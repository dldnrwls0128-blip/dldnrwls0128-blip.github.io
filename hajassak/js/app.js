/** 하자싹 — 현장 시공불량·하자 관리 (오프라인 PWA) */
import * as db from "./db.js";
import * as M from "./model.js";
import { $, $$, esc, n, toast, busy, initNav, go, replace, back, rerender, navDepth, pushLayer, closeLayer, unwind, openSheet, ask, prompt2, choose, pickFile } from "./ui.js";
import { compressImage, downloadBlob, shareOrDownload } from "./photo.js";
import { shareKakao, shareGeneric, isMobileDevice, isAndroid, copyText, contactPickerSupported, pickContacts, canShareFiles } from "./share.js";
import * as Pro from "./pro.js";
import { speechSupported, startDictation } from "./speech.js";
import * as Sync from "./sync.js";

export const APP_VERSION = self.HAJASSAK_VERSION || "0.0.0"; // 유일 출처: /version.js (sw.js 캐시 이름도 같은 값)
export const APP_NAME = "하자싹";
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("hs:" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hs:" + k, JSON.stringify(v)); } catch {} },
};
const S = {
  projects: [], pid: LS.get("pid", ""), defects: [], vendors: [], plans: [], pidx: new Map(),
  filter: LS.get("filter", { status: "_open" }), listMode: LS.get("listMode", "list"), listLimit: 60,
  draft: null, select: new Set(), selRoute: "", selAnchor: null, issuer: LS.get("issuer", ""),
};
const P = () => S.projects.find((p) => p.id === S.pid) || null;
const PD = () => S.defects.filter((d) => d.projectId === S.pid);
const V = (id) => S.vendors.find((v) => v.id === id) || null;
/** 업체 이름: 업체 기록 → 하자에 적어 둔 이름 → ‘업체 정보 받는 중’(다른 기기에서 업체 기록이 아직 안 왔을 때) */
const vLabel = (id) => { const v = V(id); if (v) return v.name; const d = id && S.defects.find((x) => x.vendorId === id && x.vendorName); return d ? d.vendorName : "업체 정보 받는 중"; };
const vName = (d) => V(d.vendorId)?.name || d.vendorName || "";
const photoCount = (d) => S.pidx.get(d.id) || { before: 0, after: 0 };
const view = () => $("#view");
const q = () => Object.fromEntries(new URLSearchParams((location.hash.split("?")[1] || "")));
const pill = (s) => `<span class="pill ${M.STATUS_CLS[s] || ""}">${esc(s)}</span>`;
const sevBadge = (d) => (d.severity === "긴급" ? '<span class="sev">긴급</span>' : "");
const fmtDT = (iso) => { const d = new Date(iso); return `${M.todayStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const shortDate = (s) => (s ? s.slice(5).replace("-", "/") : "");

function setHeader(title, { backBtn = navDepth() > 1, action = "" } = {}) {
  $("#header-title").textContent = title;
  $("#btn-back").hidden = !backBtn;
  $("#hdr-action").innerHTML = action;
}
function setTab(tab) { $$(".tab-item").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab)); $(".tab-bar").hidden = !tab; }

/* ---------- 데이터 ---------- */
async function loadAll() {
  [S.projects, S.defects, S.vendors, S.plans] = await Promise.all([db.getAll("projects"), db.getAll("defects"), db.getAll("vendors"), db.getAll("plans")]);
  S.pidx = await db.photoIndex(); db.setVendorNames(S.vendors);
  S.projects.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (!S.projects.some((p) => p.id === S.pid)) S.pid = S.projects[0]?.id || "";
  LS.set("pid", S.pid);
  await Pro.loadPro();
}
async function saveProject(p) { await db.put("projects", p); const i = S.projects.findIndex((x) => x.id === p.id); if (i >= 0) S.projects[i] = p; else S.projects.push(p); }
async function saveDefect(d, { local = true } = {}) {
  d.updatedAt = new Date().toISOString(); if (local) d.localEdited = true;
  await db.put("defects", d);
  const i = S.defects.findIndex((x) => x.id === d.id); if (i >= 0) S.defects[i] = d; else S.defects.push(d);
  requestPersist();
}
async function saveVendor(v) { await db.put("vendors", v); const i = S.vendors.findIndex((x) => x.id === v.id); if (i >= 0) S.vendors[i] = v; else S.vendors.push(v); }
function setStatus(d, status, note = "") {
  if (d.status === status && !note) return d;
  const now = new Date().toISOString();
  d.history = [...(d.history || []), { at: now, status, note, from: d.status, ...(Sync.attached() && Sync.signedIn() ? { by: Sync.actorName() } : {}) }];
  d.status = status;
  if (status === "업체전달") d.sentAt = now;
  if (status === "조치완료") d.doneAt = now;
  if (status === "확인완료") d.confirmedAt = now;
  if (status === "재접수") { d.reopenCount = (d.reopenCount || 0) + 1; d.doneAt = ""; d.confirmedAt = ""; }
  return d;
}
let persistAsked = false;
async function requestPersist() {
  if (persistAsked || !navigator.storage?.persist) return; persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
async function addPhotos(defectId, files, kind, stampBase) {
  let ok = 0;
  for (const f of files) {
    try {
      const at = new Date().toISOString();
      const { blob, thumb, w, h } = await compressImage(f, { stamp: `${stampBase}\n${fmtDT(at)} · ${kind === "after" ? "조치후" : "조치전"}` });
      await db.put("photos", { id: M.uid("ph"), defectId, kind, blob, thumb, w, h, at });
      const m = S.pidx.get(defectId) || { before: 0, after: 0 }; m[kind === "after" ? "after" : "before"]++; S.pidx.set(defectId, m); ok++;
    } catch (e) { toast(e.message || "사진 처리 실패"); }
  }
  return ok;
}
const stampOf = (d) => `${P()?.name || ""} · ${M.locText(d)}\n${M.tradeText(d)}${d.type ? " · " + d.type : ""}`;

/* ---------- 라우터 ---------- */
const ROUTES = {};
async function route() {
  const path = (location.hash.split("?")[0] || "#/home").slice(2) || "home";
  document.body.classList.remove("printing");
  view().oninput = null;
  if (!LS.get("onboarded", false) && path !== "onboard" && path !== "privacy") return replace("#/onboard");
  if (!P() && !["onboard", "wizard", "settings", "privacy", "about", "restore", "pro", "sync"].includes(path)) {
    setTab("home"); setHeader(APP_NAME, { backBtn: false });
    view().innerHTML = noProject(); bindNoProject(); return;
  }
  const selKey = location.hash.split("?")[0] === "#/list" ? "#/list" : location.hash;
  if (selKey !== S.selRoute && !["item", "edit"].includes(path)) { S.select.clear(); S.selAnchor = null; S.selRoute = selKey; }
  document.body.classList.remove("has-selbar");
  const fn = ROUTES[path] || ROUTES.home;
  try { await fn(q()); } catch (e) { console.error(e); view().innerHTML = `<div class="card"><p>화면 오류: ${esc(e.message)}</p></div>`; }
  window.scrollTo(0, 0);
}
function noProject() {
  return `<div class="empty-hero"><img src="./icons/icon-192.png" alt="" width="72" height="72"><h2>첫 현장을 만들어 주세요</h2>
    <p class="help">동·층·호수를 한 번 만들어 두면 위치를 몇 번의 탭으로 고를 수 있어요.</p>
    <button type="button" class="btn btn-primary btn-lg" data-a="wizard">+ 새 현장 만들기</button>
    <button type="button" class="btn btn-lg" data-a="sample">샘플 현장 불러오기</button>
    <button type="button" class="btn btn-lg" data-a="team">👥 팀 현장 참여·열기 (초대코드)</button>
    <button type="button" class="btn btn-ghost" data-a="restore">백업 파일에서 복원</button>
    ${Sync.attached() ? `<p class="help">‘${esc(Sync.state.ws.name)}’ 팀 데이터를 받는 중이에요… (${esc(Sync.status().label)})</p>` : ""}</div>`;
}
function bindNoProject() {
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    if (a === "wizard") go("#/wizard"); else if (a === "sample") loadSample(); else if (a === "team") go("#/sync"); else go("#/restore");
  }));
}

/* ---------- 온보딩 ---------- */
const ONBOARD = [
  { ico: "📍", t: "몇 번의 탭으로 하자 등록", d: "동 → 층 → 호 → 실을 차례로 누르고, 사진을 찍으면 위치·시간이 사진에 자동으로 찍혀요." },
  { ico: "📲", t: "업체에 카톡·문자로 바로 전달", d: "업체를 등록해 두면 미조치 목록을 한 번에 카톡·문자로 보내고, 보낸 건은 ‘업체전달’로 바뀌어요." },
  { ico: "🔒", t: "인터넷 없이도, 원하면 PC·폰 동기화", d: "기본은 이 기기 안에만 저장돼요. 설정 > 동기화에서 구글 로그인하면 컴퓨터와 폰에서 같은 데이터를 실시간으로 볼 수 있어요." },
];
ROUTES.onboard = async (qq) => {
  const i = Math.min(Number(qq.i || 0), ONBOARD.length - 1);
  if (LS.get("onboarded", false) && !qq.again) return replace(P() ? "#/home" : "#/home");
  setTab(null); setHeader(APP_NAME, { backBtn: i > 0 });
  const s = ONBOARD[i];
  view().innerHTML = `<div class="onboard"><div class="ob-ico" aria-hidden="true">${s.ico}</div><h2>${esc(s.t)}</h2><p>${esc(s.d)}</p>
    <div class="dots" aria-label="${i + 1} / ${ONBOARD.length}">${ONBOARD.map((_, j) => `<span class="${j === i ? "on" : ""}"></span>`).join("")}</div>
    <div class="ob-act">${i < ONBOARD.length - 1 ? `<button type="button" class="btn btn-ghost" data-a="skip">건너뛰기</button><button type="button" class="btn btn-primary btn-lg" data-a="next">다음</button>`
      : `<button type="button" class="btn btn-primary btn-lg" data-a="done">시작하기</button>`}</div>
    <p class="help small">시작하면 <a href="#/privacy">개인정보처리방침</a>에 동의한 것으로 봅니다. 동기화를 켜기 전에는 기기 밖으로 아무것도 보내지 않아요.</p></div>`;
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.a === "next") go(`#/onboard?i=${i + 1}`);
    else { const again = !!qq.again; LS.set("onboarded", true); if (again) history.go(-(i + 1)); else if (i > 0) history.go(-i); else replace("#/home"); }
  }));
};

/* ---------- 카드 ---------- */
function defectCard(d, { sel = false } = {}) {
  const pc = photoCount(d); const od = M.isOverdue(d); const on = sel && S.select.has(d.id);
  return `<article class="dcard ${od ? "overdue" : ""} ${sel ? "selectable" : ""} ${on ? "checked" : ""}" data-id="${d.id}" tabindex="0">
    ${sel ? `<label class="dchk" title="선택 (Shift+클릭: 범위 선택)"><input type="checkbox" class="dsel" data-sel="${d.id}" aria-label="${esc(M.locText(d) || "하자")} ${esc(M.tradeText(d))} 선택" ${on ? "checked" : ""}></label>` : ""}
    <div class="dc-top"><span class="dc-loc">${esc(M.locText(d) || "위치 미지정")}</span>${pill(d.status)}</div>
    <div class="dc-mid">${sevBadge(d)}<b>${esc(M.tradeText(d) || "공종 미지정")}</b>${d.type ? ` <span class="tbadge">${esc(d.type)}</span>` : ""} ${esc(d.content || "")}</div>
    <div class="dc-bot"><span>${esc(vName(d) || "업체 미지정")}</span>
      ${d.due ? `<span class="${od ? "od" : ""}">기한 ${shortDate(d.due)}${od ? " 초과" : ""}</span>` : ""}
      ${pc.before + pc.after ? `<span>📷${pc.before}${pc.after ? "/" + pc.after : ""}</span>` : ""}<span>${esc(d.category || "")}</span></div>
  </article>`;
}
function bindCards(root = view()) {
  $$(".dcard", root).forEach((c) => {
    const chk = $(".dchk", c);
    if (chk) {
      // 체크칸: 카드 상세로 가지 않고 선택만 바꾼다. Shift+클릭은 마지막으로 누른 칸부터 범위 선택(PC)
      chk.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target.tagName !== "INPUT") return; // label 클릭은 input click으로 다시 들어옴
        const cb = e.target; const id = c.dataset.id;
        if (e.shiftKey && S.selAnchor && S.selAnchor !== id) {
          const ids = $$(".dcard[data-id] .dsel", view()).map((x) => x.dataset.sel);
          const a = ids.indexOf(S.selAnchor), b = ids.indexOf(id);
          if (a >= 0 && b >= 0) for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) S.select[cb.checked ? "add" : "delete"](x);
        } else S.select[cb.checked ? "add" : "delete"](id);
        S.selAnchor = id; syncChecks();
      });
      chk.addEventListener("keydown", (e) => e.stopPropagation());
    }
    const open = () => go(`#/item?id=${c.dataset.id}`);
    c.addEventListener("click", open);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === c) open(); });
  });
}
/* ---------- 체크 선택(세대·목록·업체 화면 공통) ---------- */
const selItems = () => S.defects.filter((d) => S.select.has(d.id));
function selBarHtml({ all = false } = {}) {
  return `<div id="selbar" class="selbar" hidden role="region" aria-label="선택한 하자"><span id="selcount"></span>
    ${all ? '<button type="button" class="btn btn-sm" data-sa="all">전체선택</button>' : ""}
    <button type="button" class="btn btn-sm btn-primary" data-sa="send">보내기</button><button type="button" class="btn btn-sm" data-sa="status">상태변경</button><button type="button" class="btn btn-sm btn-ghost" data-sa="clear">해제</button></div>`;
}
/** 체크 상태를 화면(카드·그룹 전체칸·그룹 보내기 버튼·하단 바)에 반영 */
function syncChecks() {
  for (const cb of $$(".dsel", view())) { const on = S.select.has(cb.dataset.sel); cb.checked = on; cb.closest(".dcard")?.classList.toggle("checked", on); }
  for (const g of $$("[data-gall]", view())) {
    const ids = g.dataset.gall.split(","); const k = ids.filter((x) => S.select.has(x)).length;
    g.checked = k > 0 && k === ids.length; g.indeterminate = k > 0 && k < ids.length;
    const btn = $(`[data-g="${g.dataset.gi}"]`, view()); if (btn) btn.textContent = k ? `선택 ${k}건 보내기` : "보내기";
  }
  const vs = $("#btn-send"); if (vs) { vs.dataset.def ??= vs.textContent; const k = selItems().length; vs.textContent = k ? `선택 ${k}건 보내기` : vs.dataset.def; }
  updateSelBar();
}
function updateSelBar() {
  const bar = $("#selbar"); if (!bar) return;
  const n0 = selItems().length; bar.hidden = !n0; document.body.classList.toggle("has-selbar", !!n0);
  const c = $("#selcount"); if (c) c.textContent = `선택 ${n0}건`;
}
/** 하단 바 버튼. pool: ‘전체선택’ 대상 */
function bindSelBar(pool = []) {
  $$("[data-sa]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.sa; const sel = selItems();
    if (a === "all") { pool.forEach((d) => S.select.add(d.id)); return syncChecks(); }
    if (a === "clear") { S.select.clear(); return syncChecks(); }
    if (!sel.length) return toast("먼저 하자를 체크하세요");
    if (a === "send") return sendChecked(sel);
    const st = await choose(`${sel.length}건 상태 변경`, M.STATUSES.map((x) => ({ label: x, value: x })));
    if (!st) return;
    for (const d of sel) { setStatus(d, st, "일괄 변경"); await saveDefect(d); }
    toast(`${sel.length}건을 ‘${st}’(으)로 바꿨어요`); S.select.clear(); rerender();
  }));
}
/** 체크한 건 보내기: 업체가 여럿이면 어느 업체에 보낼지 고르고, 보낸 업체 건은 체크 해제(나머지는 남겨 차례로 보내기) */
async function sendChecked(sel) {
  const byV = new Map(); for (const d of sel) { const k = d.vendorId || ""; if (!byV.has(k)) byV.set(k, []); byV.get(k).push(d); }
  let vid = [...byV.keys()][0];
  if (byV.size > 1) {
    vid = await choose(`체크한 ${sel.length}건 · 업체 ${byV.size}곳 — 어느 업체에 보낼까요?`, [...byV.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([id, l]) => ({ icon: "🏢", label: id ? vLabel(id) : "업체 미지정", sub: `${l.length}건 · ${[...new Set(l.map((d) => M.tradeText(d)).filter(Boolean))].slice(0, 3).join(", ")}`, value: id || "_none" })));
    if (vid === null) return;
    if (vid === "_none") vid = "";
  }
  const items = byV.get(vid) || []; const vendor = vid ? V(vid) : null;
  if (byV.size > 1) { for (const d of items) S.select.delete(d.id); syncChecks(); toast(`나머지 ${S.select.size}건은 체크된 채로 남아 있어요 · 이어서 보내세요`, { ms: 4000 }); }
  const pool = [...new Set([...items, ...PD().filter((d) => (d.vendorId || "") === vid && d.status !== "확인완료")])];
  return sendSheet({ items: vendor ? pool : items, vendor, preselect: items.map((d) => d.id) });
}

/* ---------- 홈 ---------- */
ROUTES.home = async () => {
  setTab("home");
  const p = P(); const list = PD(); const today = M.todayStr();
  const open = list.filter(M.isOpen), od = list.filter((d) => M.isOverdue(d, today));
  const done = list.filter((d) => d.status === "조치완료" || d.status === "확인완료").length;
  const todayN = list.filter((d) => (d.createdAt || "").slice(0, 10) === today).length;
  setHeader(p.name, { backBtn: false, action: `<span class="ver-badge" id="hdr-ver" title="앱 버전">v${APP_VERSION}</span><button type="button" class="hdr-btn" id="btn-proj" aria-label="현장 전환">현장 ▾</button>` });
  const recent = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 5);
  view().innerHTML = `
    <form class="search" id="qsearch" role="search"><input class="inp" id="qs" type="search" inputmode="search" placeholder="예: ${esc(exampleQuery(p))}  ·  동/호/내용 검색" aria-label="빠른 검색"><button class="btn btn-primary" type="submit">검색</button></form>
    <div class="kpis">
      <button type="button" class="kpi" data-f='{"status":"_open"}'><b>${n(open.length)}</b><span>미조치</span></button>
      <button type="button" class="kpi warn" data-f='{"overdue":true}'><b>${n(od.length)}</b><span>기한초과</span></button>
      <button type="button" class="kpi" data-f='{"status":"업체전달"}'><b>${n(list.filter((d) => d.status === "업체전달").length)}</b><span>업체전달</span></button>
      <button type="button" class="kpi ok" data-go="#/dash"><b>${list.length ? Math.round((done / list.length) * 100) : 0}%</b><span>조치율</span></button>
    </div>
    <button type="button" class="btn btn-primary btn-xl" data-go="#/new">＋ 하자 등록</button>
    <div class="quick">
      <button type="button" class="qbtn" data-go="#/grid">🏢<span>동 현황</span></button>
      <button type="button" class="qbtn" data-go="#/vendors">📲<span>업체 전달</span></button>
      <button type="button" class="qbtn" data-go="#/dash">📊<span>대시보드</span></button>
      <button type="button" class="qbtn" data-go="#/import">📥<span>엑셀 가져오기</span></button>
    </div>
    <h3 class="sec">최근 기록 <small>오늘 등록 ${todayN}건 · 전체 ${n(list.length)}건</small></h3>
    ${recent.length ? recent.map((d) => defectCard(d)).join("") : `<div class="card empty-card"><p>아직 등록된 하자가 없어요.<br>‘＋ 하자 등록’을 눌러 시작하세요.</p></div>`}
    ${recent.length ? `<button type="button" class="btn btn-block" data-go="#/list">전체 목록 보기</button>` : ""}
    ${verFoot()}`;
  bindCards(); bindVerFoot();
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$("[data-f]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = JSON.parse(b.dataset.f); LS.set("filter", S.filter); S.listMode = "list"; go("#/list"); }));
  $("#btn-proj").addEventListener("click", switchProject);
  $("#qsearch").addEventListener("submit", (e) => { e.preventDefault(); quickSearch($("#qs").value); });
};
function exampleQuery(p) { const d = p.dongs[0]; if (!d) return "1203"; const f = Math.min(12, d.floors || 1); return `${d.alias ? d.alias + "동" : d.name} ${f * 100 + 3}`; }
function quickSearch(text) {
  const r = M.parseQuery(P(), text);
  if (r.dong && r.ho) return go(`#/unit?dong=${encodeURIComponent(r.dong)}&ho=${r.ho}`);
  if (r.dong) return go(`#/grid?dong=${encodeURIComponent(r.dong)}`);
  S.filter = r.ho ? { ho: r.ho } : { text: r.text || "" }; LS.set("filter", S.filter); S.listMode = "list"; go("#/list");
}
async function switchProject() {
  const opts = S.projects.map((p) => ({ label: p.name + (p.id === S.pid ? " ✓" : ""), sub: `${p.dongs.length}개 동 · 하자 ${n(S.defects.filter((d) => d.projectId === p.id).length)}건${p.sample ? " · 샘플" : ""}`, value: p.id }));
  opts.push({ label: "＋ 새 현장 만들기", value: "_new", icon: "➕" });
  const v = await choose("현장 선택", opts);
  if (!v) return;
  if (v === "_new") return newProjectGate();
  S.pid = v; LS.set("pid", v); S.filter = { status: "_open" }; LS.set("filter", S.filter); rerender();
}
const realProjects = () => S.projects.filter((p) => !p.sample).length;
async function newProjectGate() {
  if (!Pro.can("multiProject", { projectCount: realProjects() })) return proSheet("무료판은 현장 1개까지 만들 수 있어요.");
  go("#/wizard");
}

/* ---------- 목록 ---------- */
const FILTER_LABEL = { dong: "동", ho: "호", trade: "공종", vendorId: "업체", type: "유형", category: "구분", severity: "중요도", status: "상태", overdue: "기한초과", text: "검색" };
function filterChipText(k, v) {
  if (k === "status") return v === "_open" ? "미조치" : v;
  if (k === "vendorId") return v === "_none" ? "업체 미지정" : vLabel(v);
  if (k === "overdue") return "기한초과";
  if (k === "ho") return v + "호";
  if (k === "text") return `“${v}”`;
  return v;
}
ROUTES.list = async () => {
  setTab("list");
  setHeader("하자 목록", { backBtn: navDepth() > 1 });
  const f = S.filter; const all = PD();
  const list = M.applyFilter(all, f, { vendorName: vName }).sort((a, b) => (M.isOverdue(b) - M.isOverdue(a)) || (a.createdAt < b.createdAt ? 1 : -1));
  const chips = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `<button type="button" class="chip on" data-rm="${k}">${esc(FILTER_LABEL[k])}: ${esc(filterChipText(k, v))} ✕</button>`).join("");
  view().innerHTML = `
    <form class="search" id="lsearch" role="search"><input class="inp" id="ls" type="search" value="${esc(f.text || "")}" placeholder="내용·위치·업체 검색" aria-label="목록 검색">
      <button type="button" class="btn" id="btn-filter">필터${M.filterCount(f) ? ` <b class="badge">${M.filterCount(f)}</b>` : ""}</button></form>
    <div class="chips scroll">${chips || '<span class="help">필터 없음 · 전체</span>'}${chips ? '<button type="button" class="chip" data-rm="_all">모두 지우기</button>' : ""}</div>
    <div class="list-hd"><b>${n(list.length)}건</b><span class="help">기한초과 ${n(list.filter((d) => M.isOverdue(d)).length)}</span>
      <span class="sp"></span><button type="button" class="btn btn-sm" id="btn-export">내보내기</button><button type="button" class="btn btn-sm btn-primary" id="btn-sendlist">업체에 보내기</button></div>
    <div id="cards">${list.slice(0, S.listLimit).map((d) => defectCard(d, { sel: true })).join("") || `<div class="card empty-card"><p>조건에 맞는 하자가 없어요.</p></div>`}</div>
    ${list.length > S.listLimit ? `<button type="button" class="btn btn-block" id="btn-more">더 보기 (${n(list.length - S.listLimit)}건 남음)</button>` : ""}
    ${selBarHtml({ all: true })}`;
  bindCards(); syncChecks(); bindSelBar(list);
  $("#lsearch").addEventListener("submit", (e) => { e.preventDefault(); S.filter = { ...S.filter, text: $("#ls").value.trim() }; LS.set("filter", S.filter); rerender(); });
  $("#btn-filter").addEventListener("click", () => filterSheet());
  $$("[data-rm]", view()).forEach((b) => b.addEventListener("click", () => { if (b.dataset.rm === "_all") S.filter = {}; else delete S.filter[b.dataset.rm]; LS.set("filter", S.filter); rerender(); }));
  $("#btn-more")?.addEventListener("click", () => { S.listLimit += 120; rerender(); });
  $("#btn-export").addEventListener("click", () => exportSheet(list, "하자목록"));
  $("#btn-sendlist").addEventListener("click", () => sendSheet({ items: list }));
};
function filterSheet() {
  const p = P(); const f = { ...S.filter };
  const sel = (k, opts, label) => `<label class="fld"><span>${label}</span><select class="inp" data-k="${k}"><option value="">전체</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(f[k] || "") === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  const usedTrades = [...new Set([...p.trades.map((t) => t.name), ...PD().map((d) => d.trade).filter(Boolean)])];
  const usedTypes = [...new Set([...p.types, ...PD().map((d) => d.type).filter(Boolean)])];
  const s = openSheet({
    title: "필터", full: true,
    html: `<div class="grid2">
      ${sel("dong", p.dongs.map((d) => [d.name, d.name]), "동")}
      <label class="fld"><span>호</span><input class="inp" data-k="ho" inputmode="numeric" value="${esc(f.ho || "")}" placeholder="예: 1203"></label>
      ${sel("status", [["_open", "미조치 전체"], ...M.STATUSES.map((x) => [x, x])], "상태")}
      ${sel("category", [...new Set([...M.catsOf(p), ...PD().map((d) => d.category).filter(Boolean)])].map((x) => [x, x]), "구분")}
      ${sel("trade", usedTrades.map((x) => [x, x]), "공종")}
      ${sel("vendorId", [["_none", "업체 미지정"], ...S.vendors.map((v) => [v.id, v.name])], "업체")}
      ${sel("type", usedTypes.map((x) => [x, x]), "유형")}
      ${sel("severity", M.SEVERITIES.map((x) => [x, x]), "중요도")}</div>
      <label class="check"><input type="checkbox" data-k="overdue" ${f.overdue ? "checked" : ""}> 기한초과만</label>
      <label class="fld"><span>검색어</span><input class="inp" data-k="text" value="${esc(f.text || "")}" placeholder="내용·위치·메모"></label>`,
    footer: `<button type="button" class="btn" data-a="reset">초기화</button><button type="button" class="btn btn-primary" data-a="apply">적용</button>`,
  });
  $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", async () => {
    const nf = {};
    if (b.dataset.a === "apply") $$("[data-k]", s.el).forEach((i) => { const v = i.type === "checkbox" ? i.checked : i.value.trim(); if (v) nf[i.dataset.k] = v; });
    S.filter = nf; LS.set("filter", nf); S.listLimit = 60; await s.close(); rerender();
  }));
}

/* ---------- 세대 보기 ---------- */
ROUTES.unit = async (qq) => {
  setTab("list");
  const dong = qq.dong, ho = qq.ho || "";
  setHeader(`${dong} ${ho ? ho + "호" : ""}`);
  const all = PD().filter((d) => d.dong === dong && (ho ? d.ho === ho : !d.ho));
  const onlyOpen = LS.get("unitOpen", true);
  const list = onlyOpen ? all.filter(M.isOpen) : all;
  const groups = M.groupByTradeVendor(list, vName);
  view().innerHTML = `
    <div class="unit-hd"><div><b>${n(all.filter(M.isOpen).length)}</b> 미조치 / ${n(all.length)}건 · 기한초과 ${all.filter((d) => M.isOverdue(d)).length}</div>
      <div class="chips"><button type="button" class="chip ${onlyOpen ? "on" : ""}" data-o="1">미조치</button><button type="button" class="chip ${!onlyOpen ? "on" : ""}" data-o="0">전체</button></div></div>
    <button type="button" class="btn btn-primary btn-block" id="btn-add">＋ 이 세대에 하자 등록</button>
    ${groups.map((g, gi) => `<section class="group"><header class="grp-hd"><label class="gchk" title="이 묶음 전체 선택"><input type="checkbox" data-gall="${g.items.map((d) => d.id).join(",")}" data-gi="${gi}" aria-label="${esc(g.trade)} · ${esc(g.vendor)} 전체 선택"><span>전체</span></label><div class="grp-tt"><b>${esc(g.trade)}</b> · ${esc(g.vendor)} <span class="help">${g.items.length}건</span></div>
      <button type="button" class="btn btn-sm btn-primary" data-g="${gi}">보내기</button></header>${g.items.map((d) => defectCard(d, { sel: true })).join("")}</section>`).join("") ||
      `<div class="card empty-card"><p>${onlyOpen ? "미조치 하자가 없어요 👍" : "등록된 하자가 없어요."}</p></div>`}
    ${selBarHtml()}`;
  bindCards(); bindSelBar();
  $$("[data-gall]", view()).forEach((g) => g.addEventListener("change", () => { const ids = g.dataset.gall.split(","); const on = g.checked; for (const x of ids) S.select[on ? "add" : "delete"](x); syncChecks(); }));
  syncChecks();
  $("#btn-add").addEventListener("click", () => { startDraft({ dong, ho, floor: M.floorOfHo(ho) }); go("#/new"); });
  $$("[data-o]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("unitOpen", b.dataset.o === "1"); rerender(); }));
  $$("[data-g]", view()).forEach((b) => b.addEventListener("click", () => { const g = groups[+b.dataset.g]; const picked = g.items.filter((d) => S.select.has(d.id)).map((d) => d.id);
    sendSheet({ items: g.items, vendor: V(g.vendorId), preselect: picked.length ? picked : null }); }));
};

/* ---------- 동 현황(히트맵) ---------- */
ROUTES.grid = async (qq) => {
  setTab("list");
  const p = P(); const dong = p.dongs.find((d) => d.name === qq.dong) || p.dongs[0];
  setHeader("동 현황");
  if (!dong) { view().innerHTML = `<div class="card empty-card"><p>동이 없어요. 설정 &gt; 현장 설정에서 동을 추가하세요.</p><button class="btn btn-primary" type="button" onclick="location.hash='#/project'">현장 설정</button></div>`; return; }
  const list = PD().filter((d) => d.dong === dong.name);
  const by = new Map(); for (const d of list) { if (!d.ho) continue; const m = by.get(d.ho) || { open: 0, all: 0, od: 0 }; m.all++; if (M.isOpen(d)) m.open++; if (M.isOverdue(d)) m.od++; by.set(d.ho, m); }
  const th = M.heatThresholds(p, PD()); const cnt = (m) => (th.basis === "all" ? m.all : m.open);
  const floors = []; for (let f = dong.floors; f >= (dong.unitStart || 1); f--) if (M.unitsOf(dong, String(f)).length) floors.push(f);
  const lines = M.linesOf(dong);
  const common = list.filter((d) => !d.ho);
  view().innerHTML = `
    <div class="chips scroll">${p.dongs.map((d) => `<button type="button" class="chip ${d.id === dong.id ? "on" : ""}" data-d="${esc(d.name)}">${esc(d.name)}</button>`).join("")}</div>
    <div class="list-hd"><b>${esc(dong.name)}</b><span class="help">미조치 ${list.filter(M.isOpen).length} / ${list.length}건</span></div>
    ${heatLegendHtml(th)}
    <div class="hgrid" style="--cols:${lines.length}">${floors.map((f) => { const us = new Set(M.unitsOf(dong, String(f))); return `<div class="hf">${f}F</div>` + lines.map((l) => String(f * 100 + l)).map((ho) => {
      if (!us.has(ho)) return `<span class="hc hx" aria-hidden="true"></span>`;
      const m = by.get(ho) || { open: 0, all: 0, od: 0 }; const n = cnt(m); const lv = M.heatLevel(n, th);
      return `<button type="button" class="hc h${lv} ${m.od ? "od" : ""} ${m.all && !m.open && th.basis !== "all" ? "done" : ""}" data-ho="${ho}" data-n="${n}" data-lv="${lv}" aria-label="${ho}호 ${th.basis === "all" ? "전체" : "미조치"} ${n}건"><span>${ho}</span>${m.all ? `<b>${n}</b>` : ""}</button>`;
    }).join(""); }).join("")}</div>
    <h3 class="sec">공용부·세대 외 <small>${common.filter(M.isOpen).length} / ${common.length}건</small></h3>
    ${common.slice(0, 30).map((d) => defectCard(d)).join("") || '<p class="help">없음</p>'}`;
  bindCards();
  $$("[data-d]", view()).forEach((b) => b.addEventListener("click", () => replace(`#/grid?dong=${encodeURIComponent(b.dataset.d)}`)));
  $$("[data-ho]", view()).forEach((b) => b.addEventListener("click", () => go(`#/unit?dong=${encodeURIComponent(dong.name)}&ho=${b.dataset.ho}`)));
  $("#heat-cfg", view())?.addEventListener("click", () => heatSheet());
};
function heatLegendHtml(th, { gear = true } = {}) {
  return `<div class="legend" id="heat-legend">${M.heatLegend(th).map((x) => `<span class="lg"><span class="hm h${x.lv}"></span>${esc(x.label)}</span>`).join("")}<span class="lg"><span class="hm odl"></span>기한초과</span>
    <span class="lg-basis">${th.basis === "all" ? "전체" : "미조치"} 기준${th.mode === "auto" ? " · 자동" : ""}</span>${gear ? '<button type="button" class="lg-gear" id="heat-cfg" aria-label="색 기준 설정" title="색 기준 설정">⚙</button>' : ""}</div>`;
}
/** 동현황 색 기준 설정(현장별 저장 → 동기화) */
async function heatSheet() {
  const p = P(); if (!p) return;
  const c = M.heatCfg(p); const st = { ...c };
  const auto0 = M.autoThresholds(M.unitCounts(PD(), st.basis));
  if (st.mode === "auto") { st.low = auto0.low; st.high = auto0.high; }
  const s = openSheet({ title: "동현황 색 기준", cls: "heat-sheet",
    html: `<p class="help">세대별 하자 수에 따라 동현황 칸 색을 정해요. 0건은 ‘없음’이에요. 현장마다 따로 저장돼요.</p>
      <div class="fld"><span>세는 기준</span><div class="seg" id="hs-basis"><button type="button" data-v="open">미조치만</button><button type="button" data-v="all">전체(완료 포함)</button></div></div>
      <div class="fld"><span>기준 정하기</span><div class="seg" id="hs-mode"><button type="button" data-v="auto">자동(데이터 분포 기준)</button><button type="button" data-v="manual">직접 입력</button></div></div>
      <div class="hs-nums"><label class="fld"><span>적음: 1건 ~</span><input class="inp" id="hs-low" type="number" inputmode="numeric" min="1" step="1"></label>
        <label class="fld"><span>많음: 이 건수 이상</span><input class="inp" id="hs-high" type="number" inputmode="numeric" min="2" step="1"></label></div>
      <p class="help small" id="hs-auto-note"></p><p class="err" id="hs-err" role="alert"></p>
      <div class="fld"><span>미리보기</span><div id="hs-prev"></div><div class="hs-swatch" id="hs-sw"></div></div>`,
    footer: '<button type="button" class="btn" data-a="cancel">취소</button><button type="button" class="btn btn-primary" data-a="save">저장</button>' });
  const el = s.el; const low = $("#hs-low", el), high = $("#hs-high", el);
  const read = () => ({ low: parseInt(low.value, 10), high: parseInt(high.value, 10) });
  const paint = () => {
    $$("#hs-basis button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === st.basis));
    $$("#hs-mode button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === st.mode));
    const isAuto = st.mode === "auto";
    if (isAuto) { const a = M.autoThresholds(M.unitCounts(PD(), st.basis)); low.value = a.low; high.value = a.high; }
    low.disabled = high.disabled = isAuto;
    const n = M.unitCounts(PD(), st.basis).filter((x) => x > 0).length;
    $("#hs-auto-note", el).textContent = isAuto ? `하자 있는 세대 ${n}곳의 분포로 계산했어요(하위 1/3까지 적음, 상위 20%부터 많음). 데이터가 바뀌면 기준도 따라 바뀌어요.` : "";
    const v = read(); const err = M.validHeat(v.low, v.high); $("#hs-err", el).textContent = err;
    $("[data-a=save]", el).disabled = !!err;
    if (!err) { const t = { ...v, basis: st.basis, mode: st.mode }; $("#hs-prev", el).innerHTML = heatLegendHtml(t, { gear: false });
      const samples = [0, 1, v.low, v.low + 1, v.high - 1, v.high, v.high + 5].filter((x, i, a) => x >= 0 && a.indexOf(x) === i).sort((a, b) => a - b);
      $("#hs-sw", el).innerHTML = samples.map((x) => `<span class="hc h${M.heatLevel(x, t)}" data-lv="${M.heatLevel(x, t)}"><b>${x}</b><span>건</span></span>`).join(""); }
    else { $("#hs-prev", el).innerHTML = ""; $("#hs-sw", el).innerHTML = ""; }
  };
  low.value = st.low; high.value = st.high; paint();
  $("#hs-basis", el).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { st.basis = b.dataset.v; paint(); } });
  $("#hs-mode", el).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; if (b.dataset.v === "manual" && st.mode === "auto") { /* 자동값에서 시작 */ } st.mode = b.dataset.v; paint(); });
  low.addEventListener("input", paint); high.addEventListener("input", paint);
  $("[data-a=cancel]", el).addEventListener("click", () => s.close());
  $("[data-a=save]", el).addEventListener("click", async () => {
    const v = read(); if (M.validHeat(v.low, v.high)) return;
    p.heat = st.mode === "auto" ? { mode: "auto", basis: st.basis, low: c.low, high: c.high } : { mode: "manual", basis: st.basis, low: v.low, high: v.high };
    await saveProject(p); await s.close(); toast("색 기준을 저장했어요"); rerender();
  });
}

/* ---------- 대시보드 ---------- */
ROUTES.dash = async () => {
  setTab("home"); setHeader("대시보드", { backBtn: navDepth() > 1 });
  const list = PD(); const today = M.todayStr(); const now = Date.now();
  const st = new Map(M.countBy(list, "status"));
  const done = (st.get("조치완료") || 0) + (st.get("확인완료") || 0);
  const open = list.filter(M.isOpen); const od = list.filter((d) => M.isOverdue(d, today));
  const aging = [["3일 이내", 0, 3], ["4~7일", 4, 7], ["8~14일", 8, 14], ["15~30일", 15, 30], ["30일 초과", 31, 1e9]].map(([l, a, b]) => [l, open.filter((d) => { const x = M.ageDays(d, now); return x >= a && x <= b; }).length]);
  const amax = Math.max(1, ...aging.map((a) => a[1]));
  const vrows = new Map();
  for (const d of list) { const k = d.vendorId || "_none"; const m = vrows.get(k) || { all: 0, open: 0, od: 0, done: 0 }; m.all++; if (M.isOpen(d)) m.open++; if (M.isOverdue(d, today)) m.od++; if (!M.isOpen(d)) m.done++; vrows.set(k, m); }
  const vlist = [...vrows.entries()].sort((a, b) => b[1].open - a[1].open);
  const bar = (v, max, cls = "") => `<span class="bar ${cls}"><i style="width:${Math.round((v / Math.max(1, max)) * 100)}%"></i></span>`;
  const types = M.countBy(open, "type").slice(0, 8); const tmax = Math.max(1, ...types.map((t) => t[1]));
  const dongs = M.countBy(open, "dong").slice(0, 12); const dmax = Math.max(1, ...dongs.map((t) => t[1]));
  const cats = M.countBy(list, "category"); const copen = new Map(M.countBy(open, "category")); const cmax = Math.max(1, ...cats.map((t) => t[1]));
  view().innerHTML = `
    <div class="kpis"><div class="kpi"><b>${n(list.length)}</b><span>전체</span></div><div class="kpi"><b>${n(open.length)}</b><span>미조치</span></div>
      <div class="kpi warn"><b>${n(od.length)}</b><span>기한초과</span></div><div class="kpi ok"><b>${list.length ? Math.round((done / list.length) * 100) : 0}%</b><span>조치율</span></div></div>
    <section class="card"><h3>상태별</h3><div class="stbar">${M.STATUSES.map((s) => (st.get(s) ? `<i class="${M.STATUS_CLS[s]}" style="flex:${st.get(s)}" title="${s}"></i>` : "")).join("")}</div>
      <div class="stleg">${M.STATUSES.map((s) => `<button type="button" class="lg" data-st="${s}">${pill(s)} ${n(st.get(s) || 0)}</button>`).join("")}</div></section>
    <section class="card"><h3>업체별 <small>미조치 · 기한초과 · 조치율</small></h3>
      <table class="tbl"><tbody>${vlist.map(([k, m]) => `<tr data-v="${k}"><td>${esc(k === "_none" ? "업체 미지정" : vLabel(k))}</td><td class="r">${m.open}</td><td class="r ${m.od ? "od" : ""}">${m.od}</td><td class="w">${bar(m.done, m.all, "ok")}<small>${Math.round((m.done / m.all) * 100)}%</small></td></tr>`).join("") || '<tr><td class="help">데이터 없음</td></tr>'}</tbody></table></section>
    <section class="card"><h3>미조치 경과일</h3>${aging.map(([l, v]) => `<div class="hrow"><span>${l}</span>${bar(v, amax, v && l.includes("초과") ? "bad" : "")}<b>${v}</b></div>`).join("")}</section>
    <section class="card"><h3>구분별 <small>전체 · 미조치</small></h3>${cats.map(([t, v]) => `<div class="hrow" data-cat="${esc(t)}"><span>${esc(t || "-")}</span>${bar(v, cmax)}<b>${v}<small> · ${copen.get(t) || 0}</small></b></div>`).join("") || '<p class="help">없음</p>'}</section>
    <section class="card"><h3>유형별(미조치)</h3>${types.map(([t, v]) => `<div class="hrow"><span>${esc(t || "-")}</span>${bar(v, tmax)}<b>${v}</b></div>`).join("") || '<p class="help">없음</p>'}</section>
    <section class="card"><h3>동별(미조치)</h3>${dongs.map(([t, v]) => `<div class="hrow" data-dg="${esc(t)}"><span>${esc(t || "-")}</span>${bar(v, dmax)}<b>${v}</b></div>`).join("") || '<p class="help">없음</p>'}</section>`;
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = { status: b.dataset.st }; LS.set("filter", S.filter); go("#/list"); }));
  $$("[data-v]", view()).forEach((r) => r.addEventListener("click", () => { if (r.dataset.v === "_none") { S.filter = { vendorId: "_none", status: "_open" }; LS.set("filter", S.filter); go("#/list"); } else go(`#/vendor?id=${r.dataset.v}`); }));
  $$("[data-cat]", view()).forEach((r) => r.addEventListener("click", () => { if (!r.dataset.cat) return; S.filter = { category: r.dataset.cat }; LS.set("filter", S.filter); go("#/list"); }));
  $$("[data-dg]", view()).forEach((r) => r.addEventListener("click", () => go(`#/grid?dong=${encodeURIComponent(r.dataset.dg)}`)));
};

/* ---------- 하자 등록/수정 ---------- */
function startDraft(loc = {}, base = null) {
  const p = P();
  S.draft = base ? { ...structuredClone({ ...base, history: undefined }), _editId: base.id, photos: [] } : {
    dong: "", floor: "", ho: "", common: "", room: "", part: "", locEtc: "", trade: "", subTrade: "", type: "", category: LS.get("lastCat", "시공불량"),
    severity: "보통", content: "", vendorId: "", vendorAuto: true, due: M.addDays(p.dueDays ?? 7), pin: null, photos: [], ...loc,
  };
}
ROUTES.new = async () => { if (!S.draft || S.draft._editId) startDraft(); renderForm(); };
ROUTES.edit = async (qq) => {
  const d = S.defects.find((x) => x.id === qq.id); if (!d) return replace("#/list");
  if (!S.draft || S.draft._editId !== d.id) startDraft({}, d);
  renderForm();
};
function chipRow(name, opts, cur, { allowAdd = false, ua = null } = {}) {
  return `<div class="chips wrap" data-chips="${name}">${opts.map((o) => { const u = ua?.(o); return `<button type="button" class="chip ${o === cur ? "on" : ""} ${u ? "ua" : ""}" data-v="${esc(o)}"${u ? ' data-ua="1"' : ""}>${esc(o)}${u ? '<span class="ua-ed" data-ed="1" title="이름 변경·삭제">✎</span>' : ""}</button>`; }).join("")}${allowAdd ? `<button type="button" class="chip add" data-add="${name}">＋ 직접 추가</button>` : ""}</div>`;
}
/* ---------- 직접 추가·편집 공용 (위치 선택기·등록 폼) ---------- */
/** 작은 입력 시트(레이어 → 뒤로가기로 닫힘). validate(vals) → 오류 문구("" = 통과). 결과 Promise<vals|null> */
function formSheet({ title, fields, ok = "추가", hint = "", validate = () => "" }) {
  return new Promise((resolve) => {
    let val = null;
    const s = openSheet({ title, cls: "dialog add-sheet",
      html: `${hint ? `<p class="help">${esc(hint)}</p>` : ""}${fields.map((x, i) => `<label class="fld"><span>${esc(x.label)}</span><input class="inp" data-fk="${x.k}" type="${x.type || "text"}" ${x.inputmode ? `inputmode="${x.inputmode}"` : ""} value="${esc(x.value ?? "")}" placeholder="${esc(x.placeholder || "")}" ${i === 0 ? 'enterkeyhint="done"' : ""}></label>`).join("")}<p class="fs-err" role="alert"></p>`,
      footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="yes">${esc(ok)}</button>` });
    const ins = $$("input", s.el); setTimeout(() => ins[0]?.focus(), 50);
    s.onClose = () => resolve(val);
    const yes = () => {
      const v = Object.fromEntries(ins.map((i) => [i.dataset.fk, i.value.trim()]));
      const err = validate(v); if (err) { const e = $(".fs-err", s.el); e.textContent = err; return; }
      val = v; s.close();
    };
    ins.forEach((i) => { i.addEventListener("keydown", (e) => { if (e.key === "Enter") yes(); }); i.addEventListener("input", () => { $(".fs-err", s.el).textContent = ""; }); });
    $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", () => (b.dataset.a === "yes" ? yes() : s.close())));
  });
}
/** 하자 필드 ↔ 현장 목록 키 */
const LIST_FIELD = { commons: "common", rooms: "room", parts: "part", types: "type", categories: "category", trades: "trade" };
const LIST_NAME = { commons: "공용부", rooms: "실", parts: "부위", types: "유형", categories: "구분", trades: "공종", subTrade: "세부공종" };
const listArr = (p, k) => { if (k === "categories" && !Array.isArray(p.categories)) p.categories = [...M.catsOf(p)]; return k === "trades" ? p.trades.map((t) => t.name) : p[k]; };
const isUserItem = (k, v) => !M.defaultsOf(k).includes(v);
/** 목록(공용부·실·부위·유형·구분·공종)에 새 항목 추가 → 이름 또는 null */
async function addListItem(k) {
  const p = P(); const arr = listArr(p, k); const nm = LIST_NAME[k];
  const r = await formSheet({ title: `${nm} 직접 추가`, ok: "추가하고 선택", hint: "현장 설정에 저장돼서 다음부터 바로 고를 수 있어요.",
    fields: [{ k: "v", label: `${nm} 이름`, placeholder: { commons: "예: 경비실", rooms: "예: 알파룸", parts: "예: 걸레받이", types: "예: 결로", categories: "예: 준공검사", trades: "예: 방음" }[k] }],
    validate: ({ v }) => (!v ? "이름을 입력하세요" : v.length > 20 ? "20자 이내로 입력하세요" : M.hasSame(arr, v) ? `이미 있는 ${nm}이에요: ${arr.find((x) => M.sameKey(x) === M.sameKey(v))}` : "") });
  if (!r) return null;
  if (k === "trades") p.trades.push({ name: r.v, subs: [] }); else p[k].push(r.v);
  await saveProject(p); toast(`${nm} ‘${r.v}’ 추가했어요`); return r.v;
}
/** 직접 추가한 항목 이름 변경·삭제. 이름 변경은 기존 하자에도 반영, 삭제는 사용 중이 아닐 때만. → "ren"|"del"|null */
async function editUserItem({ kind, name, used, rename, remove }) {
  const act = await choose(name, [{ label: "이름 변경", value: "ren", icon: "✎", sub: used ? `하자 ${used}건의 이름도 함께 바뀌어요` : "" },
    used ? { label: "삭제할 수 없어요", value: "used", icon: "🔒", sub: `하자 ${used}건에서 사용 중` } : { label: "삭제", value: "del", icon: "🗑", sub: "사용 중인 하자가 없어요" }]);
  if (act === "used") { toast(`하자 ${used}건에서 쓰고 있어 삭제할 수 없어요`); return null; }
  if (act === "del") { if (!(await ask(`${kind} ‘${name}’을(를) 목록에서 삭제할까요?`, { ok: "삭제", danger: true }))) return null; await remove(); toast("삭제했어요"); return "del"; }
  if (act === "ren") { const ok = await rename(); return ok ? "ren" : null; }
  return null;
}
/** 목록 항목(공용부·실·부위·유형·구분·공종) 편집 */
async function editListItem(k, name) {
  const p = P(); const fld = LIST_FIELD[k]; const nm = LIST_NAME[k];
  const users = () => PD().filter((d) => d[fld] === name);
  return editUserItem({ kind: nm, name, used: users().length,
    remove: async () => { if (k === "trades") p.trades = p.trades.filter((t) => t.name !== name); else p[k] = p[k].filter((x) => x !== name); await saveProject(p); },
    rename: async () => {
      const arr = listArr(p, k);
      const r = await formSheet({ title: `${nm} 이름 변경`, ok: "변경", fields: [{ k: "v", label: "새 이름", value: name }],
        validate: ({ v }) => (!v ? "이름을 입력하세요" : v.length > 20 ? "20자 이내로 입력하세요" : M.hasSame(arr, v, name) ? `이미 있는 ${nm}이에요` : "") });
      if (!r || r.v === name) return false;
      if (k === "trades") { const t = p.trades.find((x) => x.name === name); if (t) t.name = r.v; for (const v of S.vendors) if ((v.trades || []).includes(name)) { v.trades = v.trades.map((x) => (x === name ? r.v : x)); await saveVendor(v); } }
      else p[k] = p[k].map((x) => (x === name ? r.v : x));
      await saveProject(p);
      for (const d of users()) { d[fld] = r.v; await saveDefect(d, { local: false }); }
      if (S.draft?.[fld] === name) S.draft[fld] = r.v;
      if (k === "categories" && LS.get("lastCat") === name) LS.set("lastCat", r.v);
      toast("이름을 바꿨어요"); return true;
    } });
}
/** 길게 누르기(0.55초) → onLong(el). 이후 click은 무시 */
function onLongPress(root, sel, onLong) {
  let t = 0, fired = false, sx = 0, sy = 0;
  root.addEventListener("pointerdown", (e) => { const el = e.target.closest(sel); if (!el) return; fired = false; sx = e.clientX; sy = e.clientY; clearTimeout(t); t = setTimeout(() => { fired = true; onLong(el); }, 550); });
  root.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) clearTimeout(t); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => root.addEventListener(ev, () => clearTimeout(t)));
  root.addEventListener("contextmenu", (e) => { if (e.target.closest(sel)) e.preventDefault(); });
  root.addEventListener("click", (e) => { if (fired && e.target.closest(sel)) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}
function matchPlans(dr) { const p = P(); return S.plans.filter((pl) => pl.projectId === p.id && dr.dong && M.planMatches(pl, dr.dong, dr.floor || M.floorOfHo(dr.ho))); }
function renderForm() {
  const p = P(); const dr = S.draft; const editing = !!dr._editId;
  setTab(editing ? null : "new"); setHeader(editing ? "하자 수정" : "하자 등록", { backBtn: navDepth() > 1 || editing });
  const trade = p.trades.find((t) => t.name === dr.trade);
  const sug = M.suggestVendor(S.vendors, dr.trade, p.id);
  if (dr.vendorAuto && sug) dr.vendorId = sug.id;
  const loc = M.locText(dr);
  const plans = matchPlans(dr);
  const prevPhotos = editing ? photoCount({ id: dr._editId }) : { before: 0, after: 0 };
  view().innerHTML = `<form id="dform" class="form" novalidate>
    <label class="fld"><span>위치 <em>*</em></span>
      <button type="button" class="inp loc-btn ${loc ? "" : "ph"}" id="btn-loc">${esc(loc || "동·층·호·실 선택")}<span>›</span></button></label>
    ${plans.length ? `<button type="button" class="btn btn-sm" id="btn-pin">🗺 도면에 위치 표시${dr.pin ? " ✓" : ""}</button>` : ""}
    <div class="fld"><span>구분</span>${chipRow("category", M.catsOf(p), dr.category, { allowAdd: true, ua: (o) => isUserItem("categories", o) })}</div>
    <div class="fld"><span>공종 <em>*</em></span>${chipRow("trade", p.trades.map((t) => t.name), dr.trade, { allowAdd: true, ua: (o) => isUserItem("trades", o) })}</div>
    ${trade?.subs?.length ? `<div class="fld"><span>세부공종</span>${chipRow("subTrade", trade.subs, dr.subTrade, { allowAdd: true })}</div>` : ""}
    <div class="fld"><span>유형</span>${chipRow("type", p.types, dr.type, { allowAdd: true, ua: (o) => isUserItem("types", o) })}</div>
    <div class="fld"><span>중요도</span>${chipRow("severity", M.SEVERITIES, dr.severity)}</div>
    <label class="fld"><span>내용 <em>*</em></span><div class="ta-wrap"><textarea class="inp" id="f-content" rows="3" placeholder="예: 거실 창호 하부 실리콘 미시공">${esc(dr.content)}</textarea>
      ${speechSupported() ? `<button type="button" class="mic" id="btn-mic" aria-label="음성으로 입력">🎤</button>` : ""}</div></label>
    <div class="fld"><span>조치 전 사진 ${prevPhotos.before ? `<small>(저장됨 ${prevPhotos.before}장)</small>` : ""}</span>
      <div class="photos" id="ph-list">${dr.photos.map((ph, i) => `<div class="ph"><img src="${ph.url}" alt="사진 ${i + 1}"><button type="button" class="ph-x" data-rmph="${i}" aria-label="사진 삭제">✕</button></div>`).join("")}
        <button type="button" class="ph-add" id="btn-cam">📷<span>촬영</span></button><button type="button" class="ph-add" id="btn-alb">🖼<span>앨범</span></button></div></div>
    <label class="fld"><span>담당업체 ${sug && dr.vendorId === sug.id ? '<small class="sugg">공종 추천</small>' : ""}</span>
      <select class="inp" id="f-vendor"><option value="">업체 미지정</option>${S.vendors.map((v) => `<option value="${v.id}" ${v.id === dr.vendorId ? "selected" : ""}>${esc(v.name)}${(v.trades || []).length ? " · " + esc(v.trades.slice(0, 2).join(",")) : ""}</option>`).join("")}<option value="_new">＋ 새 업체 등록…</option></select></label>
    <label class="fld"><span>조치기한</span><div class="row"><input class="inp" type="date" id="f-due" value="${esc(dr.due || "")}">
      ${[3, 7, 14].map((d) => `<button type="button" class="chip" data-due="${d}">+${d}일</button>`).join("")}</div></label>
    <div class="form-act">${editing ? `<button type="button" class="btn btn-lg" id="btn-cancel">취소</button>` : `<button type="button" class="btn btn-lg" id="btn-save-next">저장 후 계속</button>`}
      <button type="submit" class="btn btn-primary btn-lg">${editing ? "수정 저장" : "저장"}</button></div>
    <p class="help" id="form-err" role="alert"></p></form>`;
  const sync = () => { dr.content = $("#f-content").value; dr.due = $("#f-due").value; };
  $$("[data-chips]", view()).forEach((row) => row.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return; sync();
    const k = row.dataset.chips;
    let v = b.dataset.v;
    const LK = { trade: "trades", type: "types", category: "categories" }[k];
    if (LK && b.dataset.ua && e.target.closest("[data-ed]")) { await editListItem(LK, v); return renderForm(); }
    if (b.dataset.add) {
      if (LK) { v = await addListItem(LK); if (!v) return; }
      else if (k === "subTrade" && trade) {
        const r = await formSheet({ title: "세부공종 직접 추가", ok: "추가하고 선택", fields: [{ k: "v", label: `${trade.name} 세부공종`, placeholder: "예: 걸레받이" }],
          validate: ({ v }) => (!v ? "이름을 입력하세요" : M.hasSame(trade.subs, v) ? "이미 있는 세부공종이에요" : "") });
        if (!r) return; v = r.v; trade.subs.push(v); await saveProject(p);
      } else return;
      if (dr[k] === v) dr[k] = ""; // 아래 토글에서 다시 선택되도록
    }
    if (k === "trade" && dr.trade !== v) { dr.subTrade = ""; dr.vendorAuto = true; }
    dr[k] = dr[k] === v && k !== "category" && k !== "severity" ? "" : v;
    if (k === "category") LS.set("lastCat", v);
    renderForm();
  }));
  onLongPress($("#dform"), "[data-chips] .chip[data-ua]", async (b) => { sync(); const LK = { trade: "trades", type: "types", category: "categories" }[b.closest("[data-chips]").dataset.chips]; if (LK) { await editListItem(LK, b.dataset.v); renderForm(); } });
  $("#btn-loc").addEventListener("click", () => { sync(); locationPicker(dr, () => renderForm()); });
  $("#btn-pin")?.addEventListener("click", () => { sync(); pinSheet(plans, dr, () => renderForm()); });
  $("#btn-mic")?.addEventListener("click", () => {
    const ta = $("#f-content"); const base = ta.value ? ta.value + " " : ""; const mic = $("#btn-mic"); mic.classList.add("on");
    startDictation({ onText: (t) => { ta.value = base + t; }, onError: (e) => toast(e === "network" ? "음성 인식은 인터넷 연결이 필요해요" : "음성 입력을 쓸 수 없어요"), onEnd: () => { mic.classList.remove("on"); dr.content = ta.value; } });
  });
  const addPh = async (capture) => {
    sync(); const files = await pickFile("image/*", { capture, multiple: !capture }); if (!files.length) return;
    busy(true, "사진 압축 중…");
    for (const f of files) {
      try { const at = new Date().toISOString(); const c = await compressImage(f, { stamp: `${stampOf(dr)}\n${fmtDT(at)} · 조치전` }); dr.photos.push({ ...c, at, url: URL.createObjectURL(c.thumb) }); }
      catch (e) { toast(e.message); }
    }
    busy(false); renderForm();
  };
  $("#btn-cam").addEventListener("click", () => addPh(true));
  $("#btn-alb").addEventListener("click", () => addPh(false));
  $$("[data-rmph]", view()).forEach((b) => b.addEventListener("click", () => { sync(); dr.photos.splice(+b.dataset.rmph, 1); renderForm(); }));
  $("#f-vendor").addEventListener("change", async (e) => {
    sync();
    if (e.target.value === "_new") { const v = await quickVendor(dr.trade); if (v) { dr.vendorId = v.id; dr.vendorAuto = false; } renderForm(); return; }
    dr.vendorId = e.target.value; dr.vendorAuto = false; renderForm();
  });
  $$("[data-due]", view()).forEach((b) => b.addEventListener("click", () => { sync(); dr.due = M.addDays(+b.dataset.due); renderForm(); }));
  $("#btn-cancel")?.addEventListener("click", () => { S.draft = null; back(); });
  const save = async (next) => {
    sync();
    const err = !dr.dong && !dr.common && !dr.locEtc?.trim() ? "위치를 선택하세요" : !dr.trade ? "공종을 선택하세요" : !dr.content.trim() && !dr.type ? "내용 또는 유형을 입력하세요" : "";
    if (err) { $("#form-err").textContent = err; toast(err); return; }
    busy(true, "저장 중…");
    const now = new Date().toISOString();
    const fields = ["dong", "floor", "ho", "common", "room", "part", "locEtc", "trade", "subTrade", "type", "category", "severity", "content", "vendorId", "due", "pin"];
    let d;
    if (editing) { d = S.defects.find((x) => x.id === dr._editId); for (const k of fields) d[k] = dr[k]; d.history = [...(d.history || []), { at: now, status: d.status, note: "내용 수정" }]; }
    else { d = { id: M.uid("h"), projectId: p.id, createdAt: now, status: "접수", memo: "", origin: "local", history: [{ at: now, status: "접수", note: "등록" }] }; for (const k of fields) d[k] = dr[k]; d.content = d.content.trim(); }
    await saveDefect(d);
    for (const ph of dr.photos) {
      await db.put("photos", { id: M.uid("ph"), defectId: d.id, kind: "before", blob: ph.blob, thumb: ph.thumb, w: ph.w, h: ph.h, at: ph.at });
      const m = S.pidx.get(d.id) || { before: 0, after: 0 }; m.before++; S.pidx.set(d.id, m); URL.revokeObjectURL(ph.url);
    }
    busy(false);
    const keep = { dong: d.dong, floor: d.floor, ho: d.ho, common: d.common, room: d.room, locEtc: d.locEtc || "" };
    S.draft = null;
    if (editing) { toast("수정했어요"); back(); return; }
    if (next) { startDraft(keep); toast(`저장했어요 · ${M.locText(d)} 계속 등록`); renderForm(); window.scrollTo(0, 0); }
    else { toast("저장했어요"); replace(`#/item?id=${d.id}`); }
  };
  $("#dform").addEventListener("submit", (e) => { e.preventDefault(); save(false); });
  $("#btn-save-next")?.addEventListener("click", () => save(true));
}

/* 위치 선택기: 동/공용부 → 층 → 호 → 실 → 부위 (단계마다 뒤로가기 한 칸).
 * 단계마다 '＋ 직접 추가'(현장 설정에 저장 → 선택 → 다음 단계), 직접 추가한 항목은 ✎/길게 눌러 이름 변경·삭제(미사용 시),
 * '기타 위치 직접 입력'은 저장하지 않는 1회용 위치 */
function locationPicker(dr, onDone) {
  const p = P();
  const sel = { dong: dr.dong, floor: dr.floor, ho: dr.ho, common: dr.common, room: dr.room, part: dr.part, locEtc: dr.locEtc || "" };
  const STEPS = ["dong", "floor", "ho", "room", "part"];
  let step = 0; const stepLayers = [];
  const s = openSheet({ title: "위치 선택", full: true, html: `<div id="lp"></div>`, footer: `<div class="lp-sum" id="lp-sum"></div><button type="button" class="btn btn-primary btn-lg" id="lp-ok">확인</button>`,
    onBack: () => (step > 0 ? history.back() : s.close()) });
  const dongObj = () => p.dongs.find((d) => d.name === sel.dong);
  const setStep = (i, push = true) => {
    if (push && i > step) { const from = step; stepLayers.push(pushLayer(() => { step = from; draw(); })); }
    step = i; draw();
  };
  const tile = (v, label, on, cls = "", ua = false) => `<button type="button" class="tile ${on ? "on" : ""} ${cls} ${ua ? "ua" : ""}" data-v="${esc(v)}"${ua ? ' data-ua="1"' : ""}>${esc(label)}${ua ? '<span class="ua-ed" data-ed="1" title="이름 변경·삭제">✎</span>' : ""}</button>`;
  const addTile = (what, key = "_add") => tile(key, "＋ 직접 추가", false, "add").replace("<button ", `<button aria-label="${esc(what)} 직접 추가" `);
  const isNumFloor = (f) => /^\d+$/.test(String(f || ""));
  const nextAfterFloor = (d, f) => (d && (M.unitsOf(d, f).length || isNumFloor(f)) ? 2 : 3);
  const used = (pred) => PD().filter(pred).length;
  const sortDongs = () => p.dongs.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  function draw() {
    s.setBackVisible(step > 0);
    const box = $("#lp", s.el); const d = dongObj();
    const crumbs = [sel.dong || sel.common, sel.floor && M.floorLabel(sel.floor), sel.ho && sel.ho + "호", sel.room, sel.part, sel.locEtc && `(${sel.locEtc})`].filter(Boolean);
    let h = `<ol class="steps">${["동", "층", "호", "실", "부위"].map((t, i) => `<li class="${i === step ? "on" : i < step ? "done" : ""}">${t}</li>`).join("")}</ol>`;
    if (STEPS[step] === "dong") {
      h += `<h4>동</h4><div class="tiles">${p.dongs.map((x) => tile(x.name, x.name, x.name === sel.dong, "", !!x.userAdded)).join("")}${addTile("동", "_add")}</div>
        <h4>공용부</h4><div class="tiles">${p.commons.map((c) => tile("c:" + c, c, c === sel.common, "common", isUserItem("commons", c))).join("")}${addTile("공용부", "_addc")}</div>`;
    } else if (STEPS[step] === "floor") {
      const fl = d ? M.floorsOf(d) : []; const ex = new Set(d?.extraFloors || []);
      h += `<h4>${esc(sel.dong || sel.common)} · 층</h4><div class="tiles small">${[...fl].reverse().map((f) => tile(f, M.floorLabel(f), f === sel.floor, "", ex.has(f))).join("")}${addTile("층")}</div>
        <button type="button" class="btn btn-block" data-skip="1">층 지정 안 함 (동 전체)</button>`;
    } else if (STEPS[step] === "ho") {
      const us = d ? M.unitsOf(d, sel.floor) : []; const ex = new Set(d?.extraUnits || []);
      h += `<h4>${esc(sel.dong)} ${esc(M.floorLabel(sel.floor))} · 호</h4><div class="tiles">${us.map((u) => tile(u, u + "호", u === sel.ho, "", ex.has(u))).join("")}${addTile("호")}</div>
        ${us.length ? "" : '<p class="help">이 층에 등록된 세대가 없어요. 필요하면 ＋ 직접 추가로 호수를 넣으세요.</p>'}
        <button type="button" class="btn btn-block" data-skip="1">세대 외 (복도·계단·EV홀 등)</button>`;
    } else if (STEPS[step] === "room") {
      h += `<h4>실</h4><div class="tiles">${p.rooms.map((r) => tile(r, r, r === sel.room, "", isUserItem("rooms", r))).join("")}${addTile("실")}</div><button type="button" class="btn btn-block" data-skip="1">건너뛰기</button>`;
    } else {
      h += `<h4>부위</h4><div class="tiles">${p.parts.map((r) => tile(r, r, r === sel.part, "", isUserItem("parts", r))).join("")}${addTile("부위")}</div>`;
    }
    h += `<button type="button" class="btn btn-block btn-etc" id="lp-etc">✎ ${sel.locEtc ? `기타 위치: ${esc(sel.locEtc)} (수정)` : "기타 위치 직접 입력 (저장 안 함)"}</button>`;
    box.innerHTML = h;
    $("#lp-sum", s.el).textContent = crumbs.length ? "선택: " + crumbs.join(" · ") : "동 또는 공용부를 먼저 고르세요";
    const ok = $("#lp-ok", s.el); ok.disabled = !(sel.dong || sel.common || sel.locEtc);
    $$(".tile", box).forEach((b) => b.addEventListener("click", async (e) => {
      let v = b.dataset.v; const k = STEPS[step];
      if (b.dataset.ua && e.target.closest("[data-ed]")) return editTile(b);
      if (v === "_add" || v === "_addc") { v = await addHere(k, v === "_addc"); if (v == null) return; }
      if (k === "dong") {
        if (v.startsWith("c:")) { sel.common = v.slice(2); sel.dong = ""; sel.floor = ""; sel.ho = ""; return setStep(3); }
        if (sel.dong !== v) { sel.floor = ""; sel.ho = ""; } sel.dong = v; sel.common = ""; return setStep(1);
      }
      if (k === "floor") { if (sel.floor !== v) sel.ho = ""; sel.floor = v; return setStep(nextAfterFloor(dongObj(), v)); }
      if (k === "ho") { sel.ho = v; return setStep(3); }
      if (k === "room") { sel.room = v; return setStep(4); }
      sel.part = v; draw();
    }));
    $("[data-skip]", box)?.addEventListener("click", () => {
      const k = STEPS[step];
      if (k === "floor") { sel.floor = ""; sel.ho = ""; return setStep(3); }
      if (k === "ho") { sel.ho = ""; return setStep(3); }
      if (k === "room") { sel.room = ""; return setStep(4); }
    });
    $("#lp-etc", box).addEventListener("click", async () => {
      const r = await formSheet({ title: "기타 위치 직접 입력", ok: "적용", hint: "이번 하자에만 쓰이고 목록에는 저장되지 않아요. 비우면 지워져요.",
        fields: [{ k: "v", label: "위치 설명", value: sel.locEtc, placeholder: "예: 101동 뒤 화단 배수구 옆" }], validate: ({ v }) => (v.length > 40 ? "40자 이내로 입력하세요" : "") });
      if (!r) return; sel.locEtc = r.v; draw();
    });
  }
  /** 현재 단계에 새 항목 추가 → 저장 후 선택할 값(동 이름, "c:공용부", 층, 호, 실, 부위) 또는 null */
  async function addHere(k, common = false) {
    const d = dongObj();
    if (k === "dong" && common) { const v = await addListItem("commons"); return v ? "c:" + v : null; }
    if (k === "dong") {
      const ref = p.dongs[p.dongs.length - 1] || {};
      const norm = (x) => (/^\d+$/.test(x) ? x + "동" : x);
      const r = await formSheet({ title: "동 직접 추가", ok: "추가하고 선택", hint: "층·라인은 나중에 설정 › 현장 › 동에서 고칠 수 있어요.",
        fields: [{ k: "name", label: "동 이름 *", placeholder: "예: 113 또는 관리동" }, { k: "alias", label: "줄임말 (빠른 검색, 선택)", placeholder: "예: 13" },
          { k: "floors", label: "지상 층수", type: "number", inputmode: "numeric", value: ref.floors || 15 }, { k: "lines", label: "층당 호수(라인)", type: "number", inputmode: "numeric", value: ref.lines ?? 4 },
          { k: "basement", label: "지하 층수", type: "number", inputmode: "numeric", value: ref.basement ?? 2 }],
        validate: (v) => {
          const name = norm(v.name); if (!name) return "동 이름을 입력하세요"; if (name.length > 15) return "15자 이내로 입력하세요";
          if (M.hasSame(p.dongs.map((x) => x.name), name)) return `이미 있는 동이에요: ${name}`;
          if (v.alias && p.dongs.some((x) => x.alias === v.alias)) return `줄임말 ‘${v.alias}’은(는) ${p.dongs.find((x) => x.alias === v.alias).name}이 쓰고 있어요`;
          const fl = Number(v.floors), ln = Number(v.lines), bs = Number(v.basement);
          if (!(fl >= 1 && fl <= 99)) return "지상 층수는 1~99"; if (!(ln >= 0 && ln <= 20)) return "라인은 0~20"; if (!(bs >= 0 && bs <= 9)) return "지하 층수는 0~9";
          return "";
        } });
      if (!r) return null;
      const name = norm(r.name); const alias = r.alias || M.aliasOf(M.dongNum(name));
      p.dongs.push({ id: M.uid("d"), name, alias: p.dongs.some((x) => x.alias && x.alias === alias) ? "" : alias, floors: Number(r.floors), lines: Number(r.lines), basement: Number(r.basement), unitStart: 1, roof: true, skipLines: "", userAdded: true });
      sortDongs(); await saveProject(p); toast(`${name} 추가했어요`); return name;
    }
    if (k === "floor") {
      if (!d) return null; const fl = M.floorsOf(d);
      const r = await formSheet({ title: `${d.name} 층 직접 추가`, ok: "추가하고 선택", hint: "지하는 B3·지하3, 옥상은 옥상/RF로 입력하세요.",
        fields: [{ k: "v", label: "층", placeholder: "예: 27, B3, 옥상" }],
        validate: ({ v }) => { const f = M.normFloor(v); return !v ? "층을 입력하세요" : !f ? "B1~B9, 1~99, 옥상 중 하나로 입력하세요" : fl.includes(f) ? `${M.floorLabel(f)}은(는) 이미 있어요` : ""; } });
      if (!r) return null; const f = M.normFloor(r.v);
      d.extraFloors = [...(d.extraFloors || []), f]; await saveProject(p); toast(`${d.name} ${M.floorLabel(f)} 추가했어요`); return f;
    }
    if (k === "ho") {
      if (!d) return null; const us = M.unitsOf(d, sel.floor); const fnum = isNumFloor(sel.floor) ? Number(sel.floor) : 0;
      const toHo = (v) => { const t = String(v).replace(/호$/, "").trim(); if (!/^\d{1,4}$/.test(t)) return ""; const n0 = Number(t); const h = n0 < 100 && fnum ? fnum * 100 + n0 : n0; return h >= 101 && h <= 9920 && h % 100 >= 1 && h % 100 <= 20 ? String(h) : ""; };
      const r = await formSheet({ title: `${d.name} ${M.floorLabel(sel.floor)} 호 직접 추가`, ok: "추가하고 선택", hint: fnum ? `라인 번호만 넣어도 돼요 (예: 5 → ${fnum * 100 + 5}호)` : "",
        fields: [{ k: "v", label: "호수", inputmode: "numeric", placeholder: fnum ? `예: ${fnum * 100 + 5} 또는 5` : "예: 1205" }],
        validate: ({ v }) => { const h = toHo(v); if (!v) return "호수를 입력하세요"; if (!h) return "호수는 101~9920 형식(층+라인 01~20)으로 입력하세요"; if (fnum && M.floorOfHo(h) !== String(fnum)) return `${h}호는 ${M.floorOfHo(h)}층 세대예요. ${fnum}층 호수를 입력하세요`; if (us.includes(h)) return `${h}호는 이미 있어요`; return ""; } });
      if (!r) return null; const h = toHo(r.v);
      d.extraUnits = [...(d.extraUnits || []), h]; await saveProject(p); toast(`${d.name} ${h}호 추가했어요`); return h;
    }
    if (k === "room") return addListItem("rooms");
    if (k === "part") return addListItem("parts");
    return null;
  }
  /** 직접 추가한 타일 편집(✎ 또는 길게 누르기) */
  async function editTile(b) {
    const k = STEPS[step]; const v = b.dataset.v; const d = dongObj();
    if (k === "dong" && v.startsWith("c:")) {
      const c = v.slice(2); const before = [...p.commons]; const r = await editListItem("commons", c);
      if (r === "del" && sel.common === c) sel.common = "";
      if (r === "ren" && sel.common === c) sel.common = p.commons.find((x) => !before.includes(x)) || "";
      return draw();
    }
    if (k === "dong") {
      const dg = p.dongs.find((x) => x.name === v); if (!dg) return;
      await editUserItem({ kind: "동", name: v, used: used((x) => x.dong === v),
        remove: async () => { p.dongs = p.dongs.filter((x) => x !== dg); await saveProject(p); if (sel.dong === v) { sel.dong = ""; sel.floor = ""; sel.ho = ""; } },
        rename: async () => {
          const r = await formSheet({ title: "동 이름 변경", ok: "변경", fields: [{ k: "v", label: "새 이름", value: v }],
            validate: ({ v: x }) => { const nmx = /^\d+$/.test(x) ? x + "동" : x; return !x ? "이름을 입력하세요" : M.hasSame(p.dongs.map((y) => y.name), nmx, v) ? "이미 있는 동이에요" : ""; } });
          if (!r) return false; const nmx = /^\d+$/.test(r.v) ? r.v + "동" : r.v; if (nmx === v) return false;
          dg.name = nmx; sortDongs(); await saveProject(p);
          for (const x of PD().filter((y) => y.dong === v)) { x.dong = nmx; await saveDefect(x, { local: false }); }
          if (sel.dong === v) sel.dong = nmx; toast("이름을 바꿨어요"); return true;
        } });
      return draw();
    }
    if (k === "floor" && d) {
      await editUserItem({ kind: `${d.name} 층`, name: M.floorLabel(v), used: used((x) => x.dong === d.name && (x.floor === v || (x.ho && M.floorOfHo(x.ho) === v))),
        remove: async () => { d.extraFloors = (d.extraFloors || []).filter((x) => x !== v); d.extraUnits = (d.extraUnits || []).filter((h) => M.floorOfHo(h) !== v); await saveProject(p); if (sel.floor === v) { sel.floor = ""; sel.ho = ""; } },
        rename: async () => {
          const r = await formSheet({ title: "층 변경", ok: "변경", fields: [{ k: "v", label: "층", value: v }],
            validate: ({ v: x }) => { const f = M.normFloor(x); return !f ? "B1~B9, 1~99, 옥상 중 하나로 입력하세요" : f !== v && M.floorsOf(d).includes(f) ? "이미 있는 층이에요" : ""; } });
          if (!r) return false; const f = M.normFloor(r.v); if (f === v) return false;
          d.extraFloors = d.extraFloors.map((x) => (x === v ? f : x)); await saveProject(p);
          for (const x of PD().filter((y) => y.dong === d.name && y.floor === v && !y.ho)) { x.floor = f; await saveDefect(x, { local: false }); }
          if (sel.floor === v) sel.floor = f; toast("층을 바꿨어요"); return true;
        } });
      return draw();
    }
    if (k === "ho" && d) {
      await editUserItem({ kind: `${d.name} 호`, name: v + "호", used: used((x) => x.dong === d.name && x.ho === v),
        remove: async () => { d.extraUnits = (d.extraUnits || []).filter((x) => x !== v); await saveProject(p); if (sel.ho === v) sel.ho = ""; },
        rename: async () => {
          const r = await formSheet({ title: "호수 변경", ok: "변경", fields: [{ k: "v", label: "호수", value: v, inputmode: "numeric" }],
            validate: ({ v: x }) => (!/^\d{3,4}$/.test(x) || M.floorOfHo(x) !== M.floorOfHo(v) ? `${M.floorLabel(M.floorOfHo(v))} 호수(3~4자리)로 입력하세요` : x !== v && M.unitsOf(d, sel.floor).includes(x) ? "이미 있는 호수예요" : "") });
          if (!r || r.v === v) return false;
          d.extraUnits = d.extraUnits.map((x) => (x === v ? r.v : x)); await saveProject(p);
          for (const x of PD().filter((y) => y.dong === d.name && y.ho === v)) { x.ho = r.v; await saveDefect(x, { local: false }); }
          if (sel.ho === v) sel.ho = r.v; toast("호수를 바꿨어요"); return true;
        } });
      return draw();
    }
    if (k === "room" || k === "part") {
      const LK = k === "room" ? "rooms" : "parts"; const before = [...p[LK]];
      const r = await editListItem(LK, v);
      if (r === "del" && sel[k] === v) sel[k] = "";
      if (r === "ren" && sel[k] === v) sel[k] = p[LK].find((x) => !before.includes(x)) || "";
      return draw();
    }
  }
  onLongPress(s.el, ".tile[data-ua]", (b) => editTile(b));
  $("#lp-ok", s.el).addEventListener("click", async () => {
    if (!(sel.dong || sel.common || sel.locEtc)) return;
    Object.assign(dr, sel); if (sel.ho && !sel.floor) dr.floor = M.floorOfHo(sel.ho);
    await s.close(); onDone();
  });
  const start = dr.part ? 4 : dr.room ? 4 : dr.ho ? 3 : dr.floor ? 2 : dr.dong ? 1 : dr.common ? 3 : 0;
  step = 0; draw(); if (start) setStep(start);
}

/* 도면 핀 */
async function pinSheet(plans, dr, onDone) {
  let plan = plans.find((x) => x.id === dr.pin?.planId) || plans[0];
  let pin = dr.pin?.planId === plan.id ? { ...dr.pin } : null;
  const s = openSheet({ title: "도면에 위치 표시", full: true,
    html: `${plans.length > 1 ? `<div class="chips scroll">${plans.map((x) => `<button type="button" class="chip ${x.id === plan.id ? "on" : ""}" data-pl="${x.id}">${esc(x.name)}</button>`).join("")}</div>` : ""}
      <p class="help">도면을 눌러 하자 위치를 찍으세요. 두 손가락으로 확대할 수 있어요.</p><div class="plan" id="plan"><img id="plan-img" alt="도면"><i class="pin" hidden></i></div>`,
    footer: `<button type="button" class="btn" data-a="clear">표시 지우기</button><button type="button" class="btn btn-primary" data-a="ok">확인</button>` });
  const img = $("#plan-img", s.el); const pinEl = $(".pin", s.el);
  const show = () => { img.src = URL.createObjectURL(plan.blob); pinEl.hidden = !pin; if (pin) { pinEl.style.left = pin.x * 100 + "%"; pinEl.style.top = pin.y * 100 + "%"; } };
  show();
  $("#plan", s.el).addEventListener("click", (e) => {
    const r = img.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    pin = { planId: plan.id, x: +x.toFixed(4), y: +y.toFixed(4) }; show();
  });
  $$("[data-pl]", s.el).forEach((b) => b.addEventListener("click", () => { plan = plans.find((x) => x.id === b.dataset.pl); pin = null; $$("[data-pl]", s.el).forEach((c) => c.classList.toggle("on", c === b)); show(); }));
  $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", async () => { dr.pin = b.dataset.a === "ok" ? pin : null; await s.close(); onDone(); }));
}

/* ---------- 상세 ---------- */
ROUTES.item = async (qq) => {
  const d = S.defects.find((x) => x.id === qq.id);
  if (!d) { toast("항목을 찾을 수 없어요"); return replace("#/list"); }
  setTab(null);
  setHeader(M.locText(d) || "하자 상세", { backBtn: true, action: `<button type="button" class="hdr-btn" id="btn-edit">수정</button>` });
  const photos = await db.byIndex("photos", "by_defect", d.id);
  const urls = []; const purl = (ph) => { const u = URL.createObjectURL(ph.thumb || ph.blob); urls.push(u); return u; };
  const before = photos.filter((x) => x.kind !== "after"), after = photos.filter((x) => x.kind === "after");
  const v = V(d.vendorId); const nx = M.NEXT[d.status]; const od = M.isOverdue(d);
  const plan = d.pin && S.plans.find((x) => x.id === d.pin.planId);
  const idx = M.STATUSES.indexOf(d.status);
  view().innerHTML = `
    <section class="card item-hd ${od ? "overdue" : ""}"><div class="row">${pill(d.status)}${sevBadge(d)}<span class="tbadge">${esc(d.category || "")}</span>${od ? '<span class="od">기한초과</span>' : ""}</div>
      <h2>${esc(M.tradeText(d))}${d.type ? ` · ${esc(d.type)}` : ""}</h2><p class="content">${esc(d.content || "")}</p>
      <dl class="kv"><dt>위치</dt><dd>${esc(M.locText(d))}</dd><dt>업체</dt><dd>${v ? `<a href="#/vendor?id=${v.id}">${esc(v.name)}</a>` : "미지정"}</dd>
        <dt>조치기한</dt><dd>${esc(d.due || "-")}</dd><dt>등록</dt><dd>${fmtDT(d.createdAt)}${d.createdBy ? ` · <b class="who">${esc(d.createdBy)}</b>` : ""}${d.extId ? ` · 외부ID ${esc(d.extId)}` : ""}</dd>
         ${d.updatedBy ? `<dt>최근 수정</dt><dd id="who-upd"><b class="who">${esc(d.updatedBy)}</b> · ${fmtDT(d.updatedByAt || d.updatedAt)}</dd>` : ""}</dl></section>
    <ol class="flow" aria-label="상태 바로 바꾸기">${["접수", "업체전달", "조치중", "조치완료", "확인완료", ...(["재접수", "조치완료", "확인완료"].includes(d.status) ? ["재접수"] : [])].map((s2, i) => `<li class="${s2 === d.status ? "on" : i < idx && d.status !== "재접수" ? "done" : ""}${s2 === "재접수" ? " re" : ""}"><button type="button" class="flow-b" data-flow="${s2}" ${s2 === d.status ? 'aria-current="step"' : ""} aria-label="상태를 ${s2}(으)로">${s2}</button></li>`).join("")}</ol>
    <div class="act-row">${nx ? `<button type="button" class="btn btn-primary btn-lg" data-st="${nx}">${nx === "업체전달" ? "업체에 보내기" : nx + " 처리"}</button>` : ""}
      ${d.status === "조치완료" || d.status === "확인완료" ? `<button type="button" class="btn btn-lg btn-warn" data-st="재접수">재접수</button>` : ""}
      <button type="button" class="btn btn-lg" id="btn-stany">상태 선택</button></div>
    ${v ? `<div class="contact-row">${(v.phones || []).slice(0, 1).map((ph) => `<a class="btn" href="${M.telHref(ph)}">📞 전화</a><a class="btn" href="${M.smsHref(ph, M.shareMessage({ project: P(), vendor: v, items: [d] }))}" data-sms>💬 문자</a>`).join("")}
      <button type="button" class="btn btn-kakao" id="btn-kakao">카톡으로 보내기</button></div>` : `<button type="button" class="btn btn-block" id="btn-kakao">카톡·공유로 보내기</button>`}
    <section class="card"><h3>조치 전 사진 <small>${before.length}</small></h3><div class="photos">${before.map((ph) => `<button type="button" class="ph" data-ph="${ph.id}"><img src="${purl(ph)}" alt="조치 전"></button>`).join("")}
      <button type="button" class="ph-add" data-add="before">📷<span>추가</span></button></div></section>
    <section class="card"><h3>조치 후 사진 <small>${after.length}</small></h3><div class="photos">${after.map((ph) => `<button type="button" class="ph" data-ph="${ph.id}"><img src="${purl(ph)}" alt="조치 후"></button>`).join("")}
      <button type="button" class="ph-add" data-add="after">📷<span>추가</span></button></div></section>
    ${plan ? `<section class="card"><h3>도면 위치 <small>${esc(plan.name)}</small></h3><div class="plan mini"><img src="${(() => { const u = URL.createObjectURL(plan.blob); urls.push(u); return u; })()}" alt="도면"><i class="pin" style="left:${d.pin.x * 100}%;top:${d.pin.y * 100}%"></i></div></section>` : ""}
    <section class="card"><h3>메모</h3><textarea class="inp" id="memo" rows="2" placeholder="현장 메모(업체 전달 문구에는 포함되지 않음)">${esc(d.memo || "")}</textarea></section>
    <section class="card"><h3>처리 이력</h3><ol class="hist">${[...(d.history || [])].reverse().map((h) => `<li><time>${fmtDT(h.at)}</time> ${pill(h.status)} ${esc(h.note || "")}${h.by ? ` <small class="who">· ${esc(h.by)}</small>` : ""}</li>`).join("")}</ol></section>
    <button type="button" class="btn btn-danger btn-block" id="btn-del">이 하자 삭제</button>`;
  ROUTES._cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  $("#btn-edit").addEventListener("click", () => { startDraft({}, d); go(`#/edit?id=${d.id}`); });
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => changeStatus(d, b.dataset.st)));
  $$("[data-flow]", view()).forEach((b) => b.addEventListener("click", () => quickStatus(d, b.dataset.flow)));
  $("#btn-stany").addEventListener("click", async () => { const st = await choose("상태 선택", M.STATUSES.map((s2) => ({ label: s2, value: s2, sub: s2 === d.status ? "현재" : "" }))); if (st) changeStatus(d, st); });
  $("#btn-kakao").addEventListener("click", () => sendSheet({ items: [d], vendor: v }));
  $("[data-sms]", view())?.addEventListener("click", () => setTimeout(() => markSent([d], "문자"), 300));
  $$("[data-add]", view()).forEach((b) => b.addEventListener("click", async () => {
    const files = await pickFile("image/*", { capture: false, multiple: true }); if (!files.length) return;
    busy(true, "사진 저장 중…"); await addPhotos(d.id, files, b.dataset.add, stampOf(d)); busy(false); rerender();
  }));
  $$("[data-ph]", view()).forEach((b) => b.addEventListener("click", () => photoViewer(photos, b.dataset.ph, () => rerender())));
  $("#memo").addEventListener("change", async (e) => { d.memo = e.target.value; await saveDefect(d); toast("메모 저장"); });
  $("#btn-del").addEventListener("click", async () => {
    if (!(await ask("이 하자와 사진을 삭제할까요? 되돌릴 수 없어요.", { ok: "삭제", danger: true }))) return;
    await db.delByIndex("photos", "by_defect", d.id); await db.del("defects", d.id);
    S.defects = S.defects.filter((x) => x.id !== d.id); S.pidx.delete(d.id); toast("삭제했어요"); back();
  });
};
/** 상세 화면 상태 단계 탭: 묻지 않고 바로 바꾸고 3초 ‘되돌리기’. 조치완료인데 조치 후 사진이 없으면 안내만(막지 않음) */
async function quickStatus(d, st) {
  if (d.status === st) return toast(`이미 ‘${st}’ 상태예요`);
  const prev = d.status; setStatus(d, st); await saveDefect(d); rerender();
  const hint = st === "조치완료" && !photoCount(d).after ? " · 조치 후 사진은 아래 📷에서 추가" : "";
  toast(`‘${st}’(으)로 변경${hint}`, { ms: 3000, action: "되돌리기", onAction: async () => { setStatus(d, prev, "되돌리기"); await saveDefect(d); rerender(); } });
}
async function changeStatus(d, st) {
  if (st === "업체전달") return sendSheet({ items: [d], vendor: V(d.vendorId) });
  if (st === "조치완료" && !photoCount(d).after) {
    const a = await choose("조치 완료 — 조치 후 사진", [{ label: "사진 찍고 완료", value: "cam", icon: "📷" }, { label: "앨범에서 고르고 완료", value: "alb", icon: "🖼" }, { label: "사진 없이 완료", value: "none", icon: "✔" }]);
    if (!a) return;
    if (a !== "none") { const files = await pickFile("image/*", { capture: a === "cam", multiple: a === "alb" }); if (!files.length) return; busy(true, "사진 저장 중…"); await addPhotos(d.id, files, "after", stampOf(d)); busy(false); }
  }
  let note = "";
  if (st === "재접수") { note = (await prompt2("재접수 사유", "", { placeholder: "예: 실리콘 재시공 필요", ok: "재접수" })); if (note === null) return; }
  const prev = d.status; setStatus(d, st, note); await saveDefect(d); rerender();
  toast(`‘${st}’(으)로 변경`, { action: "되돌리기", onAction: async () => { setStatus(d, prev, "되돌리기"); await saveDefect(d); rerender(); } });
}
function photoViewer(photos, id, onChange) {
  let i = Math.max(0, photos.findIndex((p) => p.id === id)); let url = "";
  const s = openSheet({ title: "사진", full: true, cls: "viewer", html: `<div class="pv"><img id="pv-img" alt="사진"></div><div class="pv-nav"><button type="button" class="btn" data-n="-1">‹ 이전</button><span id="pv-i"></span><button type="button" class="btn" data-n="1">다음 ›</button></div>`,
    footer: `<button type="button" class="btn" data-a="share">공유</button><button type="button" class="btn btn-danger" data-a="del">삭제</button>` });
  const show = () => { if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(photos[i].blob); $("#pv-img", s.el).src = url; $("#pv-i", s.el).textContent = `${i + 1} / ${photos.length} · ${photos[i].kind === "after" ? "조치 후" : "조치 전"}`; };
  show();
  $$("[data-n]", s.el).forEach((b) => b.addEventListener("click", () => { i = (i + Number(b.dataset.n) + photos.length) % photos.length; show(); }));
  $("[data-a=share]", s.el).addEventListener("click", () => shareOrDownload(photos[i].blob, `하자사진_${i + 1}.jpg`));
  $("[data-a=del]", s.el).addEventListener("click", async () => {
    if (!(await ask("이 사진을 삭제할까요?", { ok: "삭제", danger: true }))) return;
    const ph = photos[i]; await db.del("photos", ph.id); const m = S.pidx.get(ph.defectId); if (m) m[ph.kind === "after" ? "after" : "before"]--;
    await s.close(); onChange();
  });
}

/* ---------- 보내기(카톡·문자·전화·복사) ---------- */
async function markSent(items, via, note = "") {
  const targets = items.filter((d) => d.status === "접수" || d.status === "재접수");
  if (!targets.length) { if (note) toast(note, { ms: 7000 }); return; }
  const prev = targets.map((d) => [d, d.status]);
  for (const d of targets) { setStatus(d, "업체전달", `${via}로 전달`); await saveDefect(d); }
  rerender();
  toast(`${note ? note + " · " : ""}${targets.length}건 ‘업체전달’로 표시`, { ms: note ? 9000 : 2400, action: "되돌리기", onAction: async () => { for (const [d, st] of prev) { setStatus(d, st, "전달 취소"); await saveDefect(d); } rerender(); } });
}
/** 업체에 보내기: 건마다 체크해서 고른 건만 카톡·문자·복사·PDF로 보내고, 고른 건만 ‘업체전달’ 표시(되돌리기 가능).
 *  preselect: 처음 체크할 id 목록(없으면 미전달 → 없으면 미조치 → 전체) */
async function sendSheet({ items, vendor = null, preselect = null }) {
  if (!items.length) return toast("보낼 하자가 없어요");
  const byV = new Map(); for (const d of items) byV.set(d.vendorId || "", (byV.get(d.vendorId || "") || 0) + 1);
  if (!vendor && byV.size === 1 && [...byV.keys()][0]) vendor = V([...byV.keys()][0]);
  if (!vendor && byV.size > 1) {
    const v = await choose("어느 업체에 보낼까요?", [...byV.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => ({ label: id ? vLabel(id) : "업체 미지정", sub: `${c}건`, value: id || "_none" })).concat([{ label: "업체 구분 없이 전체", sub: `${items.length}건`, value: "_all" }]));
    if (!v) return;
    if (v !== "_all") { items = items.filter((d) => (d.vendorId || "_none") === v); vendor = v === "_none" ? null : V(v); }
  }
  const openItems = items.filter((d) => d.status !== "확인완료");
  const list = (openItems.length ? openItems : items).sort(M.sortDefects);
  const unsent = (d) => d.status === "접수" || d.status === "재접수"; const today = M.todayStr();
  const pre = preselect ? list.filter((d) => preselect.includes(d.id)) : [];
  const chosen = new Set((pre.length ? pre : list.filter(unsent).length ? list.filter(unsent) : list.filter(M.isOpen).length ? list.filter(M.isOpen) : list).map((d) => d.id));
  const phOn = new Set(list.filter((d) => photoCount(d).before).map((d) => d.id));
  const sel = () => list.filter((d) => chosen.has(d.id));
  const dongs = [...new Set(list.map((d) => d.dong || d.common).filter(Boolean))];
  const phones = vendor?.phones || [];
  const vname = vendor?.name || "업체";
  const msgOf = () => M.shareMessage({ project: P(), vendor, items: sel(), appName: APP_NAME });
  let dirty = false;
  const row = (d) => { const pc = photoCount(d).before; return `<div class="srow ${chosen.has(d.id) ? "on" : ""}" data-id="${d.id}">
      <label class="srow-chk"><input type="checkbox" data-sel="${d.id}" ${chosen.has(d.id) ? "checked" : ""} aria-label="${esc(M.locText(d))} 선택"></label>
      <button type="button" class="srow-body" data-open="${d.id}"><b>${esc(M.locText(d) || "위치 미지정")}</b><small>${esc([M.tradeText(d), d.type].filter(Boolean).join(" · "))} ${esc((d.content || "").slice(0, 40))}</small>
        <small>${pill(d.status)}${d.due ? ` 기한 ${esc(d.due.slice(5).replace("-", "/"))}` : ""}${M.isOverdue(d, today) ? ' <span class="od">기한초과</span>' : ""}</small></button>
      ${pc ? `<button type="button" class="srow-ph ${phOn.has(d.id) ? "on" : ""}" data-ph="${d.id}" aria-pressed="${phOn.has(d.id)}" title="사진 첨부 켜기/끄기">📷${pc}</button>` : '<span class="srow-ph none" aria-hidden="true"></span>'}</div>`; };
  const s = openSheet({ title: `${vname}에게 보내기 · 선택 ${chosen.size}건`, full: true,
    html: `<div class="sel-bar"><b id="selcnt">선택 ${chosen.size}건</b><small class="help"> / ${list.length}건</small></div>
      <div class="chips scroll" id="sel-q"><button type="button" class="chip" data-q="all">전체선택</button><button type="button" class="chip" data-q="none">전체해제</button>
        <button type="button" class="chip" data-q="unsent">미전달만 ${list.filter(unsent).length}</button><button type="button" class="chip" data-q="od">기한초과 ${list.filter((d) => M.isOverdue(d, today)).length}</button></div>
      ${dongs.length > 1 || list.length > 3 ? `<div class="row sel-loc"><select class="inp" id="sel-dong" aria-label="동만 선택"><option value="">동 선택…</option>${dongs.map((x) => `<option>${esc(x)}</option>`).join("")}</select><select class="inp" id="sel-ho" aria-label="호만 선택" disabled><option value="">호 선택…</option></select></div>` : ""}
      <div class="srows" id="srows">${list.map(row).join("")}</div>
      <label class="fld"><span>미리보기 · 보낼 내용 (수정 가능)</span><textarea class="inp mono" id="msg" rows="9">${esc(msgOf())}</textarea></label>
      <button type="button" class="btn btn-sm" id="msg-regen" hidden>↻ 선택한 건으로 내용 다시 만들기</button>
      <label class="check"><input type="checkbox" id="withph" ${phOn.size ? "checked" : ""}> 조치 전 사진 첨부 (카톡 공유 시, 최대 10장 · 건마다 📷로 켜고 끄기)</label>
      <div class="send-grid">
        <button type="button" class="btn btn-kakao btn-lg" data-s="kakao">카카오톡으로 보내기</button>
        <p class="help small kakao-hint" id="kakao-hint">${isMobileDevice() ? (isAndroid() ? "카카오톡이 바로 열려요(내용은 복사도 돼요). 사진을 붙이면 공유창에서 <b>카카오톡</b>을 골라 주세요." : "공유창에서 <b>카카오톡</b>을 골라 주세요. 내용은 미리 복사돼요.") : "PC: 내용이 복사되고 카카오톡 PC가 열려요. 업체 채팅방에 <b>Ctrl+V</b>로 붙여넣으세요. 사진은 PC에서 자동으로 붙지 않아요(요청서 PDF를 쓰세요)."}</p>
        ${phones.map((ph) => `<a class="btn btn-lg" data-s="sms" href="#" data-ph="${esc(ph)}">💬 문자 ${esc(ph)}</a><a class="btn btn-lg" href="${M.telHref(ph)}" data-s="tel">📞 전화 ${esc(ph)}</a>`).join("")}
        <button type="button" class="btn btn-lg" data-s="copy">📋 내용 복사</button>
        <button type="button" class="btn btn-lg" data-s="share">📤 다른 앱으로 공유</button>
        <button type="button" class="btn btn-lg" data-s="pdf">📄 요청서 PDF(인쇄)</button></div>
      <p class="help">카카오톡은 앱이 특정 친구를 대신 고를 수 없어요. 카카오톡에서 <b>업체 대화방</b>을 고르면 돼요.${phones.length ? "" : " 업체에 전화번호를 등록하면 문자·전화 버튼이 생겨요."}</p>
      <label class="check"><input type="checkbox" id="mark" checked> 보낸 뒤 선택한 건 중 ‘접수’ 건을 ‘업체전달’로 표시</label>` });
  const el = s.el; const ta = $("#msg", el);
  const refresh = () => {
    const c = chosen.size; $("#selcnt", el).textContent = `선택 ${c}건`; s.setTitle(`${vname}에게 보내기 · 선택 ${c}건`);
    $$(".srow", el).forEach((r) => { const on = chosen.has(r.dataset.id); r.classList.toggle("on", on); $("input", r).checked = on; });
    if (!dirty) ta.value = msgOf(); $("#msg-regen", el).hidden = !dirty;
    $$("[data-s]", el).forEach((b) => b.classList.toggle("disabled", !c && b.dataset.s !== "tel"));
  };
  const selectOnly = (pred, label) => { chosen.clear(); for (const d of list) if (pred(d)) chosen.add(d.id); refresh(); if (label) toast(`${label} ${chosen.size}건 선택`); };
  ta.addEventListener("input", () => { dirty = true; $("#msg-regen", el).hidden = false; });
  $("#msg-regen", el).addEventListener("click", () => { dirty = false; refresh(); });
  $("#srows", el).addEventListener("change", (e) => { const i = e.target.closest("[data-sel]"); if (!i) return; if (i.checked) chosen.add(i.dataset.sel); else chosen.delete(i.dataset.sel); refresh(); });
  $("#srows", el).addEventListener("click", (e) => {
    const ph = e.target.closest("[data-ph]");
    if (ph && ph.classList.contains("srow-ph")) { const id = ph.dataset.ph; if (phOn.has(id)) phOn.delete(id); else phOn.add(id); ph.classList.toggle("on", phOn.has(id)); ph.setAttribute("aria-pressed", phOn.has(id)); return; }
    const o = e.target.closest("[data-open]"); if (o) peekDefect(list.find((d) => d.id === o.dataset.open));
  });
  $("#sel-q", el).addEventListener("click", (e) => {
    const q2 = e.target.closest("[data-q]")?.dataset.q; if (!q2) return;
    if (q2 === "all") selectOnly(() => true); else if (q2 === "none") selectOnly(() => false);
    else if (q2 === "unsent") selectOnly(unsent, "미전달"); else if (q2 === "od") selectOnly((d) => M.isOverdue(d, today), "기한초과");
  });
  const sd = $("#sel-dong", el), sh = $("#sel-ho", el);
  sd?.addEventListener("change", () => {
    const dg = sd.value; const hos = [...new Set(list.filter((d) => (d.dong || d.common) === dg && d.ho).map((d) => d.ho))].sort((a, b) => a - b);
    sh.innerHTML = `<option value="">${dg ? "호 전체" : "호 선택…"}</option>${hos.map((h) => `<option value="${h}">${h}호</option>`).join("")}`; sh.disabled = !dg || !hos.length;
    if (dg) selectOnly((d) => (d.dong || d.common) === dg, dg);
  });
  sh?.addEventListener("change", () => { const dg = sd.value; selectOnly((d) => (d.dong || d.common) === dg && (!sh.value || d.ho === sh.value), `${dg}${sh.value ? " " + sh.value + "호" : ""}`); });
  const after = async (via) => { const mark = $("#mark", el).checked; const items2 = sel(); await s.close(); if (mark) await markSent(items2, via); };
  $$("[data-s]", el).forEach((b) => b.addEventListener("click", async (e) => {
    const k = b.dataset.s;
    if (k === "tel") return; // 기본 동작(tel:)
    if (!chosen.size) { e.preventDefault(); return toast("보낼 하자를 하나 이상 선택하세요"); }
    if (k === "kakao" || k === "share") {
      let files = [];
      if ($("#withph", el).checked) {
        busy(true, "사진 준비 중…");
        for (const d of sel()) { if (!phOn.has(d.id)) continue; for (const ph of (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 2)) if (files.length < 10) files.push(new File([ph.blob], `${M.locText(d).replace(/\s+/g, "_")}_${files.length + 1}.jpg`, { type: "image/jpeg" })); }
        busy(false);
      }
      if (k === "kakao" && !isMobileDevice()) files = []; // PC: 공유창 대신 복사
      const r = k === "share" ? await shareGeneric({ text: ta.value, files }) : await shareKakao({ text: ta.value, files });
      if (r === "cancel") return;
      if (r === "fail") return toast(k === "share" ? "공유할 수 없어요" : "복사할 수 없어요. ‘내용 복사’를 눌러 보세요");
      const note = r === "kakao-pc" ? "내용 복사됨 — 카카오톡 PC에서 업체 채팅방에 붙여넣기(Ctrl+V)" : r === "copied" ? "내용 복사됨 — 카카오톡 대화방에 붙여넣기 하세요" : "";
      const mark = $("#mark", el).checked; const items2 = sel(); await s.close();
      if (mark) await markSent(items2, k === "share" ? "공유" : "카톡", note); else if (note) toast(note, { ms: 7000 });
      return;
    }
    if (k === "sms") { e.preventDefault(); const href = M.smsHref(b.dataset.ph, ta.value); S.lastSms = href; location.href = href; return after("문자"); }
    if (k === "copy") { (await copyText(ta.value)) ? toast("복사했어요") : toast("복사 실패"); return after("복사"); }
    if (k === "pdf") { const items2 = sel(); await s.close(); return printRequest({ vendor, items: items2 }); }
  }));
  refresh();
}
/** 보내기 화면에서 한 건 미리 보기(시트 위에 겹쳐 열림 → 닫아도 선택 유지) */
async function peekDefect(d) {
  if (!d) return;
  const photos = (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after"); const urls = photos.map((x) => URL.createObjectURL(x.thumb || x.blob));
  const s = openSheet({ title: M.locText(d) || "하자", full: true,
    html: `<div class="row">${pill(d.status)}${sevBadge(d)}<span class="tbadge">${esc(d.category || "")}</span></div>
      <p><b>${esc(M.tradeText(d))}</b>${d.type ? ` · ${esc(d.type)}` : ""}</p><p>${esc(d.content || "")}</p>
      ${d.due ? `<p class="help">조치기한 ${esc(d.due)}${M.isOverdue(d) ? ' <span class="od">기한초과</span>' : ""}</p>` : ""}${d.memo ? `<p class="help">메모: ${esc(d.memo)}</p>` : ""}
      <div class="photos">${urls.map((u, i) => `<div class="ph"><img src="${u}" alt="조치 전 사진 ${i + 1}"></div>`).join("") || '<p class="help">사진 없음</p>'}</div>`,
    footer: `<button type="button" class="btn btn-primary btn-lg" data-close>보내기 화면으로</button>` });
  s.onClose = () => urls.forEach((u) => URL.revokeObjectURL(u));
}

/* 요청서 인쇄 → PDF 저장 */
async function printRequest({ vendor, items }) {
  busy(true, "요청서 만드는 중…");
  const { requestDocHtml } = await import("./exporter.js");
  const urls = new Map(); const all = [];
  for (const d of items) { const ph = (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 2); const u = ph.map((x) => URL.createObjectURL(x.blob)); all.push(...u); urls.set(d.id, u); }
  const root = $("#print-root");
  root.innerHTML = requestDocHtml({ project: P(), vendor, items, photoUrls: urls, watermark: !Pro.can("pdfNoWatermark"), issuer: S.issuer, today: M.todayStr() });
  await Promise.all($$("img", root).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
  busy(false);
  document.body.classList.add("printing");
  const cleanup = () => { document.body.classList.remove("printing"); root.innerHTML = ""; all.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  S.lastPrintHtml = root.innerHTML.length;
  if (window.__noPrint) return; // 테스트용
  setTimeout(() => window.print(), 50);
}

/* ---------- 업체 ---------- */
ROUTES.vendors = async () => {
  setTab("vendors"); setHeader("업체", { backBtn: navDepth() > 1, action: `<button type="button" class="hdr-btn" id="btn-vadd">＋ 등록</button>` });
  const list = PD(); const today = M.todayStr();
  const stat = (vid) => { const a = list.filter((d) => d.vendorId === vid); return { open: a.filter(M.isOpen).length, od: a.filter((d) => M.isOverdue(d, today)).length, unsent: a.filter((d) => d.status === "접수" || d.status === "재접수").length, all: a.length }; };
  const vs = S.vendors.map((v) => ({ v, s: stat(v.id) })).sort((a, b) => b.s.unsent - a.s.unsent || b.s.open - a.s.open || a.v.name.localeCompare(b.v.name, "ko"));
  const none = list.filter((d) => !d.vendorId && M.isOpen(d)).length;
  view().innerHTML = `
    ${contactPickerSupported() ? `<button type="button" class="btn btn-block" id="btn-contacts">📇 연락처에서 업체 가져오기</button>` : ""}
    ${vs.map(({ v, s }) => `<article class="vcard" data-v="${v.id}" tabindex="0"><div class="vc-main"><b>${esc(v.name)}</b><small>${esc([v.person, (v.phones || [])[0]].filter(Boolean).join(" · ") || "연락처 없음")}</small>
      <small class="help">${esc((v.trades || []).join(", ") || "공종 미지정")}</small></div>
      <div class="vc-num"><span><b>${s.unsent}</b>미전달</span><span><b>${s.open}</b>미조치</span>${s.od ? `<span class="od"><b>${s.od}</b>초과</span>` : ""}</div></article>`).join("") ||
      `<div class="card empty-card"><p>등록된 업체가 없어요.<br>업체를 등록하면 공종에 맞춰 담당업체가 자동으로 지정되고, 카톡·문자로 바로 보낼 수 있어요.</p></div>`}
    ${none ? `<button type="button" class="btn btn-block" id="btn-none">업체 미지정 미조치 ${none}건 보기</button>` : ""}`;
  $$(".vcard", view()).forEach((c) => c.addEventListener("click", () => go(`#/vendor?id=${c.dataset.v}`)));
  $("#btn-vadd").addEventListener("click", () => go("#/vendor-edit"));
  $("#btn-none")?.addEventListener("click", () => { S.filter = { vendorId: "_none", status: "_open" }; LS.set("filter", S.filter); go("#/list"); });
  $("#btn-contacts")?.addEventListener("click", importContacts);
};
async function importContacts() {
  try {
    const cs = await pickContacts(); let k = 0;
    for (const c of cs) { if (!c.name && !c.phones.length) continue; await saveVendor({ id: M.uid("v"), name: c.name || c.phones[0], person: "", phones: c.phones.map(M.normPhone), trades: [], memo: "", createdAt: new Date().toISOString() }); k++; }
    if (k) { toast(`${k}개 업체를 추가했어요. 공종을 지정해 주세요`); rerender(); }
  } catch (e) { if (e?.name !== "AbortError") toast("연락처를 가져올 수 없어요"); }
}
ROUTES.vendor = async (qq) => {
  const v = V(qq.id); if (!v) return replace("#/vendors");
  setTab("vendors"); setHeader(v.name, { backBtn: true, action: `<button type="button" class="hdr-btn" id="btn-vedit">수정</button>` });
  const mode = LS.get("vmode", "unsent");
  const all = PD().filter((d) => d.vendorId === v.id);
  const sets = { unsent: all.filter((d) => d.status === "접수" || d.status === "재접수"), open: all.filter(M.isOpen), od: all.filter((d) => M.isOverdue(d)), done: all.filter((d) => d.status === "조치완료"), all };
  const list = sets[mode].sort(M.sortDefects);
  const ph = v.phones || [];
  view().innerHTML = `
    <section class="card"><div class="vinfo"><div><b>${esc(v.person || "담당자 미입력")}</b><small>${esc((v.trades || []).join(", ") || "공종 미지정")}</small>${v.memo ? `<small>${esc(v.memo)}</small>` : ""}</div></div>
      <div class="contact-row">${ph.map((p) => `<a class="btn" href="${M.telHref(p)}">📞 ${esc(p)}</a>`).join("") || '<span class="help">전화번호가 없어요 · 수정에서 추가</span>'}</div></section>
    <div class="chips scroll">${[["unsent", "미전달"], ["open", "미조치"], ["od", "기한초과"], ["done", "조치완료(확인 대기)"], ["all", "전체"]].map(([k, l]) => `<button type="button" class="chip ${k === mode ? "on" : ""}" data-m="${k}">${l} ${sets[k].length}</button>`).join("")}</div>
    <div class="send-bar"><button type="button" class="btn btn-kakao btn-lg" id="btn-send">보내기 · 건별 선택 (${list.filter((d) => d.status !== "확인완료").length})</button>
      ${ph[0] ? `<button type="button" class="btn btn-lg" id="btn-sms">💬 문자</button>` : ""}<button type="button" class="btn btn-lg" id="btn-pdf">📄 요청서</button></div>
    ${mode === "done" && list.length ? `<button type="button" class="btn btn-block" id="btn-confirm-all">조치완료 ${list.length}건 모두 확인완료</button>` : ""}
    <div>${list.map((d) => defectCard(d, { sel: true })).join("") || '<div class="card empty-card"><p>해당하는 하자가 없어요.</p></div>'}</div>
    ${selBarHtml({ all: true })}`;
  bindCards(); syncChecks(); bindSelBar(list);
  $("#btn-vedit").addEventListener("click", () => go(`#/vendor-edit?id=${v.id}`));
  $$("[data-m]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("vmode", b.dataset.m); rerender(); }));
  const sendAll = () => { const picked = selItems(); if (picked.length) return sendSheet({ items: [...new Set([...all.filter((d) => d.status !== "확인완료"), ...picked])], vendor: v, preselect: picked.map((d) => d.id) }); const pool = [...new Set([...all.filter((d) => d.status !== "확인완료"), ...list])]; if (!pool.length) return toast("보낼 하자가 없어요"); sendSheet({ items: pool, vendor: v, preselect: ["unsent", "od", "done"].includes(mode) ? list.filter((d) => d.status !== "확인완료").map((d) => d.id) : null }); };
  $("#btn-send").addEventListener("click", sendAll);
  $("#btn-sms")?.addEventListener("click", sendAll);
  $("#btn-pdf").addEventListener("click", () => (list.length ? printRequest({ vendor: v, items: list }) : toast("요청서에 넣을 하자가 없어요")));
  $("#btn-confirm-all")?.addEventListener("click", async () => { if (!(await ask(`${list.length}건을 확인완료로 바꿀까요?`))) return; for (const d of list) { setStatus(d, "확인완료", "일괄 확인"); await saveDefect(d); } rerender(); });
};
ROUTES["vendor-edit"] = async (qq) => {
  const p = P(); const v = V(qq.id) || { id: M.uid("v"), name: "", person: "", phones: [""], trades: [], memo: "", createdAt: new Date().toISOString() };
  const isNew = !V(qq.id);
  setTab(null); setHeader(isNew ? "업체 등록" : "업체 수정", { backBtn: true });
  const trades = [...new Set([...p.trades.map((t) => t.name), ...(v.trades || [])])];
  view().innerHTML = `<form id="vform" class="form">
    <label class="fld"><span>업체명 <em>*</em></span><input class="inp" id="v-name" value="${esc(v.name)}" placeholder="예: ○○타일" required></label>
    <label class="fld"><span>담당자</span><input class="inp" id="v-person" value="${esc(v.person || "")}" placeholder="예: 김반장"></label>
    <div class="fld"><span>전화번호</span><div id="v-phones">${(v.phones.length ? v.phones : [""]).map((ph) => `<div class="row"><input class="inp" type="tel" inputmode="tel" value="${esc(ph)}" placeholder="010-0000-0000"><button type="button" class="btn btn-sm" data-rmp>삭제</button></div>`).join("")}</div>
      <div class="row"><button type="button" class="btn btn-sm" id="v-addph">＋ 번호 추가</button>${contactPickerSupported() ? `<button type="button" class="btn btn-sm" id="v-pick">📇 연락처에서</button>` : ""}</div></div>
    <div class="fld"><span>담당 공종 <small>(이 공종 하자 등록 시 자동 지정)</small></span><div class="chips wrap" id="v-trades">${trades.map((t) => `<button type="button" class="chip ${(v.trades || []).includes(t) ? "on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>
    <label class="fld"><span>메모</span><input class="inp" id="v-memo" value="${esc(v.memo || "")}" placeholder="예: 오전 현장 상주"></label>
    <div class="form-act">${isNew ? "" : `<button type="button" class="btn btn-danger" id="v-del">삭제</button>`}<button type="submit" class="btn btn-primary btn-lg">저장</button></div></form>`;
  const phoneRow = (val = "") => { const r = document.createElement("div"); r.className = "row"; r.innerHTML = `<input class="inp" type="tel" inputmode="tel" value="${esc(val)}" placeholder="010-0000-0000"><button type="button" class="btn btn-sm" data-rmp>삭제</button>`; $("#v-phones").appendChild(r); };
  $("#v-phones").addEventListener("click", (e) => { if (e.target.matches("[data-rmp]")) e.target.parentElement.remove(); });
  $("#v-addph").addEventListener("click", () => phoneRow());
  $("#v-pick")?.addEventListener("click", async () => { try { const [c] = await pickContacts(); if (!c) return; if (!$("#v-name").value) $("#v-name").value = c.name; c.phones.forEach((p2) => phoneRow(M.normPhone(p2))); } catch {} });
  $("#v-trades").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) b.classList.toggle("on"); });
  $("#vform").addEventListener("submit", async (e) => {
    e.preventDefault(); const name = $("#v-name").value.trim(); if (!name) return toast("업체명을 입력하세요");
    Object.assign(v, { name, person: $("#v-person").value.trim(), phones: $$("#v-phones input").map((i) => M.normPhone(i.value)).filter(Boolean),
      trades: $$("#v-trades .chip.on").map((b) => b.dataset.t), memo: $("#v-memo").value.trim() });
    await saveVendor(v); toast("저장했어요"); back();
  });
  $("#v-del")?.addEventListener("click", async () => {
    const cnt = S.defects.filter((d) => d.vendorId === v.id).length;
    if (!(await ask(`‘${v.name}’을(를) 삭제할까요?${cnt ? `\n연결된 하자 ${cnt}건은 ‘업체 미지정’이 됩니다.` : ""}`, { ok: "삭제", danger: true }))) return;
    for (const d of S.defects.filter((x) => x.vendorId === v.id)) { d.vendorId = ""; await saveDefect(d, { local: false }); }
    await db.del("vendors", v.id); S.vendors = S.vendors.filter((x) => x.id !== v.id); toast("삭제했어요"); replace("#/vendors");
  });
};
async function quickVendor(trade) {
  const name = await prompt2("새 업체 이름", "", { ok: "다음", placeholder: "예: ○○설비" }); if (!name) return null;
  const phone = await prompt2("전화번호 (없으면 비워 두기)", "", { type: "tel", ok: "등록", placeholder: "010-0000-0000" });
  const v = { id: M.uid("v"), name, person: "", phones: phone ? [M.normPhone(phone)] : [], trades: trade ? [trade] : [], memo: "", createdAt: new Date().toISOString() };
  await saveVendor(v); toast(`‘${name}’ 등록${trade ? ` · ${trade} 담당` : ""}`); return v;
}

/* ---------- 내보내기 ---------- */
async function exportSheet(list, title) {
  if (!list.length) return toast("내보낼 하자가 없어요");
  const k = await choose(`${title} 내보내기 · ${list.length}건`, [{ label: "엑셀(.xlsx)", value: "xlsx", icon: "📊" }, { label: "CSV", value: "csv", icon: "🧾" }, { label: "요청서 PDF(인쇄)", value: "pdf", icon: "📄", sub: "업체별로 묶어서 인쇄" }]);
  if (!k) return;
  const { toXlsx, toCsv } = await import("./exporter.js");
  const ctx = { vendorName: vName, photos: photoCount };
  const fn = `${P().name}_${title}_${M.todayStr()}`.replace(/[\\/:*?"<>|\s]+/g, "_");
  if (k === "xlsx") { busy(true, "엑셀 만드는 중…"); const b = await toXlsx(list, ctx); busy(false); S.lastExport = { name: fn + ".xlsx", size: b.size }; return shareOrDownload(b, fn + ".xlsx"); }
  if (k === "csv") { const b = toCsv(list, ctx); S.lastExport = { name: fn + ".csv", size: b.size }; return shareOrDownload(b, fn + ".csv"); }
  const byV = new Map(); for (const d of list) byV.set(d.vendorId || "", [...(byV.get(d.vendorId || "") || []), d]);
  if (byV.size === 1) return printRequest({ vendor: V([...byV.keys()][0]), items: list });
  const vid = await choose("어느 업체 요청서?", [...byV.entries()].map(([id, a]) => ({ label: id ? vLabel(id) : "업체 미지정", sub: `${a.length}건`, value: id || "_none" })));
  if (vid) printRequest({ vendor: V(vid), items: byV.get(vid === "_none" ? "" : vid) });
}

/* ---------- 설정 ---------- */
ROUTES.settings = async () => {
  setTab("settings"); setHeader("설정", { backBtn: navDepth() > 1, action: `<span class="ver-badge" id="hdr-ver" title="앱 버전">v${APP_VERSION}</span>` });
  const p = P(); let est = "";
  try { const e = await navigator.storage?.estimate?.(); if (e) est = `${(e.usage / 1048576).toFixed(1)}MB 사용`; } catch {}
  let persisted = false; try { persisted = await navigator.storage?.persisted?.(); } catch {}
  const item = (go2, ico, t, sub = "", attr = "") => `<button type="button" class="sitem" ${go2 ? `data-go="${go2}"` : ""} ${attr}><span class="si-ico">${ico}</span><span><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</span><span class="chev">›</span></button>`;
  view().innerHTML = `${verFoot().replace('class="ver-foot"', 'class="ver-foot top"')}
    <h3 class="sec">현장</h3><div class="slist">
      ${p ? item("#/project", "🏗", esc(p.name), `${p.dongs.length}개 동 · 공종 ${p.trades.length} · 유형 ${p.types.length} · 도면 ${S.plans.filter((x) => x.projectId === p.id).length}`) : ""}
      ${item("", "🔁", "현장 전환 / 새 현장", `${S.projects.length}개 현장${Pro.isPro() ? "" : " · 무료판 1개"}`, 'data-a="switch"')}
      ${p ? item("", "🎨", "동현황 색 기준", M.heatLegendText(M.heatThresholds(p, PD())) + ` · ${M.heatCfg(p).basis === "all" ? "전체" : "미조치"}${M.heatCfg(p).mode === "auto" ? " · 자동" : ""}`, 'data-a="heat"') : ""}
      ${item("", "🧪", "샘플 현장 불러오기", "기능을 둘러볼 수 있는 가상 데이터", 'data-a="sample"')}</div>
    <h3 class="sec">동기화</h3><div class="slist">
      ${item("#/sync", "👥", "동기화·팀 현장", Sync.attached() ? `${esc(Sync.state.ws.name)} · ${ROLE_KO[Sync.state.ws.role] || ""} · ${esc(Sync.status().label)}` : "꺼짐 · 팀원·PC·폰이 같은 현장을 실시간으로 공유", 'id="si-sync"')}</div>
    <h3 class="sec">데이터</h3><div class="slist">
      ${p ? item("#/import", "📥", "엑셀·CSV 가져오기", "다른 시스템 하자 목록 → 열 매핑 후 가져오기") : ""}
      ${p ? item("", "📤", "전체 내보내기", "엑셀·CSV·요청서", 'data-a="export"') : ""}
      ${item("", "💾", "백업 파일 만들기 (zip)", "데이터+사진 전체 · 기기 변경 시 필수", 'data-a="backup"')}
      ${item("#/restore", "♻️", "백업에서 복원", "")}
      ${item("", "🛡", "저장공간 보호", persisted ? "켜짐 · 브라우저가 데이터를 지우지 않아요" : `꺼짐 · 눌러서 요청${est ? " · " + est : ""}`, 'data-a="persist"')}</div>
    <h3 class="sec">일반</h3><div class="slist">
      ${item("", "✍️", "요청자 이름", esc(S.issuer || "요청서에 표시될 이름(선택)"), 'data-a="issuer"')}
      ${item("#/pro", "⭐", Pro.isPro() ? "하자싹 프로 (사용 중)" : "하자싹 프로", Pro.isPro() ? "모든 기능 사용 중" : "현장 무제한 · 요청서 워터마크 제거")}
      ${item("#/onboard?again=1", "📘", "사용법 다시 보기", "")}
      ${item("#/about", "ℹ️", "앱 정보", `버전 ${APP_VERSION}`)}
      ${item("#/privacy", "🔒", "개인정보처리방침", Sync.attached() ? "동기화 중: 데이터가 Google Firebase에 저장돼요" : "동기화를 켜기 전에는 기기에만 저장")}
      ${item("", "🗑", "모든 데이터 삭제", Sync.attached() ? "현장·하자·사진·업체 · 팀 현장 전체(모든 팀원 기기·클라우드)에서도 삭제" : "이 기기의 현장·하자·사진·업체", 'data-a="wipe"')}</div>`;
  bindVerFoot();
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a;
    if (a === "switch") return switchProject();
    if (a === "sample") return loadSample();
    if (a === "heat") return heatSheet();
    if (a === "export") return exportSheet(PD(), "전체");
    if (a === "backup") return doBackup();
    if (a === "persist") { const ok = await navigator.storage?.persist?.(); toast(ok ? "저장공간 보호가 켜졌어요" : "브라우저가 거절했어요. 앱을 홈 화면에 설치하면 보통 허용돼요"); return rerender(); }
    if (a === "issuer") { const v = await prompt2("요청자 이름(요청서 표시)", S.issuer); if (v !== null) { S.issuer = v; LS.set("issuer", v); rerender(); } return; }
    if (a === "wipe") {
      if (!(await ask(Sync.attached() ? "이 팀 현장의 모든 현장·하자·사진·업체를 삭제할까요?\n팀 현장이라 클라우드와 모든 팀원 기기에서도 지워져요. 이 기기만 비우려면 동기화·팀에서 ‘이 기기 전용으로 전환’하세요.\n먼저 백업 파일을 만들어 두세요. 되돌릴 수 없어요." : "이 기기의 모든 현장·하자·사진·업체를 삭제할까요?\n먼저 백업 파일을 만들어 두세요. 되돌릴 수 없어요.", { ok: "모두 삭제", danger: true }))) return;
      for (const st of ["projects", "defects", "photos", "vendors", "plans"]) await db.clear(st);
      await loadAll(); toast("모두 삭제했어요"); replace("#/home");
    }
  }));
};
async function doBackup() {
  busy(true, "백업 만드는 중…");
  try { const { exportBackup } = await import("./backup.js"); const b = await exportBackup(APP_VERSION); busy(false); S.lastBackup = b; await db.setMeta("lastBackupAt", new Date().toISOString());
    await shareOrDownload(b, `하자싹_백업_${M.todayStr()}.zip`, "하자싹 백업"); }
  catch (e) { busy(false); toast("백업 실패: " + e.message); }
}
ROUTES.restore = async () => {
  setTab(null); setHeader("백업에서 복원", { backBtn: true });
  view().innerHTML = `<div class="card"><p>‘하자싹_백업_날짜.zip’ 파일을 고르세요. 현장·하자·사진·업체·도면이 복원돼요.</p>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="btn-pick">백업 파일 선택</button></div>`;
  $("#btn-pick").addEventListener("click", async () => {
    const [f] = await pickFile(".zip,application/zip"); if (!f) return;
    await restoreFrom(f);
  });
};
async function restoreFrom(f) {
  busy(true, "백업 읽는 중…");
  try {
    const { readBackup, restoreBackup } = await import("./backup.js"); const bk = await readBackup(f); busy(false);
    const d = bk.data;
    const mode = S.projects.length ? await choose(`백업: 현장 ${d.projects.length} · 하자 ${n(d.defects.length)} · 사진 ${n(d.photos.length)}`, [{ label: "전체 교체", sub: "지금 기기 데이터를 지우고 백업으로 바꿔요", value: "replace" }, { label: "합치기", sub: "같은 항목은 백업 내용으로 덮어써요", value: "merge" }]) : "replace";
    if (!mode) return;
    busy(true, "복원 중…"); const r = await restoreBackup(bk, mode); await loadAll(); busy(false);
    toast(`복원 완료 · 하자 ${n(r.defects)}건, 사진 ${n(r.photos)}장`); replace("#/home");
  } catch (e) { busy(false); toast("복원 실패: " + e.message); }
}

/* 현장 설정 */
ROUTES.project = async () => {
  const p = P(); setTab(null); setHeader("현장 설정", { backBtn: true });
  const plans = S.plans.filter((x) => x.projectId === p.id);
  view().innerHTML = `
    <label class="fld"><span>현장 이름</span><input class="inp" id="pj-name" value="${esc(p.name)}"></label>
    <label class="fld"><span>기본 조치기한 (등록일 + 일)</span><input class="inp" id="pj-due" type="number" min="0" max="90" value="${p.dueDays ?? 7}"></label>
    <h3 class="sec">동 <small>${p.dongs.length}개 · 줄임말은 빠른 검색용(예: 9동 → 109동)</small></h3>
    <div class="slist">${p.dongs.map((d) => `<button type="button" class="sitem" data-dong="${d.id}"><span class="si-ico">🏢</span><span><b>${esc(d.name)}${d.alias ? ` <small class="tag">줄임 ${esc(d.alias)}</small>` : ""}</b><small>지하${d.basement || 0} · ${d.floors}층 · ${d.lines}호 라인 · 세대 ${d.unitStart || 1}층부터${d.units?.length ? ` · 실제 세대 ${d.units.length}개(데이터 기준)` : ""}</small></span><span class="chev">›</span></button>`).join("")}</div>
    <div class="row"><button type="button" class="btn" id="btn-adddong">＋ 동 추가</button><button type="button" class="btn" id="btn-bulkdong">＋ 여러 동 한 번에</button></div>
    <h3 class="sec">목록 편집</h3><div class="slist">
      ${[["commons", "🅿", "공용부", p.commons], ["trades", "🧱", "공종·세부공종", p.trades.map((t) => t.name)], ["types", "🏷", "하자 유형", p.types], ["categories", "🗂", "구분", M.catsOf(p)], ["rooms", "🚪", "실", p.rooms], ["parts", "🧩", "부위", p.parts]]
        .map(([k, ico, t, arr]) => `<button type="button" class="sitem" data-list="${k}"><span class="si-ico">${ico}</span><span><b>${t}</b><small>${esc(arr.slice(0, 6).join(", "))}${arr.length > 6 ? " …" : ""}</small></span><span class="chev">›</span></button>`).join("")}</div>
    <h3 class="sec">도면 <small>동·층별 평면도 이미지 → 하자 위치를 도면에 찍기</small></h3>
    <div class="slist">${plans.map((pl) => `<button type="button" class="sitem" data-plan="${pl.id}"><span class="si-ico">🗺</span><span><b>${esc(pl.name)}</b><small>${esc(pl.dongs?.length ? pl.dongs.join(", ") : "전체 동")} · ${esc(pl.floors || "전체 층")}</small></span><span class="chev">›</span></button>`).join("") || '<p class="help">등록된 도면이 없어요</p>'}</div>
    <button type="button" class="btn" id="btn-addplan">＋ 도면 이미지 추가</button>
    <button type="button" class="btn btn-danger btn-block" id="btn-delproj">이 현장 삭제</button>`;
  $("#pj-name").addEventListener("change", async (e) => { p.name = e.target.value.trim() || p.name; await saveProject(p); toast("저장"); });
  $("#pj-due").addEventListener("change", async (e) => { p.dueDays = Math.max(0, Number(e.target.value) || 0); await saveProject(p); toast("저장"); });
  $$("[data-dong]", view()).forEach((b) => b.addEventListener("click", () => go(`#/dong?id=${b.dataset.dong}`)));
  $("#btn-adddong").addEventListener("click", () => go("#/dong"));
  $("#btn-bulkdong").addEventListener("click", () => go("#/wizard?step=2&add=1"));
  $$("[data-list]", view()).forEach((b) => b.addEventListener("click", () => go(`#/lists?k=${b.dataset.list}`)));
  $$("[data-plan]", view()).forEach((b) => b.addEventListener("click", () => planEdit(S.plans.find((x) => x.id === b.dataset.plan))));
  $("#btn-addplan").addEventListener("click", async () => {
    const [f] = await pickFile("image/*"); if (!f) return;
    busy(true, "도면 압축 중…"); const c = await compressImage(f, { max: 2400, quality: 0.8 }); busy(false);
    planEdit({ id: M.uid("pl"), projectId: p.id, name: f.name.replace(/\.\w+$/, "").slice(0, 30) || "평면도", dongs: [], floors: "", blob: c.blob, w: c.w, h: c.h }, true);
  });
  $("#btn-delproj").addEventListener("click", async () => {
    const cnt = PD().length;
    if (!(await ask(`‘${p.name}’ 현장과 하자 ${cnt}건·사진을 모두 삭제할까요? 되돌릴 수 없어요.`, { ok: "현장 삭제", danger: true }))) return;
    busy(true, "삭제 중…");
    for (const d of PD()) await db.delByIndex("photos", "by_defect", d.id);
    await db.delByIndex("defects", "by_project", p.id); await db.delByIndex("plans", "by_project", p.id); await db.del("projects", p.id);
    await loadAll(); busy(false); toast("현장을 삭제했어요"); replace("#/home");
  });
};
function planEdit(pl, isNew = false) {
  const p = P();
  const s = openSheet({ title: isNew ? "도면 추가" : "도면 수정", full: true,
    html: `<div class="plan mini"><img id="pe-img" alt="도면"></div>
      <label class="fld"><span>이름</span><input class="inp" id="pe-name" value="${esc(pl.name)}" placeholder="예: 84A 기준층"></label>
      <div class="fld"><span>적용 동 <small>(아무것도 안 고르면 전체 동)</small></span><div class="chips wrap" id="pe-dongs">${p.dongs.map((d) => `<button type="button" class="chip ${pl.dongs?.includes(d.name) ? "on" : ""}" data-d="${esc(d.name)}">${esc(d.name)}</button>`).join("")}</div></div>
      <label class="fld"><span>적용 층 <small>(예: 3-25, B2-B1 · 비우면 전체)</small></span><input class="inp" id="pe-floors" value="${esc(pl.floors || "")}" placeholder="3-25"></label>`,
    footer: `${isNew ? "" : '<button type="button" class="btn btn-danger" data-a="del">삭제</button>'}<button type="button" class="btn btn-primary" data-a="save">저장</button>` });
  const u = URL.createObjectURL(pl.blob); $("#pe-img", s.el).src = u; s.onClose = () => URL.revokeObjectURL(u);
  $("#pe-dongs", s.el).addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) b.classList.toggle("on"); });
  $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.a === "del") { await db.del("plans", pl.id); S.plans = S.plans.filter((x) => x.id !== pl.id); }
    else { Object.assign(pl, { name: $("#pe-name", s.el).value.trim() || "평면도", dongs: $$("#pe-dongs .chip.on", s.el).map((x) => x.dataset.d), floors: $("#pe-floors", s.el).value.trim() });
      await db.put("plans", pl); const i = S.plans.findIndex((x) => x.id === pl.id); if (i >= 0) S.plans[i] = pl; else S.plans.push(pl); }
    await s.close(); rerender();
  }));
}
ROUTES.dong = async (qq) => {
  const p = P(); const ex = p.dongs.find((d) => d.id === qq.id);
  const d = ex ? { ...ex } : { id: M.uid("d"), name: "", alias: "", floors: 15, lines: 4, basement: 2, unitStart: 1, roof: true, skipLines: "" };
  setTab(null); setHeader(ex ? `${ex.name} 수정` : "동 추가", { backBtn: true });
  const f = (k, label, type = "number", extra = "") => `<label class="fld"><span>${label}</span><input class="inp" data-k="${k}" type="${type}" value="${esc(d[k] ?? "")}" ${extra}></label>`;
  view().innerHTML = `<form id="dgform" class="form"><div class="grid2">${f("name", "동 이름 *", "text", 'placeholder="예: 101동"')}${f("alias", "줄임말(검색)", "text", 'placeholder="예: 1"')}
    ${f("floors", "지상 층수", "number", 'min="1" max="99"')}${f("basement", "지하 층수", "number", 'min="0" max="9"')}
    ${f("lines", "층당 호수(라인)", "number", 'min="0" max="20"')}${f("unitStart", "세대 시작층", "number", 'min="1" max="99"')}</div>
    ${f("skipLines", "없는 라인(쉼표)", "text", 'placeholder="예: 4 (4호 라인 없음)"')}
    <label class="check"><input type="checkbox" data-k="roof" ${d.roof ? "checked" : ""}> 옥상 포함</label>
    <p class="help" id="dg-prev"></p>
    <div class="form-act">${ex ? '<button type="button" class="btn btn-danger" id="dg-del">삭제</button>' : ""}<button type="submit" class="btn btn-primary btn-lg">저장</button></div></form>`;
  const read = () => { $$("[data-k]", view()).forEach((i) => { d[i.dataset.k] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) || 0 : i.value.trim(); }); };
  const prev = () => { read(); const us = M.floorsOf(d).flatMap((fl) => M.unitsOf(d, fl)); $("#dg-prev").textContent = `세대 ${us.length}개 · 예: ${us.slice(0, 3).join(", ")}${us.length > 3 ? " … " + us[us.length - 1] : ""}`; };
  view().oninput = prev; prev();
  $("#dgform").addEventListener("submit", async (e) => {
    e.preventDefault(); read(); if (!d.name) return toast("동 이름을 입력하세요");
    if (ex?.units && ["floors", "lines", "unitStart", "skipLines"].some((k) => String(ex[k] ?? "") !== String(d[k] ?? ""))) delete d.units; // 직접 고치면 수동 구조 사용
    if (/^\d+$/.test(d.name)) d.name += "동";
    if (!d.alias) d.alias = M.aliasOf(M.dongNum(d.name));
    const i = p.dongs.findIndex((x) => x.id === d.id);
    if (p.dongs.some((x) => x.name === d.name && x.id !== d.id)) return toast("같은 이름의 동이 있어요");
    if (ex && ex.name !== d.name) for (const x of S.defects.filter((y) => y.projectId === p.id && y.dong === ex.name)) { x.dong = d.name; await saveDefect(x, { local: false }); }
    if (i >= 0) p.dongs[i] = d; else p.dongs.push(d);
    p.dongs.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    await saveProject(p); toast("저장했어요"); back();
  });
  $("#dg-del")?.addEventListener("click", async () => {
    const cnt = PD().filter((x) => x.dong === ex.name).length;
    if (!(await ask(`${ex.name}을(를) 삭제할까요?${cnt ? `\n하자 ${cnt}건은 남지만 위치 선택 목록에서 빠져요.` : ""}`, { ok: "삭제", danger: true }))) return;
    p.dongs = p.dongs.filter((x) => x.id !== ex.id); await saveProject(p); back();
  });
};
ROUTES.lists = async (qq) => {
  const p = P(); const k = qq.k;
  const title = { commons: "공용부", trades: "공종", types: "하자 유형", categories: "구분", rooms: "실", parts: "부위" }[k] || "목록";
  if (k === "categories" && !Array.isArray(p.categories)) p.categories = [...M.catsOf(p)];
  setTab(null); setHeader(title, { backBtn: true });
  const arr = k === "trades" ? p.trades.map((t) => t.name) : p[k];
  view().innerHTML = `<p class="help">항목을 누르면 이름 변경·삭제${k === "trades" ? "·세부공종 편집" : ""}을 할 수 있어요. ↑↓로 순서를 바꿔요.</p>
    <div class="slist">${arr.map((x, i) => `<div class="sitem"><button type="button" class="si-main" data-i="${i}"><b>${esc(x)}</b>${k === "trades" ? `<small>${esc(p.trades[i].subs.join(", ") || "세부공종 없음")}</small>` : ""}</button>
      <button type="button" class="btn btn-sm" data-up="${i}" aria-label="위로">↑</button><button type="button" class="btn btn-sm" data-dn="${i}" aria-label="아래로">↓</button></div>`).join("")}</div>
    <div class="row"><button type="button" class="btn btn-primary" id="l-add">＋ 추가</button><button type="button" class="btn" id="l-reset">기본값으로</button></div>`;
  const src = () => (k === "trades" ? p.trades : p[k]);
  const save = async () => { await saveProject(p); rerender(); };
  $("#l-add").addEventListener("click", async () => { if (LIST_NAME[k]) { if (await addListItem(k)) rerender(); return; } const v = await prompt2(`${title} 추가`); if (!v) return; if (!p[k].includes(v)) p[k].push(v); save(); });
  $("#l-reset").addEventListener("click", async () => {
    if (!(await ask(`${title} 목록을 기본값으로 되돌릴까요? 직접 추가한 항목이 사라져요.`))) return;
    const D = { commons: M.DEFAULT_COMMONS, types: M.DEFAULT_TYPES, rooms: M.DEFAULT_ROOMS, parts: M.DEFAULT_PARTS, categories: M.CATEGORIES };
    if (k === "trades") p.trades = M.DEFAULT_TRADES.map((t) => ({ name: t.name, subs: [...t.subs] })); else p[k] = [...D[k]]; save();
  });
  $$("[data-up],[data-dn]", view()).forEach((b) => b.addEventListener("click", () => {
    const a = src(); const i = Number(b.dataset.up ?? b.dataset.dn); const j = b.dataset.up != null ? i - 1 : i + 1;
    if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; save();
  }));
  $$("[data-i]", view()).forEach((b) => b.addEventListener("click", async () => {
    const i = +b.dataset.i; const a = src(); const name = k === "trades" ? a[i].name : a[i];
    if (k !== "trades" && LIST_NAME[k]) { if (await editListItem(k, name)) rerender(); return; }
    const act = await choose(name, [{ label: "이름 변경·삭제", value: "ed" }, ...(k === "trades" ? [{ label: "세부공종 편집", value: "subs", sub: a[i].subs.join(", ") }] : [])]);
    if (act === "ed") { if (await editListItem(k, name)) rerender(); return; }
    else if (act === "subs") { const v = await prompt2("세부공종 (쉼표로 구분)", a[i].subs.join(", ")); if (v === null) return; a[i].subs = v.split(/\s*,\s*/).filter(Boolean); }
    else if (act === "del") a.splice(i, 1); else return;
    save();
  }));
};

/* ---------- 새 현장 마법사 (단계마다 history 항목 → 뒤로가기로 이전 단계) ---------- */
ROUTES.wizard = async (qq) => {
  const step = Number(qq.step || 1); const addMode = !!qq.add;
  if (addMode && !P()) return replace("#/home");
  if (!S.wiz || !!S.wiz.addInit !== addMode) S.wiz = { name: "", start: 101, count: 5, floors: 20, lines: 4, basement: 2, unitStart: 1, commons: [...M.DEFAULT_COMMONS] };
  if (addMode && !S.wiz.addInit) { const last = P().dongs.at(-1); S.wiz = { ...S.wiz, addInit: true, start: last ? Number(M.dongNum(last.name)) + 1 || 101 : 101, count: 1 }; }
  const w = S.wiz; setTab(null);
  setHeader(addMode ? "여러 동 추가" : `새 현장 (${step}/3)`, { backBtn: true });
  const num = (k, label, min, max) => `<label class="fld"><span>${label}</span><input class="inp" type="number" inputmode="numeric" data-k="${k}" min="${min}" max="${max}" value="${w[k]}"></label>`;
  if (step === 1) {
    view().innerHTML = `<div class="wiz"><h2>현장 이름</h2><p class="help">현장명은 업체에 보내는 문구와 요청서에 들어가요.</p>
      <input class="inp inp-lg" id="w-name" value="${esc(w.name)}" placeholder="예: ○○지구 A블록 신축공사" autocomplete="off">
      <button type="button" class="btn btn-primary btn-lg btn-block" id="w-next">다음</button></div>`;
    $("#w-next").addEventListener("click", () => { w.name = $("#w-name").value.trim(); if (!w.name) return toast("현장 이름을 입력하세요"); go("#/wizard?step=2&keep=1"); });
    return;
  }
  if (step === 2) {
    view().innerHTML = `<div class="wiz"><h2>동·층·호수</h2><p class="help">번호가 이어지는 동을 한 번에 만들어요. 나중에 동별로 고칠 수 있어요.</p>
      <div class="grid2">${num("start", "시작 동 번호", 1, 9999)}${num("count", "동 개수", 1, 60)}${num("floors", "지상 층수", 1, 99)}${num("basement", "지하 층수", 0, 9)}${num("lines", "층당 호수(라인)", 0, 20)}${num("unitStart", "세대 시작층", 1, 99)}</div>
      <div class="card preview" id="w-prev"></div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="w-next">${addMode ? "동 추가" : "다음"}</button></div>`;
    const read = () => $$("[data-k]", view()).forEach((i) => { w[i.dataset.k] = Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0)); });
    const prev = () => { read(); const ds = M.makeDongs(w); const u = ds.reduce((s2, d) => s2 + M.floorsOf(d).flatMap((f) => M.unitsOf(d, f)).length, 0);
      $("#w-prev").innerHTML = `<b>${ds[0]?.name}${ds.length > 1 ? " ~ " + ds.at(-1).name : ""}</b> · ${ds.length}개 동<br>지하 ${w.basement}층 ~ 지상 ${w.floors}층 · 층당 ${w.lines}호 → 세대 약 <b>${n(u)}</b>개<br><small>호수 예: ${w.unitStart * 100 + 1}, ${w.floors * 100 + w.lines} · 빠른검색 줄임말: ${ds.slice(0, 3).map((d) => `${d.alias}동=${d.name}`).join(", ")}</small>`; };
    view().oninput = prev; prev();
    $("#w-next").addEventListener("click", async () => {
      read();
      if (addMode) { const p = P(); const ds = M.makeDongs(w).filter((d) => !p.dongs.some((x) => x.name === d.name)); p.dongs.push(...ds); p.dongs.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true })); await saveProject(p); S.wiz = null; toast(`${ds.length}개 동을 추가했어요`); back(); return; }
      go("#/wizard?step=3&keep=1");
    });
    return;
  }
  view().innerHTML = `<div class="wiz"><h2>공용부</h2><p class="help">세대 밖 하자 위치로 쓸 곳을 고르세요. 직접 추가할 수도 있어요.</p>
    <div class="chips wrap" id="w-commons">${[...new Set([...M.DEFAULT_COMMONS, ...w.commons])].map((c) => `<button type="button" class="chip ${w.commons.includes(c) ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}<button type="button" class="chip add" id="w-cadd">＋ 직접입력</button></div>
    <p class="help">공종(${M.DEFAULT_TRADES.length}개)·하자 유형(${M.DEFAULT_TYPES.length}개)·실 목록은 공동주택 기본값으로 만들어지고, 설정에서 바꿀 수 있어요.</p>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="w-done">현장 만들기</button></div>`;
  $("#w-commons").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "w-cadd") { const v = await prompt2("공용부 이름"); if (v && !w.commons.includes(v)) w.commons.push(v); return rerender(); }
    const c = b.dataset.c; w.commons = w.commons.includes(c) ? w.commons.filter((x) => x !== c) : [...w.commons, c]; b.classList.toggle("on");
  });
  $("#w-done").addEventListener("click", async () => {
    if (!Pro.can("multiProject", { projectCount: realProjects() })) return proSheet("무료판은 현장 1개까지 만들 수 있어요.");
    const p = M.newProject(w.name || "새 현장"); p.dongs = M.makeDongs(w); p.commons = [...w.commons];
    await saveProject(p); S.pid = p.id; LS.set("pid", p.id); S.wiz = null; S.filter = { status: "_open" }; LS.set("filter", S.filter);
    toast(`‘${p.name}’ 현장을 만들었어요`);
    await unwind(Math.min(step, navDepth() - 1)); replace("#/home");
    if (!S.vendors.length && await ask("업체를 먼저 등록할까요?\n공종별 담당업체를 등록해 두면 하자 등록 때 자동으로 지정되고 카톡·문자로 바로 보낼 수 있어요.", { ok: "업체 등록", cancel: "나중에" })) go("#/vendor-edit");
  });
};

/* ---------- 엑셀·CSV 가져오기 (열 매핑) ---------- */
ROUTES.import = async () => {
  setTab(null); setHeader("엑셀·CSV 가져오기", { backBtn: true });
  const imp = S.imp;
  if (!imp) {
    view().innerHTML = `<div class="card"><p>다른 하자관리 시스템이나 엑셀로 관리하던 목록(.xlsx, .xls, .csv)을 가져와요. 첫 화면에서 각 열이 무엇인지 맞춰 주면, 같은 양식은 다음부터 자동으로 맞춰져요.</p>
      <ul class="help"><li>외부 ID(순번·접수번호) 열을 지정하면 다시 가져올 때 같은 건을 갱신해요. 앱에서 바꾼 상태·업체·메모·사진은 유지돼요.</li><li>파일은 폰 안에서만 읽어요. 서버로 보내지 않아요.</li></ul>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="btn-file">파일 선택</button></div>`;
    $("#btn-file").addEventListener("click", async () => {
      const [f] = await pickFile(".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"); if (!f) return;
      await loadImportFile(f);
    });
    return;
  }
  const { FIELDS } = await import("./importer.js");
  const headers = imp.rows[imp.headerRow] || [];
  const sample = imp.rows.slice(imp.headerRow + 1, imp.headerRow + 4);
  const opt = (k) => `<select class="inp" data-map="${k}"><option value="">— 없음 —</option>${headers.map((h, i) => `<option value="${i}" ${imp.map[k] === i ? "selected" : ""}>${esc(h || `(${i + 1}열)`)}</option>`).join("")}</select>`;
  view().innerHTML = `<div class="card"><b>${esc(imp.file)}</b><small class="help"> · ${n(imp.rows.length - imp.headerRow - 1)}행${imp.remembered ? " · 저장된 매핑 적용" : ""}</small>
      <label class="fld"><span>머리글 행</span><select class="inp" id="hdr-row">${imp.rows.slice(0, 15).map((r, i) => `<option value="${i}" ${i === imp.headerRow ? "selected" : ""}>${i + 1}행: ${esc(r.filter(Boolean).slice(0, 4).join(" | "))}</option>`).join("")}</select></label></div>
    <h3 class="sec">열 맞추기 <small>* 필수</small></h3>
    <div class="maps">${FIELDS.map((f) => `<label class="map"><span>${f.label}${f.req ? " *" : ""}</span>${opt(f.key)}<small class="help">${esc(sample.map((r) => (imp.map[f.key] != null && imp.map[f.key] !== "" ? r[imp.map[f.key]] : "")).filter(Boolean).slice(0, 2).join(" / "))}</small></label>`).join("")}</div>
    <label class="fld"><span>구분 열이 없을 때 기본 구분</span><select class="inp" id="def-cat">${M.catsOf(P()).map((c) => `<option ${c === (imp.defCat || "입주자하자") ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="add-dongs" checked> 현장에 없는 동은 자동으로 추가</label>
    <div class="form-act"><button type="button" class="btn btn-lg" id="imp-cancel">다른 파일</button><button type="button" class="btn btn-primary btn-lg" id="imp-go">적용하기</button></div>
    <p class="help">적용하면 바로 반영되고, 결과 화면에서 <b>되돌리기</b>로 이번 가져오기를 취소할 수 있어요.</p>`;
  $("#hdr-row").addEventListener("change", async (e) => { const { guessMapping } = await import("./importer.js"); imp.headerRow = +e.target.value; imp.map = guessMapping(imp.rows[imp.headerRow] || []); rerender(); });
  $$("[data-map]", view()).forEach((s2) => s2.addEventListener("change", () => { imp.map[s2.dataset.map] = s2.value === "" ? "" : Number(s2.value); rerender(); }));
  $("#def-cat").addEventListener("change", (e) => { imp.defCat = e.target.value; });
  $("#imp-cancel").addEventListener("click", () => { S.imp = null; rerender(); });
  $("#imp-go").addEventListener("click", () => runImport($("#add-dongs").checked));
};
async function loadImportFile(f) {
  busy(true, "파일 읽는 중…");
  try {
    const I = await import("./importer.js"); const r = await I.parseFile(f);
    const headerRow = I.detectHeaderRow(r.rows);
    const sig = I.headerSignature(r.rows[headerRow] || []);
    const saved = (await db.getMeta("importMaps", {}))[sig];
    S.imp = { file: f.name, rows: r.rows, headerRow, map: saved?.map || I.guessMapping(r.rows[headerRow] || []), remembered: !!saved, defCat: saved?.defCat, sig };
    busy(false); rerender();
  } catch (e) { busy(false); toast("파일을 읽지 못했어요: " + e.message); }
}
async function runImport(addDongs) {
  const I = await import("./importer.js"); const imp = S.imp; const p = P();
  if (imp.map.dong === "" || imp.map.dong == null) return toast("‘동’ 열을 지정하세요");
  if (imp.map.content === "" || imp.map.content == null) return toast("‘내용’ 열을 지정하세요");
  busy(true, "분석 중…");
  const recs = I.rowsToRecords(imp.rows, imp.headerRow, imp.map, { project: p, defaultCategory: imp.defCat || "입주자하자" });
  const pcopy = structuredClone(p);
  const res = I.mergeRecords({ project: pcopy, existing: S.defects, records: recs, vendors: S.vendors, addMissingDongs: addDongs });
  const st = res.stats;
  if (!recs.length) { busy(false); return toast("가져올 행이 없어요. 머리글 행과 열 맞추기를 확인하세요"); }
  // 같은 양식의 이전 가져오기보다 행이 크게 줄었을 때만 확인(오래된/부분 파일 실수 방지)
  const hist = await db.getMeta("imports", []);
  const prevSame = [...hist].reverse().find((h) => h.projectId === p.id && h.sig === imp.sig);
  if (prevSame && prevSame.total >= 50 && st.total < prevSame.total * 0.5) {
    busy(false);
    if (!(await ask(`이전에 같은 양식으로 ${n(prevSame.total)}행을 가져왔는데 이번 파일은 ${n(st.total)}행이에요.\n오래된 파일이거나 일부만 있는 파일일 수 있어요. 그래도 적용할까요?\n(이미 있는 하자는 지워지지 않아요)`, { ok: "적용하기", title: "파일 확인" }))) return;
  }
  busy(true, "적용 중…");
  // 되돌리기용 스냅샷: 새로 추가된 하자 id, 바뀌기 전 하자, 새 업체, 바뀌기 전 동 구조
  const byId = new Map(S.defects.map((d) => [d.id, d]));
  const undo = { at: new Date().toISOString(), file: imp.file, projectId: p.id, added: [], prev: [], newVendorIds: res.newVendors.map((v) => v.id), prevDongs: structuredClone(p.dongs) };
  for (const d of res.toPut) { const o = byId.get(d.id); if (o) undo.prev.push(o); else undo.added.push(d.id); }
  await db.setMeta("importUndo", undo);
  await db.putMany("defects", res.toPut); for (const v of res.newVendors) await saveVendor(v);
  Object.assign(p, { dongs: pcopy.dongs }); await saveProject(p);
  const maps = await db.getMeta("importMaps", {}); maps[imp.sig] = { map: imp.map, defCat: imp.defCat, at: new Date().toISOString() }; await db.setMeta("importMaps", maps);
  hist.push({ at: undo.at, file: imp.file, projectId: p.id, sig: imp.sig, ...st }); await db.setMeta("imports", hist.slice(-20));
  S.defects = await db.getAll("defects"); busy(false); S.imp = null; requestPersist();
  S.lastImport = { ...st, at: undo.at, file: imp.file, projectId: p.id, newVendors: res.newVendors.length, newDongs: res.newDongs, fitted: res.fitted || [] };
  toast(`적용했어요 · 새 ${n(st.added)}건, 변경 ${n(st.updated)}건`);
  replace("#/imported");
}
/* 가져오기 결과(적용 후) + 되돌리기 */
ROUTES.imported = async () => {
  setTab(null); setHeader("가져오기 결과", { backBtn: true });
  const r = S.lastImport; const undo = await db.getMeta("importUndo", null);
  if (!r) { view().innerHTML = `<div class="card"><p class="help">최근 가져오기 결과가 없어요.</p></div>`; return; }
  const canUndo = undo && undo.at === r.at && undo.projectId === P()?.id;
  const row = (l, v, cls = "") => `<div class="hrow ${cls}"><span>${l}</span><b>${v}</b></div>`;
  view().innerHTML = `<section class="card imp-res"><h3>✅ 적용 완료 <small>${esc(r.file)}</small></h3>
      ${row("가져온 행", n(r.total) + "개")}${row("새 하자 (추가)", n(r.added) + "건")}${row("변경", `${n(r.updated)}건${r.kept ? ` <small>(내 수정 유지 ${n(r.kept)})</small>` : ""}`)}${row("변경 없음", n(r.same) + "건")}
      ${row("새 업체", r.newVendors + "개")}${r.newDongs.length ? row("새 동", `${r.newDongs.length}개 <small>${esc(r.newDongs.slice(0, 6).join(", "))}${r.newDongs.length > 6 ? "…" : ""}</small>`) : ""}</section>
    ${r.fitted.length ? `<section class="card"><h3>동별 층·세대 <small>데이터에 맞춰 없는 층·세대 제거</small></h3>
      <table class="tbl"><tbody>${r.fitted.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.unitStart}~${x.floors}층 · ${x.floorCount}개 층</td><td class="r">${n(x.units)}세대</td></tr>${x.dropped?.length ? `<tr class="sub"><td></td><td colspan="2"><small>제외 호수: ${esc(x.dropped.slice(0, 8).join(", "))}${x.dropped.length > 8 ? ` 외 ${x.dropped.length - 8}` : ""}</small></td></tr>` : ""}`).join("")}</tbody></table></section>` : ""}
    <button type="button" class="btn btn-primary btn-lg btn-block" id="ir-list">미조치 하자 목록 보기</button>
    ${canUndo ? `<button type="button" class="btn btn-block" id="ir-undo">↩ 되돌리기 (이번 가져오기 취소)</button>` : '<p class="help">되돌리기는 가장 최근 가져오기 한 번만 할 수 있어요.</p>'}`;
  $("#ir-list").addEventListener("click", () => { S.filter = { status: "_open" }; LS.set("filter", S.filter); replace("#/list"); });
  $("#ir-undo")?.addEventListener("click", async () => {
    if (!(await ask(`이번 가져오기를 취소할까요?\n· 추가된 하자 ${n(undo.added.length)}건 삭제\n· 변경된 하자 ${n(undo.prev.length)}건 이전 상태로\n· 새 업체 ${undo.newVendorIds.length}개 삭제, 동 구조 복원\n가져온 뒤 이 하자들에 직접 남긴 수정·사진도 함께 사라져요.`, { ok: "되돌리기", danger: true, title: "되돌리기" }))) return;
    await undoImport(undo); S.lastImport = null; toast("가져오기를 되돌렸어요"); replace("#/list");
  });
};
async function undoImport(undo) {
  busy(true, "되돌리는 중…");
  for (const id of undo.added) if (S.pidx.get(id)) { await db.delByIndex("photos", "by_defect", id); S.pidx.delete(id); }
  await db.delMany("defects", undo.added);
  await db.putMany("defects", undo.prev);
  S.defects = await db.getAll("defects");
  const usedV = new Set(S.defects.map((d) => d.vendorId).filter(Boolean));
  for (const id of undo.newVendorIds) if (!usedV.has(id)) { await db.del("vendors", id); S.vendors = S.vendors.filter((v) => v.id !== id); }
  const p = S.projects.find((x) => x.id === undo.projectId); if (p) { p.dongs = undo.prevDongs; await saveProject(p); }
  const hist = await db.getMeta("imports", []); if (hist.at(-1)?.at === undo.at) { hist.pop(); await db.setMeta("imports", hist); }
  await db.setMeta("importUndo", null); busy(false);
}

/* ---------- 프로 / 정보 / 개인정보 ---------- */
function proSheet(reason = "") {
  const s = openSheet({ title: "하자싹 프로", html: `${reason ? `<p class="pro-reason">${esc(reason)}</p>` : ""}<ul class="pro-list">${Pro.PRO_FEATURES.map((f) => `<li>✔ ${esc(f)}</li>`).join("")}</ul>
    <p class="help">한 번 구매로 계속 사용하는 방식(예정). 결제 기능은 아직 준비 중이에요.</p>`,
    footer: `<button type="button" class="btn" data-close>닫기</button><button type="button" class="btn btn-primary" id="pro-buy">프로 업그레이드 (준비 중)</button>` });
  $$("[data-close]", s.el).forEach((b) => b.addEventListener("click", () => s.close()));
  $("#pro-buy", s.el).addEventListener("click", async () => { const r = await Pro.purchase(); toast(r.ok ? "프로가 활성화됐어요" : "결제 기능은 준비 중이에요"); });
}
ROUTES.pro = async () => {
  setTab(null); setHeader("하자싹 프로", { backBtn: true });
  view().innerHTML = `<section class="card pro-card"><h2>${Pro.isPro() ? "프로 사용 중 ⭐" : "무료판 사용 중"}</h2>
    <table class="tbl"><thead><tr><th></th><th>무료</th><th>프로</th></tr></thead><tbody>
      <tr><td>현장</td><td>${Pro.FREE_LIMITS.projects}개</td><td>무제한</td></tr><tr><td>하자·사진·업체</td><td>무제한</td><td>무제한</td></tr>
      <tr><td>카톡·문자 전달</td><td>✔</td><td>✔</td></tr><tr><td>엑셀 가져오기·내보내기</td><td>✔</td><td>✔</td></tr><tr><td>요청서 PDF</td><td>워터마크</td><td>✔ 깨끗하게</td></tr></tbody></table>
    ${Pro.isPro() ? "" : `<button type="button" class="btn btn-primary btn-lg btn-block" id="pro-buy">프로 업그레이드 (준비 중)</button><button type="button" class="btn btn-block" id="pro-restore">구매 복원</button>`}
    <p class="help">결제는 Google Play 인앱 결제로 연결할 예정이며 현재는 준비 중이에요.</p></section>`;
  $("#pro-buy")?.addEventListener("click", async () => { const r = await Pro.purchase(); toast(r.ok ? "프로 활성화" : "결제 기능은 준비 중이에요"); });
  $("#pro-restore")?.addEventListener("click", async () => { const r = await Pro.restore(); toast(r.ok ? "복원했어요" : "복원할 구매가 없어요(준비 중)"); });
};
ROUTES.about = async () => {
  setTab(null); setHeader("앱 정보", { backBtn: true });
  const last = await db.getMeta("lastBackupAt", "");
  view().innerHTML = `<section class="card about"><img src="./icons/icon-192.png" width="72" height="72" alt=""><h2>${APP_NAME}</h2><p>현장 시공불량·하자 관리</p>
    <p class="help" id="ver">버전 ${APP_VERSION}${Pro.isPro() ? " · 프로" : ""}</p>
    <dl class="kv"><dt>데이터 저장</dt><dd>${Sync.attached() ? `이 기기(IndexedDB) + Google Firebase 동기화 (${esc(Sync.state.email)})` : "이 기기(IndexedDB)에만 저장 · 서버 전송 없음"}</dd><dt>마지막 백업</dt><dd>${last ? fmtDT(last) : "없음 — 설정에서 백업하세요"}</dd>
      <dt>오픈소스</dt><dd>SheetJS Community Edition (Apache-2.0), JSZip (MIT)</dd></dl>
    <p><a href="#/privacy">개인정보처리방침</a></p></section>`;
  let taps = 0;
  $("#ver").addEventListener("click", async () => { if (!Pro.DEV_UNLOCK) return; if (++taps >= 7) { taps = 0; await Pro.setProForTest(!Pro.isPro()); toast(`테스트: 프로 ${Pro.isPro() ? "켜짐" : "꺼짐"}`); rerender(); } });
};
ROUTES.privacy = async () => {
  setTab(null); setHeader("개인정보처리방침", { backBtn: true });
  view().innerHTML = `<article class="card legal">${PRIVACY_HTML}</article>`;
};
export const PRIVACY_HTML = `<h2>하자싹 개인정보처리방침</h2><p class="help">시행일: 2026년 11월 17일 (팀 현장 공유 기능 반영)</p>
<p>하자싹(이하 ‘앱’)은 기본적으로 이용자의 데이터를 이용자 기기 안에만 저장합니다. 이용자가 직접 <b>동기화</b>를 켠 경우에만 아래와 같이 Google Firebase에 저장됩니다.</p>
<h3>1. 기기 저장(기본)</h3><p>회원가입 없이 사용할 수 있으며, 이용자가 입력한 현장·하자 내용, 사진, 업체명·전화번호, 도면 이미지는 <b>이용자 기기 안(브라우저 저장소)</b>에 저장됩니다. 동기화를 켜지 않으면 개발자나 외부 서버로 아무 정보도 보내지 않습니다.</p>
<h3>2. 동기화·팀 현장(선택)</h3><p>설정 &gt; 동기화·팀 현장에서 구글 계정으로 로그인하고 <b>팀 현장</b>을 만들거나 초대코드로 참여하면, 여러 기기와 팀원이 같은 데이터를 쓰기 위해 다음 정보가 <b>Google Firebase(Google LLC 제공, Firebase Authentication · Cloud Firestore 서울 리전 asia-northeast3)</b>에 저장됩니다. 로그인만 하고 팀 현장을 열지 않으면 앱 데이터는 올라가지 않습니다.</p>
<ul><li>계정 정보: 구글 계정 이메일, 이름, 계정 식별자(Firebase Authentication)와 내가 속한 팀 현장 목록</li><li>팀 현장 정보: 현장 이름, 초대코드, 멤버 목록(각 멤버의 이름·이메일·역할)</li><li>앱 데이터: 현장·하자 내용, 사진·도면 이미지, 업체명·전화번호, 처리 이력, 엑셀 열 맞춤 설정, 그리고 각 항목을 누가 언제 등록·수정했는지(이름)</li></ul>
<p><b>팀 현장 데이터는 그 팀 멤버 모두에게 보입니다.</b> 팀 현장에 올린 하자·사진·업체 연락처와 내 이름·이메일은 같은 팀 멤버가 볼 수 있고, ‘편집’ 멤버는 고치거나 지울 수 있습니다(‘보기 전용’ 멤버는 볼 수만 있음). 팀 현장은 만든 사람(소유자)이 관리하며, 소유자는 멤버를 초대·역할 변경·내보내기 할 수 있습니다. 초대코드나 초대 링크를 받은 사람은 그 팀에 참여할 수 있으니 믿을 수 있는 사람에게만 보내 주세요(소유자는 코드를 언제든 새로 바꿀 수 있음).</p>
<p>멤버가 아닌 사람은 읽고 쓸 수 없도록 보안 규칙으로 제한되며, 전송 구간은 암호화(HTTPS)됩니다. 개발자는 이 데이터를 광고·분석 등 다른 목적으로 쓰지 않습니다. Google의 처리 방침: <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener">firebase.google.com/support/privacy</a></p>
<h3>3. 기기 권한</h3><ul><li>카메라·사진: 하자 사진 촬영·첨부 시에만 사용</li><li>연락처(선택): ‘연락처에서 가져오기’를 누를 때 이용자가 고른 연락처의 이름·전화번호만 앱 안에 저장</li><li>마이크(선택): 음성 입력 시 기기의 음성 인식 기능 사용(기기·브라우저 제공자의 정책 적용)</li></ul>
<h3>4. 제3자 제공</h3><p>앱은 정보를 제3자에게 판매·제공하지 않습니다. 팀 현장을 쓰는 경우 저장·처리를 위해 Google Firebase(처리 위탁)를 이용하며, 팀 현장 데이터는 이용자가 초대한 같은 팀 멤버에게 보입니다. 이용자가 ‘카톡으로 보내기’, ‘문자’, ‘공유’를 누르면 이용자가 고른 앱으로 내용이 전달되며, 이후 처리는 해당 앱의 정책을 따릅니다.</p>
<h3>5. 보관 및 삭제</h3><p>기기 데이터는 이용자가 삭제하거나 앱을 삭제할 때까지 남습니다. 팀 현장 데이터는 팀이 지울 때까지 보관됩니다. 팀 현장에서 하자·사진을 지우면 팀 전체에서 지워지고, 팀 현장에서 ‘모든 데이터 삭제’를 하면 그 팀 현장의 클라우드 데이터가 팀 전체에서 삭제됩니다. 팀에서 나가거나 내보내지면 멤버 목록에서 내 이름·이메일이 빠지고 이 기기에 있던 그 팀 현장 사본이 지워집니다(내가 올린 하자 기록은 팀 데이터로 남음). 계정과 클라우드 데이터 삭제는 아래 이메일로 요청할 수 있습니다. 로그아웃하면 동기화가 멈추고 이 기기 전용 데이터는 그대로 남습니다.</p>
<h3>6. 아동</h3><p>앱은 업무용이며 아동을 대상으로 하지 않습니다.</p>
<h3>7. 문의</h3><p>개발자 이메일: <span class="contact-email">(스토어 등록 시 기재)</span></p>`;

/* ---------- 샘플 현장 ---------- */
async function loadSample() {
  if (S.projects.some((p) => p.sample)) { S.pid = S.projects.find((p) => p.sample).id; LS.set("pid", S.pid); toast("샘플 현장으로 전환했어요"); return replace("#/home"); }
  if (!(await ask("가상의 ‘샘플 아파트’ 현장과 업체·하자 예시를 만들까요?\n둘러본 뒤 설정 > 현장 설정에서 삭제할 수 있어요.", { ok: "만들기" }))) return;
  const { makeSample } = await import("./sample.js");
  const { project, vendors, defects } = makeSample(M);
  await saveProject(project); for (const v of vendors) await saveVendor(v); await db.putMany("defects", defects); S.defects.push(...defects);
  S.pid = project.id; LS.set("pid", project.id); S.filter = { status: "_open" }; LS.set("filter", S.filter);
  toast("샘플 현장을 만들었어요"); replace("#/home");
}

/* ---------- 시작 ---------- */
/* ---------- 버전 표시 · 업데이트 안내 ---------- */
const UPD = { reg: null, waiting: null, next: "", clicked: false };
function verFoot() {
  return `<div class="ver-foot" id="ver-foot">${UPD.waiting ? `<button type="button" class="btn btn-sm btn-primary" id="ver-upd">새 버전 v${esc(UPD.next)} · 눌러서 업데이트</button>` : `<button type="button" class="ver-chk" id="ver-chk" aria-label="업데이트 확인">${APP_NAME} v${APP_VERSION}</button>`}</div>`;
}
function bindVerFoot(root = view()) {
  $("#ver-upd", root)?.addEventListener("click", applyUpdate);
  $("#ver-chk", root)?.addEventListener("click", async () => {
    if (!UPD.reg) return toast(`현재 v${APP_VERSION}`);
    toast("업데이트 확인 중…"); try { await UPD.reg.update(); } catch {}
    setTimeout(() => { if (!UPD.waiting) toast(`최신 버전이에요 (v${APP_VERSION})`); }, 2500);
  });
}
const swVersion = (w) => new Promise((res) => { try { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(String(e.data || "")); w.postMessage({ type: "VERSION" }, [ch.port2]); setTimeout(() => res(""), 1500); } catch { res(""); } });
async function offerUpdate(w) {
  if (!w || UPD.waiting === w) return;
  UPD.waiting = w; UPD.next = (await swVersion(w)) || "새";
  toast(`새 버전(v${UPD.next})이 있어요 — 새로고침`, { action: "새로고침", onAction: applyUpdate, ms: 600000 });
  const f = $("#ver-foot"); if (f) { f.outerHTML = verFoot(); bindVerFoot(document); }
}
function applyUpdate() {
  UPD.clicked = true;
  if (UPD.waiting) UPD.waiting.postMessage({ type: "SKIP_WAITING" });
  setTimeout(() => location.reload(), 2500); // controllerchange가 안 오면 그래도 새로고침
}
async function initUpdates() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", async () => {
    if (UPD.clicked) return location.reload();
    if (!hadController) return; // 첫 설치
    // 옛 버전(≤1.0.2)에서 바로 활성화된 경우: 새로고침만 하면 됨
    const v = navigator.serviceWorker.controller ? await swVersion(navigator.serviceWorker.controller) : "";
    if (v && v !== APP_VERSION) toast(`새 버전(v${v})이 있어요 — 새로고침`, { action: "새로고침", onAction: () => location.reload(), ms: 600000 });
  });
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }); UPD.reg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); }); });
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    setInterval(check, 30 * 60 * 1000);
  } catch {}
}
/* ---------- 동기화(Firebase) ---------- */
const UNSAFE_ROUTES = ["new", "edit", "wizard", "import", "imported", "lists", "dong", "project"];
let _remoteT = 0, _remoteToast = 0;
function onRemoteChange() {
  clearTimeout(_remoteT);
  _remoteT = setTimeout(async () => {
    await loadAll();
    const path = (location.hash.split("?")[0] || "#/home").slice(2);
    if (UNSAFE_ROUTES.includes(path) || document.body.classList.contains("sheet-open")) {
      if (Date.now() - _remoteToast > 15000) { _remoteToast = Date.now(); toast("다른 기기에서 바뀐 내용을 받았어요"); }
      return;
    }
    rerender();
  }, 250);
}
function paintSyncChip(stt = Sync.status()) {
  const c = $("#sync-chip"); if (!c) return;
  c.hidden = false; c.dataset.k = stt.key; c.innerHTML = `<span class="sc-in">${esc(stt.label)}</span>`; c.title = stt.detail || stt.label;
  c.setAttribute("aria-label", "동기화 상태: " + stt.label);
  const si = $("#si-sync small"); if (si && Sync.attached()) si.textContent = `${Sync.state.ws.name} · ${ROLE_KO[Sync.state.ws.role] || ""} · ${stt.label}`;
  const box = $("#sync-status"); if (box) renderSyncStatus(box);
}
const ROLE_KO = { owner: "소유자", editor: "편집", viewer: "보기 전용" };
function initSync() {
  Sync.onChange((stt) => paintSyncChip(stt));
  $("#sync-chip")?.addEventListener("click", () => go("#/sync"));
  paintSyncChip();
  // 보기 전용 멤버가 고치려 하면 안내
  window.addEventListener("unhandledrejection", (e) => { if (e.reason?.readOnly) { e.preventDefault(); busy(false); toast(e.reason.message); } });
  Sync.boot({ onRemote: onRemoteChange, onTeam: () => { if ((location.hash || "").startsWith("#/sync") && !document.body.classList.contains("sheet-open")) rerender(); } }).catch((e) => console.warn(e));
}
/** 초대 링크(?join=CODE)로 열렸을 때: 코드 기억 → 동기화·팀 화면에서 참여 */
function takeJoinParam() {
  const u = new URL(location.href); const code = u.searchParams.get("join");
  if (!code) return false;
  LS.set("pendingJoin", Sync.normCode(code)); u.searchParams.delete("join");
  history.replaceState(null, "", u.pathname + u.search + "#/sync"); return true;
}
function renderSyncStatus(box) {
  const stt = Sync.status(); const at = Sync.state.lastSync;
  box.innerHTML = `<div class="sync-row"><span class="sync-chip big" data-k="${stt.key}">${esc(stt.label)}</span></div>
    <dl class="kv"><dt>계정</dt><dd id="sync-email">${Sync.signedIn() ? esc(Sync.state.email || "-") : "로그인 안 됨"}</dd>
    ${Sync.attached() ? `<dt>팀 현장</dt><dd id="sync-ws">${esc(Sync.state.ws.name)} · ${ROLE_KO[Sync.state.ws.role] || ""}</dd><dt>대기 중</dt><dd id="sync-pending">${Sync.state.pending}건</dd>
    <dt>마지막 동기화</dt><dd>${at ? fmtDT(new Date(at).toISOString()) : "-"}</dd>` : `<dt>지금 데이터</dt><dd>이 기기 전용(동기화 안 함)</dd>`}${stt.detail && stt.key === "error" ? `<dt>오류</dt><dd class="err">${esc(stt.detail)}</dd>` : ""}</dl>`;
}
/** 이 기기 전용 데이터가 있으면 팀 현장에 합칠지 묻는다. null=취소 */
async function askMergeLocal(wsName) {
  if (Sync.attached()) return false; // 이미 팀 현장 화면: 합치기 대상 아님
  const c = await Sync.localCounts();
  if (!(c.projects + c.defects + c.vendors)) return false;
  const n = `현장 ${c.projects}개 · 하자 ${c.defects}건 · 사진 ${c.photos}장 · 업체 ${c.vendors}곳`;
  const v = await choose(`이 기기 데이터(${n})`, [
    { icon: "📦", label: "따로 두기 (권장)", sub: `‘${wsName}’에는 팀 데이터만 받아요. 이 기기 데이터는 ‘이 기기 전용’에 그대로 남아요.`, value: "keep" },
    { icon: "🔀", label: `‘${wsName}’에 합치기`, sub: "이 기기 데이터를 팀 현장에 올려 팀원도 보게 해요. 같은 건은 최근에 고친 쪽으로 맞춰요.", value: "merge" },
  ]);
  return v === null ? null : v === "merge";
}
function memberRow(m) {
  const own = Sync.isOwner() && !m.me && m.role !== "owner";
  return `<div class="mrow" data-uid="${esc(m.uid)}"><span class="mav" aria-hidden="true">${esc((m.name || m.email || "?").slice(0, 1))}</span>
    <span class="mname"><b>${esc(m.name || "멤버")}${m.me ? " (나)" : ""}</b><small>${esc(m.email || "")}</small></span>
    ${own ? `<select class="inp msel" data-role="${esc(m.uid)}" aria-label="${esc(m.name || "")} 역할"><option value="editor" ${m.role === "editor" ? "selected" : ""}>편집</option><option value="viewer" ${m.role === "viewer" ? "selected" : ""}>보기 전용</option></select>
      <button type="button" class="btn btn-sm btn-ghost" data-kick="${esc(m.uid)}" aria-label="${esc(m.name || "")} 내보내기">내보내기</button>` : `<span class="mrole r-${m.role}">${ROLE_KO[m.role] || m.role}</span>`}</div>`;
}
ROUTES.sync = async () => {
  setTab("settings"); setHeader("동기화·팀 현장", { backBtn: true });
  const on = Sync.attached(), user = Sync.signedIn(), ws = Sync.state.ws, wd = Sync.state.wsDoc;
  const pending = LS.get("pendingJoin", "");
  let list = [];
  if (user && !on) { try { list = await Sync.myWorkspaces(); } catch (e) { console.warn(e); } }
  const mem = on ? Sync.members() : [];
  const card = (h) => `<section class="card">${h}</section>`;
  view().innerHTML = `
    ${card(`<h3>👥 팀 현장 · PC·폰 동기화</h3>
      <p class="help">구글 로그인 후 <b>팀 현장</b>을 만들거나 초대코드로 참여하면 팀원·컴퓨터·폰이 같은 하자·사진·업체를 실시간으로 봐요. 인터넷이 없을 때 고친 내용은 모아 뒀다가 연결되면 올라가요. 로그인하지 않아도 앱은 지금처럼 이 기기에서만 쓸 수 있어요.</p>
      <div id="sync-status"></div>
      <div class="btn-col">${!user ? `<button type="button" class="btn btn-primary btn-lg gbtn" data-a="login"><span class="g-logo" aria-hidden="true">G</span> Google 계정으로 로그인</button>`
        : on ? `<button type="button" class="btn btn-primary btn-lg" data-a="now">🔄 지금 동기화</button>` : ""}</div>`)}
    ${!on && LS.get("sync.cursors", null) !== null && !list.length && !pending ? card(`<h3>ℹ️ 이전 버전 동기화(1.0.4~1.0.5)는 끝났어요</h3><p class="help">이 기기 데이터는 그대로 있어요. 이제는 <b>팀 현장</b>으로 맞춰요: 데이터가 가장 많은 기기(보통 PC)에서 <b>＋ 현장(팀) 만들기</b>를 누르면 전부 올라가고(하자 수만 건도 몇 분), 다른 기기·팀원은 <b>초대코드로 참여</b>하면서 ‘따로 두기’를 고르세요.</p>`) : ""}
    ${pending ? card(`<h3>✉️ 초대받은 팀 현장</h3><p>초대코드 <b class="code">${esc(pending)}</b>로 참여할 수 있어요.${user ? "" : " 먼저 구글로 로그인해 주세요."}</p>
      <div class="btn-col">${user ? `<button type="button" class="btn btn-primary btn-lg" data-a="join-pending">이 팀 현장에 참여하기</button>` : ""}<button type="button" class="btn btn-ghost" data-a="join-cancel">초대 무시</button></div>`) : ""}
    ${on ? card(`<h3>🏗 ${esc(ws.name)} <small>${ROLE_KO[ws.role] || ""}</small></h3>
      ${Sync.isOwner() && wd ? `<div class="invite"><span>초대코드</span><b class="code" id="inv-code">${esc(wd.inviteCode)}</b></div>
        <div class="btn-row"><button type="button" class="btn btn-kakao" data-a="inv-kakao">카톡으로 초대</button><button type="button" class="btn" data-a="inv-copy">초대 링크 복사</button><button type="button" class="btn btn-ghost" data-a="inv-new">코드 바꾸기</button></div>
        <p class="help small">링크를 받은 사람이 구글로 로그인하면 <b>편집</b> 멤버로 들어와요. 무료판은 팀원 ${Pro.FREE_LIMITS.members}명까지(지금 ${mem.length}/${wd.maxMembers}명).</p>` : ""}
      <h4 class="sec">멤버 ${mem.length}명</h4><div class="mlist" id="mlist">${mem.map(memberRow).join("") || '<p class="help">불러오는 중…</p>'}</div>
      <div class="btn-col">${Sync.isOwner() ? '<button type="button" class="btn" data-a="rename">팀 현장 이름 바꾸기</button>' : ""}
        <button type="button" class="btn" data-a="to-local">이 기기 전용 데이터로 전환</button>
        ${!Sync.isOwner() && wd ? '<button type="button" class="btn btn-danger" data-a="leave">이 팀 현장 나가기</button>' : ""}</div>`) : ""}
    ${user ? card(`<h3>현장 전환</h3><div class="opt-list">
      ${on ? "" : `<div class="opt cur"><span class="opt-ico">📱</span><span><b>이 기기 전용 (지금)</b><small>로그인 없이 쓰던 데이터</small></span></div>`}
      ${list.map((w) => `<button type="button" class="opt" data-open="${esc(w.id)}"><span class="opt-ico">🏗</span><span><b>${esc(w.name)}</b><small>${ROLE_KO[w.role] || ""} · 멤버 ${w.members}명</small></span></button>`).join("")}
      ${on ? `<div class="opt cur"><span class="opt-ico">🏗</span><span><b>${esc(ws.name)} (지금)</b><small>다른 팀 현장은 ‘이 기기 전용으로 전환’ 후 목록에서 열어요</small></span></div>` : ""}</div>
      <div class="btn-col">${on ? "" : `<button type="button" class="btn btn-primary btn-lg" data-a="create">＋ 현장(팀) 만들기 <small>지금 데이터로</small></button>`}
        <button type="button" class="btn btn-lg" data-a="join">초대코드로 참여</button></div>`) : ""}
    ${user ? `<button type="button" class="btn btn-block btn-ghost" data-a="logout">로그아웃 ${on ? "(팀 데이터는 이 기기에 남고, 다시 로그인하면 이어서 동기화)" : ""}</button>` : ""}
    ${card(`<h3>알아 두세요</h3><ul class="help">
      <li>팀 현장 데이터는 Google Firebase(서울 리전)에 저장되고, 그 팀 멤버만 볼 수 있어요. 보기 전용 멤버는 고칠 수 없어요.</li>
      <li>무료 한도(팀 전체 합산): 저장 1GB(사진 약 5천~1만 장), 하루 읽기 5만·쓰기 2만 번. 넘으면 다음 날까지 동기화가 멈추고, 앱은 계속 쓸 수 있어요.</li>
      <li>같은 건을 두 사람이 동시에 고치면 나중에 고친 쪽으로 맞춰져요. 상세 화면에 누가 언제 고쳤는지 나와요.</li>
      <li>무료판: 팀 현장 ${Pro.FREE_LIMITS.workspaces}개 · 팀원 ${Pro.FREE_LIMITS.members}명까지. 프로: 무제한.</li></ul>`)}`;
  renderSyncStatus($("#sync-status"));
  if (navigator.onLine !== false) Sync.preload();
  const wsCount = async () => { try { return (await Sync.myWorkspaces()).length; } catch { return list.length; } };
  const doJoin = async (code) => {
    const merge = await askMergeLocal("팀 현장"); if (merge === null) return;
    busy(true, "참여하는 중…");
    try { await Sync.joinWorkspace(code, { workspaceCount: await wsCount(), isPro: Pro.isPro(), mergeLocal: merge }); LS.set("pendingJoin", ""); }
    catch (e) { busy(false); if (e.pro) return proSheet(e.message); throw e; }
  };
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a;
    try {
      if (a === "login") {
        const label = b.innerHTML; b.disabled = true; b.textContent = "구글 로그인 여는 중…";
        let left = false; const onHide = () => { left = true; }; document.addEventListener("visibilitychange", onHide, { once: true }); window.addEventListener("pagehide", onHide, { once: true });
        const wd = setTimeout(() => { if (!left && !Sync.signedIn() && b.isConnected) { b.disabled = false; b.innerHTML = label; toast("구글 로그인 화면이 열리지 않았어요. 인터넷 연결을 확인하고 다시 눌러 주세요", { ms: 6000 }); } }, 10000);
        try { const r = await Sync.signIn(); if (r !== "redirect") { clearTimeout(wd); if (Sync.signedIn()) toast("로그인했어요"); rerender(); } }
        catch (e) { clearTimeout(wd); b.disabled = false; b.innerHTML = label; toast("로그인을 시작하지 못했어요: " + (e.message || e), { ms: 6000 }); }
        return;
      }
      if (a === "now") { b.disabled = true; await Sync.syncNow(); toast("동기화했어요"); rerender(); }
      if (a === "join-cancel") { LS.set("pendingJoin", ""); rerender(); }
      if (a === "join-pending") await doJoin(pending);
      if (a === "join") { const c = await prompt2("초대코드 6자리", ""); if (c) await doJoin(c); }
      if (a === "create") {
        const n0 = await wsCount();
        if (!Pro.can("workspace", { workspaceCount: n0 })) return proSheet("무료판은 팀 현장 1개까지예요");
        const name = await prompt2("팀 현장 이름", P()?.name || "우리 현장"); if (name === null) return;
        const c = await Sync.localCounts(db.DB_NAME);
        if (!(await ask(`‘${name || "팀 현장"}’ 팀 현장을 만들고 지금 데이터(현장 ${c.projects}개 · 하자 ${c.defects}건 · 사진 ${c.photos}장 · 업체 ${c.vendors}곳)를 올릴까요?\n이 기기 전용 데이터는 그대로 남아요(복사).`, { ok: "만들기" }))) return;
        busy(true, "팀 현장 만드는 중…"); await Sync.createWorkspace(name.trim() || "팀 현장", { workspaceCount: n0, isPro: Pro.isPro(), memberLimit: Pro.memberLimit() });
      }
      if (a === "inv-copy") { (await copyText(Sync.inviteLink(Sync.state.wsDoc.inviteCode))) ? toast("초대 링크를 복사했어요") : toast("복사 실패"); }
      if (a === "inv-kakao") {
        const text = `[하자싹] ‘${ws.name}’ 팀 현장에 초대합니다.\n아래 링크를 열고 구글로 로그인하면 참여돼요.\n${Sync.inviteLink(Sync.state.wsDoc.inviteCode)}\n(초대코드 ${Sync.state.wsDoc.inviteCode})`;
        const r = await shareKakao({ text });
        if (r === "kakao-pc" || r === "copied") toast("초대 내용 복사됨 — 카카오톡 대화방에 붙여넣기(Ctrl+V)", { ms: 6000 });
      }
      if (a === "inv-new") { if (!(await ask("초대코드를 새로 만들까요? 예전 코드·링크로는 더 이상 참여할 수 없어요."))) return; await Sync.regenerateCode(); toast("새 초대코드를 만들었어요"); }
      if (a === "rename") { const n2 = await prompt2("팀 현장 이름", ws.name); if (n2) { await Sync.renameWorkspace(n2.trim()); toast("이름을 바꿨어요"); } }
      if (a === "to-local") { if (Sync.state.pending && !(await ask(`아직 안 올라간 변경 ${Sync.state.pending}건은 이 팀 현장을 다시 열면 이어서 올라가요. 전환할까요?`))) return; busy(true, "전환 중…"); await Sync.switchTo(null); }
      if (a === "leave") { if (!(await ask(`‘${ws.name}’에서 나갈까요?\n이 기기에 받아 둔 팀 데이터는 지워지고(팀에는 남아요), 이 기기 전용 데이터로 돌아가요.`, { ok: "나가기", danger: true }))) return; busy(true, "나가는 중…"); await Sync.leaveWorkspace(); }
      if (a === "logout") {
        if (!(await ask("로그아웃할까요? 이 기기 데이터는 지우지 않아요.", { ok: "로그아웃" }))) return;
        await Sync.signOut(); toast("로그아웃했어요"); rerender();
      }
    } catch (e) { busy(false); toast(e.message || String(e)); b.disabled = false; renderSyncStatus($("#sync-status")); }
  }));
  $$("[data-open]", view()).forEach((b) => b.addEventListener("click", async () => {
    const w = list.find((x) => x.id === b.dataset.open); if (!w) return;
    const merge = await askMergeLocal(w.name); if (merge === null) return;
    busy(true, "여는 중…"); try { await Sync.openWorkspace({ id: w.id, name: w.name, role: w.role }, { mergeLocal: merge }); } catch (e) { busy(false); toast(e.message); }
  }));
  $$("[data-role]", view()).forEach((sel) => sel.addEventListener("change", async () => { try { await Sync.setRole(sel.dataset.role, sel.value); toast("역할을 바꿨어요"); } catch (e) { toast(e.message); } }));
  $$("[data-kick]", view()).forEach((b) => b.addEventListener("click", async () => {
    const m = Sync.members().find((x) => x.uid === b.dataset.kick);
    if (!(await ask(`${m?.name || "멤버"}님을 팀에서 내보낼까요?`, { ok: "내보내기", danger: true }))) return;
    try { await Sync.removeMember(b.dataset.kick); toast("내보냈어요"); } catch (e) { toast(e.message); }
  }));
};
async function main() {
  $("#btn-back").addEventListener("click", () => back());
  $$(".tab-item").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); const h = a.getAttribute("href");
    if (h === "#/new") { if (!S.draft || S.draft._editId) startDraft(); }
    if (location.hash.split("?")[0] === h) return rerender();
    if (navDepth() <= 1 || h === "#/home") replace(h); else go(h);
  }));
  window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
  const joined = takeJoinParam();
  try { await loadAll(); } catch (e) { $("#view").innerHTML = `<div class="card"><p>저장소를 열 수 없어요: ${esc(e.message)}</p></div>`; return; }
  initNav(() => { ROUTES._cleanup?.(); ROUTES._cleanup = null; route(); });
  initUpdates();
  initSync();
  window.__hs = { S, M, db, Pro, go, replace, UPD, APP_VERSION, Sync }; // 테스트·디버그용
}
main();
