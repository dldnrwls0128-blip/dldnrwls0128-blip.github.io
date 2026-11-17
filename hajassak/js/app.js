/** 하자싹 — 현장 시공불량·하자 관리 (오프라인 PWA) */
import * as db from "./db.js";
import * as M from "./model.js";
import { $, $$, esc, n, toast, busy, initNav, go, replace, back, rerender, navDepth, pushLayer, closeLayer, unwind, openSheet, ask, prompt2, choose, pickFile } from "./ui.js";
import { compressImage, downloadBlob, shareOrDownload } from "./photo.js";
import { shareKakao, copyText, contactPickerSupported, pickContacts, canShareFiles } from "./share.js";
import * as Pro from "./pro.js";
import { speechSupported, startDictation } from "./speech.js";

export const APP_VERSION = "1.0.0";
export const APP_NAME = "하자싹";
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("hs:" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hs:" + k, JSON.stringify(v)); } catch {} },
};
const S = {
  projects: [], pid: LS.get("pid", ""), defects: [], vendors: [], plans: [], pidx: new Map(),
  filter: LS.get("filter", { status: "_open" }), listMode: LS.get("listMode", "list"), listLimit: 60,
  draft: null, select: null, issuer: LS.get("issuer", ""),
};
const P = () => S.projects.find((p) => p.id === S.pid) || null;
const PD = () => S.defects.filter((d) => d.projectId === S.pid);
const V = (id) => S.vendors.find((v) => v.id === id) || null;
const vName = (d) => V(d.vendorId)?.name || "";
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
  S.pidx = await db.photoIndex();
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
  d.history = [...(d.history || []), { at: now, status, note, from: d.status }];
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
  if (!P() && !["onboard", "wizard", "settings", "privacy", "about", "restore", "pro"].includes(path)) {
    setTab("home"); setHeader(APP_NAME, { backBtn: false });
    view().innerHTML = noProject(); bindNoProject(); return;
  }
  const fn = ROUTES[path] || ROUTES.home;
  try { await fn(q()); } catch (e) { console.error(e); view().innerHTML = `<div class="card"><p>화면 오류: ${esc(e.message)}</p></div>`; }
  window.scrollTo(0, 0);
}
function noProject() {
  return `<div class="empty-hero"><img src="./icons/icon-192.png" alt="" width="72" height="72"><h2>첫 현장을 만들어 주세요</h2>
    <p class="help">동·층·호수를 한 번 만들어 두면 위치를 몇 번의 탭으로 고를 수 있어요.</p>
    <button type="button" class="btn btn-primary btn-lg" data-a="wizard">+ 새 현장 만들기</button>
    <button type="button" class="btn btn-lg" data-a="sample">샘플 현장 불러오기</button>
    <button type="button" class="btn btn-ghost" data-a="restore">백업 파일에서 복원</button></div>`;
}
function bindNoProject() {
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    if (a === "wizard") go("#/wizard"); else if (a === "sample") loadSample(); else go("#/restore");
  }));
}

/* ---------- 온보딩 ---------- */
const ONBOARD = [
  { ico: "📍", t: "몇 번의 탭으로 하자 등록", d: "동 → 층 → 호 → 실을 차례로 누르고, 사진을 찍으면 위치·시간이 사진에 자동으로 찍혀요." },
  { ico: "📲", t: "업체에 카톡·문자로 바로 전달", d: "업체를 등록해 두면 미조치 목록을 한 번에 카톡·문자로 보내고, 보낸 건은 ‘업체전달’로 바뀌어요." },
  { ico: "🔒", t: "인터넷 없이, 내 폰에만 저장", d: "모든 기록은 이 기기 안에만 저장돼요. 기기를 바꿀 땐 백업 파일(zip)로 옮기면 돼요." },
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
    <p class="help small">시작하면 <a href="#/privacy">개인정보처리방침</a>에 동의한 것으로 봅니다. 개인정보를 수집하지 않습니다.</p></div>`;
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.a === "next") go(`#/onboard?i=${i + 1}`);
    else { const again = !!qq.again; LS.set("onboarded", true); if (again) history.go(-(i + 1)); else if (i > 0) history.go(-i); else replace("#/home"); }
  }));
};

/* ---------- 카드 ---------- */
function defectCard(d, { sel = false } = {}) {
  const pc = photoCount(d); const od = M.isOverdue(d);
  return `<article class="dcard ${od ? "overdue" : ""} ${sel ? "selectable" : ""}" data-id="${d.id}" tabindex="0">
    ${sel ? `<input type="checkbox" class="dsel" aria-label="선택" ${S.select?.has(d.id) ? "checked" : ""}>` : ""}
    <div class="dc-top"><span class="dc-loc">${esc(M.locText(d) || "위치 미지정")}</span>${pill(d.status)}</div>
    <div class="dc-mid">${sevBadge(d)}<b>${esc(M.tradeText(d) || "공종 미지정")}</b>${d.type ? ` <span class="tbadge">${esc(d.type)}</span>` : ""} ${esc(d.content || "")}</div>
    <div class="dc-bot"><span>${esc(vName(d) || "업체 미지정")}</span>
      ${d.due ? `<span class="${od ? "od" : ""}">기한 ${shortDate(d.due)}${od ? " 초과" : ""}</span>` : ""}
      ${pc.before + pc.after ? `<span>📷${pc.before}${pc.after ? "/" + pc.after : ""}</span>` : ""}<span>${esc(d.category || "")}</span></div>
  </article>`;
}
function bindCards(root = view()) {
  $$(".dcard", root).forEach((c) => {
    const open = (e) => {
      if (S.select) { const cb = $(".dsel", c); if (e.target !== cb) cb.checked = !cb.checked; S.select[cb.checked ? "add" : "delete"](c.dataset.id); updateSelBar(); return; }
      go(`#/item?id=${c.dataset.id}`);
    };
    c.addEventListener("click", open);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
  });
}

/* ---------- 홈 ---------- */
ROUTES.home = async () => {
  setTab("home");
  const p = P(); const list = PD(); const today = M.todayStr();
  const open = list.filter(M.isOpen), od = list.filter((d) => M.isOverdue(d, today));
  const done = list.filter((d) => d.status === "조치완료" || d.status === "확인완료").length;
  const todayN = list.filter((d) => (d.createdAt || "").slice(0, 10) === today).length;
  setHeader(p.name, { backBtn: false, action: S.projects.length > 1 || true ? `<button type="button" class="hdr-btn" id="btn-proj" aria-label="현장 전환">현장 ▾</button>` : "" });
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
    ${recent.length ? `<button type="button" class="btn btn-block" data-go="#/list">전체 목록 보기</button>` : ""}`;
  bindCards();
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
  if (k === "vendorId") return v === "_none" ? "업체 미지정" : V(v)?.name || "업체";
  if (k === "overdue") return "기한초과";
  if (k === "ho") return v + "호";
  if (k === "text") return `“${v}”`;
  return v;
}
ROUTES.list = async () => {
  setTab("list");
  setHeader("하자 목록", { backBtn: navDepth() > 1, action: `<button type="button" class="hdr-btn" id="btn-sel">${S.select ? "선택 끝" : "선택"}</button>` });
  const f = S.filter; const all = PD();
  const list = M.applyFilter(all, f, { vendorName: vName }).sort((a, b) => (M.isOverdue(b) - M.isOverdue(a)) || (a.createdAt < b.createdAt ? 1 : -1));
  const chips = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `<button type="button" class="chip on" data-rm="${k}">${esc(FILTER_LABEL[k])}: ${esc(filterChipText(k, v))} ✕</button>`).join("");
  view().innerHTML = `
    <form class="search" id="lsearch" role="search"><input class="inp" id="ls" type="search" value="${esc(f.text || "")}" placeholder="내용·위치·업체 검색" aria-label="목록 검색">
      <button type="button" class="btn" id="btn-filter">필터${M.filterCount(f) ? ` <b class="badge">${M.filterCount(f)}</b>` : ""}</button></form>
    <div class="chips scroll">${chips || '<span class="help">필터 없음 · 전체</span>'}${chips ? '<button type="button" class="chip" data-rm="_all">모두 지우기</button>' : ""}</div>
    <div class="list-hd"><b>${n(list.length)}건</b><span class="help">기한초과 ${n(list.filter((d) => M.isOverdue(d)).length)}</span>
      <span class="sp"></span><button type="button" class="btn btn-sm" id="btn-export">내보내기</button><button type="button" class="btn btn-sm btn-primary" id="btn-sendlist">업체에 보내기</button></div>
    <div id="cards">${list.slice(0, S.listLimit).map((d) => defectCard(d, { sel: !!S.select })).join("") || `<div class="card empty-card"><p>조건에 맞는 하자가 없어요.</p></div>`}</div>
    ${list.length > S.listLimit ? `<button type="button" class="btn btn-block" id="btn-more">더 보기 (${n(list.length - S.listLimit)}건 남음)</button>` : ""}
    <div id="selbar" class="selbar" ${S.select ? "" : "hidden"}><span id="selcount"></span>
      <button type="button" class="btn btn-sm" data-sa="all">전체선택</button><button type="button" class="btn btn-sm" data-sa="status">상태 변경</button>
      <button type="button" class="btn btn-sm btn-primary" data-sa="send">보내기</button></div>`;
  bindCards(); updateSelBar();
  $("#lsearch").addEventListener("submit", (e) => { e.preventDefault(); S.filter = { ...S.filter, text: $("#ls").value.trim() }; LS.set("filter", S.filter); rerender(); });
  $("#btn-filter").addEventListener("click", () => filterSheet());
  $$("[data-rm]", view()).forEach((b) => b.addEventListener("click", () => { if (b.dataset.rm === "_all") S.filter = {}; else delete S.filter[b.dataset.rm]; LS.set("filter", S.filter); rerender(); }));
  $("#btn-more")?.addEventListener("click", () => { S.listLimit += 120; rerender(); });
  $("#btn-sel").addEventListener("click", () => { S.select = S.select ? null : new Set(); rerender(); });
  $("#btn-export").addEventListener("click", () => exportSheet(list, "하자목록"));
  $("#btn-sendlist").addEventListener("click", () => sendSheet({ items: list }));
  $$("[data-sa]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.sa; const sel = list.filter((d) => S.select.has(d.id));
    if (a === "all") { list.forEach((d) => S.select.add(d.id)); return rerender(); }
    if (!sel.length) return toast("먼저 하자를 선택하세요");
    if (a === "send") return sendSheet({ items: sel });
    const st = await choose(`${sel.length}건 상태 변경`, M.STATUSES.map((s) => ({ label: s, value: s })));
    if (!st) return;
    for (const d of sel) { setStatus(d, st, "일괄 변경"); await saveDefect(d); }
    toast(`${sel.length}건을 ‘${st}’(으)로 바꿨어요`); S.select = null; rerender();
  }));
};
function updateSelBar() { const c = $("#selcount"); if (c && S.select) c.textContent = `${S.select.size}건 선택`; }
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
      ${sel("category", M.CATEGORIES.map((x) => [x, x]), "구분")}
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
    ${groups.map((g, gi) => `<section class="group"><header class="grp-hd"><div><b>${esc(g.trade)}</b> · ${esc(g.vendor)} <span class="help">${g.items.length}건</span></div>
      <button type="button" class="btn btn-sm btn-primary" data-g="${gi}">보내기</button></header>${g.items.map((d) => defectCard(d)).join("")}</section>`).join("") ||
      `<div class="card empty-card"><p>${onlyOpen ? "미조치 하자가 없어요 👍" : "등록된 하자가 없어요."}</p></div>`}`;
  bindCards();
  $("#btn-add").addEventListener("click", () => { startDraft({ dong, ho, floor: M.floorOfHo(ho) }); go("#/new"); });
  $$("[data-o]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("unitOpen", b.dataset.o === "1"); rerender(); }));
  $$("[data-g]", view()).forEach((b) => b.addEventListener("click", () => { const g = groups[+b.dataset.g]; sendSheet({ items: g.items, vendor: V(g.vendorId) }); }));
};

/* ---------- 동 현황(히트맵) ---------- */
ROUTES.grid = async (qq) => {
  setTab("list");
  const p = P(); const dong = p.dongs.find((d) => d.name === qq.dong) || p.dongs[0];
  setHeader("동 현황");
  if (!dong) { view().innerHTML = `<div class="card empty-card"><p>동이 없어요. 설정 &gt; 현장 설정에서 동을 추가하세요.</p><button class="btn btn-primary" type="button" onclick="location.hash='#/project'">현장 설정</button></div>`; return; }
  const list = PD().filter((d) => d.dong === dong.name);
  const by = new Map(); for (const d of list) { if (!d.ho) continue; const m = by.get(d.ho) || { open: 0, all: 0, od: 0 }; m.all++; if (M.isOpen(d)) m.open++; if (M.isOverdue(d)) m.od++; by.set(d.ho, m); }
  const max = Math.max(1, ...[...by.values()].map((m) => m.open));
  const floors = []; for (let f = dong.floors; f >= (dong.unitStart || 1); f--) floors.push(f);
  const lines = M.unitsOf(dong, String(dong.floors)).map((h) => Number(h) % 100);
  const common = list.filter((d) => !d.ho);
  view().innerHTML = `
    <div class="chips scroll">${p.dongs.map((d) => `<button type="button" class="chip ${d.id === dong.id ? "on" : ""}" data-d="${esc(d.name)}">${esc(d.name)}</button>`).join("")}</div>
    <div class="list-hd"><b>${esc(dong.name)}</b><span class="help">미조치 ${list.filter(M.isOpen).length} / ${list.length}건</span></div>
    <div class="legend"><span class="hm h0"></span>0 <span class="hm h1"></span>적음 <span class="hm h3"></span>많음 <span class="hm odl"></span>기한초과</div>
    <div class="hgrid" style="--cols:${lines.length}">${floors.map((f) => `<div class="hf">${f}F</div>` + M.unitsOf(dong, String(f)).map((ho) => {
      const m = by.get(ho) || { open: 0, all: 0, od: 0 }; const lv = m.open ? Math.min(3, Math.ceil((m.open / max) * 3)) : 0;
      return `<button type="button" class="hc h${lv} ${m.od ? "od" : ""} ${m.all && !m.open ? "done" : ""}" data-ho="${ho}" aria-label="${ho}호 미조치 ${m.open}건"><span>${ho}</span>${m.all ? `<b>${m.open}</b>` : ""}</button>`;
    }).join("")).join("")}</div>
    <h3 class="sec">공용부·세대 외 <small>${common.filter(M.isOpen).length} / ${common.length}건</small></h3>
    ${common.slice(0, 30).map((d) => defectCard(d)).join("") || '<p class="help">없음</p>'}`;
  bindCards();
  $$("[data-d]", view()).forEach((b) => b.addEventListener("click", () => replace(`#/grid?dong=${encodeURIComponent(b.dataset.d)}`)));
  $$("[data-ho]", view()).forEach((b) => b.addEventListener("click", () => go(`#/unit?dong=${encodeURIComponent(dong.name)}&ho=${b.dataset.ho}`)));
};

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
  view().innerHTML = `
    <div class="kpis"><div class="kpi"><b>${n(list.length)}</b><span>전체</span></div><div class="kpi"><b>${n(open.length)}</b><span>미조치</span></div>
      <div class="kpi warn"><b>${n(od.length)}</b><span>기한초과</span></div><div class="kpi ok"><b>${list.length ? Math.round((done / list.length) * 100) : 0}%</b><span>조치율</span></div></div>
    <section class="card"><h3>상태별</h3><div class="stbar">${M.STATUSES.map((s) => (st.get(s) ? `<i class="${M.STATUS_CLS[s]}" style="flex:${st.get(s)}" title="${s}"></i>` : "")).join("")}</div>
      <div class="stleg">${M.STATUSES.map((s) => `<button type="button" class="lg" data-st="${s}">${pill(s)} ${n(st.get(s) || 0)}</button>`).join("")}</div></section>
    <section class="card"><h3>업체별 <small>미조치 · 기한초과 · 조치율</small></h3>
      <table class="tbl"><tbody>${vlist.map(([k, m]) => `<tr data-v="${k}"><td>${esc(k === "_none" ? "업체 미지정" : V(k)?.name || "?")}</td><td class="r">${m.open}</td><td class="r ${m.od ? "od" : ""}">${m.od}</td><td class="w">${bar(m.done, m.all, "ok")}<small>${Math.round((m.done / m.all) * 100)}%</small></td></tr>`).join("") || '<tr><td class="help">데이터 없음</td></tr>'}</tbody></table></section>
    <section class="card"><h3>미조치 경과일</h3>${aging.map(([l, v]) => `<div class="hrow"><span>${l}</span>${bar(v, amax, v && l.includes("초과") ? "bad" : "")}<b>${v}</b></div>`).join("")}</section>
    <section class="card"><h3>유형별(미조치)</h3>${types.map(([t, v]) => `<div class="hrow"><span>${esc(t || "-")}</span>${bar(v, tmax)}<b>${v}</b></div>`).join("") || '<p class="help">없음</p>'}</section>
    <section class="card"><h3>동별(미조치)</h3>${dongs.map(([t, v]) => `<div class="hrow" data-dg="${esc(t)}"><span>${esc(t || "-")}</span>${bar(v, dmax)}<b>${v}</b></div>`).join("") || '<p class="help">없음</p>'}</section>`;
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = { status: b.dataset.st }; LS.set("filter", S.filter); go("#/list"); }));
  $$("[data-v]", view()).forEach((r) => r.addEventListener("click", () => { if (r.dataset.v === "_none") { S.filter = { vendorId: "_none", status: "_open" }; LS.set("filter", S.filter); go("#/list"); } else go(`#/vendor?id=${r.dataset.v}`); }));
  $$("[data-dg]", view()).forEach((r) => r.addEventListener("click", () => go(`#/grid?dong=${encodeURIComponent(r.dataset.dg)}`)));
};

/* ---------- 하자 등록/수정 ---------- */
function startDraft(loc = {}, base = null) {
  const p = P();
  S.draft = base ? { ...structuredClone({ ...base, history: undefined }), _editId: base.id, photos: [] } : {
    dong: "", floor: "", ho: "", common: "", room: "", part: "", trade: "", subTrade: "", type: "", category: LS.get("lastCat", "시공불량"),
    severity: "보통", content: "", vendorId: "", vendorAuto: true, due: M.addDays(p.dueDays ?? 7), pin: null, photos: [], ...loc,
  };
}
ROUTES.new = async () => { if (!S.draft || S.draft._editId) startDraft(); renderForm(); };
ROUTES.edit = async (qq) => {
  const d = S.defects.find((x) => x.id === qq.id); if (!d) return replace("#/list");
  if (!S.draft || S.draft._editId !== d.id) startDraft({}, d);
  renderForm();
};
function chipRow(name, opts, cur, { allowAdd = false } = {}) {
  return `<div class="chips wrap" data-chips="${name}">${opts.map((o) => `<button type="button" class="chip ${o === cur ? "on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}${allowAdd ? `<button type="button" class="chip add" data-add="${name}">＋ 직접입력</button>` : ""}</div>`;
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
    <div class="fld"><span>구분</span>${chipRow("category", M.CATEGORIES, dr.category)}</div>
    <div class="fld"><span>공종 <em>*</em></span>${chipRow("trade", p.trades.map((t) => t.name), dr.trade, { allowAdd: true })}</div>
    ${trade?.subs?.length ? `<div class="fld"><span>세부공종</span>${chipRow("subTrade", trade.subs, dr.subTrade, { allowAdd: true })}</div>` : ""}
    <div class="fld"><span>유형</span>${chipRow("type", p.types, dr.type, { allowAdd: true })}</div>
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
    if (b.dataset.add) {
      v = await prompt2(`${{ trade: "공종", subTrade: "세부공종", type: "유형" }[k]} 직접입력`, "", { ok: "추가" }); if (!v) return;
      if (k === "trade" && !p.trades.some((t) => t.name === v)) { p.trades.push({ name: v, subs: [] }); await saveProject(p); }
      if (k === "type" && !p.types.includes(v)) { p.types.push(v); await saveProject(p); }
      if (k === "subTrade" && trade && !trade.subs.includes(v)) { trade.subs.push(v); await saveProject(p); }
    }
    if (k === "trade" && dr.trade !== v) { dr.subTrade = ""; dr.vendorAuto = true; }
    dr[k] = dr[k] === v && k !== "category" && k !== "severity" ? "" : v;
    if (k === "category") LS.set("lastCat", v);
    renderForm();
  }));
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
    const err = !dr.dong && !dr.common ? "위치를 선택하세요" : !dr.trade ? "공종을 선택하세요" : !dr.content.trim() && !dr.type ? "내용 또는 유형을 입력하세요" : "";
    if (err) { $("#form-err").textContent = err; toast(err); return; }
    busy(true, "저장 중…");
    const now = new Date().toISOString();
    const fields = ["dong", "floor", "ho", "common", "room", "part", "trade", "subTrade", "type", "category", "severity", "content", "vendorId", "due", "pin"];
    let d;
    if (editing) { d = S.defects.find((x) => x.id === dr._editId); for (const k of fields) d[k] = dr[k]; d.history = [...(d.history || []), { at: now, status: d.status, note: "내용 수정" }]; }
    else { d = { id: M.uid("h"), projectId: p.id, createdAt: now, status: "접수", memo: "", origin: "local", history: [{ at: now, status: "접수", note: "등록" }] }; for (const k of fields) d[k] = dr[k]; d.content = d.content.trim(); }
    await saveDefect(d);
    for (const ph of dr.photos) {
      await db.put("photos", { id: M.uid("ph"), defectId: d.id, kind: "before", blob: ph.blob, thumb: ph.thumb, w: ph.w, h: ph.h, at: ph.at });
      const m = S.pidx.get(d.id) || { before: 0, after: 0 }; m.before++; S.pidx.set(d.id, m); URL.revokeObjectURL(ph.url);
    }
    busy(false);
    const keep = { dong: d.dong, floor: d.floor, ho: d.ho, common: d.common, room: d.room };
    S.draft = null;
    if (editing) { toast("수정했어요"); back(); return; }
    if (next) { startDraft(keep); toast(`저장했어요 · ${M.locText(d)} 계속 등록`); renderForm(); window.scrollTo(0, 0); }
    else { toast("저장했어요"); replace(`#/item?id=${d.id}`); }
  };
  $("#dform").addEventListener("submit", (e) => { e.preventDefault(); save(false); });
  $("#btn-save-next")?.addEventListener("click", () => save(true));
}

/* 위치 선택기: 동/공용부 → 층 → 호 → 실 → 부위 (단계마다 뒤로가기 한 칸) */
function locationPicker(dr, onDone) {
  const p = P();
  const sel = { dong: dr.dong, floor: dr.floor, ho: dr.ho, common: dr.common, room: dr.room, part: dr.part };
  const STEPS = ["dong", "floor", "ho", "room", "part"];
  let step = 0; const stepLayers = [];
  const s = openSheet({ title: "위치 선택", full: true, html: `<div id="lp"></div>`, footer: `<div class="lp-sum" id="lp-sum"></div><button type="button" class="btn btn-primary btn-lg" id="lp-ok">확인</button>`,
    onBack: () => (step > 0 ? history.back() : s.close()) });
  const dongObj = () => p.dongs.find((d) => d.name === sel.dong);
  const setStep = (i, push = true) => {
    if (push && i > step) { const from = step; stepLayers.push(pushLayer(() => { step = from; draw(); })); }
    step = i; draw();
  };
  const tile = (v, label, on, cls = "") => `<button type="button" class="tile ${on ? "on" : ""} ${cls}" data-v="${esc(v)}">${esc(label)}</button>`;
  function draw() {
    s.setBackVisible(step > 0);
    const box = $("#lp", s.el); const d = dongObj();
    const crumbs = [sel.dong || sel.common, sel.floor && M.floorLabel(sel.floor), sel.ho && sel.ho + "호", sel.room, sel.part].filter(Boolean);
    let h = `<ol class="steps">${["동", "층", "호", "실", "부위"].map((t, i) => `<li class="${i === step ? "on" : i < step ? "done" : ""}">${t}</li>`).join("")}</ol>`;
    if (STEPS[step] === "dong") {
      h += `<h4>동</h4><div class="tiles">${p.dongs.map((x) => tile(x.name, x.name, x.name === sel.dong)).join("") || '<p class="help">동이 없어요. 설정에서 추가하세요.</p>'}</div>
        <h4>공용부</h4><div class="tiles">${p.commons.map((c) => tile("c:" + c, c, c === sel.common, "common")).join("")}</div>`;
    } else if (STEPS[step] === "floor") {
      const fl = d ? M.floorsOf(d) : [];
      h += `<h4>${esc(sel.dong || sel.common)} · 층</h4><div class="tiles small">${[...fl].reverse().map((f) => tile(f, M.floorLabel(f), f === sel.floor)).join("")}</div>
        <button type="button" class="btn btn-block" data-skip="1">층 지정 안 함 (동 전체)</button>`;
    } else if (STEPS[step] === "ho") {
      const us = d ? M.unitsOf(d, sel.floor) : [];
      h += `<h4>${esc(sel.dong)} ${esc(M.floorLabel(sel.floor))} · 호</h4><div class="tiles">${us.map((u) => tile(u, u + "호", u === sel.ho)).join("")}</div>
        <button type="button" class="btn btn-block" data-skip="1">세대 외 (복도·계단·EV홀 등)</button>`;
    } else if (STEPS[step] === "room") {
      h += `<h4>실</h4><div class="tiles">${p.rooms.map((r) => tile(r, r, r === sel.room)).join("")}${tile("_add", "＋ 직접입력", false, "add")}</div><button type="button" class="btn btn-block" data-skip="1">건너뛰기</button>`;
    } else {
      h += `<h4>부위</h4><div class="tiles">${p.parts.map((r) => tile(r, r, r === sel.part)).join("")}${tile("_add", "＋ 직접입력", false, "add")}</div>`;
    }
    box.innerHTML = h;
    $("#lp-sum", s.el).textContent = crumbs.length ? "선택: " + crumbs.join(" · ") : "동 또는 공용부를 먼저 고르세요";
    const ok = $("#lp-ok", s.el); ok.disabled = !(sel.dong || sel.common);
    $$(".tile", box).forEach((b) => b.addEventListener("click", async () => {
      let v = b.dataset.v; const k = STEPS[step];
      if (v === "_add") { v = await prompt2(k === "room" ? "실 이름" : "부위", "", { ok: "선택" }); if (!v) return; const arr = k === "room" ? p.rooms : p.parts; if (!arr.includes(v)) { arr.push(v); await saveProject(p); } }
      if (k === "dong") {
        if (v.startsWith("c:")) { sel.common = v.slice(2); sel.dong = ""; sel.floor = ""; sel.ho = ""; return setStep(3); }
        if (sel.dong !== v) { sel.floor = ""; sel.ho = ""; } sel.dong = v; sel.common = ""; return setStep(1);
      }
      if (k === "floor") { if (sel.floor !== v) sel.ho = ""; sel.floor = v; return setStep(d && M.unitsOf(d, v).length ? 2 : 3); }
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
  }
  $("#lp-ok", s.el).addEventListener("click", async () => {
    if (!(sel.dong || sel.common)) return;
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
        <dt>조치기한</dt><dd>${esc(d.due || "-")}</dd><dt>등록</dt><dd>${fmtDT(d.createdAt)}${d.extId ? ` · 외부ID ${esc(d.extId)}` : ""}</dd></dl></section>
    <ol class="flow">${["접수", "업체전달", "조치중", "조치완료", "확인완료"].map((s2, i) => `<li class="${s2 === d.status ? "on" : i < idx && d.status !== "재접수" ? "done" : ""}">${s2}</li>`).join("")}</ol>
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
    <section class="card"><h3>처리 이력</h3><ol class="hist">${[...(d.history || [])].reverse().map((h) => `<li><time>${fmtDT(h.at)}</time> ${pill(h.status)} ${esc(h.note || "")}</li>`).join("")}</ol></section>
    <button type="button" class="btn btn-danger btn-block" id="btn-del">이 하자 삭제</button>`;
  ROUTES._cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  $("#btn-edit").addEventListener("click", () => { startDraft({}, d); go(`#/edit?id=${d.id}`); });
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => changeStatus(d, b.dataset.st)));
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
async function markSent(items, via) {
  const targets = items.filter((d) => d.status === "접수" || d.status === "재접수");
  if (!targets.length) return;
  const prev = targets.map((d) => [d, d.status]);
  for (const d of targets) { setStatus(d, "업체전달", `${via}로 전달`); await saveDefect(d); }
  rerender();
  toast(`${targets.length}건 ‘업체전달’로 표시`, { action: "되돌리기", onAction: async () => { for (const [d, st] of prev) { setStatus(d, st, "전달 취소"); await saveDefect(d); } rerender(); } });
}
async function sendSheet({ items, vendor = null }) {
  if (!items.length) return toast("보낼 하자가 없어요");
  const byV = new Map(); for (const d of items) byV.set(d.vendorId || "", (byV.get(d.vendorId || "") || 0) + 1);
  if (!vendor && byV.size === 1 && [...byV.keys()][0]) vendor = V([...byV.keys()][0]);
  if (!vendor && byV.size > 1) {
    const v = await choose("어느 업체에 보낼까요?", [...byV.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => ({ label: id ? V(id)?.name || "?" : "업체 미지정", sub: `${c}건`, value: id || "_none" })).concat([{ label: "업체 구분 없이 전체", sub: `${items.length}건`, value: "_all" }]));
    if (!v) return;
    if (v !== "_all") { items = items.filter((d) => (d.vendorId || "_none") === v); vendor = v === "_none" ? null : V(v); }
  }
  const openItems = items.filter((d) => d.status !== "확인완료");
  const list = openItems.length ? openItems : items;
  const text = M.shareMessage({ project: P(), vendor, items: list, appName: APP_NAME });
  const phones = vendor?.phones || [];
  const s = openSheet({ title: `${vendor?.name || "업체"}에게 보내기 · ${list.length}건`, full: true,
    html: `<label class="fld"><span>보낼 내용 (수정 가능)</span><textarea class="inp mono" id="msg" rows="10">${esc(text)}</textarea></label>
      <label class="check"><input type="checkbox" id="withph" ${list.length <= 10 ? "checked" : ""}> 조치 전 사진 첨부 (카톡 공유 시, 최대 10장)</label>
      <div class="send-grid">
        <button type="button" class="btn btn-kakao btn-lg" data-s="kakao">카카오톡으로 보내기</button>
        ${phones.map((ph) => `<a class="btn btn-lg" data-s="sms" href="#" data-ph="${esc(ph)}">💬 문자 ${esc(ph)}</a><a class="btn btn-lg" href="${M.telHref(ph)}" data-s="tel">📞 전화 ${esc(ph)}</a>`).join("")}
        <button type="button" class="btn btn-lg" data-s="copy">📋 내용 복사</button>
        <button type="button" class="btn btn-lg" data-s="pdf">📄 요청서 PDF(인쇄)</button></div>
      <p class="help">카카오톡은 앱이 특정 친구를 대신 고를 수 없어요. 공유창에서 <b>카카오톡 → 대화방</b>을 고르면 내용이 채워진 채로 열려요.${phones.length ? "" : " 업체에 전화번호를 등록하면 문자·전화 버튼이 생겨요."}</p>
      <label class="check"><input type="checkbox" id="mark" checked> 보낸 뒤 ‘접수’ 건을 ‘업체전달’로 표시</label>` });
  const msg = () => $("#msg", s.el).value;
  const after = async (via) => { const mark = $("#mark", s.el).checked; await s.close(); if (mark) await markSent(list, via); };
  $$("[data-s]", s.el).forEach((b) => b.addEventListener("click", async (e) => {
    const k = b.dataset.s;
    if (k === "kakao") {
      let files = [];
      if ($("#withph", s.el).checked) {
        busy(true, "사진 준비 중…");
        for (const d of list) { for (const ph of (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 2)) if (files.length < 10) files.push(new File([ph.blob], `${M.locText(d).replace(/\s+/g, "_")}_${files.length + 1}.jpg`, { type: "image/jpeg" })); }
        busy(false);
      }
      const r = await shareKakao({ text: msg(), files });
      if (r === "cancel") return;
      if (r === "copied") toast("공유를 지원하지 않아 내용을 복사했어요. 카톡에 붙여넣기 하세요");
      if (r === "fail") return toast("공유할 수 없어요");
      return after("카톡");
    }
    if (k === "sms") { e.preventDefault(); const href = M.smsHref(b.dataset.ph, msg()); S.lastSms = href; location.href = href; return after("문자"); }
    if (k === "tel") return; // 기본 동작(tel:)
    if (k === "copy") { (await copyText(msg())) ? toast("복사했어요") : toast("복사 실패"); return after("복사"); }
    if (k === "pdf") { await s.close(); return printRequest({ vendor, items: list }); }
  }));
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
    <div class="send-bar"><button type="button" class="btn btn-kakao btn-lg" id="btn-send">카톡으로 보내기 (${list.length})</button>
      ${ph[0] ? `<button type="button" class="btn btn-lg" id="btn-sms">💬 문자</button>` : ""}<button type="button" class="btn btn-lg" id="btn-pdf">📄 요청서</button></div>
    ${mode === "done" && list.length ? `<button type="button" class="btn btn-block" id="btn-confirm-all">조치완료 ${list.length}건 모두 확인완료</button>` : ""}
    <div>${list.map((d) => defectCard(d)).join("") || '<div class="card empty-card"><p>해당하는 하자가 없어요.</p></div>'}</div>`;
  bindCards();
  $("#btn-vedit").addEventListener("click", () => go(`#/vendor-edit?id=${v.id}`));
  $$("[data-m]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("vmode", b.dataset.m); rerender(); }));
  $("#btn-send").addEventListener("click", () => sendSheet({ items: list, vendor: v }));
  $("#btn-sms")?.addEventListener("click", () => sendSheet({ items: list, vendor: v }));
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
  const vid = await choose("어느 업체 요청서?", [...byV.entries()].map(([id, a]) => ({ label: V(id)?.name || "업체 미지정", sub: `${a.length}건`, value: id || "_none" })));
  if (vid) printRequest({ vendor: V(vid), items: byV.get(vid === "_none" ? "" : vid) });
}

/* ---------- 설정 ---------- */
ROUTES.settings = async () => {
  setTab("settings"); setHeader("설정", { backBtn: navDepth() > 1 });
  const p = P(); let est = "";
  try { const e = await navigator.storage?.estimate?.(); if (e) est = `${(e.usage / 1048576).toFixed(1)}MB 사용`; } catch {}
  let persisted = false; try { persisted = await navigator.storage?.persisted?.(); } catch {}
  const item = (go2, ico, t, sub = "", attr = "") => `<button type="button" class="sitem" ${go2 ? `data-go="${go2}"` : ""} ${attr}><span class="si-ico">${ico}</span><span><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</span><span class="chev">›</span></button>`;
  view().innerHTML = `
    <h3 class="sec">현장</h3><div class="slist">
      ${p ? item("#/project", "🏗", esc(p.name), `${p.dongs.length}개 동 · 공종 ${p.trades.length} · 유형 ${p.types.length} · 도면 ${S.plans.filter((x) => x.projectId === p.id).length}`) : ""}
      ${item("", "🔁", "현장 전환 / 새 현장", `${S.projects.length}개 현장${Pro.isPro() ? "" : " · 무료판 1개"}`, 'data-a="switch"')}
      ${item("", "🧪", "샘플 현장 불러오기", "기능을 둘러볼 수 있는 가상 데이터", 'data-a="sample"')}</div>
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
      ${item("#/privacy", "🔒", "개인정보처리방침", "개인정보를 수집하지 않아요")}
      ${item("", "🗑", "모든 데이터 삭제", "이 기기의 현장·하자·사진·업체", 'data-a="wipe"')}</div>`;
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a;
    if (a === "switch") return switchProject();
    if (a === "sample") return loadSample();
    if (a === "export") return exportSheet(PD(), "전체");
    if (a === "backup") return doBackup();
    if (a === "persist") { const ok = await navigator.storage?.persist?.(); toast(ok ? "저장공간 보호가 켜졌어요" : "브라우저가 거절했어요. 앱을 홈 화면에 설치하면 보통 허용돼요"); return rerender(); }
    if (a === "issuer") { const v = await prompt2("요청자 이름(요청서 표시)", S.issuer); if (v !== null) { S.issuer = v; LS.set("issuer", v); rerender(); } return; }
    if (a === "wipe") {
      if (!(await ask("이 기기의 모든 현장·하자·사진·업체를 삭제할까요?\n먼저 백업 파일을 만들어 두세요. 되돌릴 수 없어요.", { ok: "모두 삭제", danger: true }))) return;
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
    <div class="slist">${p.dongs.map((d) => `<button type="button" class="sitem" data-dong="${d.id}"><span class="si-ico">🏢</span><span><b>${esc(d.name)}${d.alias ? ` <small class="tag">줄임 ${esc(d.alias)}</small>` : ""}</b><small>지하${d.basement || 0} · ${d.floors}층 · ${d.lines}호 라인 · 세대 ${d.unitStart || 1}층부터</small></span><span class="chev">›</span></button>`).join("")}</div>
    <div class="row"><button type="button" class="btn" id="btn-adddong">＋ 동 추가</button><button type="button" class="btn" id="btn-bulkdong">＋ 여러 동 한 번에</button></div>
    <h3 class="sec">목록 편집</h3><div class="slist">
      ${[["commons", "🅿", "공용부", p.commons], ["trades", "🧱", "공종·세부공종", p.trades.map((t) => t.name)], ["types", "🏷", "하자 유형", p.types], ["rooms", "🚪", "실", p.rooms], ["parts", "🧩", "부위", p.parts]]
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
  const title = { commons: "공용부", trades: "공종", types: "하자 유형", rooms: "실", parts: "부위" }[k] || "목록";
  setTab(null); setHeader(title, { backBtn: true });
  const arr = k === "trades" ? p.trades.map((t) => t.name) : p[k];
  view().innerHTML = `<p class="help">항목을 누르면 이름 변경·삭제${k === "trades" ? "·세부공종 편집" : ""}을 할 수 있어요. ↑↓로 순서를 바꿔요.</p>
    <div class="slist">${arr.map((x, i) => `<div class="sitem"><button type="button" class="si-main" data-i="${i}"><b>${esc(x)}</b>${k === "trades" ? `<small>${esc(p.trades[i].subs.join(", ") || "세부공종 없음")}</small>` : ""}</button>
      <button type="button" class="btn btn-sm" data-up="${i}" aria-label="위로">↑</button><button type="button" class="btn btn-sm" data-dn="${i}" aria-label="아래로">↓</button></div>`).join("")}</div>
    <div class="row"><button type="button" class="btn btn-primary" id="l-add">＋ 추가</button><button type="button" class="btn" id="l-reset">기본값으로</button></div>`;
  const src = () => (k === "trades" ? p.trades : p[k]);
  const save = async () => { await saveProject(p); rerender(); };
  $("#l-add").addEventListener("click", async () => { const v = await prompt2(`${title} 추가`); if (!v) return; if (k === "trades") p.trades.push({ name: v, subs: [] }); else if (!p[k].includes(v)) p[k].push(v); save(); });
  $("#l-reset").addEventListener("click", async () => {
    if (!(await ask(`${title} 목록을 기본값으로 되돌릴까요? 직접 추가한 항목이 사라져요.`))) return;
    const D = { commons: M.DEFAULT_COMMONS, types: M.DEFAULT_TYPES, rooms: M.DEFAULT_ROOMS, parts: M.DEFAULT_PARTS };
    if (k === "trades") p.trades = M.DEFAULT_TRADES.map((t) => ({ name: t.name, subs: [...t.subs] })); else p[k] = [...D[k]]; save();
  });
  $$("[data-up],[data-dn]", view()).forEach((b) => b.addEventListener("click", () => {
    const a = src(); const i = Number(b.dataset.up ?? b.dataset.dn); const j = b.dataset.up != null ? i - 1 : i + 1;
    if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; save();
  }));
  $$("[data-i]", view()).forEach((b) => b.addEventListener("click", async () => {
    const i = +b.dataset.i; const a = src(); const name = k === "trades" ? a[i].name : a[i];
    const act = await choose(name, [{ label: "이름 변경", value: "ren" }, ...(k === "trades" ? [{ label: "세부공종 편집", value: "subs", sub: a[i].subs.join(", ") }] : []), { label: "삭제", value: "del" }]);
    if (act === "ren") { const v = await prompt2("새 이름", name); if (!v) return; if (k === "trades") a[i].name = v; else a[i] = v; }
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
    <label class="fld"><span>구분 열이 없을 때 기본 구분</span><select class="inp" id="def-cat">${M.CATEGORIES.map((c) => `<option ${c === (imp.defCat || "입주자하자") ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="add-dongs" checked> 현장에 없는 동은 자동으로 추가</label>
    <div class="form-act"><button type="button" class="btn btn-lg" id="imp-cancel">다른 파일</button><button type="button" class="btn btn-primary btn-lg" id="imp-go">미리보기</button></div>`;
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
  busy(false);
  const st = res.stats;
  const ok = await ask(`가져올 행 ${n(st.total)}개\n· 새 하자 ${n(st.added)}건\n· 갱신 ${n(st.updated)}건 (그중 내 수정 유지 ${n(st.kept)}건)\n· 변경 없음 ${n(st.same)}건\n· 새 업체 ${res.newVendors.length}개${res.newDongs.length ? `\n· 새 동 ${res.newDongs.length}개 (${res.newDongs.slice(0, 4).join(", ")}${res.newDongs.length > 4 ? "…" : ""})` : ""}`, { ok: "가져오기", title: "가져오기 미리보기" });
  if (!ok) return;
  busy(true, "저장 중…");
  await db.putMany("defects", res.toPut); for (const v of res.newVendors) await saveVendor(v);
  Object.assign(p, { dongs: pcopy.dongs }); await saveProject(p);
  const maps = await db.getMeta("importMaps", {}); maps[imp.sig] = { map: imp.map, defCat: imp.defCat, at: new Date().toISOString() }; await db.setMeta("importMaps", maps);
  const hist = await db.getMeta("imports", []); hist.push({ at: new Date().toISOString(), file: imp.file, projectId: p.id, ...st }); await db.setMeta("imports", hist.slice(-20));
  S.defects = await db.getAll("defects"); busy(false); S.imp = null; requestPersist();
  S.lastImport = st;
  toast(`가져오기 완료 · 새 ${n(st.added)}건, 갱신 ${n(st.updated)}건`);
  S.filter = { status: "_open" }; LS.set("filter", S.filter); replace("#/list");
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
    <dl class="kv"><dt>데이터 저장</dt><dd>이 기기(IndexedDB)에만 저장 · 서버 전송 없음</dd><dt>마지막 백업</dt><dd>${last ? fmtDT(last) : "없음 — 설정에서 백업하세요"}</dd>
      <dt>오픈소스</dt><dd>SheetJS Community Edition (Apache-2.0), JSZip (MIT)</dd></dl>
    <p><a href="#/privacy">개인정보처리방침</a></p></section>`;
  let taps = 0;
  $("#ver").addEventListener("click", async () => { if (!Pro.DEV_UNLOCK) return; if (++taps >= 7) { taps = 0; await Pro.setProForTest(!Pro.isPro()); toast(`테스트: 프로 ${Pro.isPro() ? "켜짐" : "꺼짐"}`); rerender(); } });
};
ROUTES.privacy = async () => {
  setTab(null); setHeader("개인정보처리방침", { backBtn: true });
  view().innerHTML = `<article class="card legal">${PRIVACY_HTML}</article>`;
};
export const PRIVACY_HTML = `<h2>하자싹 개인정보처리방침</h2><p class="help">시행일: 2026년 11월 17일</p>
<p>하자싹(이하 ‘앱’)은 이용자의 개인정보를 수집·저장·전송하지 않습니다.</p>
<h3>1. 수집하는 정보</h3><p>앱은 회원가입·로그인이 없으며 개발자 서버로 어떤 정보도 보내지 않습니다. 이용자가 입력한 현장·하자 내용, 사진, 업체명·전화번호, 도면 이미지는 <b>이용자 기기 안(브라우저 저장소)</b>에만 저장됩니다.</p>
<h3>2. 기기 권한</h3><ul><li>카메라·사진: 하자 사진 촬영·첨부 시에만 사용</li><li>연락처(선택): ‘연락처에서 가져오기’를 누를 때 이용자가 고른 연락처의 이름·전화번호만 앱 안에 저장</li><li>마이크(선택): 음성 입력 시 기기의 음성 인식 기능 사용(기기·브라우저 제공자의 정책 적용)</li></ul>
<h3>3. 제3자 제공</h3><p>앱은 정보를 제3자에게 제공하지 않습니다. 이용자가 ‘카톡으로 보내기’, ‘문자’, ‘공유’를 누르면 이용자가 고른 앱(카카오톡·문자 등)으로 내용이 전달되며, 이후 처리는 해당 앱의 정책을 따릅니다.</p>
<h3>4. 보관 및 삭제</h3><p>데이터는 이용자가 삭제하거나 앱을 삭제할 때까지 기기에 남습니다. 설정 &gt; ‘모든 데이터 삭제’로 언제든 지울 수 있습니다. 백업 파일(zip)은 이용자가 직접 보관·관리합니다.</p>
<h3>5. 아동</h3><p>앱은 업무용이며 아동을 대상으로 하지 않습니다.</p>
<h3>6. 문의</h3><p>개발자 이메일: <span class="contact-email">(스토어 등록 시 기재)</span></p>`;

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
async function main() {
  $("#btn-back").addEventListener("click", () => back());
  $$(".tab-item").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); const h = a.getAttribute("href");
    if (h === "#/new") { if (!S.draft || S.draft._editId) startDraft(); }
    if (location.hash.split("?")[0] === h) return rerender();
    if (navDepth() <= 1 || h === "#/home") replace(h); else go(h);
  }));
  window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
  try { await loadAll(); } catch (e) { $("#view").innerHTML = `<div class="card"><p>저장소를 열 수 없어요: ${esc(e.message)}</p></div>`; return; }
  initNav(() => { ROUTES._cleanup?.(); ROUTES._cleanup = null; route(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
  window.__hs = { S, M, db, Pro, go, replace }; // 테스트·디버그용
}
main();
