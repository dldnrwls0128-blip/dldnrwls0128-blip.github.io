/** 하자싹 — 현장 시공불량·하자 관리 (오프라인 PWA) */
import * as db from "./db.js";
import * as M from "./model.js";
import { $, $$, esc, n, toast, busy, initNav, go, replace, back, rerender, navDepth, navKind, pushLayer, closeLayer, unwind, openSheet, ask, prompt2, choose, pickFile } from "./ui.js";
import { compressImage, downloadBlob, shareOrDownload, stampBlob } from "./photo.js";
import { shareKakao, shareGeneric, isMobileDevice, isAndroid, copyText, contactPickerSupported, contactPickerInfo, pickContacts, canShareFiles } from "./share.js";
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

/** 화면별 ‘?’ → 사용법의 해당 부분 */
const HELP_OF = { new: "add", edit: "add", unit: "add", item: "status", list: "grid", grid: "grid", dash: "grid", vendors: "vendors", vendor: "send", "vendor-edit": "vendors", settings: "settings", project: "plans", import: "excel", imported: "excel", restore: "excel", sync: "team", wizard: "start", lists: "plans" };
function setHeader(title, { backBtn = navDepth() > 1, action = "", help } = {}) {
  $("#header-title").textContent = title;
  $("#btn-back").hidden = !backBtn;
  const path = (location.hash.split("?")[0] || "").slice(2); const hs = help ?? HELP_OF[path];
  $("#hdr-action").innerHTML = action + (hs ? `<button type="button" class="hdr-help" data-help="${hs}" aria-label="이 화면 사용법" title="사용법">?</button>` : "");
}
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-help]"); if (b) { e.preventDefault(); go(`#/help?s=${b.dataset.help}`); } });
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
  d.updatedAt = new Date().toISOString(); if (local) d.localEdited = true; S.locIdx = null;
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
async function addPhotos(defectId, files, kind, stampBase, extra = {}) {
  let ok = 0;
  for (const f of files) {
    try {
      const at = new Date().toISOString();
      const on = stampOn();
      const { blob, thumb, w, h } = await compressImage(f, { stamp: on ? stampInfo(stampBase, kind, at) : null });
      await db.put("photos", { id: M.uid("ph"), defectId, kind, blob, thumb, w, h, at, stamp: on ? "1" : "0", ...extra });
      const m = S.pidx.get(defectId) || { before: 0, after: 0 }; m[kind === "after" ? "after" : "before"]++; S.pidx.set(defectId, m); ok++;
    } catch (e) { toast(e.message || "사진 처리 실패"); }
  }
  return ok;
}
/** 사진 스탬프: 설정(기본 켬)·내용. stampOf(d)는 하자 기준 정보, stampInfo로 조치 전/후·일시를 붙인다 */
const stampOn = () => LS.get("stampPhotos", true) !== false;
const stampOf = (d) => ({ project: P()?.name || "", loc: M.locText(d) || "위치 미지정", work: [M.tradeText(d), d.type].filter(Boolean).join(" · ") });
const stampInfo = (base, kind, at) => ({ ...base, tag: kind === "after" ? "조치 후" : "조치 전", at: fmtDT(at) });
/** 보내기·내보내기용 사진: 스탬프 없이 찍은 사진은(설정이 켜져 있으면) 이때 새긴 사본을 쓴다 */
async function photoOut(ph, d) {
  if (ph.stamp !== "0" || !stampOn()) return ph.blob;
  try { return await stampBlob(ph.blob, stampInfo(stampOf(d), ph.kind, ph.at)); } catch { return ph.blob; }
}

/* ---------- 라우터 ---------- */
const ROUTES = {};
/* 1.2.3 보던 자리 유지: 같은 화면 다시 그리기(상태변경·보내기·이관 후)와 뒤로가기는 스크롤 위치를 되살림.
 * 높이가 바뀌어도 맞도록 ‘화면 맨 위에 보이던 하자 카드’ 기준(없으면 scrollY). 열린 <details>도 유지 */
const scrollMem = new Map(); let curHash = "";
function captureView() {
  const top = (document.querySelector(".app-header")?.getBoundingClientRect().bottom || 0) + 2;
  let anchor = "", off = 0;
  for (const el of $$("[data-id]", view())) { if (el.closest("details:not([open])")) continue; const r = el.getBoundingClientRect(); if (r.height && r.bottom > top) { anchor = el.dataset.id; off = r.top; break; } }
  return { y: window.scrollY, anchor, off, open: $$("details[id]:not(.vgrp)", view()).filter((x) => x.open).map((x) => x.id), limit: S.listLimit };
}
function restoreView(m) {
  for (const id of m.open || []) { const dd = document.getElementById(id); if (dd && dd.tagName === "DETAILS") dd.open = true; }
  const apply = () => { const el = m.anchor && $(`[data-id="${CSS.escape(m.anchor)}"]`, view()); if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - m.off); else window.scrollTo(0, m.y); };
  apply(); requestAnimationFrame(apply); setTimeout(apply, 120);
  window.__scrollRestored = (window.__scrollRestored || 0) + 1;
}
async function route() {
  const path = (location.hash.split("?")[0] || "#/home").slice(2) || "home";
  const kind = navKind(); const hash = location.hash;
  if (curHash && view().childElementCount) scrollMem.set(curHash, captureView());
  if (scrollMem.size > 40) scrollMem.delete(scrollMem.keys().next().value);
  const mem = !S.noRestore && (kind === "re" || kind === "pop" || hash === curHash) ? scrollMem.get(hash) : null; S.noRestore = false;
  if (kind === "pop" && mem?.limit && mem.limit > S.listLimit) S.listLimit = mem.limit; // 목록 ‘더 보기’로 늘린 만큼 유지
  curHash = hash;
  document.body.classList.remove("printing");
  view().oninput = null;
  if (!LS.get("onboarded", false) && !["onboard", "privacy", "help"].includes(path)) return replace("#/onboard");
  if (!P() && !["onboard", "wizard", "settings", "privacy", "about", "restore", "pro", "sync", "help"].includes(path)) {
    setTab("home"); setHeader(APP_NAME, { backBtn: false });
    view().innerHTML = noProject(); bindNoProject(); return;
  }
  const selKey = location.hash.split("?")[0] === "#/list" ? "#/list" : location.hash;
  if (selKey !== S.selRoute && !["item", "edit"].includes(path)) { S.select.clear(); S.selAnchor = null; S.selRoute = selKey; }
  document.body.classList.remove("has-selbar");
  const fn = ROUTES[path] || ROUTES.home;
  let keep = false;
  try { keep = (await fn(q())) === "keep-scroll"; } catch (e) { console.error(e); view().innerHTML = `<div class="card"><p>화면 오류: ${esc(e.message)}</p></div>`; }
  if (keep) return;
  if (mem && !["new", "edit"].includes(path)) restoreView(mem); else window.scrollTo(0, 0);
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
    <div class="dc-top"><span class="dc-loc">${esc(M.locText(d) || "위치 미지정")}</span><button type="button" class="dtag ${d.tabs?.length ? "on" : ""}" data-tag="${d.id}" aria-label="관리 탭${d.tabs?.length ? ` (${d.tabs.length}개)` : ""}" title="관리 탭">${d.tabs?.length ? "★" : "☆"}</button>${pill(d.status)}<button type="button" class="dmore" data-more="${d.id}" aria-label="더 보기(복사해서 등록 등)" title="복사해서 등록 · 수정 …">⋯</button></div>
    <div class="dc-mid">${sevBadge(d)}<b>${esc(M.tradeText(d) || "공종 미지정")}</b>${d.type ? ` <span class="tbadge">${esc(d.type)}</span>` : ""} ${esc(d.content || "")}</div>
    <div class="dc-bot"><span>${esc(vName(d) || "업체 미지정")}</span>${M.hasSteps(d) ? `<span class="stp-b" title="${esc(M.stepsText(d))}">🔗 ${M.stepProgress(d)}${M.curStep(d) ? ` · ${esc(M.curStep(d).trade)}` : ""}</span>` : ""}
      ${d.due ? `<span class="${od ? "od" : ""}">기한 ${shortDate(d.due)}${od ? " 초과" : ""}</span>` : ""}
      ${pc.before + pc.after ? `<span>📷${pc.before}${pc.after ? "/" + pc.after : ""}</span>` : ""}<span>${esc(d.category || "")}</span></div>
  </article>`;
}
function bindCards(root = view()) {
  if (!root.__cardLp) { root.__cardLp = true; onLongPress(root, ".dcard", (c) => { const d = S.defects.find((x) => x.id === c.dataset.id); if (d) cardMenu(d); }); }
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
    $(".dtag", c)?.addEventListener("click", (e) => { e.stopPropagation(); const d = S.defects.find((x) => x.id === c.dataset.id); if (d) tabSheet([d], () => rerender()); });
    $(".dtag", c)?.addEventListener("keydown", (e) => e.stopPropagation());
    $(".dmore", c)?.addEventListener("click", (e) => { e.stopPropagation(); const d = S.defects.find((x) => x.id === c.dataset.id); if (d) cardMenu(d); });
    $(".dmore", c)?.addEventListener("keydown", (e) => e.stopPropagation());
    const open = () => go(`#/item?id=${c.dataset.id}`);
    c.addEventListener("click", open);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === c) open(); });
  });
}
/* ---------- 체크 선택(세대·목록·업체 화면 공통) ---------- */
const selItems = () => S.defects.filter((d) => S.select.has(d.id));
function selBarHtml({ all = false, core = false } = {}) {
  return `<div id="selbar" class="selbar" hidden role="region" aria-label="선택한 하자"><span id="selcount"></span>
    ${all ? '<button type="button" class="btn btn-sm" data-sa="all">전체선택</button>' : ""}
    <button type="button" class="btn btn-sm btn-primary" data-sa="send">보내기</button><button type="button" class="btn btn-sm" data-sa="req">요청서</button><button type="button" class="btn btn-sm" data-sa="move">이관</button><button type="button" class="btn btn-sm" data-sa="status">상태변경</button><button type="button" class="btn btn-sm" data-sa="tabadd">★ 탭에 추가</button><button type="button" class="btn btn-sm" data-sa="copyto">📋 선택 위치들에 복사</button><button type="button" class="btn btn-sm" data-sa="tabdel">탭에서 빼기</button>${core ? '<button type="button" class="btn btn-sm" data-sa="core">코어 지정</button>' : ""}<button type="button" class="btn btn-sm btn-ghost" data-sa="clear">해제</button></div>`;
}
/** 체크 상태를 화면(카드·그룹 전체칸·그룹 보내기 버튼·하단 바)에 반영 */
/** 묶음 ‘전체’ 체크 대상: data-gall="@묶음키"면 목록 묶음 지도에서(큰 목록에서 HTML이 커지지 않게), 아니면 쉼표 목록 */
const gallIds = (g) => (g.dataset.gall.startsWith("@") ? S.lgItems?.get(g.dataset.gall.slice(1)) || [] : g.dataset.gall.split(","));
function syncChecks() {
  for (const cb of $$(".dsel", view())) { const on = S.select.has(cb.dataset.sel); cb.checked = on; cb.closest(".dcard")?.classList.toggle("checked", on); }
  for (const g of $$("[data-gall]", view())) {
    const ids = gallIds(g); let k = 0; for (const x of ids) if (S.select.has(x)) k++;
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
    if (a === "req") return requestImageFor(sel);
    if (a === "move") return transferSheet(sel);
    if (a === "core") return coreAssign(sel);
    if (a === "copyto") return bulkCopySheet(sel);
    if (a === "tabadd" || a === "tabdel") return tabBulk(sel, a === "tabadd");
    const st = await choose(`${sel.length}건 상태 변경`, M.STATUSES.map((x) => ({ label: x, value: x })));
    if (!st) return;
    for (const d of sel) { setStatus(d, st, "일괄 변경"); await saveDefect(d); }
    toast(`${sel.length}건을 ‘${st}’(으)로 바꿨어요`); S.select.clear(); rerender();
  }));
}
/* ---------- 1.2.8 관리 탭: 특정 건을 따로 모아 관리(현장마다 탭 여러 개 · 이름 바꾸기 · 한 건이 여러 탭) ---------- */
const TABS = () => M.tabsOf(P());
const tabCount = (id) => { let k = 0; for (const d of PD()) if (M.inTab(d, id)) k++; return k; };
async function saveTabs(list) { const p = P(); p.tabs = list.map((t) => ({ id: t.id, name: t.name })); await saveProject(p); }
async function setTabs(items, id, on) {
  let k = 0;
  for (const d of items) { const cur = Array.isArray(d.tabs) ? d.tabs : []; const has = cur.includes(id); if (has === on) continue; d.tabs = on ? [...cur, id] : cur.filter((x) => x !== id); await saveDefect(d); k++; }
  return k;
}
async function newTab() {
  if (isViewerNow()) { toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요"); return null; }
  const r = await formSheet({ title: "새 관리 탭", ok: "만들기", hint: "예: 중점관리, 입주 전 필수, 소장 확인", fields: [{ k: "name", label: "탭 이름", placeholder: "예: 입주 전 필수" }],
    validate: ({ name }) => (!name.trim() ? "이름을 입력하세요" : name.trim().length > 20 ? "20자 이내로" : TABS().some((t) => t.name === name.trim()) ? "이미 있는 탭이에요" : "") });
  if (!r) return null; const t = { id: M.uid("t"), name: r.name.trim() }; await saveTabs([...TABS(), t]); return t.id;
}
/** 카드·상세의 ★: 탭마다 체크(여러 건이면 일부만 들어 있는 탭은 ‘일부’) */
function tabSheet(items, onDone = () => {}) {
  const draw = () => TABS().map((t) => { const k = items.filter((d) => M.inTab(d, t.id)).length; const st = k === 0 ? "" : k === items.length ? "all" : "some";
    return `<label class="tb-row"><input type="checkbox" data-tb="${esc(t.id)}" data-st="${st}" ${st === "all" ? "checked" : ""}><span>${esc(t.name)}</span><small class="help">${n(tabCount(t.id))}건</small></label>`; }).join("") || '<p class="help">탭이 없어요. ＋ 새 탭으로 만드세요.</p>';
  const s = openSheet({ title: items.length > 1 ? `관리 탭 · ${items.length}건` : "관리 탭", cls: "tb-sheet",
    html: `<div class="tb-list" id="tb-list">${draw()}</div><div class="row wrap"><button type="button" class="btn btn-sm" id="tb-new">＋ 새 탭</button><button type="button" class="btn btn-sm btn-ghost" id="tb-cfg">탭 이름·순서 관리</button></div>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="tb-ok">저장</button>` });
  const marks = () => $$("[data-tb]", s.el).forEach((c) => { if (c.dataset.st === "some" && !c.dataset.touched) c.indeterminate = true; c.addEventListener("change", () => { c.dataset.touched = "1"; }); });
  marks();
  $("#tb-new", s.el).addEventListener("click", async () => { const keep = new Map($$("[data-tb]", s.el).filter((c) => c.dataset.touched).map((c) => [c.dataset.tb, c.checked])); const id = await newTab(); if (id) keep.set(id, true);
    $("#tb-list", s.el).innerHTML = draw(); marks(); for (const c of $$("[data-tb]", s.el)) if (keep.has(c.dataset.tb)) { c.checked = keep.get(c.dataset.tb); c.indeterminate = false; c.dataset.touched = "1"; } });
  $("#tb-cfg", s.el).addEventListener("click", async () => { await s.close(); tabManager(onDone); });
  $("#tb-ok", s.el).addEventListener("click", async () => {
    if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
    let k = 0; for (const c of $$("[data-tb]", s.el)) { if (!c.dataset.touched) continue; k += await setTabs(items, c.dataset.tb, c.checked); }
    await s.close(); if (k) toast("관리 탭을 바꿨어요"); onDone();
  });
  return s;
}
/** 체크한 건을 탭에 넣기/빼기 */
async function tabBulk(items, add) {
  if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
  const opts = TABS().filter((t) => add || items.some((d) => M.inTab(d, t.id))).map((t) => ({ icon: "★", label: t.name, sub: `지금 ${n(tabCount(t.id))}건${add ? "" : ` · 체크한 것 중 ${items.filter((d) => M.inTab(d, t.id)).length}건 들어 있음`}`, value: t.id }));
  if (!add && !opts.length) return toast("체크한 하자가 들어 있는 탭이 없어요");
  let id = await choose(add ? `${items.length}건을 어느 탭에 넣을까요?` : `${items.length}건을 어느 탭에서 뺄까요?`, add ? [...opts, { icon: "＋", label: "새 탭 만들기", value: "_new" }] : opts);
  if (!id) return; if (id === "_new") { id = await newTab(); if (!id) return; }
  const k = await setTabs(items, id, add); const nm = TABS().find((t) => t.id === id)?.name || "";
  toast(add ? `‘${nm}’에 ${k}건 넣었어요` : `‘${nm}’에서 ${k}건 뺐어요`); S.select.clear(); rerender();
}
/** 탭 만들기·이름 바꾸기·지우기·순서 */
function tabManager(onDone = () => rerender()) {
  const ro = isViewerNow();
  const draw = () => `${TABS().map((t, i, a) => `<div class="tm-row" data-tid="${esc(t.id)}"><b>${esc(t.name)}</b><small class="help">${n(tabCount(t.id))}건</small><span class="sp"></span>
      <button type="button" class="btn btn-sm" data-tm="up" ${i === 0 || ro ? "disabled" : ""} aria-label="${esc(t.name)} 위로">↑</button><button type="button" class="btn btn-sm" data-tm="down" ${i === a.length - 1 || ro ? "disabled" : ""} aria-label="${esc(t.name)} 아래로">↓</button>
      <button type="button" class="btn btn-sm" data-tm="ren" ${ro ? "disabled" : ""}>이름</button><button type="button" class="btn btn-sm btn-warn" data-tm="del" ${ro ? "disabled" : ""}>삭제</button></div>`).join("") || '<p class="help">탭이 없어요.</p>'}
    <button type="button" class="btn btn-block" id="tm-new" ${ro ? "disabled" : ""}>＋ 새 탭</button><p class="help small">탭을 지워도 하자는 그대로예요(그 탭에서만 빠져요). 탭은 팀원과 함께 써요.</p>`;
  const s = openSheet({ title: "관리 탭 설정", cls: "tm-sheet", html: `<div id="tm-body">${draw()}</div>`, footer: `<button type="button" class="btn btn-primary" data-close>닫기</button>` });
  s.onClose = () => onDone();
  const body = () => { $("#tm-body", s.el).innerHTML = draw(); };
  s.el.addEventListener("click", async (e) => {
    if (e.target.closest("#tm-new")) { if (await newTab()) body(); return; }
    const b = e.target.closest("[data-tm]"); if (!b) return; const id = b.closest("[data-tid]").dataset.tid; const list = [...TABS()]; const i = list.findIndex((t) => t.id === id); const t = list[i];
    if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
    if (b.dataset.tm === "up" || b.dataset.tm === "down") { const j = b.dataset.tm === "up" ? i - 1 : i + 1; [list[i], list[j]] = [list[j], list[i]]; await saveTabs(list); return body(); }
    if (b.dataset.tm === "ren") { const r = await formSheet({ title: "탭 이름 바꾸기", ok: "바꾸기", fields: [{ k: "name", label: "탭 이름", value: t.name }], validate: ({ name }) => (!name.trim() ? "이름을 입력하세요" : name.trim().length > 20 ? "20자 이내로" : list.some((x) => x.id !== id && x.name === name.trim()) ? "이미 있는 탭이에요" : "") });
      if (!r) return; t.name = r.name.trim(); await saveTabs(list); return body(); }
    if (b.dataset.tm === "del") { const k = tabCount(id);
      if (!(await ask(`‘${t.name}’ 탭을 지울까요?\n하자 ${k}건은 지워지지 않고 이 탭에서만 빠져요.`, { ok: "탭 삭제", danger: true }))) return;
      await setTabs(PD().filter((d) => M.inTab(d, id)), id, false); await saveTabs(list.filter((x) => x.id !== id)); if (LS.get("listTab", "") === id) LS.set("listTab", ""); toast("탭을 지웠어요"); return body(); }
  });
  return s;
}
/** 1.2.7 코어 지정: 동 공용부(호 없는) 하자에 코어를 한꺼번에(호 있는 하자는 라인으로 자동이라 건너뜀) */
async function coreAssign(items) {
  if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
  const p = P(); const tg = items.filter((d) => { const lp = M.locParts(d); return lp.dong && lp.line == null; });
  if (!tg.length) return toast("코어는 동 공용부(방풍실·계단실 등 호 없는) 하자에 지정해요 — 호가 있으면 라인으로 자동");
  const dongs = [...new Set(tg.map((d) => M.locParts(d).dong))]; const cs = [...new Set(dongs.flatMap((dn) => M.coresOf(p, dn, PD())))].sort((a, b) => a - b);
  const skip = items.length - tg.length;
  const v = await choose(`동 공용부 ${tg.length}건 코어 지정${skip ? ` (호 있는 ${skip}건은 자동이라 건너뜀)` : ""}`, [...cs.map((c) => ({ icon: "🏢", label: `${c}코어`, sub: dongs.slice(0, 4).join(", ") + (dongs.length > 4 ? ` 외 ${dongs.length - 4}` : ""), value: String(c) })), { icon: "↺", label: "코어 미지정으로", value: "_none" }]);
  if (v == null) return;
  const now = new Date().toISOString(); const c = v === "_none" ? "" : Number(v);
  for (const d of tg) { if ((Number(d.core) || "") === c) continue; d.core = c; d.history = [...(d.history || []), { at: now, status: d.status, note: c ? `코어 지정: ${c}코어` : "코어 지정 해제", ...(Sync.attached() && Sync.signedIn() ? { by: Sync.actorName() } : {}) }]; await saveDefect(d); }
  S.locIdx = null; toast(c ? `${tg.length}건을 ${c}코어로 지정했어요` : `${tg.length}건 코어를 지웠어요`); S.select.clear(); rerender();
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
  const recent = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 3);
  const doing = list.filter((d) => d.status === "조치중").length; const mine = list.filter(M.isMyTurn).length;
  const unsent = list.filter((d) => d.status === "접수" || d.status === "재접수").length;
  const rate = list.length ? Math.round((done / list.length) * 100) : 0;
  view().innerHTML = `<div class="home2">
    <form class="search" id="qsearch" role="search"><input class="inp" id="qs" type="search" inputmode="search" placeholder="예: ${esc(exampleQuery(p))}  ·  동/호/내용 검색" aria-label="빠른 검색"><button class="btn btn-primary" type="submit">검색</button></form>
    <section class="card home-stat">
      <div class="kpis">
        <button type="button" class="kpi" data-f='{"status":"_open"}'><b>${n(open.length)}</b><span>미조치</span></button>
        <button type="button" class="kpi doing" data-f='{"status":"조치중"}'><b>${n(doing)}</b><span>조치중</span></button>
        <button type="button" class="kpi ok" data-f='{"status":"_done"}'><b>${n(done)}</b><span>완료</span></button>
        <button type="button" class="kpi mine" data-f='{"mine":"1"}'><b>${n(mine)}</b><span>내 차례 대기</span></button>
      </div>
      <button type="button" class="rate" data-go="#/dash" aria-label="조치율 ${rate}% · 대시보드"><span class="rate-bar"><i style="width:${rate}%"></i></span><span class="rate-t">조치율 <b>${rate}%</b> · 전체 ${n(list.length)}건 · 오늘 ${todayN}건</span></button>
      ${od.length ? `<button type="button" class="od-alert" data-f='{"overdue":true}'>⏰ 기한초과 <b>${n(od.length)}건</b> 보기 ›</button>` : ""}
    </section>
    <button type="button" class="btn btn-primary btn-xl" data-go="#/new">＋ 하자 등록</button>
    <div class="actions4">
      <button type="button" class="act" data-go="#/list"><span class="act-i">📋</span><b>목록</b><small>${n(open.length)}건 미조치</small></button>
      <button type="button" class="act" data-go="#/grid"><span class="act-i">🏢</span><b>동현황</b><small>세대별 한눈에</small></button>
      <button type="button" class="act" id="home-find"><span class="act-i">🔎</span><b>건수 찾기</b><small>업체·동·유형별</small></button>
      <button type="button" class="act" data-go="#/vendors"><span class="act-i">📲</span><b>보내기</b><small>${unsent ? `미전달 ${n(unsent)}건` : "업체에 카톡·문자"}</small></button>
    </div>
    <details class="more card" id="home-more"><summary>더보기 <small>대시보드 · 엑셀 · 현장 전환 · 사용법</small></summary>
      <div class="more-list">
        <button type="button" class="sitem" data-go="#/dash"><span class="si-ico">📊</span><span><b>대시보드</b><small>상태·업체·경과일 통계</small></span><span class="chev">›</span></button>
        <button type="button" class="sitem" data-go="#/import"><span class="si-ico">📥</span><span><b>엑셀 가져오기</b><small>다른 시스템·엑셀 목록</small></span><span class="chev">›</span></button>
        <button type="button" class="sitem" data-a="switch"><span class="si-ico">🔁</span><span><b>현장 전환 / 새 현장</b><small>${S.projects.length}개 현장</small></span><span class="chev">›</span></button>
        <button type="button" class="sitem" data-go="#/help"><span class="si-ico">📘</span><span><b>사용법 보기</b><small>처음이라면 여기부터</small></span><span class="chev">›</span></button>
      </div></details>
    <h3 class="sec">최근 기록 <small>오늘 등록 ${todayN}건 · 전체 ${n(list.length)}건</small></h3>
    ${recent.length ? recent.map((d) => defectCard(d)).join("") : `<div class="card empty-card"><p>아직 등록된 하자가 없어요.<br>‘＋ 하자 등록’을 눌러 시작하세요.</p><button type="button" class="btn btn-sm" data-go="#/help?s=add">등록하는 법 보기</button></div>`}
    ${recent.length ? `<button type="button" class="btn btn-block" data-go="#/list">전체 목록 보기</button>` : ""}
    ${verFoot()}</div>`;
  bindCards(); bindVerFoot();
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$("[data-f]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = JSON.parse(b.dataset.f); LS.set("filter", S.filter); S.listMode = "list"; go("#/list"); }));
  $("#btn-proj").addEventListener("click", switchProject);
  $("#home-find")?.addEventListener("click", () => filterSheet());
  $("[data-a=switch]", view())?.addEventListener("click", switchProject);
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
const FILTER_LABEL = { exw: "제외", x_vendorId: "제외 업체", x_dong: "제외 동", x_floor: "제외 층", x_core: "제외 코어", x_trade: "제외 공종", x_type: "제외 유형", x_status: "제외 상태", x_severity: "제외 중요도", x_category: "제외 구분", x_createdBy: "제외 등록자", dong: "동", ho: "호", common: "공용부", floor: "층", turn: "내 차례 대기", mine: "내 차례", chain: "후속 공정", trade: "공종", vendorId: "업체", type: "유형", category: "구분", severity: "중요도", status: "상태", overdue: "기한초과", text: "검색", createdBy: "등록자", from: "기간", to: "기간", core: "코어", room: "실" };
function filterChipText(k, v) {
  if (k.startsWith("x_")) return filterChipText(k.slice(2), v);
  if (k === "exw") return v;
  if (k === "status") return v === "_open" ? "미조치" : v === "_done" ? "완료(조치·확인)" : v;
  if (k === "vendorId") return v === "_none" ? "업체 미지정" : vLabel(v);
  if (k === "overdue") return "기한초과";
  if (k === "ho") return v + "호";
  if (k === "common") return v === "_any" ? "공용부·세대 외 전체" : v === "_bare" ? "공용부 미지정(동·층만)" : v;
  if (k === "turn") return vLabel(v);
  if (k === "chain") return "있는 하자";
  if (k === "mine") return "다음 공정 보낼 차례";
  if (k === "floor") return v === "_none" ? "층 미지정" : M.floorLabel(v);
  if (k === "text") return `“${v}”`;
  if (k === "core") return M.coreLabel(v);
  if (k === "from") return `${v}부터`;
  if (k === "to") return `${v}까지`;
  if (v === "_none") return { dong: "동 없음", trade: "공종 없음", type: "유형 없음", createdBy: "기록 없음", severity: "없음", category: "없음" }[k] || "없음";
  return v;
}
/** 1.2.4 목록 묶어 보기: 유형별·공종·업체별·위치(동)별. 묶음 순서는 다시 그려도 유지(보던 자리 유지) */
function listGroupsHtml(list, grp, sorted = false) {
  const keyOf = grp === "type" ? (d) => (d.type ? M.typeKey(d.type) : "")
    : grp === "core" ? (d) => M.coreKey(P(), d)
    : grp === "tv" ? (d) => `${d.trade ? M.tradeKey(d.trade) : ""}|${d.vendorId || ""}`
    : grp === "vendor" ? (d) => d.vendorId || "_none"
    : (d) => M.locParts(d).dong || (d.common ? "공용:" + d.common : d.locEtc ? "기타" : "");
  const m = new Map();
  for (const d of list) { const k = keyOf(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
  const label = (k, items) => {
    if (grp === "type") return k ? M.typeCounts(items)[0].name : "유형 없음";
    if (grp === "tv") { const d = items[0]; return `${d.trade || "공종 미지정"} · ${vName(d) || "업체 미지정"}`; }
    if (grp === "core") return M.coreLabel(k);
    if (grp === "vendor") return k === "_none" ? "업체 미지정" : vName(items[0]) || vLabel(k);
    return !k ? "위치 미지정" : k.startsWith("공용:") ? k.slice(3) : k;
  };
  const okey = `lg:${grp}:${sorted ? LS.get("listSort", {}).mode || "auto" : ""}`; S.grpOrder ||= new Map(); const prev = S.grpOrder.get(okey) || [];
  // 정렬을 골랐으면 정렬 순서대로(처음 나온 순), 아니면 건수 많은 순
  let keys = sorted ? [...m.keys()].sort((a, b) => (!a || a === "_none") - (!b || b === "_none")) : [...m.keys()].sort((a, b) => (!a || a === "_none") - (!b || b === "_none") || m.get(b).length - m.get(a).length || String(a).localeCompare(String(b), "ko"));
  if (navKind() === "re" || navKind() === "pop") keys = [...prev.filter((k) => m.has(k)), ...keys.filter((k) => !prev.includes(k))];
  S.grpOrder.set(okey, keys);
  let left = S.listLimit; S.lgTrunc = false; S.lgHid = 0;
  /* 1.2.8 모든 묶음: 펼치고 접기(이번 실행 동안 기억, 1.2.7 업체별과 같게). 처음엔 펼침 — 결과가 적거나(60건 이하) 필터·검색 중이거나 묶음이 6개 이하면.
   * 묶음이 하나뿐이면 늘 펼침. 접힌 묶음은 카드를 그리지 않고 ‘더 보기’ 개수에도 안 셈 */
  S.vgOpen ||= new Map(); const defOpen = keys.length <= 6 || list.length <= 60 || M.filterCount(S.filter || {}) > 0;
  const isOpen = (gk) => keys.length === 1 || (S.vgOpen.has(gk) ? S.vgOpen.get(gk) : defOpen);
  S.lgItems = new Map();
  const bar = keys.length > 1 ? `<div class="lg-bar" id="lg-bar"><span class="help">${grp === "vendor" ? `업체 ${n(keys.length)}곳` : `묶음 ${n(keys.length)}개`}</span><span class="sp"></span><button type="button" class="btn btn-sm" id="lg-openall">모두 펼치기</button><button type="button" class="btn btn-sm" id="lg-closeall">모두 접기</button></div>` : "";
  return bar + keys.map((k, gi) => {
    const items = m.get(k); const gk = `${grp}:${k}`; const op = isOpen(gk); const shown = op ? items.slice(0, Math.max(0, left)) : []; if (op) left -= shown.length; const lb = label(k, items);
    const hid = op ? items.length - shown.length : 0; if (hid) { S.lgTrunc = true; S.lgHid += hid; }
    S.lgItems.set(gk, items.map((d) => d.id)); const openN = items.filter(M.isOpen).length;
    return `<details class="lgrp vgrp" data-gk="${esc(gk)}" ${op ? "open" : ""}><summary class="grp-hd"><label class="gchk" title="이 묶음 전체 선택"><input type="checkbox" data-gall="@${esc(gk)}" aria-label="${esc(lb)} 전체 선택"><span>전체</span></label><div class="grp-tt"><b>${esc(lb)}</b> <span class="help">${n(items.length)}건 · 미조치 <b class="${openN ? "warn-t" : ""}">${n(openN)}</b></span></div></summary>
      ${shown.map((d) => defectCard(d, { sel: true })).join("")}${hid ? `<p class="help small lg-more">+${n(hid)}건은 아래 ‘더 보기’</p>` : ""}</details>`;
  }).join("");
}
/** 1.2.7 위치 칸 글자·값: v1 = 위치(d:동 / _none / c:단지 공용 공간), v2 = 세부 위치(f:층 / h:층|호 / c:동 공용부 / r:세부실) */
function locLabels(f) {
  const dongs = M.fArr(f.dong), floors = M.fArr(f.floor); const com = f.common && f.common !== "_any" && f.common !== "_bare" ? f.common : "";
  let v1 = "", l1 = "전체 위치", v2 = "", l2 = "전체", room3 = false, cs3 = false, v3 = "", l3 = "전체";
  const cores = M.fArr(f.core);
  if (dongs.length > 1) { v1 = "_multi"; l1 = `동 ${dongs.length}곳`; }
  else if (dongs[0] === "_none") { if (com) { v1 = "c:" + com; l1 = com; if (floors.length === 1) { v2 = "f:" + floors[0]; l2 = M.floorLabel(floors[0]); room3 = true; } else if (f.room) { v2 = "r:" + f.room; l2 = f.room; } } else { v1 = "_none"; l1 = "단지 공용"; } }
  else if (dongs[0] && cores.length === 1 && (cores[0] === "_none" || cores[0].startsWith(dongs[0] + "|"))) { v1 = "d:" + dongs[0]; l1 = dongs[0];
    /* 1.2.7 코어를 골랐으면 [세부 위치]=코어, 셋째 칸 = 그 코어의 층·호·공용부 */
    v2 = cores[0] === "_none" ? "k:_none" : "k:" + cores[0].split("|")[1]; l2 = cores[0] === "_none" ? "코어 미지정" : `${cores[0].split("|")[1]}코어`; cs3 = true;
    if (f.ho) { v3 = `h:${floors[0] || M.floorOfHo(f.ho)}|${f.ho}`; l3 = `${f.ho}호`; room3 = true; }
    else if (floors.length === 1) { v3 = "f:" + floors[0]; l3 = `${M.floorLabel(floors[0])} 전체`; room3 = true; }
    else if (com) { v3 = "c:" + com; l3 = com; room3 = true; } }
  else if (dongs[0]) { v1 = "d:" + dongs[0]; l1 = dongs[0];
    if (f.ho) { v2 = `h:${floors[0] || M.floorOfHo(f.ho)}|${f.ho}`; l2 = `${f.ho}호`; room3 = true; }
    else if (floors.length === 1) { v2 = "f:" + floors[0]; l2 = `${M.floorLabel(floors[0])} 전체`; room3 = true; }
    else if (floors.length > 1) { v2 = "_multi"; l2 = `층 ${floors.length}개`; }
    else if (com) { v2 = "c:" + com; l2 = com; room3 = true; } }
  else if (com) { v1 = "c:" + com; l1 = com; }
  else if (f.ho) { l1 = `${f.ho}호(모든 동)`; v1 = "_ho"; }
  if (f.room && !room3 && !v2.startsWith("r:")) { room3 = true; }
  return { v1, l1, v2, l2, room3, cs3, v3, l3 };
}
/** 1.2.7 펼침 목록(검색 가능): PC는 버튼 아래, 폰은 아래에서 올라옴. opts: [{v,label,n,sub}|{group}] */
function ddPick(btn, { title, opts, value, onPick, hint = "" }) {
  document.querySelector(".dd-pop")?.__close?.();
  const wide = window.innerWidth >= 700; const many = opts.filter((o) => !o.group).length > 10;
  const el = document.createElement("div"); el.className = "dd-pop" + (wide ? " wide" : " dd-sheet"); el.setAttribute("role", "dialog"); el.setAttribute("aria-label", title);
  el.innerHTML = `${wide ? "" : '<div class="dd-dim"></div>'}<div class="dd-box"><div class="dd-hd"><b>${esc(title)}</b><button type="button" class="dd-x" aria-label="닫기">✕</button></div>
    ${many ? `<input class="inp dd-q" type="search" placeholder="찾기 (예: 802, 휀룸)" aria-label="${esc(title)} 찾기">` : ""}
    <div class="dd-list" role="listbox">${opts.map((o) => (o.group ? `<div class="dd-grp">${esc(o.group)}</div>` : `<button type="button" class="dd-opt ${o.v === value ? "on" : ""}" role="option" aria-selected="${o.v === value}" data-v="${esc(o.v)}"${o.kw ? ` data-kw="${esc(o.kw)}"` : ""}><span>${esc(o.label)}${o.sub ? ` <small class="help">${esc(o.sub)}</small>` : ""}</span><small class="fn">${n(o.n || 0)}</small></button>`)).join("")}</div>
    ${hint ? `<p class="help small dd-hint">${esc(hint)}</p>` : ""}</div>`;
  document.body.appendChild(el);
  if (wide) { const r = btn.getBoundingClientRect(); const box = $(".dd-box", el); const w = Math.max(r.width, 280); box.style.width = w + "px"; box.style.left = Math.min(r.left, window.innerWidth - w - 8) + "px"; box.style.top = r.bottom + 4 + "px"; box.style.maxHeight = Math.max(240, window.innerHeight - r.bottom - 16) + "px"; }
  const close = () => { el.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc2, true); btn.focus?.(); };
  const outside = (e) => { if (!$(".dd-box", el).contains(e.target) && !btn.contains(e.target)) close(); };
  const esc2 = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  el.__close = close; setTimeout(() => document.addEventListener("pointerdown", outside, true), 0); document.addEventListener("keydown", esc2, true);
  $(".dd-x", el).addEventListener("click", close); $(".dd-dim", el)?.addEventListener("click", close);
  $$(".dd-opt", el).forEach((b) => b.addEventListener("click", () => { close(); onPick(b.dataset.v); }));
  const q = $(".dd-q", el); if (q) { if (wide) q.focus();
    q.addEventListener("input", () => { const t = M.sameKey(q.value); let lastG = null, shownInG = 0;
      const items = [...$(".dd-list", el).children]; for (const c of items) { if (c.classList.contains("dd-grp")) { if (lastG) lastG.hidden = !shownInG; lastG = c; shownInG = 0; continue; } const ok = !t || (M.sameKey(c.textContent + " " + (c.dataset.kw || "")).includes(t) || M.koMatch(c.querySelector("span")?.textContent || "", q.value)) || !c.dataset.v; c.hidden = !ok; if (ok) shownInG++; }
      if (lastG) lastG.hidden = !shownInG; }); }
  $(".dd-opt.on", el)?.scrollIntoView({ block: "nearest" });
  window.__ddOpen = title; return el;
}
/** 1.3.0 단지 공용 장소 목록: 현장 설정(단지 공용) + 도면 장소 + 데이터에 있는 이름 */
function sitePlaces(p = P()) { if (!p) return []; return [...new Set([...(p.commons?.length ? p.commons : M.DEFAULT_COMMONS), ...M.placesWithPlans(p, S.plans)])].filter((c) => !/코어|옥상|외벽/.test(c)); }
const SITE_ALIAS = [[/지하주차장|주차/, "지하·B1·B2·주차"], [/부대|커뮤니티/, "부대·커뮤니티·주민공동"], [/관리/, "관리동·관리사무소"], [/경비/, "경비실"], [/근린|상가/, "근린·상가"], [/조경|놀이터/, "조경·놀이터·옥외"], [/외부|옥외/, "옥외·단지 외부"]];
function siteAlias(name) { const a = SITE_ALIAS.find(([re]) => re.test(name)); return a ? a[1] : ""; }
/** 데이터에 있는 단지 공용 이름(건수 많은 순) */
function dataSites() { const m = new Map(); for (const d of PD()) { const c = M.locParts(d).site; if (c) m.set(c, (m.get(c) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 40); }
/** 도면에서 찾은 그 장소의 세부 위치(실) */
function placeRooms(place, p = P()) { try { return [...new Set(M.placeSpots(p, S.plans, place).flatMap((x) => x.spots.map((r) => r.name)))].slice(0, 80); } catch { return []; } }
/** 1.2.6 위치 검색 색인(현장·건수 바뀔 때만 다시 만듦) */
function locIndex() {
  const all = PD(); const key = `${S.pid}|${all.length}|${all[0]?.id}|${all.at(-1)?.id}`;
  if (!S.locIdx || S.locIdx.key !== key) { const t = performance.now(); const idx = M.buildLocIndex(all); for (const c of sitePlaces()) if (!idx.some((e) => e.key === `c|${c}`)) idx.push({ key: `c|${c}`, label: c, sub: "단지 공용", f: { dong: ["_none"], common: c }, lv: 1, n: 0, norm: M.sameKey(`${c} ${siteAlias(c)}`) }); for (const e of idx) if (e.key.startsWith("c|") && !e.alias) { e.alias = 1; e.norm = M.sameKey(`${e.label} ${siteAlias(e.label)}`); } S.locIdx = { key, idx }; window.__locIdxMs = Math.round(performance.now() - t); }
  return S.locIdx.idx;
}
ROUTES.list = async () => {
  setTab("list");
  setHeader("하자 목록", { backBtn: navDepth() > 1 });
  /* 1.2.8 관리 탭: [전체] [중점관리 n] … — 고른 탭 안에서 필터·정렬·묶음·보내기 그대로 */
  const allP = PD(); const tabs = TABS(); let ltab = LS.get("listTab", ""); if (ltab && !tabs.some((t) => t.id === ltab)) { ltab = ""; LS.set("listTab", ""); }
  const f = S.filter; const all = ltab ? allP.filter((d) => M.inTab(d, ltab)) : allP;
  /* 1.2.5 정렬(기억) — 위치·코어 묶음에서 ‘기본’이면 안에서 층·호 순 */
  const grp = LS.get("listGroup", ""); const srt = { mode: "", dir: "", ...LS.get("listSort", {}) };
  const effMode = srt.mode || (grp === "core" ? "core" : grp === "loc" ? "loc" : ""); const effDir = srt.dir || M.sortDefaultDir(effMode);
  M.setCoreProject(P());
  const list = M.sortList(M.applyFilter(all, f, { vendorName: vName }), effMode, effDir);
  const exGone = M.hasEx(f) ? M.applyFilter(all, M.stripEx(f), { vendorName: vName }).length - list.length : 0; // 1.3.3 제외로 빠진 건수
  /* 1.2.4 유형 칩(건수: 유형 조건만 뺀 목록 기준) + 묶어 보기 */
  const tcs = M.typeCounts(M.applyFilter(all, { ...f, type: [] }, { vendorName: vName })); const fTypes = M.fArr(f.type);
  const tOn = (t) => fTypes.some((v) => (t.key ? M.sameType(v, t.name) || v === t.name : v === "_none"));
  const typeLabel = !fTypes.length ? "유형 전체" : fTypes.length > 1 ? `유형 ${fTypes.length}개` : fTypes[0] === "_none" ? "유형 없음" : (tcs.find((t) => t.key && M.sameType(t.name, fTypes[0]))?.name || fTypes[0]);
  const chips = activeChips(f);
  /* 1.2.6 위치 바로 고르기 */
  const fNoLoc = Object.fromEntries(Object.entries(f).filter(([k]) => !M.LOC_KEYS.includes(k)));
  /* 1.2.7 코어별로 볼 때: 코어 안 정한 동 공용부(방풍실·계단실 등) 바로 지정 */
  const coreFix = grp === "core" || srt.mode === "core" ? list.filter((d) => { const lp = M.locParts(d); return lp.dong && lp.line == null && !lp.core; }) : [];
  const lb = locLabels(f); const locBase = () => M.applyFilter(all, fNoLoc, { vendorName: vName });
  view().innerHTML = `
    <div class="ltabs" id="ltabs" role="tablist" aria-label="관리 탭"><button type="button" class="ltab ${ltab ? "" : "on"}" role="tab" aria-selected="${!ltab}" data-ltab="">전체 <small>${n(allP.length)}</small></button>${tabs.map((t) => `<button type="button" class="ltab ${ltab === t.id ? "on" : ""}" role="tab" aria-selected="${ltab === t.id}" data-ltab="${esc(t.id)}">★ ${esc(t.name)} <small>${n(tabCount(t.id))}</small></button>`).join("")}<button type="button" class="ltab ltab-cfg" id="ltab-cfg" aria-label="관리 탭 설정" title="탭 만들기·이름·순서">⚙</button></div>
    <form class="search ls-form" id="lsearch" role="search" autocomplete="off"><input class="inp" id="ls" type="search" value="${esc(f.text || "")}" placeholder="검색 · 312-802 · 지하주차장 휀룸" aria-label="목록 검색(위치도 돼요)" aria-autocomplete="list" aria-controls="ls-sugg"><div class="ls-sugg" id="ls-sugg" role="listbox" hidden></div>
      <button type="button" class="btn" id="btn-filter">필터${M.filterCount(f) ? ` <b class="badge">${M.filterCount(f)}</b>` : ""}</button></form>
    ${presetRowHtml("list")}
    <div class="chips scroll">${chips || '<span class="help">필터 없음 · 전체</span>'}${chips ? '<button type="button" class="chip" data-rm="_all">모두 지우기</button>' : ""}</div>
    <div class="loc-row" id="loc-row">
      <button type="button" class="dd-btn ${lb.v1 ? "on" : ""}" id="dd-loc" aria-haspopup="listbox"><small>위치</small><b>${esc(lb.l1)}</b></button>
      <button type="button" class="dd-btn ${lb.v2 ? "on" : ""}" id="dd-sub" aria-haspopup="listbox" ${lb.v1 && lb.v1 !== "_none" ? "" : "disabled"}><small>세부 위치</small><b>${esc(lb.l2)}</b></button>
      ${lb.cs3 ? `<button type="button" class="dd-btn ${lb.v3 ? "on" : ""}" id="dd-cs" aria-haspopup="listbox"><small>층·호·공용부</small><b>${esc(lb.l3)}</b></button>` : ""}
      ${lb.room3 ? `<button type="button" class="dd-btn ${f.room ? "on" : ""}" id="dd-room" aria-haspopup="listbox"><small>실</small><b>${esc(f.room || "전체")}</b></button>` : ""}
      <button type="button" class="dd-btn ${fTypes.length ? "on" : ""}" id="dd-type" aria-haspopup="listbox"><small>유형</small><b>${esc(typeLabel)}</b></button>
    </div>
    <div class="list-ctl" id="list-ctl"><select class="inp inp-sm" id="lgroup" aria-label="묶어 보기">${[["", "묶음 없음"], ["type", "유형별"], ["vendor", "업체별"], ["tv", "공종·업체별"], ["loc", "위치(동)별"], ["core", "코어별"]].map(([v, t]) => `<option value="${v}" ${grp === v ? "selected" : ""}>${t}</option>`).join("")}</select><button type="button" class="btn btn-sm tg-done ${f.hideDone ? "on" : ""}" id="btn-hidedone" aria-pressed="${!!f.hideDone}" title="조치완료·확인완료 건 숨기기">${f.hideDone ? "✓ " : ""}완료 건 숨기기</button><select class="inp inp-sm" id="lsort" aria-label="정렬">${M.SORTS.map(([v, t]) => `<option value="${v}" ${srt.mode === v ? "selected" : ""}>↕ ${t}</option>`).join("")}</select>${effMode ? `<button type="button" class="btn btn-sm" id="lsdir" aria-label="정렬 방향" data-dir="${effDir}">${effDir === "desc" ? "↓ 내림" : "↑ 오름"}</button>` : ""}</div>
    <div class="list-hd"><b class="res-n" id="res-n">${M.filterCount(f) ? "검색 결과 " : ""}${n(list.length)}건</b>${M.hasEx(f) ? `<span class="ex-gone" id="res-ex">제외 −${n(exGone)}</span>` : ""}<span class="help">기한초과 ${n(list.filter((d) => M.isOverdue(d)).length)}</span>
      <span class="sp"></span><button type="button" class="btn btn-sm" id="btn-agg">📊 집계</button><button type="button" class="btn btn-sm" id="btn-export">내보내기</button><button type="button" class="btn btn-sm btn-primary" id="btn-sendlist">업체에 보내기</button></div>
    ${coreFix.length ? `<div class="lg-bar core-fix"><span class="help">코어 미지정 동 공용부 <b>${n(coreFix.length)}</b>건</span><span class="sp"></span><button type="button" class="btn btn-sm" id="core-fix">코어 지정</button></div>` : ""}
    <div id="cards">${list.length ? (grp ? listGroupsHtml(list, grp, !!effMode) : list.slice(0, S.listLimit).map((d) => defectCard(d, { sel: true })).join("")) : `<div class="card empty-card"><p>조건에 맞는 하자가 없어요.</p></div>`}</div>
    ${(grp ? S.lgTrunc : list.length > S.listLimit) ? `<button type="button" class="btn btn-block" id="btn-more">더 보기 (${n(grp ? S.lgHid : list.length - S.listLimit)}건 남음)</button>` : ""}
    ${selBarHtml({ all: true, core: true })}`;
  bindCards(); syncChecks(); bindSelBar(list);
  /* 1.2.7 위치 고르기: [위치 ▾] → [세부 위치 ▾] (→ [실 ▾]) · 고르면 바로 걸림 · 목록이 길면 안에서 검색 */
  const setLoc = (patch, from) => { const nf = { ...S.filter }; const order = ["dong", "core", "floor", "ho", "common", "room"];
    for (const k of order.slice(order.indexOf(from))) delete nf[k]; Object.assign(nf, patch);
    S.filter = nf; LS.set("filter", nf); S.listLimit = 60; S.noRestore = true; rerender(); };
  $("#dd-loc").addEventListener("click", (e) => { const base = locBase(); const dong = new Map(), com = new Map(); let nc = 0;
    for (const d of base) { const lp = M.locParts(d); const dg = lp.dong; if (dg) dong.set(dg, (dong.get(dg) || 0) + 1); else { nc++; const c = lp.site; if (c) com.set(c, (com.get(c) || 0) + 1); } }
    const dn = (x) => Number((x.match(/\d+/) || [])[0]) || 1e9;
    /* 1.3.0 단지 공용(지하주차장·부대시설 등)을 동 목록 위에 — 하자가 없어도 현장의 공용 장소는 0건으로 보여 줌 */
    const places = sitePlaces(); for (const c of places) if (!com.has(c)) com.set(c, 0);
    const pOrd = (k) => { const i = places.indexOf(k); return i < 0 ? 1e6 : i; };
    ddPick(e.currentTarget, { title: "위치", value: lb.v1, opts: [{ v: "", label: "전체 위치", n: base.length },
      { group: "단지 공용" }, { v: "_none", label: "단지 공용 전체", n: nc }, ...[...com.entries()].sort((a, b) => (b[1] > 0) - (a[1] > 0) || b[1] - a[1] || pOrd(a[0]) - pOrd(b[0])).map(([k, c]) => ({ v: "c:" + k, label: k, n: c, kw: siteAlias(k) })),
      ...(dong.size ? [{ group: "동" }] : []), ...[...dong.entries()].sort((a, b) => dn(a[0]) - dn(b[0]) || a[0].localeCompare(b[0], "ko")).map(([k, c]) => ({ v: "d:" + k, label: k, n: c }))],
      onPick: (v) => (!v ? setLoc({}, "dong") : v === "_none" ? setLoc({ dong: ["_none"] }, "dong") : v.startsWith("d:") ? setLoc({ dong: [v.slice(2)] }, "dong") : setLoc({ dong: ["_none"], common: v.slice(2) }, "dong")) }); });
  /** 층·호(층별로 묶음)·동 공용부 고르기 목록 */
  const hoOpts = (cur, allLabel) => { const fl = new Map(), cm = new Map();
    for (const d of cur) { const lp = M.locParts(d); if (lp.floor) { const x = fl.get(lp.floor) || { n: 0, hos: new Map() }; x.n++; if (lp.ho) x.hos.set(lp.ho, (x.hos.get(lp.ho) || 0) + 1); fl.set(lp.floor, x); } if (!lp.ho && d.common) cm.set(d.common, (cm.get(d.common) || 0) + 1); }
    const fnum = (x) => (/^B(\d+)$/i.test(x) ? -Number(x.slice(1)) : x === "옥상" ? 999 : Number(x) || 0);
    const opts = [{ v: "", label: allLabel, n: cur.length }];
    for (const [k, x] of [...fl.entries()].sort((a, b) => fnum(a[0]) - fnum(b[0]))) { opts.push({ group: M.floorLabel(k) }, { v: "f:" + k, label: `${M.floorLabel(k)} 전체`, n: x.n }); for (const [h, c] of [...x.hos.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) opts.push({ v: `h:${k}|${h}`, label: `${h}호`, n: c, sub: M.floorLabel(k) }); }
    if (cm.size) { opts.push({ group: "동 공용부" }); for (const [k, c] of [...cm.entries()].sort((a, b) => b[1] - a[1])) opts.push({ v: "c:" + k, label: k, n: c }); }
    return opts; };
  const pickHo = (v, from) => (!v ? setLoc({}, from) : v.startsWith("f:") ? setLoc({ floor: [v.slice(2)] }, from) : v.startsWith("h:") ? setLoc({ floor: [v.slice(2).split("|")[0]], ho: v.split("|")[1] }, from) : setLoc({ common: v.slice(2) }, from));
  $("#dd-sub").addEventListener("click", (e) => { const cur = M.applyFilter(locBase(), { dong: M.fArr(f.dong), common: lb.v1.startsWith("c:") ? f.common : "" });
    if (lb.v1.startsWith("c:")) { const rm = new Map(), fl = new Map(); for (const d of cur) { const r = M.roomOf(d); if (r) rm.set(r, (rm.get(r) || 0) + 1); const fx = M.locParts(d).floor; if (fx) fl.set(fx, (fl.get(fx) || 0) + 1); }
      /* 1.3.0 단지 공용: 층(B1·B2…) → 세부실(도면 세부 위치·실) */
      const fnum = (x) => (/^B(\d+)$/i.test(x) ? -Number(x.slice(1)) : Number(x) || 0);
      for (const r of placeRooms(f.common)) if (!rm.has(r)) rm.set(r, 0);
      return ddPick(e.currentTarget, { title: `${f.common} 세부 위치`, value: lb.v2, opts: [{ v: "", label: "전체", n: cur.length }, ...(fl.size ? [{ group: "층" }, ...[...fl.entries()].sort((a, b) => fnum(a[0]) - fnum(b[0])).map(([k, c]) => ({ v: "f:" + k, label: M.floorLabel(k), n: c }))] : []),
        ...(rm.size ? [{ group: "세부실" }] : []), ...[...rm.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).map(([k, c]) => ({ v: "r:" + k, label: k, n: c }))],
        onPick: (v) => (!v ? setLoc({ dong: ["_none"], common: f.common }, "dong") : v.startsWith("f:") ? setLoc({ dong: ["_none"], floor: [v.slice(2)], common: f.common }, "floor") : setLoc({ room: v.slice(2) }, "room")) }); }
    /* 1.2.7 동 → 코어(호는 라인으로, 공용부는 지정한 코어) 또는 층·호 */
    const dong = M.fArr(f.dong)[0]; const kc = new Map(); for (const d of cur) { const c = M.coreOf(P(), d) || 0; kc.set(c, (kc.get(c) || 0) + 1); }
    const kOpts = [...kc.keys()].filter(Boolean).sort((a, b) => a - b).map((c) => ({ v: "k:" + c, label: `${c}코어`, n: kc.get(c) }));
    const opts = hoOpts(cur, `${lb.l1} 전체`); if (kOpts.length) opts.splice(1, 0, { group: "코어" }, ...kOpts, ...(kc.get(0) ? [{ v: "k:_none", label: "코어 미지정", n: kc.get(0) }] : []));
    ddPick(e.currentTarget, { title: `${lb.l1} 코어·층·호`, value: lb.v2, opts, onPick: (v) => (v.startsWith("k:") ? setLoc({ core: [v === "k:_none" ? "_none" : `${dong}|${v.slice(2)}`] }, "core") : pickHo(v, "core")) }); });
  $("#dd-cs")?.addEventListener("click", (e) => { const cur = M.applyFilter(locBase(), { dong: M.fArr(f.dong), core: M.fArr(f.core) });
    ddPick(e.currentTarget, { title: `${lb.l1} ${lb.l2} 층·호·공용부`, value: lb.v3, opts: hoOpts(cur, `${lb.l2} 전체`), onPick: (v) => pickHo(v, "floor") }); });
  $("#dd-room")?.addEventListener("click", (e) => { const cur = M.applyFilter(locBase(), { dong: M.fArr(f.dong), core: M.fArr(f.core), floor: M.fArr(f.floor), ho: f.ho || "", common: f.common || "" }); const rm = new Map(); for (const d of cur) { const r = M.roomOf(d); if (r) rm.set(r, (rm.get(r) || 0) + 1); }
    ddPick(e.currentTarget, { title: "실", value: f.room || "", opts: [{ v: "", label: "전체", n: cur.length }, ...[...rm.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).map(([k, c]) => ({ v: k, label: k, n: c }))], onPick: (v) => setLoc(v ? { room: v } : {}, "room") }); });
  $("#dd-type").addEventListener("click", (e) => { const tot = tcs.reduce((a, t) => a + t.n, 0);
    ddPick(e.currentTarget, { title: "유형", value: fTypes.length === 1 ? fTypes[0] : fTypes.length ? "_multi" : "", opts: [{ v: "", label: "유형 전체", n: tot }, ...tcs.map((t) => ({ v: t.key ? t.name : "_none", label: t.key ? t.name : "유형 없음", n: t.n }))],
      hint: "여러 유형을 함께 보려면 필터에서 골라요", onPick: (v) => { if (v) S.filter.type = [v]; else delete S.filter.type; LS.set("filter", S.filter); S.listLimit = 60; S.noRestore = true; rerender(); } }); });
  /* 위치 검색: 312-802 · 312동 802 · 802호 · 휀룸 · 지하주차장 휀룸 → 위치 고르기 (색인 미리 만들어 두고 입력은 잠깐 기다렸다가) */
  const lsI = $("#ls"), sg = $("#ls-sugg"); let sgT = 0, sgList = [], sgAct = -1;
  const applySugg = (e) => { const nf = { ...S.filter }; for (const k of M.LOC_KEYS) delete nf[k]; delete nf.text; Object.assign(nf, JSON.parse(JSON.stringify(e.f))); S.filter = nf; LS.set("filter", nf); S.listLimit = 60; S.noRestore = true; rerender(); };
  const drawSugg = () => { const q = lsI.value.trim(); sgList = q ? M.searchLoc(locIndex(), q, 8) : []; sgAct = -1;
    sg.hidden = !sgList.length; sg.innerHTML = sgList.map((e, i) => `<button type="button" class="ls-opt" role="option" data-si="${i}"><span>📍 <b>${esc(e.label)}</b>${e.sub ? ` <small class="help">${esc(e.sub)}</small>` : ""}</span><small class="cnt">${n(e.n)}건</small></button>`).join("");
    $$("[data-si]", sg).forEach((b) => b.addEventListener("mousedown", (ev) => { ev.preventDefault(); applySugg(sgList[+b.dataset.si]); })); window.__suggN = (window.__suggN || 0) + 1; };
  lsI.addEventListener("input", () => { clearTimeout(sgT); sgT = setTimeout(drawSugg, 120); });
  lsI.addEventListener("focus", () => { if (lsI.value.trim()) drawSugg(); });
  lsI.addEventListener("blur", () => setTimeout(() => { sg.hidden = true; }, 150));
  lsI.addEventListener("keydown", (e) => { if (sg.hidden || !sgList.length) return; if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sgAct = (sgAct + (e.key === "ArrowDown" ? 1 : -1) + sgList.length) % sgList.length; $$(".ls-opt", sg).forEach((b, i) => b.classList.toggle("act", i === sgAct)); } else if (e.key === "Escape") sg.hidden = true; });
  $("#lsearch").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(sgT); const q = lsI.value.trim();
    const hits = q ? M.searchLoc(locIndex(), q, 8) : []; const pick = sgAct >= 0 && !sg.hidden ? sgList[sgAct] : hits[0] && (M.parseLocQuery(q) || hits[0].norm === M.sameKey(q)) ? hits[0] : null;
    if (pick) return applySugg(pick);
    S.filter = { ...S.filter, text: q }; LS.set("filter", S.filter); S.noRestore = true; rerender(); });
  bindPresetRow(view());
  $("#btn-filter").addEventListener("click", () => filterSheet({ prefill: true })); // 1.2.9 목록 ‘필터’는 지금 걸린 조건 그대로(건수 찾기는 초기화)
  $$("[data-fopen]", view()).forEach((b) => b.addEventListener("click", () => filterSheet({ prefill: true, focus: b.dataset.fopen })));
  $$("[data-ltab]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("listTab", b.dataset.ltab); S.listLimit = 60; S.select.clear(); S.noRestore = true; rerender(); }));
  $("#ltab-cfg").addEventListener("click", () => tabManager());
  $("#core-fix")?.addEventListener("click", () => coreAssign(coreFix));
  $$("[data-rm]", view()).forEach((b) => b.addEventListener("click", () => { const k = b.dataset.rm; if (k === "_all") S.filter = {}; else if (b.dataset.rv != null && Array.isArray(S.filter[k])) { S.filter[k] = S.filter[k].filter((x) => x !== b.dataset.rv); if (!S.filter[k].length) delete S.filter[k]; } else delete S.filter[k]; LS.set("filter", S.filter); S.noRestore = true; rerender(); }));
  $("#btn-more")?.addEventListener("click", () => { S.listLimit += 120; rerender(); });
  $("#lgroup").addEventListener("change", (e) => { LS.set("listGroup", e.target.value); S.noRestore = true; rerender(); });
  $("#lsort").addEventListener("change", (e) => { LS.set("listSort", { mode: e.target.value, dir: M.sortDefaultDir(e.target.value) }); S.noRestore = true; rerender(); });
  $("#lsdir")?.addEventListener("click", () => { LS.set("listSort", { mode: srt.mode || effMode, dir: effDir === "desc" ? "asc" : "desc" }); S.noRestore = true; rerender(); });
  $$("details.vgrp", view()).forEach((dd) => dd.addEventListener("toggle", () => { if (dd.open === (dd.dataset.wasOpen === "1")) return; dd.dataset.wasOpen = dd.open ? "1" : "0"; S.vgOpen.set(dd.dataset.gk, dd.open); if ((dd.open && !dd.querySelector(".dcard")) || (!dd.open && S.lgTrunc)) rerender(); }));
  $$("details.vgrp", view()).forEach((dd) => { dd.dataset.wasOpen = dd.open ? "1" : "0"; });
  const vgAll = (op) => { for (const dd of $$("details.vgrp", view())) S.vgOpen.set(dd.dataset.gk, op); rerender(); };
  $("#lg-openall")?.addEventListener("click", () => vgAll(true)); $("#lg-closeall")?.addEventListener("click", () => vgAll(false));
  $$("[data-gall]", view()).forEach((g) => g.addEventListener("change", () => { const ids = gallIds(g); for (const x of ids) S.select[g.checked ? "add" : "delete"](x); syncChecks(); }));
  $("#btn-export").addEventListener("click", () => exportSheet(list, "하자목록"));
  $("#btn-hidedone").addEventListener("click", () => { const nf = { ...S.filter }; if (nf.hideDone) delete nf.hideDone; else nf.hideDone = true; S.filter = nf; LS.set("filter", nf); S.listLimit = 60; S.noRestore = true; rerender(); });
  $("#btn-agg").addEventListener("click", () => aggSheet(list));
  if (S.openFilter) { S.openFilter = false; setTimeout(() => filterSheet(), 50); }
  $("#btn-sendlist").addEventListener("click", () => sendSheet({ items: list }));
};
/** 필터 칩(여러 값이면 값마다 칩) */
function activeChips(f, { collapse = 3 } = {}) {
  return Object.entries(f).flatMap(([k, v]) => {
    if (!v || (Array.isArray(v) && !v.length)) return [];
    if (k === "hideDone") return [`<button type="button" class="chip on ex" data-rm="hideDone" aria-label="완료 숨김 끄기">완료 숨김 ✕</button>`];
    /* 1.2.9 한 항목에 4개 이상이면 칩 하나로(누르면 필터 패널의 그 항목, ✕는 그 항목 모두 지우기) */
    if (Array.isArray(v) && collapse && v.length > collapse) { const ex = k === "exw" || k.startsWith("x_"); const lb = FILTER_LABEL[k] || k;
      return [`<span class="chip on cgrp ${ex ? "ex" : ""}"><button type="button" class="cg-open" data-fopen="${k}" title="${esc(v.map((x) => filterChipText(k, x)).join(", "))}">${esc(lb)} ${n(v.length)}개</button><button type="button" class="cg-x" data-rm="${k}" aria-label="${esc(lb)} 조건 모두 지우기">✕</button></span>`]; }
    if (Array.isArray(v)) return v.map((x) => `<button type="button" class="chip on ${k === "exw" || k.startsWith("x_") ? "ex" : ""}" data-rm="${k}" data-rv="${esc(x)}">${esc(FILTER_LABEL[k] || k)}: ${esc(filterChipText(k, x))} ✕</button>`);
    return [`<button type="button" class="chip on" data-rm="${k}">${esc(FILTER_LABEL[k] || k)}: ${esc(filterChipText(k, v))} ✕</button>`];
  }).join("");
}
/** 1.2.4 필터 패널: 항목마다 여러 개 고르기 + 실시간 건수(그 항목만 뺀 나머지 조건 기준) · 항목끼리는 그리고 */
function facetOptions(p, all) {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const tradeNames = []; for (const t of uniq([...p.trades.map((t) => t.name), ...all.map((d) => d.trade)])) if (!tradeNames.some((x) => M.sameTrade(x, t))) tradeNames.push(t);
  const typeNames = M.typeCounts(all).filter((t) => t.key).map((t) => t.name);
  const floors = uniq(all.map((d) => d.floor || M.floorOfHo(d.ho))).sort((a, b) => (Number(b) || -99) - (Number(a) || -99));
  const dongs = uniq([...p.dongs.map((d) => d.name), ...all.map((d) => d.dong)]);
  const vids = new Set(all.map((d) => d.vendorId).filter(Boolean)); const vendors = S.vendors.filter((v) => vids.has(v.id) || !v.projectIds?.length || v.projectIds.includes(p.id));
  const by = uniq(all.map((d) => d.createdBy));
  return [
    { k: "status", t: "상태", o: [["_open", "미조치 전체"], ["_done", "완료(조치·확인)"], ...M.STATUSES.map((x) => [x, x])] },
    { k: "vendorId", t: "업체", o: [...vendors.map((v) => [v.id, v.name]), ["_none", "업체 미지정"]] },
    { k: "dong", t: "동", o: [...dongs.map((x) => [x, x]), ...(all.some((d) => !d.dong) ? [["_none", "동 없음(단지 공용 등)"]] : [])] },
    { k: "floor", t: "층", o: [...floors.map((x) => [x, M.floorLabel(x)]), ...(all.some((d) => !(d.floor || d.ho)) ? [["_none", "층 미지정"]] : [])], fold: true },
    { k: "core", t: "코어", o: (() => { M.setCoreProject(p); const ks = [...new Set(M.sortList(all, "core", "asc", p).map((d) => M.coreKey(p, d)))]; return [...ks.filter((k) => k !== "_none"), ...(ks.includes("_none") ? ["_none"] : [])].map((k) => [k, M.coreLabel(k)]); })(), fold: true },
    { k: "trade", t: "공종", o: tradeNames.map((x) => [x, x]) },
    { k: "type", t: "유형", o: [...typeNames.map((x) => [x, x]), ...(all.some((d) => !d.type) ? [["_none", "유형 없음"]] : [])] },
    { k: "severity", t: "중요도", o: M.SEVERITIES.map((x) => [x, x]) },
    { k: "category", t: "구분", o: uniq([...M.catsOf(p), ...all.map((d) => d.category)]).map((x) => [x, x]), fold: true },
    ...(by.length ? [{ k: "createdBy", t: "등록자", o: [...by.map((x) => [x, x]), ...(all.some((d) => !d.createdBy) ? [["_none", "기록 없음"]] : [])] }] : []),
  ];
}
/* ---------- 1.3.0 저장된 조건(필터 프리셋): 이 기기 · 현장별(동기화 안 함) ---------- */
const PRESET_K = () => `filterPresets:${S.pid || ""}`;
function presets() { const a = LS.get(PRESET_K(), []); return Array.isArray(a) ? a : []; }
function savePresets(a) { LS.set(PRESET_K(), a); }
const presetSub = (pz) => { const k = M.filterCount(pz.f || {}); return `조건 ${k}개${pz.sort || pz.group != null ? " · 정렬·묶음" : ""}`; };
function presetRowHtml(where) {
  const a = presets(); if (!a.length && where === "list") return "";
  return `<div class="pz-row" data-pzrow="${where}" role="toolbar" aria-label="저장된 조건"><span class="pz-lbl">🔖 저장된 조건</span><div class="chips scroll pz-chips">${a.map((pz) => `<span class="pz"><button type="button" class="chip pchip ${where === "list" && presetActive(pz) ? "on" : ""}" data-pz="${esc(pz.id)}" title="${esc(presetSub(pz))}">${esc(pz.name)}</button><button type="button" class="pz-more" data-pzm="${esc(pz.id)}" aria-label="${esc(pz.name)} 관리">⋯</button></span>`).join("") || '<span class="help small">아직 없어요 · 아래 ‘조건 저장’으로 지금 조건을 저장해요</span>'}</div></div>`;
}
const normF = (f) => JSON.stringify(Object.fromEntries(Object.entries(f || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)).sort((a, b) => a[0].localeCompare(b[0]))));
const presetActive = (pz) => normF(pz.f) === normF(S.filter);
/** 저장된 조건 적용: 필터(+저장했으면 정렬·묶음)를 그대로 → 목록 */
async function applyPreset(id, sheet = null) {
  const pz = presets().find((x) => x.id === id); if (!pz) return;
  S.filter = JSON.parse(JSON.stringify(pz.f || {})); LS.set("filter", S.filter);
  if (pz.sort) LS.set("listSort", pz.sort); if (pz.group != null) LS.set("listGroup", pz.group);
  S.listLimit = 60; S.noRestore = true; window.__presetApplied = pz.name;
  if (sheet) await sheet.close();
  if (location.hash.split("?")[0] !== "#/list") go("#/list"); else rerender();
  toast(`‘${pz.name}’ 조건을 걸었어요`);
}
/** 이름 + (정렬·묶음 포함) 묻기 */
function presetNameSheet({ title, name = "", withSort = false, showSort = true, ok = "저장" }) {
  return new Promise((resolve) => {
    let val = null;
    const s = openSheet({ title, cls: "dialog pz-sheet", html: `<label class="fld"><span>이름</span><input class="inp" id="pz-name" maxlength="20" value="${esc(name)}" placeholder="예: 코킹 빼고 미조치"></label>
      ${showSort ? `<label class="check"><input type="checkbox" id="pz-sort" ${withSort ? "checked" : ""}> 정렬·묶어 보기도 함께 저장</label>` : ""}<p class="fs-err help small"></p>`,
      footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="yes">${esc(ok)}</button>` });
    const inp = $("#pz-name", s.el); setTimeout(() => inp.focus(), 50); s.onClose = () => resolve(val);
    const yes = () => { const v = inp.value.trim().slice(0, 20); if (!v) { $(".fs-err", s.el).textContent = "이름을 넣어 주세요"; return; } val = { name: v, withSort: !!$("#pz-sort", s.el)?.checked }; s.close(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") yes(); });
    $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", () => (b.dataset.a === "yes" ? yes() : s.close())));
  });
}
const curSortGroup = () => ({ sort: { mode: "", dir: "", ...LS.get("listSort", {}) }, group: LS.get("listGroup", "") });
/** 지금 조건(f) 저장. 같은 이름이면 덮어쓸지 물음 */
async function savePresetFlow(f) {
  if (!M.filterCount(f) && !f.text) { toast("저장할 조건이 없어요 · 먼저 조건을 골라요"); return null; }
  const r = await presetNameSheet({ title: "조건 저장" }); if (!r) return null;
  const a = presets(); const same = a.find((x) => x.name === r.name);
  if (same && !(await ask(`‘${r.name}’이(가) 이미 있어요. 지금 조건으로 덮어쓸까요?`, { ok: "덮어쓰기" }))) return null;
  const sg = r.withSort ? curSortGroup() : {};
  const pz = { id: same?.id || M.uid("pz"), name: r.name, f: JSON.parse(JSON.stringify(f)), ...sg, at: new Date().toISOString() };
  savePresets(same ? a.map((x) => (x.id === same.id ? pz : x)) : [...a, pz]); toast(`‘${r.name}’ 저장했어요`); return pz;
}
/** ⋯ / 길게 누르기: 적용 · 이름 바꾸기 · 지금 조건으로 덮어쓰기 · 순서 · 삭제. cur = 지금 조건(패널이면 패널 조건) */
async function presetMenu(id, cur, sheet = null) {
  const a = presets(); const i = a.findIndex((x) => x.id === id); if (i < 0) return false; const pz = a[i];
  const k = await choose(`🔖 ${pz.name} · ${presetSub(pz)}`, [{ icon: "✅", label: "적용", value: "apply" }, { icon: "✏️", label: "이름 바꾸기", value: "ren" }, { icon: "💾", label: "지금 조건으로 덮어쓰기", sub: `지금 조건 ${M.filterCount(cur)}개`, value: "over" },
    ...(i > 0 ? [{ icon: "⬅️", label: "앞으로", value: "up" }] : []), ...(i < a.length - 1 ? [{ icon: "➡️", label: "뒤로", value: "down" }] : []), { icon: "🗑", label: "삭제", value: "del" }]);
  if (!k) return false;
  if (k === "apply") { await applyPreset(id, sheet); return false; }
  if (k === "ren") { const r = await presetNameSheet({ title: "이름 바꾸기", name: pz.name, showSort: false, ok: "바꾸기" }); if (!r) return false; pz.name = r.name; }
  if (k === "over") { if (!(await ask(`‘${pz.name}’을(를) 지금 조건으로 덮어쓸까요?`, { ok: "덮어쓰기" }))) return false; pz.f = JSON.parse(JSON.stringify(cur)); if (pz.sort || pz.group != null) Object.assign(pz, curSortGroup()); pz.at = new Date().toISOString(); toast("덮어썼어요"); }
  if (k === "up" || k === "down") { const j = k === "up" ? i - 1 : i + 1; [a[i], a[j]] = [a[j], a[i]]; }
  if (k === "del") { if (!(await ask(`‘${pz.name}’ 저장된 조건을 지울까요? (하자는 그대로예요)`, { ok: "삭제", danger: true }))) return false; a.splice(i, 1); toast("지웠어요"); }
  savePresets(a); return true;
}
/** 저장된 조건 줄 연결(목록·패널 공용) */
function bindPresetRow(root, { cur = () => S.filter, sheet = null, onChange = () => rerender() } = {}) {
  const row = $(".pz-row", root); if (!row) return;
  $$("[data-pz]", row).forEach((b) => b.addEventListener("click", () => applyPreset(b.dataset.pz, sheet)));
  $$("[data-pzm]", row).forEach((b) => b.addEventListener("click", async () => { if (await presetMenu(b.dataset.pzm, cur(), sheet)) onChange(); }));
  onLongPress(row, "[data-pz]", async (b) => { if (await presetMenu(b.dataset.pz, cur(), sheet)) onChange(); });
}
function filterSheet({ prefill = false, focus = "" } = {}) {
  const p = P(); const all = PD(); const ctx = { vendorName: vName };
  // 1.2.7 건수 찾기(홈·대시보드)는 늘 초기화 상태로 열림. 1.2.9 목록 ‘필터’는 지금 걸린 조건을 그대로 보여 줌(초기화 버튼 따로) — 적용하면 목록 조건을 새로 바꿈
  const nf = prefill ? JSON.parse(JSON.stringify(S.filter || {})) : {};
  const facets = facetOptions(p, all);
  for (const fc of facets) for (const v of [...M.fArr(nf[fc.k]), ...M.fArr(nf["x_" + fc.k])]) if (!fc.o.some(([x]) => x === v)) fc.o.unshift([v, filterChipText(fc.k, v)]);
  const has = (k, v) => M.fArr(nf[k]).includes(v);
  const day = (dd) => { const t = new Date(Date.now() - dd * 864e5); return M.localDay(t.toISOString()); };
  const facetHtml = (fc) => `<details class="fc" data-fc="${fc.k}" ${fc.fold && !M.fArr(nf[fc.k]).length && !M.fArr(nf["x_" + fc.k]).length && focus !== fc.k && focus !== "x_" + fc.k ? "" : "open"}><summary><b>${fc.t}</b> <small class="fc-sel" data-sel-of="${fc.k}"></small></summary>
    ${fc.k === "vendorId" && fc.o.length > 6 ? `<input class="inp fc-q" data-fq="${fc.k}" type="search" placeholder="업체 찾기 · 초성 가능 (예: ㄷㅎ)" aria-label="업체 찾기">` : ""}${fc.k === "status" ? `<div class="fc-tools"><button type="button" class="btn btn-sm" id="fl-openonly">미조치만</button><small class="help">칩을 <b>길게 누르면 제외</b>(빨간 −칩) · 맨 위 ‘제외로 고르기’를 켜도 돼요</small></div>` : ""}<div class="chips fc-chips">${fc.o.map(([v, t]) => `<button type="button" class="chip fchip ${has(fc.k, v) ? "on" : ""}" data-fk="${fc.k}" data-fv="${esc(v)}" aria-pressed="${has(fc.k, v)}">${esc(t)} <small class="fn">0</small></button>`).join("")}</div></details>`;
  const s = openSheet({ title: "필터 · 건수 찾기", full: true, cls: "fl-sheet",
    html: `${presetRowHtml("panel")}<p class="fl-res" aria-live="polite">검색 결과 <b id="fl-n">0</b>건 <span class="ex-gone" id="fl-exn" hidden></span> <small class="help">항목 안에서는 ‘또는’, 항목끼리는 ‘그리고’</small></p>
      <div class="chips scroll" id="fl-active"></div>
      <div class="fl-toggles"><label class="check"><input type="checkbox" id="fl-overdue" ${nf.overdue ? "checked" : ""}> ⏰ 기한초과만 <small class="fn" id="fl-odn"></small></label>
        <label class="check"><input type="checkbox" id="fl-urgent" ${has("severity", "긴급") ? "checked" : ""}> 🚨 긴급만</label>
        <label class="check"><input type="checkbox" id="fl-hidedone" ${nf.hideDone ? "checked" : ""}> ✅ 완료 건 숨기기 <small class="help">(조치완료·확인완료)</small></label></div>
      <section class="fl-ex" id="fl-ex"><div class="fl-ex-hd"><b>제외</b> <small class="help">이 단어가 공종·세부공종·내용·위치·업체·유형에 있으면 빼요</small></div>
        <form class="row" id="fl-exw-f" autocomplete="off"><input class="inp" id="fl-exw" placeholder="예: 코킹, 마이다판 (쉼표·Enter)" aria-label="제외 단어"><button type="submit" class="btn btn-sm">추가</button></form>
        <div class="chips" id="fl-exw-chips"></div>
        <label class="check"><input type="checkbox" id="fl-exmode"> 아래 칩을 <b class="ex-t">제외</b>로 고르기 <small class="help">(칩을 길게 눌러도 제외)</small></label></section>
      ${facets.map(facetHtml).join("")}
      <details class="fc" data-fc="_loc" ${nf.ho || nf.from || nf.to ? "open" : ""}><summary><b>호 · 기간</b></summary>
        <div class="grid2"><label class="fld"><span>호</span><input class="inp" id="fl-ho" inputmode="numeric" value="${esc(nf.ho || "")}" placeholder="예: 1203"></label><span></span>
        <label class="fld"><span>등록일 부터</span><input class="inp" type="date" id="fl-from" value="${esc(nf.from || "")}"></label><label class="fld"><span>까지</span><input class="inp" type="date" id="fl-to" value="${esc(nf.to || "")}"></label></div>
        <div class="chips"><button type="button" class="chip" data-per="0">오늘</button><button type="button" class="chip" data-per="6">최근 7일</button><button type="button" class="chip" data-per="29">최근 30일</button><button type="button" class="chip" data-per="">기간 없음</button></div></details>
      <details class="fc" data-fc="_more" ${nf.common || nf.turn || nf.chain || nf.mine || nf.text ? "open" : ""}><summary><b>더 보기</b> <small>공용부 · 내 차례 · 후속 공정 · 검색어</small></summary>
        <div class="grid2">
        <label class="fld"><span>공용부</span><select class="inp" data-k="common"><option value="">전체</option>${[["_any", "공용부·세대 외 전체"], ["_bare", "공용부 미지정(동·층만)"], ...[...new Set([...M.dongCommonsOf(p), ...p.commons, ...all.map((d) => d.common).filter(Boolean)])].map((x) => [x, x])].map(([v, t]) => `<option value="${esc(v)}" ${nf.common === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label class="fld"><span>내 차례 대기(업체)</span><select class="inp" data-k="turn"><option value="">전체</option>${S.vendors.map((v) => `<option value="${esc(v.id)}" ${nf.turn === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label></div>
        <label class="check"><input type="checkbox" data-k="chain" ${nf.chain ? "checked" : ""}> 후속 공정 있는 하자</label>
        <label class="check"><input type="checkbox" data-k="mine" ${nf.mine ? "checked" : ""}> 다음 공정 보낼 차례</label>
        <label class="fld"><span>검색어</span><input class="inp" data-k="text" value="${esc(nf.text || "")}" placeholder="내용·위치·메모"></label></details>`,
    footer: `<button type="button" class="btn" data-a="reset">초기화</button><button type="button" class="btn" data-a="psave" id="fl-psave">🔖 조건 저장</button><button type="button" class="btn btn-primary" data-a="apply" id="fl-apply">0건 보기</button>` });
  const el = s.el;
  const redrawPresets = () => { const old = $(".pz-row", el); const tmp = document.createElement("div"); tmp.innerHTML = presetRowHtml("panel"); old.replaceWith(tmp.firstElementChild); bindPresetRow(el, { cur: () => (addExw(), clean()), sheet: s, onChange: redrawPresets }); };
  const clean = () => { const o = {}; for (const [k, v] of Object.entries(nf)) { if (Array.isArray(v) ? v.length : v) o[k] = v; } return o; };
  const refresh = () => {
    const f0 = clean(); const res = M.applyFilter(all, f0, ctx).length;
    $("#fl-n", el).textContent = n(res); $("#fl-apply", el).textContent = `${n(res)}건 보기`;
    /* 1.3.3 제외로 빠진 건수를 따로 보여 줌(전에는 포함 칩 건수도 제외 뒤 숫자라 ‘312동 1,615 = 결과 1,615’처럼 제외가 안 먹은 듯 보였음) */
    const fIn = M.stripEx(f0); const exOn = M.hasEx(f0); const gone = exOn ? M.applyFilter(all, fIn, ctx).length - res : 0;
    const exn = $("#fl-exn", el); exn.hidden = !exOn; exn.textContent = exOn ? `(${n(res + gone)}건 중 제외 −${n(gone)}건)` : "";
    for (const fc of facets) {
      const vals = fc.o.map(([v]) => v);
      const cnt = M.facetCounts(all, fIn, fc.k, vals, ctx); // 포함 칩: 제외 전 건수
      const xc = M.fArr(nf["x_" + fc.k]).length ? M.facetCounts(all, { ...f0, ["x_" + fc.k]: [] }, fc.k, vals, ctx) : null; // 제외 칩: ‘빠지는 건수’
      for (const b of $$(`.fchip[data-fk="${fc.k}"]`, el)) { const c = (xc && has("x_" + fc.k, b.dataset.fv) ? xc : cnt).get(b.dataset.fv) || 0; b.querySelector(".fn").textContent = n(c); const on = has(fc.k, b.dataset.fv); const ex = has("x_" + fc.k, b.dataset.fv); b.classList.toggle("on", on); b.classList.toggle("ex", ex); b.setAttribute("aria-pressed", on || ex); b.classList.toggle("zero", !c && !on && !ex); }
      const sel = [...M.fArr(nf[fc.k]).map((v) => filterChipText(fc.k, v)), ...M.fArr(nf["x_" + fc.k]).map((v) => "−" + filterChipText(fc.k, v))]; $(`[data-sel-of="${fc.k}"]`, el).textContent = sel.join(", ");
    }
    $("#fl-odn", el).textContent = n(M.applyFilter(all, { ...f0, overdue: true }, ctx).length);
    $("#fl-urgent", el).checked = has("severity", "긴급"); $("#fl-hidedone", el).checked = !!nf.hideDone;
    $("#fl-active", el).innerHTML = activeChips(f0) || '<span class="help">조건 없음 · 전체</span>';
    $("#fl-exw-chips", el).innerHTML = M.fArr(nf.exw).map((w) => `<button type="button" class="chip on ex" data-exw="${esc(w)}" aria-label="제외 ${esc(w)} 지우기">−${esc(w)} ✕</button>`).join("");
    $$("[data-fopen]", $("#fl-active", el)).forEach((b) => b.addEventListener("click", () => goFacet(b.dataset.fopen)));
    $$("[data-rm]", $("#fl-active", el)).forEach((b) => b.addEventListener("click", () => { const k = b.dataset.rm; if (b.dataset.rv != null && Array.isArray(nf[k])) nf[k] = nf[k].filter((x) => x !== b.dataset.rv); else delete nf[k]; syncInputs(); refresh(); }));
  };
  const syncInputs = () => { $("#fl-overdue", el).checked = !!nf.overdue; $("#fl-ho", el).value = nf.ho || ""; $("#fl-from", el).value = nf.from || ""; $("#fl-to", el).value = nf.to || "";
    for (const i of $$("[data-k]", el)) { if (i.type === "checkbox") i.checked = !!nf[i.dataset.k]; else i.value = nf[i.dataset.k] || ""; } };
  const toggle = (k, v) => { const cur = M.fArr(nf[k]); nf[k] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; };
  /* 1.2.8 칩: 보통은 ‘포함’, 제외 모드(또는 길게 누르기)면 ‘제외’(빨간 −칩). 한 값은 둘 중 하나만 */
  const pickChip = (k, v, ex) => { const a = ex ? "x_" + k : k, b2 = ex ? k : "x_" + k; nf[b2] = M.fArr(nf[b2]).filter((x) => x !== v); toggle(a, v); refresh(); };
  onLongPress(el, ".fchip", (b) => pickChip(b.dataset.fk, b.dataset.fv, true));
  $$("[data-fq]", el).forEach((qi) => qi.addEventListener("input", () => { for (const b of $$(`.fchip[data-fk="${qi.dataset.fq}"]`, el)) b.hidden = !!qi.value.trim() && !M.koMatch(b.firstChild?.textContent || b.textContent, qi.value) && !b.classList.contains("on"); }));
  const addExw = () => { const inp = $("#fl-exw", el); const ws = inp.value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean); if (!ws.length) return; nf.exw = [...new Set([...M.fArr(nf.exw), ...ws])]; inp.value = ""; refresh(); };
  $("#fl-exw-f", el).addEventListener("submit", (e) => { e.preventDefault(); addExw(); });
  $("#fl-exw", el).addEventListener("input", (e) => { if (/[,，]/.test(e.target.value)) addExw(); });
  el.addEventListener("click", (e) => {
    const xw = e.target.closest("[data-exw]"); if (xw) { nf.exw = M.fArr(nf.exw).filter((x) => x !== xw.dataset.exw); refresh(); return; }
    const b = e.target.closest(".fchip"); if (b) { const exOn = $("#fl-exmode", el).checked; if (!exOn && has("x_" + b.dataset.fk, b.dataset.fv)) pickChip(b.dataset.fk, b.dataset.fv, true); else pickChip(b.dataset.fk, b.dataset.fv, exOn); return; }
    const per = e.target.closest("[data-per]"); if (per) { if (per.dataset.per === "") { delete nf.from; delete nf.to; } else { nf.from = day(+per.dataset.per); nf.to = day(0); } syncInputs(); refresh(); }
  });
  $("#fl-overdue", el).addEventListener("change", (e) => { nf.overdue = e.target.checked || undefined; refresh(); });
  $("#fl-hidedone", el).addEventListener("change", (e) => { nf.hideDone = e.target.checked || undefined; refresh(); });
  /* 1.3.1 미조치만 = 완료 상태(조치완료·확인완료) 제외 */
  $("#fl-openonly", el)?.addEventListener("click", () => { const done = ["조치완료", "확인완료"]; nf.status = M.fArr(nf.status).filter((x) => !done.includes(x)); nf.x_status = [...new Set([...M.fArr(nf.x_status), ...done])]; refresh(); });
  $("#fl-urgent", el).addEventListener("change", (e) => { const cur = M.fArr(nf.severity).filter((x) => x !== "긴급"); nf.severity = e.target.checked ? [...cur, "긴급"] : cur; refresh(); });
  for (const [id, k] of [["#fl-ho", "ho"], ["#fl-from", "from"], ["#fl-to", "to"]]) $(id, el).addEventListener("input", (e) => { nf[k] = e.target.value.trim(); refresh(); });
  for (const i of $$("[data-k]", el)) i.addEventListener(i.type === "checkbox" ? "change" : "input", () => { nf[i.dataset.k] = i.type === "checkbox" ? (i.checked ? "1" : "") : i.value.trim(); refresh(); });
  $$("[data-a]", el).forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.a === "reset") { for (const k of Object.keys(nf)) delete nf[k]; syncInputs(); refresh(); return; }
    if (b.dataset.a === "psave") { addExw(); if (await savePresetFlow(clean())) redrawPresets(); return; }
    addExw(); S.filter = clean(); LS.set("filter", S.filter); S.listLimit = 60; S.noRestore = true; await s.close();
    if (location.hash.split("?")[0] !== "#/list") go("#/list"); else rerender();
  }));
  /** 그 항목으로 펼치고 스크롤(제외 단어는 제외 칸) */
  function goFacet(k) { const t = k === "exw" ? $("#fl-ex", el) : $(`details.fc[data-fc="${k.replace(/^x_/, "")}"]`, el); if (!t) return; if (t.tagName === "DETAILS") t.open = true; t.scrollIntoView({ block: "start" }); t.classList.add("fc-focus"); setTimeout(() => t.classList.remove("fc-focus"), 1500); }
  bindPresetRow(el, { cur: () => (addExw(), clean()), sheet: s, onChange: redrawPresets });
  refresh();
  if (focus) setTimeout(() => goFacet(focus), 60);
  window.__flPrefill = prefill;
  return s;
}
/** 1.2.4 집계: 지금 목록을 업체·동·공종·유형 × 상태 건수 표로. 칸을 누르면 그 조건으로 목록 */
function aggSheet(list, base = null) {
  let row = LS.get("aggRow", "vendorId");
  const ROWS = { vendorId: "업체", dong: "동", core: "코어", trade: "공종", type: "유형" }; if (!ROWS[row]) row = "vendorId"; M.setCoreProject(P());
  const COLS = [["_open", "미조치"], ...M.STATUSES.map((x) => [x, x])];
  const keyOf = { vendorId: (d) => d.vendorId || "_none", dong: (d) => d.dong || "_none", core: (d) => M.coreKey(P(), d), trade: (d) => (d.trade ? M.tradeKey(d.trade) : "_none"), type: (d) => (d.type ? M.typeKey(d.type) : "_none") };
  const table = () => {
    const m = new Map(); const nameOf = new Map();
    for (const d of list) { const k = keyOf[row](d); if (!m.has(k)) m.set(k, []); m.get(k).push(d);
      if (!nameOf.has(k)) nameOf.set(k, row === "core" ? M.coreLabel(k) : row === "vendorId" ? (k === "_none" ? "업체 미지정" : vLabel(k)) : k === "_none" ? "없음" : row === "dong" ? k : row === "trade" ? d.trade : d.type); }
    if (row === "type") for (const [k, items] of m) if (k !== "_none") nameOf.set(k, M.typeCounts(items)[0].name);
    const rows = [...m.entries()].sort((a, b) => (a[0] === "_none") - (b[0] === "_none") || (row === "core" ? a[0].localeCompare(b[0], "ko", { numeric: true }) : 0) || b[1].filter(M.isOpen).length - a[1].filter(M.isOpen).length || b[1].length - a[1].length);
    const fv = (k, items) => (k === "_none" ? "_none" : row === "vendorId" || row === "dong" || row === "core" ? k : row === "trade" ? items[0].trade : nameOf.get(k));
    const cell = (items, rk, c) => { const v = c === "_open" ? items.filter(M.isOpen).length : c === "_od" ? items.filter((d) => M.isOverdue(d)).length : c === "_all" ? items.length : items.filter((d) => d.status === c).length;
      return `<td>${v ? `<button type="button" class="agg-c ${c === "_od" ? "bad" : ""}" data-rk="${esc(rk)}" data-c="${c}">${n(v)}</button>` : '<span class="z">·</span>'}</td>`; };
    return `<table class="agg-t"><thead><tr><th>${ROWS[row]}</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}<th>기한초과</th><th>합계</th></tr></thead><tbody>
      ${rows.map(([k, items]) => `<tr><th>${esc(nameOf.get(k) || "-")}</th>${COLS.map(([c]) => cell(items, fv(k, items), c)).join("")}${cell(items, fv(k, items), "_od")}${cell(items, fv(k, items), "_all")}</tr>`).join("")}
      <tr class="sum"><th>합계</th>${COLS.map(([c]) => cell(list, "_ALL", c)).join("")}${cell(list, "_ALL", "_od")}${cell(list, "_ALL", "_all")}</tr></tbody></table>`;
  };
  const s = openSheet({ title: base ? "집계 (전체)" : "집계 (지금 목록 기준)", full: true, cls: "agg-sheet",
    html: `<p class="help">${base ? "전체" : "검색 결과"} <b>${n(list.length)}건</b>을 묶어서 셌어요. 숫자를 누르면 그 조건의 목록으로 가요.</p>
      <div class="chips" id="agg-rows">${Object.entries(ROWS).map(([k, t]) => `<button type="button" class="chip ${k === row ? "on" : ""}" data-row="${k}">${t} × 상태</button>`).join("")}</div>
      <div class="agg-wrap" id="agg-wrap">${table()}</div>` });
  const bind = () => $$(".agg-c", s.el).forEach((b) => b.addEventListener("click", async () => {
    const f = { ...(base || S.filter) }; const rk = b.dataset.rk, c = b.dataset.c;
    if (rk !== "_ALL") f[row] = [rk];
    if (c === "_od") f.overdue = true; else if (c !== "_all") f.status = [c];
    S.filter = f; LS.set("filter", f); S.listLimit = 60; S.noRestore = true; await s.close();
    if (location.hash.split("?")[0] !== "#/list") go("#/list"); else rerender();
  }));
  $$("[data-row]", s.el).forEach((b) => b.addEventListener("click", () => { row = b.dataset.row; LS.set("aggRow", row); $$("[data-row]", s.el).forEach((x) => x.classList.toggle("on", x === b)); $("#agg-wrap", s.el).innerHTML = table(); bind(); }));
  bind(); return s;
}

/* ---------- 세대 보기 ---------- */
ROUTES.unit = async (qq) => {
  setTab("list");
  const dong = qq.dong, ho = qq.ho || "";
  setHeader(`${dong} ${ho ? ho + "호" : ""}`);
  const all = PD().filter((d) => d.dong === dong && (ho ? (d.ho === ho || M.normHo(d.ho) === M.normHo(ho)) : !d.ho));
  const onlyOpen = LS.get("unitOpen", true);
  const list = onlyOpen ? all.filter(M.isOpen) : all;
  const groups = M.groupByTradeVendor(list, vName);
  // 제자리 다시 그리기·뒤로가기 때는 묶음 순서를 그대로(상태가 바뀌어 미조치 수가 달라져도 묶음이 자리를 바꾸지 않게)
  const gKey = (g) => `${g.trade}|${g.vendorId}`; S.grpOrder ||= new Map(); const prevOrder = S.grpOrder.get(location.hash);
  if (prevOrder && (navKind() === "re" || navKind() === "pop")) { const ix = (g) => { const i = prevOrder.indexOf(gKey(g)); return i < 0 ? 1e6 : i; }; groups.sort((a, b) => ix(a) - ix(b)); }
  S.grpOrder.set(location.hash, [...groups.map(gKey), ...(prevOrder || []).filter((k) => !groups.some((g) => gKey(g) === k))]);
  /* 1.2.8 업체 묶음 펼치고 접기(이번 실행 동안 세대별 기억). 묶음이 6개 넘으면 처음엔 접힘 */
  S.ugOpen ||= new Map(); const ugK = (g) => `${dong}|${ho}|${gKey(g)}`; const ugDef = groups.length <= 6;
  const ugOpen = (g) => (S.ugOpen.has(ugK(g)) ? S.ugOpen.get(ugK(g)) : ugDef);
  view().innerHTML = `
    <div class="unit-hd"><div><b>${n(all.filter(M.isOpen).length)}</b> 미조치 / ${n(all.length)}건 · 기한초과 ${all.filter((d) => M.isOverdue(d)).length}</div>
      <div class="chips"><button type="button" class="chip ${onlyOpen ? "on" : ""}" data-o="1">미조치</button><button type="button" class="chip ${!onlyOpen ? "on" : ""}" data-o="0">전체</button></div></div>
    <button type="button" class="btn btn-primary btn-block" id="btn-add">＋ 이 세대에 하자 등록</button>
    ${groups.length > 1 ? `<div class="lg-bar" id="ug-bar"><span class="help">업체 묶음 ${groups.length}개</span><span class="sp"></span><button type="button" class="btn btn-sm" id="ug-openall">모두 펼치기</button><button type="button" class="btn btn-sm" id="ug-closeall">모두 접기</button></div>` : ""}
    ${groups.map((g, gi) => { const op = ugOpen(g); const openN = g.items.filter(M.isOpen).length;
      return `<details class="group lgrp vgrp ugrp" data-uk="${esc(gKey(g))}" ${op ? "open" : ""}><summary class="grp-hd"><label class="gchk" title="이 묶음 전체 선택"><input type="checkbox" data-gall="${g.items.map((d) => d.id).join(",")}" data-gi="${gi}" aria-label="${esc(g.trade)} · ${esc(g.vendor)} 전체 선택"><span>전체</span></label><div class="grp-tt"><b>${esc(g.trade)}</b> · ${esc(g.vendor)} <span class="help">${g.items.length}건${openN !== g.items.length ? ` · 미조치 ${openN}` : ""}</span></div>
      <button type="button" class="btn btn-sm btn-primary" data-g="${gi}">보내기</button></summary>${g.items.map((d) => defectCard(d, { sel: true })).join("")}</details>`; }).join("") ||
      `<div class="card empty-card"><p>${onlyOpen ? "미조치 하자가 없어요 👍" : "등록된 하자가 없어요."}</p></div>`}
    ${selBarHtml()}`;
  bindCards(); bindSelBar();
  $$("[data-gall]", view()).forEach((g) => g.addEventListener("change", () => { const ids = g.dataset.gall.split(","); const on = g.checked; for (const x of ids) S.select[on ? "add" : "delete"](x); syncChecks(); }));
  syncChecks();
  $("#btn-add").addEventListener("click", () => { startDraft({ dong, ho, floor: M.floorOfHo(ho) }); go("#/new"); });
  $$("[data-o]", view()).forEach((b) => b.addEventListener("click", () => { LS.set("unitOpen", b.dataset.o === "1"); rerender(); }));
  const ugSet = (k, v) => S.ugOpen.set(`${dong}|${ho}|${k}`, v);
  $$("details.ugrp", view()).forEach((dd) => { dd.dataset.wasOpen = dd.open ? "1" : "0"; dd.addEventListener("toggle", () => { if (dd.open === (dd.dataset.wasOpen === "1")) return; dd.dataset.wasOpen = dd.open ? "1" : "0"; ugSet(dd.dataset.uk, dd.open); }); });
  // 전체 체크·보내기는 펼침/접힘을 바꾸지 않음
  $$("details.ugrp > summary .gchk, details.ugrp > summary [data-g]", view()).forEach((x) => x.addEventListener("click", (e) => e.stopPropagation()));
  const ugAll = (op) => { for (const dd of $$("details.ugrp", view())) { ugSet(dd.dataset.uk, op); dd.dataset.wasOpen = op ? "1" : "0"; dd.open = op; } };
  $("#ug-openall")?.addEventListener("click", () => ugAll(true)); $("#ug-closeall")?.addEventListener("click", () => ugAll(false));
  $$("[data-g]", view()).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); const g = groups[+b.dataset.g]; const picked = g.items.filter((d) => S.select.has(d.id)).map((d) => d.id);
    sendSheet({ items: g.items, vendor: V(g.vendorId), preselect: picked.length ? picked : null }); }));
};

/* ---------- 동 현황(히트맵) ---------- */
/** 동 공용부를 세부위치별로 묶기(층은 무시하고 세부위치 기준, 세부위치 없는 건 ‘층·기타’) */
function commonGroups(list) {
  const m = new Map(); const fl = (d) => d.floor || "";
  for (const d of list) {
    const key = d.common ? "c|" + d.common : "f|" + fl(d);
    const g = m.get(key) || (d.common ? { common: d.common, floor: "", label: d.common, floors: new Map() } : { common: "", floor: fl(d) || "_none", label: fl(d) ? `${M.floorLabel(fl(d))} (공용부 미지정)` : "동 전체 (층·공용부 미지정)", floors: null });
    g.all = (g.all || 0) + 1; if (M.isOpen(d)) g.open = (g.open || 0) + 1; if (M.isOverdue(d)) g.od = (g.od || 0) + 1;
    if (g.floors) g.floors.set(fl(d), (g.floors.get(fl(d)) || 0) + 1);
    m.set(key, g);
  }
  const fsort = (a, b) => (Number(b) || -99) - (Number(a) || -99);
  return [...m.values()].map((g) => ({ open: 0, od: 0, ...g, sub: g.floors && [...g.floors.keys()].some(Boolean) ? [...g.floors.entries()].sort((a, b) => fsort(a[0], b[0])).slice(0, 4).map(([f, n]) => `${f ? M.floorLabel(f) : "층 없음"} ${n}`).join(" · ") : "" }))
    .sort((a, b) => (a.common ? 0 : 1) - (b.common ? 0 : 1) || b.all - a.all || fsort(a.floor, b.floor));
}
ROUTES.grid = async (qq) => {
  setTab("list");
  const p = P(); const dong = p.dongs.find((d) => d.name === qq.dong) || p.dongs[0];
  setHeader("동 현황");
  if (!dong) { view().innerHTML = `<div class="card empty-card"><p>동이 없어요. 설정 &gt; 현장 설정에서 동을 추가하세요.</p><button class="btn btn-primary" type="button" onclick="location.hash='#/project'">현장 설정</button></div>`; return; }
  const list = PD().filter((d) => d.dong === dong.name);
  const by = new Map(); for (const d of list) { if (!d.ho) continue; const k = M.normHo(d.ho) || d.ho; const m = by.get(k) || { open: 0, all: 0, od: 0 }; m.all++; if (M.isOpen(d)) m.open++; if (M.isOverdue(d)) m.od++; by.set(k, m); }
  const th = M.heatThresholds(p, PD()); const cnt = (m) => (th.basis === "all" ? m.all : m.open);
  const floors = []; for (let f = dong.floors; f >= (dong.unitStart || 1); f--) if (M.unitsOf(dong, String(f)).length) floors.push(f);
  const lines = M.linesOf(dong);
  const common = list.filter((d) => !d.ho);
  view().innerHTML = `
    <div class="chips wrap dong-chips">${p.dongs.map((d) => `<button type="button" class="chip ${d.id === dong.id ? "on" : ""}" data-d="${esc(d.name)}">${esc(d.name)}</button>`).join("")}</div>
    <div class="list-hd"><b>${esc(dong.name)}</b><span class="help">미조치 ${list.filter(M.isOpen).length} / ${list.length}건</span></div>
    ${heatLegendHtml(th)}
    <div class="hgrid" style="--cols:${lines.length}">${floors.map((f) => { const us = new Set(M.unitsOf(dong, String(f))); return `<div class="hf">${f}F</div>` + lines.map((l) => String(f * 100 + l)).map((ho) => {
      if (!us.has(ho)) return `<span class="hc hx" aria-hidden="true"></span>`;
      const m = by.get(ho) || { open: 0, all: 0, od: 0 }; const n = cnt(m); const lv = M.heatLevel(n, th);
      return `<button type="button" class="hc h${lv} ${m.od ? "od" : ""} ${m.all && !m.open && th.basis !== "all" ? "done" : ""}" data-ho="${ho}" data-n="${n}" data-lv="${lv}" aria-label="${ho}호 ${th.basis === "all" ? "전체" : "미조치"} ${n}건"><span>${ho}</span>${m.all ? `<b>${n}</b>` : ""}</button>`;
    }).join(""); }).join("")}</div>
    <h3 class="sec">공용부·세대 외 <small>${esc(dong.name)} · ${th.basis === "all" ? "전체" : "미조치"} ${common.filter(M.isOpen).length} / ${common.length}건</small></h3>
    <div class="cgrid" id="cgrid">${commonGroups(common).map((g) => { const n = th.basis === "all" ? g.all : g.open; const lv = M.heatLevel(n, th);
      return `<button type="button" class="cc h${lv} ${g.od ? "od" : ""}" data-cm="${esc(g.common)}" data-cf="${esc(g.floor)}" aria-label="${esc(g.label)} ${n}건"><span>${esc(g.label)}</span><b>${n}</b><small>${g.all}건${g.sub ? " · " + esc(g.sub) : ""}</small></button>`; }).join("") || '<p class="help">공용부 하자 없음 — 등록할 때 위치에서 동을 고른 뒤 ‘공용부’를 선택하세요.</p>'}</div>
    ${common.slice(0, 30).map((d) => defectCard(d)).join("")}`;
  bindCards();
  $$("[data-d]", view()).forEach((b) => b.addEventListener("click", () => replace(`#/grid?dong=${encodeURIComponent(b.dataset.d)}`)));
  $$("[data-ho]", view()).forEach((b) => b.addEventListener("click", () => go(`#/unit?dong=${encodeURIComponent(dong.name)}&ho=${b.dataset.ho}`)));
  $$("[data-cm]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = { dong: dong.name, common: b.dataset.cm || "_bare", ...(b.dataset.cm ? {} : { floor: b.dataset.cf || "_none" }), ...(th.basis === "all" ? {} : { status: "_open" }) }; LS.set("filter", S.filter); go("#/list"); }));
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
  const types = M.typeCounts(list).filter((t) => t.key).slice(0, 10); const tmax = Math.max(1, ...types.map((t) => t.n));
  const dongs = M.countBy(open, "dong").slice(0, 12); const dmax = Math.max(1, ...dongs.map((t) => t[1]));
  const cats = M.countBy(list, "category"); const copen = new Map(M.countBy(open, "category")); const cmax = Math.max(1, ...cats.map((t) => t[1]));
  view().innerHTML = `
    <div class="kpis"><div class="kpi"><b>${n(list.length)}</b><span>전체</span></div><div class="kpi"><b>${n(open.length)}</b><span>미조치</span></div>
      <div class="kpi warn"><b>${n(od.length)}</b><span>기한초과</span></div><div class="kpi ok"><b>${list.length ? Math.round((done / list.length) * 100) : 0}%</b><span>조치율</span></div></div>
    <div class="dash-find"><button type="button" class="btn btn-primary" id="dash-find">🔎 업체·동·유형별 건수 찾기</button><button type="button" class="btn" id="dash-agg">📊 집계표</button></div>
    <section class="card"><h3>상태별</h3><div class="stbar">${M.STATUSES.map((s) => (st.get(s) ? `<i class="${M.STATUS_CLS[s]}" style="flex:${st.get(s)}" title="${s}"></i>` : "")).join("")}</div>
      <div class="stleg">${M.STATUSES.map((s) => `<button type="button" class="lg" data-st="${s}">${pill(s)} ${n(st.get(s) || 0)}</button>`).join("")}</div></section>
    <section class="card"><h3>업체별 <small>미조치 · 기한초과 · 조치율</small></h3>
      <table class="tbl"><tbody>${vlist.map(([k, m]) => `<tr data-v="${k}"><td>${esc(k === "_none" ? "업체 미지정" : vLabel(k))}</td><td class="r">${m.open}</td><td class="r ${m.od ? "od" : ""}">${m.od}</td><td class="w">${bar(m.done, m.all, "ok")}<small>${Math.round((m.done / m.all) * 100)}%</small></td></tr>`).join("") || '<tr><td class="help">데이터 없음</td></tr>'}</tbody></table></section>
    <section class="card"><h3>미조치 경과일</h3>${aging.map(([l, v]) => `<div class="hrow"><span>${l}</span>${bar(v, amax, v && l.includes("초과") ? "bad" : "")}<b>${v}</b></div>`).join("")}</section>
    <section class="card"><h3>구분별 <small>전체 · 미조치</small></h3>${cats.map(([t, v]) => `<div class="hrow" data-cat="${esc(t)}"><span>${esc(t || "-")}</span>${bar(v, cmax)}<b>${v}<small> · ${copen.get(t) || 0}</small></b></div>`).join("") || '<p class="help">없음</p>'}</section>
    <section class="card" id="dash-types"><h3>유형별 <small>전체 · 미조치</small></h3>${types.map((t) => `<div class="hrow" data-ty="${esc(t.name)}"><span>${esc(t.name)}</span>${bar(t.n, tmax)}<b>${t.n}<small> · ${t.open}</small></b></div>`).join("") || '<p class="help">없음</p>'}</section>
    <section class="card"><h3>동별(미조치)</h3>${dongs.map(([t, v]) => `<div class="hrow" data-dg="${esc(t)}"><span>${esc(t || "-")}</span>${bar(v, dmax)}<b>${v}</b></div>`).join("") || '<p class="help">없음</p>'}</section>`;
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => { S.filter = { status: b.dataset.st }; LS.set("filter", S.filter); go("#/list"); }));
  $$("[data-v]", view()).forEach((r) => r.addEventListener("click", () => { if (r.dataset.v === "_none") { S.filter = { vendorId: "_none", status: "_open" }; LS.set("filter", S.filter); go("#/list"); } else go(`#/vendor?id=${r.dataset.v}`); }));
  $$("[data-cat]", view()).forEach((r) => r.addEventListener("click", () => { if (!r.dataset.cat) return; S.filter = { category: r.dataset.cat }; LS.set("filter", S.filter); go("#/list"); }));
  $$("[data-dg]", view()).forEach((r) => r.addEventListener("click", () => go(`#/grid?dong=${encodeURIComponent(r.dataset.dg)}`)));
  $$("[data-ty]", view()).forEach((r) => r.addEventListener("click", () => { S.filter = { type: [r.dataset.ty] }; LS.set("filter", S.filter); go("#/list"); }));
  $("#dash-find").addEventListener("click", () => filterSheet());
  $("#dash-agg").addEventListener("click", () => aggSheet(PD(), {}));
};

/* ---------- 하자 등록/수정 ---------- */
/* ---------- 1.3.1 복사해서 등록 · 같은 내용으로 하나 더 · 최근 내용 · 선택 위치들에 복사 ---------- */
const COPY_KEYS = ["trade", "subTrade", "type", "severity", "category", "content", "vendorId"];
/** 기한 규칙: 원래 하자의 ‘등록일 → 기한’ 일수(없으면 현장 기본) */
function dueDaysOf(d) { if (!d?.due) return P()?.dueDays ?? 7; const a = new Date(M.localDay(d.createdAt || new Date().toISOString()) + "T00:00:00"), b = new Date(d.due + "T00:00:00"); const n = Math.round((b - a) / 864e5); return Number.isFinite(n) && n >= 0 && n <= 365 ? n : P()?.dueDays ?? 7; }
const locOf = (d) => ({ dong: d.dong || "", core: d.core || "", floor: d.floor || "", ho: d.ho || "", common: d.common || "", room: d.room || "", part: d.part || "", locEtc: d.locEtc || "" });
/** 새 등록 초안을 src 내용으로. keepLoc=false면 위치 비움, focusLoc면 위치 고르기부터 */
function startCopyDraft(src, { keepLoc = true, focusLoc = true, photos = [] } = {}) {
  startDraft(keepLoc ? locOf(src) : {});
  const dr = S.draft; for (const k of COPY_KEYS) dr[k] = src[k] || (k === "severity" ? "보통" : "");
  dr.due = M.addDays(src._dueDays ?? dueDaysOf(src)); dr.vendorAuto = !dr.vendorId; dr.photos = photos;
  dr._copy = { from: src.id || "", focusLoc, opened: false, dueDays: src._dueDays ?? dueDaysOf(src) };
  window.__copyDraft = { from: dr._copy.from, keepLoc, focusLoc, photos: photos.length };
}
async function copyPhotosOf(d) {
  const out = []; for (const ph of (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 10)) out.push({ blob: ph.blob, thumb: ph.thumb || ph.blob, w: ph.w, h: ph.h, at: ph.at, stamp: ph.stamp || "1", url: URL.createObjectURL(ph.thumb || ph.blob) });
  return out;
}
/** 상세·카드 메뉴: 복사해서 등록(위치 바꾸기/그대로 · 사진도 복사) */
async function copyToNewSheet(d) {
  const nph = photoCount(d).before || 0;
  const s = openSheet({ title: "복사해서 등록", cls: "dialog copy-sheet", html: `<p class="help">공종·세부공종·유형·중요도·내용·담당업체·기한 규칙을 그대로 넣은 새 등록 화면을 열어요.</p>
      <div class="copy-sum"><b>${esc(M.tradeText(d) || "공종 미지정")}</b>${d.type ? ` · ${esc(d.type)}` : ""}<br><small>${esc(d.content || "")}</small><br><small class="help">${esc(M.locText(d) || "위치 미지정")} · ${esc(vName(d) || "업체 미지정")}</small></div>
      <label class="check"><input type="radio" name="cp-loc" value="change" checked> 위치 바꾸기 <small class="help">(동·호·실만 다시 고르기)</small></label>
      <label class="check"><input type="radio" name="cp-loc" value="keep"> 같은 위치 그대로</label>
      <label class="check"><input type="checkbox" id="cp-ph" ${nph ? "" : "disabled"}> 사진도 복사 <small class="help">${nph ? `(조치 전 ${nph}장)` : "(사진 없음)"}</small></label>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="cp-go">등록 화면 열기</button>` });
  $("#cp-go", s.el).addEventListener("click", async () => {
    const keep = $('[name=cp-loc]:checked', s.el).value === "keep"; const withPh = $("#cp-ph", s.el).checked;
    const photos = withPh ? await copyPhotosOf(d) : [];
    await s.close(); startCopyDraft(d, { keepLoc: true, focusLoc: !keep, photos }); go("#/new");
  });
  return s;
}
/** 카드 ⋯ / 길게 누르기 메뉴 */
async function cardMenu(d) {
  const k = await choose(`${M.locText(d) || "하자"} · ${M.tradeText(d) || ""}`, [{ icon: "📋", label: "복사해서 등록", sub: "같은 내용으로 다른 위치에", value: "copy" }, { icon: "✏️", label: "수정", value: "edit" }, { icon: "★", label: "관리 탭", value: "tab" }, { icon: "🧾", label: "요청서 만들기", value: "req" }]);
  if (k === "copy") return copyToNewSheet(d);
  if (k === "edit") { startDraft({}, d); return go(`#/edit?id=${d.id}`); }
  if (k === "tab") return tabSheet([d], () => rerender());
  if (k === "req") return requestImageFor([d], V(d.vendorId) || null);
}
/** 최근 내용 조합(공종·세부공종·유형·내용) — 최근 등록 순, 같은 조합은 하나 */
function recentCombos(n = 8) {
  const seen = new Set(); const out = []; const all = [...PD()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const d of all) { if (!d.trade || !(d.content || d.type)) continue; const k = [d.trade, d.subTrade, d.type, d.content].map((x) => M.sameKey(x || "")).join("|"); if (seen.has(k)) continue; seen.add(k); out.push(d); if (out.length >= n) break; if (seen.size > 400) break; }
  return out;
}
/** 1.3.1 선택 위치들에 복사: 한 하자 내용을 고른 세대·호(위치)마다 새로 등록. 무료 요금제 쓰기 한도 때문에 한 번에 최대 BULK_COPY_MAX건 */
const BULK_COPY_MAX = 50;
async function bulkCopySheet(sel) {
  const tplOpts = [...new Map(sel.map((d) => [[d.trade, d.subTrade, d.type, d.content].join("|"), d])).values()].slice(0, 12);
  const tid = await choose("어느 내용을 복사할까요?", tplOpts.map((d) => ({ icon: "📋", label: `${M.tradeText(d) || "공종 미지정"}${d.type ? " · " + d.type : ""}`, sub: `${(d.content || "").slice(0, 40)} · ${M.locText(d)}`, value: d.id })));
  if (!tid) return; const tpl = S.defects.find((d) => d.id === tid);
  const key = (d) => [d.dong, d.ho, d.floor, d.common, d.room].join("|");
  const locs = [...new Map(sel.filter((d) => key(d) !== key(tpl)).map((d) => [key(d), locOf(d)])).values()];
  if (!locs.length) return toast("다른 위치가 없어요 · 복사할 세대·호의 하자를 함께 체크하세요");
  const n0 = Math.min(locs.length, BULK_COPY_MAX);
  const s = openSheet({ title: "선택 위치들에 복사", cls: "dialog bulkcopy-sheet", html: `<p><b>${esc(M.tradeText(tpl))}${tpl.type ? " · " + esc(tpl.type) : ""}</b> — ${esc((tpl.content || "").slice(0, 60))}</p>
      <p>체크한 하자의 위치 <b>${n(locs.length)}곳</b>에 같은 내용으로 새 하자를 <b>${n(n0)}건</b> 만들어요.${locs.length > BULK_COPY_MAX ? ` <span class="od">한 번에 최대 ${BULK_COPY_MAX}건 — 나머지 ${n(locs.length - BULK_COPY_MAX)}곳은 다시 해 주세요.</span>` : ""}</p>
      <div class="chips wrap">${locs.slice(0, n0).map((l) => `<span class="chip">${esc(M.locText(l))}</span>`).join("")}</div>
      <label class="check"><input type="checkbox" id="bc-room" checked> 실은 원래 하자의 실(${esc(tpl.room || "없음")})로</label>
      <p class="help small">사진은 복사하지 않아요. 동기화 중이면 1건 = 쓰기 1번(무료 한도 하루 2만 번)이라 한 번에 ${BULK_COPY_MAX}건으로 묶었어요.</p>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="bc-go">${n(n0)}건 만들기</button>` });
  $("#bc-go", s.el).addEventListener("click", async () => {
    const sameRoom = $("#bc-room", s.el).checked; busy(true, "복사 중…"); const now = new Date().toISOString(); const due = M.addDays(dueDaysOf(tpl)); const made = [];
    for (const l of locs.slice(0, n0)) {
      const d = { id: M.uid("h"), projectId: P().id, createdAt: now, status: "접수", memo: "", origin: "local", ...l, ...(sameRoom ? { room: tpl.room || "", part: tpl.part || "" } : {}), pin: null, due,
        history: [{ at: now, status: "접수", note: `복사 등록(${M.locText(tpl)}에서)` }] };
      for (const k of COPY_KEYS) d[k] = tpl[k] || (k === "severity" ? "보통" : "");
      await saveDefect(d); made.push(d.id);
    }
    busy(false); window.__bulkCopy = { n: made.length, ids: made, capped: locs.length > BULK_COPY_MAX }; await s.close(); S.select.clear();
    toast(`${made.length}곳에 복사해서 등록했어요`); rerender();
  });
  return s;
}
function startDraft(loc = {}, base = null) {
  const p = P();
  S.draft = base ? { ...structuredClone({ ...base, history: undefined }), _editId: base.id, photos: [] } : {
    dong: "", core: "", floor: "", ho: "", common: "", room: "", part: "", locEtc: "", trade: "", subTrade: "", type: "", category: LS.get("lastCat", "시공불량"),
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
const LIST_FIELD = { commons: "common", dongCommons: "common", rooms: "room", parts: "part", types: "type", categories: "category", trades: "trade" };
const LIST_NAME = { commons: "단지 공용", dongCommons: "동 공용부", rooms: "실", parts: "부위", types: "유형", categories: "구분", trades: "공종", subTrade: "세부공종" };
const listArr = (p, k) => { if (k === "dongCommons" && !Array.isArray(p.dongCommons)) p.dongCommons = [...M.DEFAULT_DONG_COMMONS]; if (k === "categories" && !Array.isArray(p.categories)) p.categories = [...M.catsOf(p)]; return k === "trades" ? p.trades.map((t) => t.name) : p[k]; };
const isUserItem = (k, v) => !M.defaultsOf(k).includes(v);
/** 목록(공용부·실·부위·유형·구분·공종)에 새 항목 추가 → 이름 또는 null */
async function addListItem(k) {
  const p = P(); const arr = listArr(p, k); const nm = LIST_NAME[k];
  const r = await formSheet({ title: `${nm} 직접 추가`, ok: "추가하고 선택", hint: "현장 설정에 저장돼서 다음부터 바로 고를 수 있어요.",
    fields: [{ k: "v", label: `${nm} 이름`, placeholder: { commons: "예: 경비실", dongCommons: "예: 쓰레기 분리수거장", rooms: "예: 알파룸", parts: "예: 걸레받이", types: "예: 결로", categories: "예: 준공검사", trades: "예: 방음" }[k] }],
    validate: ({ v }) => (!v ? "이름을 입력하세요" : v.length > 20 ? "20자 이내로 입력하세요" : k !== "trades" && k !== "types" && M.hasSame(arr, v) ? `이미 있는 ${nm}이에요: ${arr.find((x) => M.sameKey(x) === M.sameKey(v))}` : "") });
  if (!r) return null;
  if (k === "trades") { const ex = p.trades.find((t) => M.sameTrade(t.name, r.v)); if (ex) { toast(`‘${r.v}’은(는) ‘${ex.name}’과 같은 공종이라 ‘${ex.name}’을(를) 골랐어요`, { ms: 4000 }); return ex.name; } }
  if (k === "types") { const ex = p.types.find((t) => M.sameType(t, r.v)); if (ex) { toast(`‘${r.v}’은(는) ‘${ex}’과 같은 유형이라 ‘${ex}’을(를) 골랐어요`, { ms: 4000 }); return ex; } }
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
/** 이 위치에 맞는 도면: 세대(호)면 평형 평면도, 동·층이면 그 동 도면, 단지 공용이면 동 지정 없는 도면. 실 이름이 들어 있는 도면을 먼저 */
function matchPlans(dr) {
  const p = P(); const ut = M.unitTypeOf(p, dr.dong, dr.ho); const fl = dr.floor || M.floorOfHo(dr.ho);
  const placeHas = !dr.dong && dr.common && M.placePlans(p, S.plans, dr.common).length > 0;
  const ok = (pl) => {
    if (pl.projectId !== p.id) return false;
    if (pl.utype) return !!dr.ho && (!ut || M.normType(pl.utype) === ut);
    if (pl.dongs?.length ? !pl.dongs.includes(dr.dong) : false) return false;
    if (!dr.dong && !dr.common) return false;
    if (!dr.dong && placeHas && M.placeOf(pl, p) !== dr.common) return false;
    return !fl || !String(pl.floors || "").trim() || M.planMatches({ ...pl, dongs: [] }, dr.dong, fl);
  };
  const want = [dr.room, dr.common].filter(Boolean);
  const score = (pl) => (pl.rooms?.some((r) => want.includes(r.name)) ? 4 : 0) + (pl.utype ? 2 : 0) + (pl.dongs?.length ? 1 : 0);
  return S.plans.filter(ok).sort((a, b) => score(b) - score(a));
}
/** 1.3.1 업체 찾기 콤보: 글자·초성(ㄷㅎ)으로 바로 추리기, ↑↓·Enter, ‘업체 미지정’도 고를 수 있음. 앞쪽: 자동 지정·공종 업체 → 많이 맡은 업체 */
function vendorUse() { const all = PD(); const key = `${S.pid}|${all.length}`; if (!S.vUse || S.vUse.key !== key) { const m = new Map(); for (const d of all) if (d.vendorId) m.set(d.vendorId, (m.get(d.vendorId) || 0) + 1); S.vUse = { key, m }; } return S.vUse.m; }
function vendorCombo(inp, { current = () => "", first = () => [], onPick, max = 30 }) {
  if (!inp) return; const list = inp.parentElement.querySelector(".vc-list"); let items = [], act = -1;
  const draw = () => {
    const q = inp.value.trim(); const use = vendorUse(); const pri = first().filter(Boolean);
    const rank = (v) => { const i = pri.indexOf(v.id); return i < 0 ? 1e3 : i; };
    const vs = S.vendors.filter((v) => !q || M.koMatch(v.name, q) || M.koMatch((v.trades || []).join(" "), q)).sort((a, b) => rank(a) - rank(b) || (use.get(b.id) || 0) - (use.get(a.id) || 0) || a.name.localeCompare(b.name, "ko")).slice(0, max);
    items = [...(!q || M.koMatch("업체 미지정", q) ? [{ id: "", name: "업체 미지정" }] : []), ...vs]; act = q && items.length ? (items[0].id === "" && items.length > 1 ? 1 : 0) : -1;
    list.innerHTML = items.map((v, i) => `<button type="button" class="vc-opt ${i === act ? "act" : ""} ${v.id === current() ? "on" : ""}" role="option" aria-selected="${i === act}" data-vc="${esc(v.id)}" tabindex="-1"><b>${esc(v.name)}</b>${v.id ? `<small>${esc([(v.trades || []).slice(0, 3).join(","), pri[0] === v.id ? "자동 지정" : pri.includes(v.id) ? "공종 업체" : "", use.get(v.id) ? `${use.get(v.id)}건` : ""].filter(Boolean).join(" · "))}</small>` : ""}</button>`).join("") || '<p class="help small vc-none">맞는 업체가 없어요</p>';
    list.hidden = false; inp.setAttribute("aria-expanded", "true"); window.__vcList = items.map((v) => v.name);
    $$("[data-vc]", list).forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(b.dataset.vc); }));
  };
  const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); };
  const pick = (id) => { close(); inp.value = ""; onPick(id); };
  const mark = () => $$(".vc-opt", list).forEach((b, i) => { b.classList.toggle("act", i === act); b.setAttribute("aria-selected", i === act); if (i === act) b.scrollIntoView({ block: "nearest" }); });
  inp.addEventListener("input", draw); inp.addEventListener("focus", draw); inp.addEventListener("blur", () => setTimeout(close, 150));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (list.hidden) draw(); if (!items.length) return; act = (act + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; mark(); }
    else if (e.key === "Enter") { e.preventDefault(); if (act >= 0 && items[act]) pick(items[act].id); }
    else if (e.key === "Escape") { close(); }
  });
}
/** 1.3.0 공종·세부공종 → 업체 자동 지정(설정 표 + 기록 학습 + 업체 담당 공종) */
function vendorLearned() { const all = PD(); const key = `${S.pid}|${all.length}|${all.at(-1)?.id}|${all.at(-1)?.vendorId}`; if (!S.vLearn || S.vLearn.key !== key) S.vLearn = { key, m: M.learnVendorMap(all) }; return S.vLearn.m; }
function autoVendorOf(dr, cands = null) {
  const a = M.autoVendorFor(dr, { table: P()?.vendorMap || [], learned: vendorLearned(), vendors: S.vendors }); if (a) return a;
  const c = (cands || M.vendorsForTrade(S.vendors, dr.trade, P()?.id, PD()))[0]; return c ? { id: c.id, why: `담당 공종 · ${dr.trade}`, src: "trades" } : null;
}
function renderForm() {
  const p = P(); const dr = S.draft; const editing = !!dr._editId;
  setTab(editing ? null : "new"); setHeader(editing ? "하자 수정" : "하자 등록", { backBtn: navDepth() > 1 || editing });
  const trade = p.trades.find((t) => t.name === dr.trade);
  const cands = M.vendorsForTrade(S.vendors, dr.trade, p.id, PD());
  /* 1.3.0 자동 지정: 설정 표 → 기록(세부공종·공종에 가장 많이 맡은 업체) → 업체 담당 공종. 미지정일 때만 채우고, 이미 있으면 ‘→ 업체로 변경’ 한 번 누르기 */
  if (dr.vendorAuto === undefined) dr.vendorAuto = !editing;
  const auto = autoVendorOf(dr, cands);
  if (dr.vendorAuto) dr.vendorId = auto?.id || (dr.trade ? "" : dr.vendorId);
  const sug = auto && dr.vendorId === auto.id ? auto : null;
  const hint = auto && auto.id !== dr.vendorId && !dr.vendorAuto ? auto : null;
  const loc = M.locText(dr);
  const plans = matchPlans(dr);
  const prevPhotos = editing ? photoCount({ id: dr._editId }) : { before: 0, after: 0 };
  view().innerHTML = `<nav class="fstep" id="fstep" aria-label="등록 단계">${[["loc", "위치"], ["ph", "사진"], ["what", "공종·내용"], ["save", "저장"]].map(([k, t], i) => `<button type="button" class="fs-i" data-fs="${k}"><span class="n">${i + 1}</span>${t}</button>`).join('<span class="fs-ln"></span>')}</nav>
    <form id="dform" class="form fsteps" novalidate>
    ${dr._copy && !editing ? `<div class="copy-bn" id="copy-bn" role="status">📋 <b>복사해서 등록</b> · ${dr._copy.focusLoc ? "위치를 바꿔 주세요" : "같은 위치"}${dr.photos.length ? ` · 사진 ${dr.photos.length}장` : ""}${dr._copy.focusLoc ? ' <button type="button" class="btn btn-sm" id="copy-keep">같은 위치 그대로</button>' : ""}</div>` : ""}
    <section class="fsec" id="fs-loc"><h3 class="fsec-h"><span class="n">1</span>위치 <em>*</em></h3>
    <label class="fld"><span class="sr-only">위치</span>
      <button type="button" class="inp loc-btn ${loc ? "" : "is-empty"}" id="btn-loc">${esc(loc || "동·층·호·실 선택")}<span>›</span></button></label>
    ${plans.length ? `<button type="button" class="btn btn-sm" id="btn-pin">🗺 도면에 위치 표시${dr.pin ? " ✓" : ""}</button>` : ""}</section>
    <section class="fsec" id="fs-ph"><h3 class="fsec-h"><span class="n">2</span>사진 <small>조치 전 ${prevPhotos.before ? `· 저장됨 ${prevPhotos.before}장` : ""}</small></h3>
      <div class="photos" id="ph-list">${dr.photos.map((ph, i) => `<div class="ph"><img src="${ph.url}" alt="사진 ${i + 1}"><button type="button" class="ph-x" data-rmph="${i}" aria-label="사진 삭제">✕</button></div>`).join("")}
        <button type="button" class="ph-add cam" id="btn-cam" aria-label="카메라로 바로 촬영">📷<span>${dr.photos.length ? "한 장 더" : "촬영"}</span></button></div>
      <div class="ph-more"><button type="button" class="btn btn-sm" id="btn-alb">🖼 앨범</button><small class="help">📷를 누르면 카메라가 바로 열려요</small></div></section>
    <section class="fsec" id="fs-what"><h3 class="fsec-h"><span class="n">3</span>공종·내용</h3>
    ${!editing ? (() => { const rc = recentCombos(8); return rc.length ? `<div class="fld recent-c"><span>최근 내용 불러오기 <small class="help">누르면 공종·세부공종·유형·내용 채움</small></span><div class="chips scroll" id="recent-c">${rc.map((x) => `<button type="button" class="chip rcombo" data-rc="${x.id}" title="${esc(x.content || "")}"><b>${esc(M.tradeText(x))}</b>${x.type ? ` · ${esc(x.type)}` : ""} <small>${esc((x.content || "").slice(0, 18))}</small></button>`).join("")}</div></div>` : ""; })() : ""}
    <div class="fld"><span>구분</span>${chipRow("category", M.catsOf(p), dr.category, { allowAdd: true, ua: (o) => isUserItem("categories", o) })}</div>
    <div class="fld"><span>공종 <em>*</em></span>${chipRow("trade", p.trades.map((t) => t.name), dr.trade, { allowAdd: true, ua: (o) => isUserItem("trades", o) })}</div>
    ${trade?.subs?.length ? `<div class="fld"><span>세부공종</span>${chipRow("subTrade", trade.subs, dr.subTrade, { allowAdd: true })}</div>` : ""}
    <div class="fld"><span>유형</span>${chipRow("type", p.types, dr.type, { allowAdd: true, ua: (o) => isUserItem("types", o) })}</div>
    <div class="fld"><span>중요도</span>${chipRow("severity", M.SEVERITIES, dr.severity)}</div>
    <label class="fld"><span>내용 <em>*</em></span><div class="ta-wrap"><textarea class="inp" id="f-content" rows="3" placeholder="예: 거실 창호 하부 실리콘 미시공">${esc(dr.content)}</textarea>
      ${speechSupported() ? `<button type="button" class="mic" id="btn-mic" aria-label="음성으로 입력">🎤</button>` : ""}</div></label></section>
    <section class="fsec" id="fs-save"><h3 class="fsec-h"><span class="n">4</span>업체·기한 · 저장</h3>
    <label class="fld"><span>담당업체 ${sug && dr.vendorAuto ? `<small class="sugg auto" title="${esc(sug.why)}">자동 지정 · ${esc(sug.why)}</small>` : sug ? `<small class="sugg">${esc(sug.why)}</small>` : ""}</span>
      <div class="vcombo"><input class="inp vc-q" id="f-vq" type="search" role="combobox" aria-expanded="false" aria-controls="f-vlist" aria-autocomplete="list" autocomplete="off" placeholder="🔍 업체 찾기 · 초성 가능 (예: ㄷㅎ)" aria-label="업체 찾기(초성 가능)"><div class="vc-list" id="f-vlist" role="listbox" hidden></div></div>
      <select class="inp" id="f-vendor"><option value="">업체 미지정</option>${S.vendors.map((v) => `<option value="${v.id}" ${v.id === dr.vendorId ? "selected" : ""}>${esc(v.name)}${(v.trades || []).length ? " · " + esc(v.trades.slice(0, 2).join(",")) : ""}</option>`).join("")}<option value="_new">＋ 새 업체 등록…</option></select></label>
    ${hint ? `<button type="button" class="btn btn-sm vhint" id="v-auto-hint" data-vid="${esc(hint.id)}">→ ${esc(V(hint.id)?.name || "")} 로 ${dr.vendorId ? "변경" : "지정"} <small>${esc(hint.why)}</small></button>` : ""}
    ${cands.length > 1 ? `<div class="chips vsw" id="v-switch"><small class="help">‘${esc(dr.trade)}’ 다른 업체:</small>${cands.filter((v) => v.id !== dr.vendorId).map((v) => `<button type="button" class="chip" data-vsw="${v.id}">${esc(v.name)}</button>`).join("")}</div>` : ""}
    <label class="fld"><span>조치기한</span><div class="row"><input class="inp" type="date" id="f-due" value="${esc(dr.due || "")}">
      ${[3, 7, 14].map((d) => `<button type="button" class="chip" data-due="${d}">+${d}일</button>`).join("")}</div></label></section>
    <div class="form-act">${editing ? `<button type="button" class="btn btn-lg" id="btn-cancel">취소</button>` : `<button type="button" class="btn btn-lg" id="btn-save-next">저장 후 계속</button>`}
      <button type="submit" class="btn btn-primary btn-lg">${editing ? "수정 저장" : "저장"}</button></div>
    <p class="help" id="form-err" role="alert"></p></form>`;
  const stepState = () => { const c = ($("#f-content")?.value || dr.content || "").trim();
    const st = { loc: !!M.locText(dr), ph: dr.photos.length > 0 || prevPhotos.before > 0, what: !!dr.trade && !!(c || dr.type), save: false };
    $$(".fs-i", view()).forEach((b) => b.classList.toggle("done", !!st[b.dataset.fs]));
    const cur = ["loc", "ph", "what", "save"].find((k) => !st[k]) || "save"; $$(".fs-i", view()).forEach((b) => b.classList.toggle("cur", b.dataset.fs === cur)); };
  stepState(); $("#f-content").addEventListener("input", stepState);
  $$(".fs-i", view()).forEach((b) => b.addEventListener("click", () => $("#fs-" + b.dataset.fs)?.scrollIntoView({ block: "start", behavior: "smooth" })));
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
    if (k === "trade" && dr.trade !== v) dr.subTrade = "";
    if ((k === "trade" || k === "subTrade") && !dr.vendorId) dr.vendorAuto = true; // 미지정이면 공종·세부공종 고를 때 자동 지정(새 등록·수정 모두)
    dr[k] = dr[k] === v && k !== "category" && k !== "severity" ? "" : v;
    if (k === "category") LS.set("lastCat", v);
    renderForm();
  }));
  onLongPress($("#dform"), "[data-chips] .chip[data-ua]", async (b) => { sync(); const LK = { trade: "trades", type: "types", category: "categories" }[b.closest("[data-chips]").dataset.chips]; if (LK) { await editListItem(LK, b.dataset.v); renderForm(); } });
  $("#btn-loc").addEventListener("click", () => { sync(); locationPicker(dr, () => renderForm()); });
  $$("[data-rc]", view()).forEach((b) => b.addEventListener("click", () => { sync(); const x = S.defects.find((d) => d.id === b.dataset.rc); if (!x) return; for (const k of ["trade", "subTrade", "type", "content"]) dr[k] = x[k] || ""; if (!dr.vendorId) dr.vendorAuto = true; window.__recentPicked = x.id; renderForm(); toast("최근 내용을 넣었어요"); }));
  $("#copy-keep")?.addEventListener("click", () => { dr._copy.focusLoc = false; dr._copy.opened = true; renderForm(); });
  if (dr._copy && dr._copy.focusLoc && !dr._copy.opened && !editing) { dr._copy.opened = true; $("#fs-loc")?.scrollIntoView({ block: "start" }); setTimeout(() => { if (S.draft === dr && location.hash.split("?")[0] === "#/new") locationPicker(dr, () => renderForm(), { quick: true }); }, 80); }
  $("#btn-pin")?.addEventListener("click", () => { sync(); pinSheet(plans, dr, () => renderForm()); });
  $("#btn-mic")?.addEventListener("click", () => {
    const ta = $("#f-content"); const base = ta.value ? ta.value + " " : ""; const mic = $("#btn-mic"); mic.classList.add("on");
    startDictation({ onText: (t) => { ta.value = base + t; }, onError: (e) => toast(e === "network" ? "음성 인식은 인터넷 연결이 필요해요" : "음성 입력을 쓸 수 없어요"), onEnd: () => { mic.classList.remove("on"); dr.content = ta.value; } });
  });
  const addPh = async (capture) => {
    sync(); const files = await pickFile("image/*", { capture, multiple: !capture }); if (!files.length) return;
    busy(true, "사진 압축 중…");
    for (const f of files) {
      try { const at = new Date().toISOString(); const on = stampOn(); const c = await compressImage(f, { stamp: on ? stampInfo(stampOf(dr), "before", at) : null }); dr.photos.push({ ...c, at, stamp: on ? "1" : "0", url: URL.createObjectURL(c.thumb) }); }
      catch (e) { toast(e.message); }
    }
    busy(false); renderForm();
    if (capture) toast(`사진 ${dr.photos.length}장`, { ms: 6000, action: "📷 한 장 더", onAction: () => addPh(true) });
  };
  $("#btn-cam").addEventListener("click", () => addPh(true));
  $("#btn-alb").addEventListener("click", () => addPh(false));
  $$("[data-rmph]", view()).forEach((b) => b.addEventListener("click", () => { sync(); dr.photos.splice(+b.dataset.rmph, 1); renderForm(); }));
  vendorCombo($("#f-vq"), { current: () => dr.vendorId, first: () => [auto?.id, ...cands.map((v) => v.id)], onPick: (id) => { sync(); dr.vendorId = id; dr.vendorAuto = false; window.__vcPicked = id; renderForm(); } });
  $("#v-auto-hint")?.addEventListener("click", (e) => { sync(); dr.vendorId = e.currentTarget.dataset.vid; dr.vendorAuto = true; renderForm(); });
  $$("[data-vsw]", view()).forEach((b) => b.addEventListener("click", () => { sync(); dr.vendorId = b.dataset.vsw; dr.vendorAuto = false; renderForm(); }));
  $("#f-vendor").addEventListener("change", async (e) => {
    sync();
    if (e.target.value === "_new") { const v = await quickVendor(dr.trade); if (v) { dr.vendorId = v.id; dr.vendorAuto = false; } renderForm(); return; }
    dr.vendorId = e.target.value; dr.vendorAuto = false; renderForm();
  });
  $$("[data-due]", view()).forEach((b) => b.addEventListener("click", () => { sync(); dr.due = M.addDays(+b.dataset.due); renderForm(); }));
  $("#btn-cancel")?.addEventListener("click", () => { S.draft = null; back(); });
  const save = async (next) => {
    sync();
    const err = !dr.dong && !dr.common && !dr.locEtc?.trim() && !dr.room && !dr.part ? "위치를 선택하세요" : !dr.trade ? "공종을 선택하세요" : !dr.content.trim() && !dr.type ? "내용 또는 유형을 입력하세요" : "";
    if (err) { $("#form-err").textContent = err; toast(err); return; }
    busy(true, "저장 중…");
    const now = new Date().toISOString();
    const fields = ["dong", "core", "floor", "ho", "common", "room", "part", "locEtc", "trade", "subTrade", "type", "category", "severity", "content", "vendorId", "due", "pin"];
    let d;
    if (editing) { d = S.defects.find((x) => x.id === dr._editId); const v0 = d.vendorId || ""; for (const k of fields) d[k] = dr[k]; const moved = (dr.vendorId || "") !== v0;
      d.history = [...(d.history || []), { at: now, status: d.status, note: moved ? `내용 수정 · 업체 변경: ${v0 ? vLabel(v0) : "업체 미지정"} → ${d.vendorId ? vLabel(d.vendorId) : "업체 미지정"}` : "내용 수정", ...(moved ? { kind: "transfer" } : {}), ...(Sync.attached() && Sync.signedIn() ? { by: Sync.actorName() } : {}) }];
      if (moved && M.hasSteps(d)) { const own = d.steps.find((x) => x.own); if (own) own.vendorId = d.vendorId || ""; } }
    else { d = { id: M.uid("h"), projectId: p.id, createdAt: now, status: "접수", memo: "", origin: "local", history: [{ at: now, status: "접수", note: "등록" }] }; for (const k of fields) d[k] = dr[k]; d.content = d.content.trim(); }
    await saveDefect(d);
    for (const ph of dr.photos) {
      await db.put("photos", { id: M.uid("ph"), defectId: d.id, kind: "before", blob: ph.blob, thumb: ph.thumb, w: ph.w, h: ph.h, at: ph.at, stamp: ph.stamp || "1" });
      const m = S.pidx.get(d.id) || { before: 0, after: 0 }; m.before++; S.pidx.set(d.id, m); URL.revokeObjectURL(ph.url);
    }
    busy(false);
    const keep = { dong: d.dong, core: d.core || "", floor: d.floor, ho: d.ho, common: d.common, room: d.room, locEtc: d.locEtc || "" };
    S.draft = null;
    if (editing) { toast("수정했어요"); back(); return; }
    const again = () => { S.justSaved = null; startCopyDraft(d, { keepLoc: true, focusLoc: true }); if (location.hash.split("?")[0] === "#/new") renderForm(); else go("#/new"); };
    if (next) { startDraft(keep); toast(`저장했어요 · ${M.locText(d)} 계속 등록`, { ms: 7000, action: "같은 내용으로 하나 더", onAction: again }); renderForm(); window.scrollTo(0, 0); }
    else { S.justSaved = d.id; toast("저장했어요", { ms: 7000, action: "같은 내용으로 하나 더", onAction: again }); replace(`#/item?id=${d.id}`); }
  };
  $("#dform").addEventListener("submit", (e) => { e.preventDefault(); save(false); });
  $("#btn-save-next")?.addEventListener("click", () => save(true));
}

/* 위치 선택기: 동/공용부 → 층 → 호 → 실 → 부위 (단계마다 뒤로가기 한 칸).
 * 단계마다 '＋ 직접 추가'(현장 설정에 저장 → 선택 → 다음 단계), 직접 추가한 항목은 ✎/길게 눌러 이름 변경·삭제(미사용 시),
 * '기타 위치 직접 입력'은 저장하지 않는 1회용 위치 */
function locationPicker(dr, onDone, { quick = false } = {}) {
  const p = P(); if (!Array.isArray(p.dongCommons)) p.dongCommons = [...M.DEFAULT_DONG_COMMONS];
  const sel = { dong: dr.dong, core: dr.core || "", floor: dr.floor, ho: dr.ho, common: dr.common, room: dr.room, part: dr.part, locEtc: dr.locEtc || "", pin: dr.pin || null };
  /** 단지 공용 장소(지하주차장 등)에 도면 세부 위치가 있으면 층 → 세부 위치로 */
  const place = () => (!sel.dong && sel.common && M.placeSpots(p, S.plans, sel.common).length ? sel.common : "");
  const dropSpotPin = () => { if (sel.pin?.spot) sel.pin = null; };
  const STEPS = ["dong", "floor", "ho", "room", "part"];
  let step = 0; const stepLayers = [];
  const s = openSheet({ title: "위치 선택", full: true, cls: "lp-sheet", html: `<div id="lp"></div>`, footer: `<div class="lp-sum" id="lp-sum"></div><button type="button" class="btn btn-primary btn-lg" id="lp-ok">확인</button>`,
    onBack: () => (step > 0 ? history.back() : s.close()) });
  const dongObj = () => p.dongs.find((d) => d.name === sel.dong);
  const setStep = (i, push = true) => {
    if (push && i > step) { const from = step; stepLayers.push(pushLayer(() => { step = from; draw(); })); }
    step = i; draw();
  };
  const tile = (v, label, on, cls = "", ua = false) => `<button type="button" class="tile ${on ? "on" : ""} ${cls} ${ua ? "ua" : ""}" data-v="${esc(v)}"${ua ? ' data-ua="1"' : ""}>${esc(label)}${ua ? '<span class="ua-ed" data-ed="1" title="이름 변경·삭제">✎</span>' : ""}</button>`;
  const addTile = (what, key = "_add") => tile(key, "＋ 추가", false, "add").replace("<button ", `<button aria-label="${esc(what)} 직접 추가" `);
  const isNumFloor = (f) => /^\d+$/.test(String(f || ""));
  const nextAfterFloor = (d, f) => (d && (M.unitsOf(d, f).length || isNumFloor(f)) ? 2 : 3);
  const used = (pred) => PD().filter(pred).length;
  const sortDongs = () => p.dongs.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  /** 동 공용부 타일(층을 골랐으면 그 층의 공용부: 예) 301동 12층 계단실) */
  function dongCommonHtml() {
    if (!sel.dong) return "";
    const where = `${sel.dong}${sel.core ? ` ${sel.core}코어` : ""}${sel.floor ? " " + M.floorLabel(sel.floor) : ""}`;
    return `${coreRowHtml()}<h4>${esc(where)} 공용부 <small class="help">계단실·EV홀 등 — 층은 골라도 되고 건너뛰어도 돼요</small></h4><div class="tiles cm">${p.dongCommons.map((c) => tile("dc:" + c, c, !sel.ho && c === sel.common, "common", isUserItem("dongCommons", c))).join("")}${addTile("동 공용부", "_adddc")}</div>`;
  }
  /** 1.2.7 동 공용부(방풍실·계단실·EV홀 등)의 코어: 코어 설정 기준 목록 + 코어 미지정. 호는 라인으로 자동이라 안 물어봄 */
  function coreRowHtml() {
    if (!sel.dong || sel.ho) return "";
    const cs = M.coresOf(p, sel.dong, PD());
    return `<h4>${esc(sel.dong)} 코어 <small class="help">공용부가 어느 코어인지 — 모르면 미지정</small></h4><div class="tiles small co-tiles" id="lp-core">${tile("core:", "코어 미지정", !sel.core, "core")}${cs.map((c) => tile("core:" + c, `${c}코어`, Number(sel.core) === c, "core")).join("")}</div>`;
  }
  const canSave = () => !!(sel.dong || sel.common || sel.locEtc?.trim() || sel.room || sel.part);
  function draw() {
    s.setBackVisible(step > 0);
    const box = $("#lp", s.el); const d = dongObj();
    const crumbs = [sel.dong, !sel.ho && sel.core && `${sel.core}코어`, sel.floor && M.floorLabel(sel.floor), sel.ho && sel.ho + "호", sel.common, sel.room, sel.part, sel.locEtc && `(${sel.locEtc})`].filter(Boolean);
    const K = STEPS[step]; const has = K === "dong" ? !!sel.dong : K === "floor" ? !!(sel.floor || (sel.dong && sel.common)) : !!sel[K];
    const skipLabel = K === "part" ? (has ? "완료 ✓" : "건너뛰고 완료 ✓") : has ? "다음 ›" : { dong: "동 건너뛰기 ›", floor: "층 건너뛰기 ›", ho: "호 건너뛰기 ›", room: "실 건너뛰기 ›" }[K];
    let h = `<div class="lp-top"><ol class="steps">${["동", "층", "호", "실", "부위"].map((t, i) => `<li class="${i === step ? "on" : i < step ? "done" : ""}" data-go="${i}">${t}</li>`).join("")}</ol><button type="button" class="btn btn-sm lp-skip" data-skip="1">${skipLabel}</button></div>`;
    if (STEPS[step] === "dong") {
      /* 1.3.0 단지 공용(지하주차장·부대시설 등)을 동 위에 — 동이 많아도 바로 보이게 */
      h += `<h4>단지 공용 <small class="help">지하주차장·부대시설 등 동과 상관없는 곳</small></h4><div class="tiles cm" id="lp-site">${[...new Set([...(p.commons.length ? p.commons : M.DEFAULT_COMMONS), ...M.placesWithPlans(p, S.plans), ...dataSites()])].map((c) => tile("c:" + c, c + (M.placeSpots(p, S.plans, c).length ? " ›" : ""), !sel.dong && c === sel.common, "common", isUserItem("commons", c) && p.commons.includes(c))).join("")}${addTile("단지 공용", "_addc")}</div>
        <h4>동</h4><div class="tiles">${p.dongs.map((x) => tile(x.name, x.name, x.name === sel.dong, "", !!x.userAdded)).join("")}${addTile("동", "_add")}</div>
        <p class="help">동 안의 공용부(계단실·EV홀·피트실·옥상 등)는 동을 고르면 나와요.</p>`;
    } else if (STEPS[step] === "floor") {
      const pf = !d && place() ? M.placeFloors(p, S.plans, sel.common) : null;
      const fl = d ? M.floorsOf(d) : pf || []; const ex = new Set(d?.extraFloors || []);
      h += `<h4>${esc(sel.dong || sel.common)} · 층${pf ? ' <small class="help">도면 기준 — 모르면 건너뛰기</small>' : ""}</h4><div class="tiles small">${(pf ? fl : [...fl].reverse()).map((f) => tile(f, M.floorLabel(f), f === sel.floor, "", ex.has(f))).join("")}${d ? addTile("층") : ""}</div>`;
      h += dongCommonHtml();
    } else if (STEPS[step] === "ho") {
      const us = d ? M.unitsOf(d, sel.floor) : []; const ex = new Set(d?.extraUnits || []);
      h += `<h4>${esc(sel.dong)} ${esc(M.floorLabel(sel.floor))} · 호</h4><div class="tiles">${us.map((u) => tile(u, u + "호", u === sel.ho, "", ex.has(u))).join("")}${addTile("호")}</div>
        ${us.length ? "" : '<p class="help">이 층에 등록된 세대가 없어요. 필요하면 ＋ 직접 추가로 호수를 넣으세요.</p>'}
`;
      h += dongCommonHtml();
    } else if (STEPS[step] === "room") {
      const pg = place() ? M.placeSpots(p, S.plans, sel.common, sel.floor) : [];
      if (pg.length) {
        h += `<h4>${esc(sel.common)}${sel.floor ? " " + esc(M.floorLabel(sel.floor)) : ""} · 세부 위치 <small class="help">도면에서 — 누르면 도면 핀도 그 자리에</small></h4>` +
          pg.map((g) => `${pg.length > 1 ? `<h4 class="sub">${esc(g.plan.name)}</h4>` : ""}<div class="tiles cm">${g.spots.map((r) => tile(r.name, r.name, r.name === sel.room, "spot").replace("<button ", `<button data-pl="${esc(g.plan.id)}" data-x="${r.x ?? ""}" data-y="${r.y ?? ""}" `)).join("")}</div>`).join("") +
          `<div class="tiles cm">${addTile("실")}</div>`;
      } else {
      const rf = M.roomsFor(p, sel.dong, sel.ho);
      if (sel.dong && sel.common && !sel.ho) h += coreRowHtml();
      h += `<h4>실${rf.type ? ` <small class="help">${esc(rf.type)} 평형</small>` : ""}</h4><div class="tiles">${rf.rooms.map((r) => tile(r, r, r === sel.room, "", isUserItem("rooms", r) && !(p.roomsByType?.[rf.type] || []).includes(r))).join("")}${addTile("실")}</div>`;
      }
    } else {
      h += `<h4>부위</h4><div class="tiles">${p.parts.map((r) => tile(r, r, r === sel.part, "", isUserItem("parts", r))).join("")}${addTile("부위")}</div>`;
    }
    h += `<button type="button" class="btn btn-block btn-etc" id="lp-etc">✎ ${sel.locEtc ? `기타 위치: ${esc(sel.locEtc)} (수정)` : "기타 위치 직접 입력 (저장 안 함)"}</button>`;
    box.innerHTML = h;
    $("#lp-sum", s.el).textContent = crumbs.length ? "선택: " + crumbs.join(" · ") : "동 또는 공용부를 먼저 고르세요";
    const ok = $("#lp-ok", s.el); ok.disabled = !canSave();
    $$(".tile", box).forEach((b) => b.addEventListener("click", async (e) => {
      let v = b.dataset.v; const k = STEPS[step];
      if (b.dataset.ua && e.target.closest("[data-ed]")) return editTile(b);
      if (v.startsWith("core:")) { sel.core = v.slice(5) ? Number(v.slice(5)) : ""; return draw(); }
      if (v === "_adddc") { const nv = await addListItem("dongCommons"); if (nv == null) return; v = "dc:" + nv; }
      if (v === "_add" || v === "_addc") { v = await addHere(k, v === "_addc"); if (v == null) return; }
      if (v.startsWith("dc:")) {
        const c = v.slice(3); sel.ho = "";
        if (k === "floor" && !sel.floor) { sel.common = sel.common === c ? "" : c; return draw(); } // 층을 안 골랐으면 같은 화면에서 층을 더 고를 수 있게(선택)
        sel.common = c; return setStep(3);
      }
      if (k === "dong") {
        dropSpotPin();
        if (v.startsWith("c:")) { const c = v.slice(2); if (sel.common !== c || M.placeSpots(p, S.plans, c).length) sel.room = ""; sel.common = c; sel.dong = ""; sel.core = ""; sel.floor = ""; sel.ho = ""; return setStep(place() && M.placeFloors(p, S.plans, c).length ? 1 : 3); }
        if (sel.dong !== v) sel.core = ""; sel.floor = ""; sel.ho = ""; sel.dong = v; sel.common = ""; return setStep(1); // 동을 (다시) 누르면 층·호·공용부를 새로 고름
      }
      if (k === "floor") { if (sel.floor !== v) sel.ho = ""; sel.floor = v; return setStep(sel.common ? 3 : nextAfterFloor(dongObj(), v)); }
      if (k === "ho") { sel.ho = v; sel.common = ""; return setStep(3); }
      if (k === "room") {
        sel.room = v;
        if (b.dataset.pl && b.dataset.x !== "" && (!sel.pin || sel.pin.spot)) sel.pin = { planId: b.dataset.pl, x: Number(b.dataset.x), y: Number(b.dataset.y), spot: 1 };
        else dropSpotPin();
        return setStep(4);
      }
      sel.part = v; draw();
    }));
    $("[data-skip]", box)?.addEventListener("click", () => {
      const k = STEPS[step];
      if (k === "dong") { if (sel.dong) return setStep(1); sel.floor = ""; sel.ho = ""; return setStep(3); }
      if (k === "floor") { if (sel.floor && !sel.common) return setStep(nextAfterFloor(dongObj(), sel.floor)); sel.ho = ""; return setStep(3); }
      if (k === "ho") return setStep(3);
      if (k === "room") return setStep(4);
      if (!canSave()) return toast("동·공용부·실·부위 중 하나는 고르거나 기타 위치를 입력하세요");
      $("#lp-ok", s.el).click();
    });
    $$("[data-go]", box).forEach((li) => li.addEventListener("click", () => { if (Number(li.dataset.go) < step) history.back(); }));
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
    if (v.startsWith("dc:")) {
      const c = v.slice(3); const before = [...p.dongCommons]; const r = await editListItem("dongCommons", c);
      if (r === "del" && sel.common === c) sel.common = "";
      if (r === "ren" && sel.common === c) sel.common = p.dongCommons.find((x) => !before.includes(x)) || "";
      return draw();
    }
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
    if (!canSave()) return;
    Object.assign(dr, sel); if (sel.ho && !sel.floor) dr.floor = M.floorOfHo(sel.ho);
    if (sel.ho || !sel.dong) dr.core = ""; // 호는 라인으로 코어 자동
    await s.close(); onDone();
  });
  /* 1.3.1 복사해서 등록: 같은 층의 호(세대) 고르기부터 — 뒤로 가면 층·동 */
  const start = quick ? (dr.dong && dr.floor && dr.ho ? 2 : dr.dong ? 1 : 0) : dr.part ? 4 : dr.room ? 4 : dr.ho ? 3 : dr.common ? 3 : dr.floor ? 2 : dr.dong ? 1 : 0;
  // 바로 앞 단계에서 시작한 것처럼(뒤로 가면 동 공용부·호 고르는 화면으로)
  const prev = start === 4 ? 3 : start === 3 ? (sel.dong ? (sel.floor && !sel.common ? 2 : 1) : 0) : start === 2 ? 1 : 0;
  step = 0; draw(); if (prev) setStep(prev); if (start) setStep(start); // 뒤로 가기로 동 단계까지 차례로
}

/* 도면 핀 */
async function pinSheet(plans, dr, onDone) {
  let plan = plans.find((x) => x.id === dr.pin?.planId) || plans[0];
  let pin = dr.pin?.planId === plan.id ? { ...dr.pin } : null;
  // 실·공용부 이름이 도면에 있으면 그 자리에 미리 찍어 두기(눌러서 고치면 됨)
  let hint = "";
  if (!pin) { const want = [dr.room, dr.common].filter(Boolean); for (const pl of plans) { const r = pl.rooms?.find((x) => want.includes(x.name) && x.x != null); if (r) { plan = pl; pin = { planId: pl.id, x: r.x, y: r.y, auto: 1 }; hint = r.name; break; } } }
  const s = openSheet({ title: "도면에 위치 표시", full: true,
    html: `${plans.length > 1 ? `<div class="chips scroll">${plans.map((x) => `<button type="button" class="chip ${x.id === plan.id ? "on" : ""}" data-pl="${x.id}">${esc(x.name)}</button>`).join("")}</div>` : ""}
      <p class="help">${hint ? `‘${esc(hint)}’ 자리에 미리 찍어 뒀어요. 정확한 곳을 눌러 고치세요.` : "도면을 눌러 하자 위치를 찍으세요. 두 손가락으로 확대할 수 있어요."}</p><div class="plan" id="plan"><img id="plan-img" alt="도면"><i class="pin" hidden></i></div>`,
    footer: `<button type="button" class="btn" data-a="clear">표시 지우기</button><button type="button" class="btn btn-primary" data-a="ok">확인</button>` });
  const img = $("#plan-img", s.el); const pinEl = $(".pin", s.el);
  const show = () => { img.src = URL.createObjectURL(plan.blob); pinEl.hidden = !pin; if (pin) { pinEl.style.left = pin.x * 100 + "%"; pinEl.style.top = pin.y * 100 + "%"; } };
  show();
  if (pin?.auto) img.addEventListener("load", () => pinEl.scrollIntoView?.({ block: "center", inline: "center" }), { once: true });
  $("#plan", s.el).addEventListener("click", (e) => {
    const r = img.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    pin = { planId: plan.id, x: +x.toFixed(4), y: +y.toFixed(4) }; show();
  });
  $$("[data-pl]", s.el).forEach((b) => b.addEventListener("click", () => { plan = plans.find((x) => x.id === b.dataset.pl); pin = null; $$("[data-pl]", s.el).forEach((c) => c.classList.toggle("on", c === b)); show(); }));
  $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", async () => { dr.pin = b.dataset.a === "ok" && pin ? (({ auto, ...x }) => x)(pin) : null; await s.close(); onDone(); }));
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
      <dl class="kv"><dt>위치</dt><dd>${esc(M.locText(d))}</dd><dt>업체</dt><dd class="dd-v">${v ? `<a href="#/vendor?id=${v.id}">${esc(v.name)}</a>` : "미지정"}<button type="button" class="btn btn-sm btn-ghost dd-act" id="btn-move-kv" aria-label="업체 이관">🔁 이관</button></dd>
        <dt>조치기한</dt><dd>${esc(d.due || "-")}</dd>${d.reqAt ? `<dt>요청서</dt><dd id="req-at">${esc(d.reqNo || "")} · ${fmtDT(d.reqAt)} 발송</dd>` : ""}<dt>등록</dt><dd>${fmtDT(d.createdAt)}${d.createdBy ? ` · <b class="who">${esc(d.createdBy)}</b>` : ""}${d.extId ? ` · 외부ID ${esc(d.extId)}` : ""}</dd>
         ${d.updatedBy ? `<dt>최근 수정</dt><dd id="who-upd"><b class="who">${esc(d.updatedBy)}</b> · ${fmtDT(d.updatedByAt || d.updatedAt)}</dd>` : ""}</dl></section>
    <ol class="flow" aria-label="상태 바로 바꾸기">${["접수", "업체전달", "조치중", "조치완료", "확인완료", ...(["재접수", "조치완료", "확인완료"].includes(d.status) ? ["재접수"] : [])].map((s2, i) => `<li class="${s2 === d.status ? "on" : i < idx && d.status !== "재접수" ? "done" : ""}${s2 === "재접수" ? " re" : ""}"><button type="button" class="flow-b" data-flow="${s2}" ${s2 === d.status ? 'aria-current="step"' : ""} aria-label="상태를 ${s2}(으)로">${s2}</button></li>`).join("")}</ol>
    <div class="act-row">${nx ? `<button type="button" class="btn btn-primary btn-lg" data-st="${nx}">${nx === "업체전달" ? "업체에 보내기" : nx + " 처리"}</button>` : ""}
      ${d.status === "조치완료" || d.status === "확인완료" ? `<button type="button" class="btn btn-lg btn-warn" data-st="재접수">재접수</button>` : ""}
      <button type="button" class="btn btn-lg" id="btn-stany">상태 선택</button></div>
    ${v ? `<div class="contact-row">${(() => { const vp = M.vendorPhones(v); if (!vp.length) return ""; if (vp.length === 1) { const ph = vp[0].phone; return `<a class="btn" href="${M.telHref(ph)}">📞 전화</a><a class="btn" href="${M.smsHref(ph, M.shareMessage({ project: P(), vendor: v, items: [d] }))}" data-sms>💬 문자</a>`; } return `<button type="button" class="btn" id="btn-dtel">📞 전화 ▾</button><button type="button" class="btn" id="btn-dsms">💬 문자 ▾</button>`; })()}
      <button type="button" class="btn btn-kakao" id="btn-kakao">카톡으로 보내기</button></div>` : `<button type="button" class="btn btn-block" id="btn-kakao">카톡·공유로 보내기</button>`}
    ${S.justSaved === d.id ? `<button type="button" class="btn btn-primary btn-block" id="btn-again">➕ 같은 내용으로 하나 더 <small>위치만 바꿔서</small></button>` : ""}
    <div class="btn-row2"><button type="button" class="btn btn-req" id="btn-reqimg">🧾 요청서 만들기</button><button type="button" class="btn btn-req" id="btn-move">🔁 업체 이관</button></div>
    <button type="button" class="btn btn-block" id="btn-copy">📋 복사해서 등록</button>
    <button type="button" class="btn btn-block btn-tags ${d.tabs?.length ? "on" : ""}" id="btn-tags">${d.tabs?.length ? "★" : "☆"} 관리 탭${(() => { const nm = TABS().filter((t) => M.inTab(d, t.id)).map((t) => t.name); return nm.length ? ` · ${esc(nm.join(", "))}` : " 넣기"; })()}</button>
    ${stepsHtml(d, photos)}
    <section class="card"><h3>조치 전 사진 <small>${before.length}</small></h3><div class="photos">${before.map((ph) => `<button type="button" class="ph" data-ph="${ph.id}"><img src="${purl(ph)}" alt="조치 전"></button>`).join("")}
      <button type="button" class="ph-add cam" data-add="before" aria-label="조치 전 사진 바로 촬영">📷<span>${before.length ? "한 장 더" : "촬영"}</span></button></div>
      <div class="ph-more"><button type="button" class="btn btn-sm" data-alb="before">🖼 앨범</button></div></section>
    <section class="card"><h3>조치 후 사진 <small>${after.length}</small></h3><div class="photos">${after.map((ph) => `<button type="button" class="ph" data-ph="${ph.id}"><img src="${purl(ph)}" alt="조치 후"></button>`).join("")}
      <button type="button" class="ph-add cam" data-add="after" aria-label="조치 후 사진 바로 촬영">📷<span>${after.length ? "한 장 더" : "촬영"}</span></button></div>
      <div class="ph-more"><button type="button" class="btn btn-sm" data-alb="after">🖼 앨범</button></div></section>
    ${plan ? `<section class="card"><h3>도면 위치 <small>${esc(plan.name)}</small></h3><div class="plan mini"><img src="${(() => { const u = URL.createObjectURL(plan.blob); urls.push(u); return u; })()}" alt="도면"><i class="pin" style="left:${d.pin.x * 100}%;top:${d.pin.y * 100}%"></i></div></section>` : ""}
    <section class="card"><h3>메모</h3><textarea class="inp" id="memo" rows="2" placeholder="현장 메모(업체 전달 문구에는 포함되지 않음)">${esc(d.memo || "")}</textarea></section>
    <section class="card"><h3>처리 이력</h3><ol class="hist">${[...(d.history || [])].reverse().map((h) => `<li${h.kind === "transfer" ? ' class="h-move"' : ""}><time>${fmtDT(h.at)}</time> ${h.kind === "transfer" ? `<span class="pill pmove">🔁 이관</span>${h.from && h.from !== h.status ? " " + pill(h.status) : ""}` : pill(h.status)} ${esc(h.kind === "transfer" ? String(h.note || "").replace(/^업체 이관: /, "") : h.note || "")}${h.by ? ` <small class="who">· ${esc(h.by)}</small>` : ""}</li>`).join("")}</ol></section>
    <button type="button" class="btn btn-danger btn-block" id="btn-del">이 하자 삭제</button>`;
  ROUTES._cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  $("#btn-edit").addEventListener("click", () => { startDraft({}, d); go(`#/edit?id=${d.id}`); });
  $$("[data-st]", view()).forEach((b) => b.addEventListener("click", () => changeStatus(d, b.dataset.st)));
  $$("[data-flow]", view()).forEach((b) => b.addEventListener("click", () => quickStatus(d, b.dataset.flow)));
  $("#btn-stany").addEventListener("click", async () => { const st = await choose("상태 선택", M.STATUSES.map((s2) => ({ label: s2, value: s2, sub: s2 === d.status ? "현재" : "" }))); if (st) changeStatus(d, st); });
  $("#btn-kakao").addEventListener("click", () => sendSheet({ items: [d], vendor: v }));
  $("#btn-reqimg").addEventListener("click", () => requestImageFor([d], v || null));
  $("#btn-copy").addEventListener("click", () => copyToNewSheet(d));
  $("#btn-again")?.addEventListener("click", () => { S.justSaved = null; startCopyDraft(d, { keepLoc: true, focusLoc: true }); go("#/new"); });
  $("#btn-tags").addEventListener("click", () => tabSheet([d], () => rerender()));
  $("#btn-move").addEventListener("click", () => transferSheet([d])); $("#btn-move-kv").addEventListener("click", () => transferSheet([d]));
  $("[data-sms]", view())?.addEventListener("click", () => setTimeout(() => markSent([d], "문자"), 300));
  $("#btn-dtel", view())?.addEventListener("click", async () => { const ph = await pickPhone(V(d.vendorId), "전화"); if (ph) location.href = M.telHref(ph); });
  $("#btn-dsms", view())?.addEventListener("click", async () => { const ph = await pickPhone(V(d.vendorId), "문자"); if (!ph) return; location.href = M.smsHref(ph, M.shareMessage({ project: P(), vendor: V(d.vendorId), items: [d] })); setTimeout(() => markSent([d], "문자"), 300); });
  // 1.2.3 📷 = 카메라 바로(capture) · 🖼 앨범 = 여러 장 고르기 · 찍은 뒤 ‘한 장 더’
  const addDPh = async (kind, capture) => {
    const files = await pickFile("image/*", { capture, multiple: !capture }); if (!files.length) return;
    busy(true, "사진 저장 중…"); await addPhotos(d.id, files, kind, stampOf(d)); busy(false); rerender();
    if (capture) { const m = photoCount(d); toast(`${kind === "after" ? "조치 후" : "조치 전"} 사진 ${kind === "after" ? m.after : m.before}장`, { ms: 6000, action: "📷 한 장 더", onAction: () => addDPh(kind, true) }); }
  };
  $$("[data-add]", view()).forEach((b) => b.addEventListener("click", () => addDPh(b.dataset.add, true)));
  $$("[data-alb]", view()).forEach((b) => b.addEventListener("click", () => addDPh(b.dataset.alb, false)));
  $$("[data-ph]", view()).forEach((b) => b.addEventListener("click", () => photoViewer(photos, b.dataset.ph, () => rerender(), d)));
  $("#memo").addEventListener("change", async (e) => { d.memo = e.target.value; await saveDefect(d); toast("메모 저장"); });
  bindSteps(d);
  $("#btn-del").addEventListener("click", async () => {
    if (!(await ask("이 하자와 사진을 삭제할까요? 되돌릴 수 없어요.", { ok: "삭제", danger: true }))) return;
    await db.delByIndex("photos", "by_defect", d.id); await db.del("defects", d.id);
    S.defects = S.defects.filter((x) => x.id !== d.id); S.pidx.delete(d.id); toast("삭제했어요"); back();
  });
};
/** 상세 화면 상태 단계 탭: 묻지 않고 바로 바꾸고 3초 ‘되돌리기’. 조치완료인데 조치 후 사진이 없으면 안내만(막지 않음) */
async function quickStatus(d, st) {
  if (d.status === st) return toast(`이미 ‘${st}’ 상태예요`);
  if (!(await stepsGuard(d, st))) return;
  const prev = d.status; setStatus(d, st); await saveDefect(d); rerender();
  const hint = st === "조치완료" && !photoCount(d).after ? " · 조치 후 사진은 아래 📷에서 추가" : "";
  toast(`‘${st}’(으)로 변경${hint}`, { ms: 3000, action: "되돌리기", onAction: async () => { setStatus(d, prev, "되돌리기"); await saveDefect(d); rerender(); } });
}
async function changeStatus(d, st) {
  if (st === "업체전달") return sendSheet({ items: [d], vendor: V(M.turnVendorId(d) || d.vendorId) });
  if (!(await stepsGuard(d, st))) return;
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
/* ---------- 1.0.8 후속 공정(공정 단계) ---------- */
/** 공정 목록 준비: 첫 단계는 하자 자체 공종(own) — 하자의 공종·업체를 따라간다 */
function ensureSteps(d) {
  if (!Array.isArray(d.steps) || !d.steps.length) d.steps = [{ id: M.uid("st"), trade: d.trade || "공종 미지정", vendorId: d.vendorId || "", status: ["조치완료", "확인완료"].includes(d.status) ? "완료" : d.status === "조치중" ? "조치중" : d.status === "업체전달" ? "전달" : "대기", due: d.due || "", own: true }];
  const own = d.steps.find((x) => x.own); if (own) { own.trade = d.trade || own.trade; own.vendorId = d.vendorId || own.vendorId; }
  return d.steps;
}
function stepsHtml(d, photos) {
  const has = M.hasSteps(d); if (has) ensureSteps(d);
  const cur = M.curStepIdx(d); const pc = (st) => photos.filter((x) => x.stepId === st.id).length;
  return `<section class="card" id="steps"><h3>공정 단계 ${has ? `<small>${M.stepProgress(d)}</small>` : '<small>여러 공종이 차례로 고칠 때</small>'}</h3>
    ${has ? `<ol class="stp-list">${d.steps.map((st, i) => `<li class="stp ${i === cur ? "cur" : ""} ${st.status === "완료" ? "done" : ""}" data-si="${i}">
      <span class="stp-n">${i + 1}</span><span class="stp-t"><b>${esc(st.trade)}</b><small>${esc(st.vendorId ? vLabel(st.vendorId) : "업체 미지정")}${st.due ? ` · 기한 ${shortDate(st.due)}` : ""}${i === cur ? " · 지금 차례" : ""}</small></span>
      <button type="button" class="pill ${M.STEP_CLS[st.status] || ""} stp-st" data-sst="${i}" aria-label="${i + 1}단계 상태 ${st.status} 바꾸기">${st.status}</button>
      <button type="button" class="btn btn-sm stp-ph" data-sph="${i}" aria-label="${i + 1}단계 사진 바로 촬영">📷${pc(st) || ""}</button><button type="button" class="btn btn-sm stp-ph" data-salb="${i}" aria-label="${i + 1}단계 사진 앨범">🖼</button>
      <button type="button" class="btn btn-sm stp-ed" data-sed="${i}" aria-label="${i + 1}단계 수정">✎</button></li>`).join("")}</ol>`
      : '<p class="help">예: 도배가 찢겨 석고보드를 갈고 다시 도배 → 석고보드 교체 → 도배. 모든 단계가 끝나야 조치완료가 돼요.</p>'}
    <div class="row"><button type="button" class="btn" id="btn-addstep">＋ 후속 공정 추가</button><button type="button" class="btn" id="btn-tpl">📋 템플릿</button></div></section>`;
}
function bindSteps(d) {
  $("#btn-addstep")?.addEventListener("click", () => addStep(d));
  $("#btn-tpl")?.addEventListener("click", () => applyTemplate(d));
  $$("[data-sst]", view()).forEach((b) => b.addEventListener("click", async () => {
    const i = Number(b.dataset.sst); const st = d.steps[i];
    const v = await choose(`${i + 1}단계 · ${st.trade}`, M.STEP_STATUSES.map((x) => ({ label: x, value: x, sub: x === st.status ? "현재" : "" }))); if (v) setStepStatus(d, i, v);
  }));
  $$("[data-sph],[data-salb]", view()).forEach((b) => b.addEventListener("click", async () => {
    const cap = b.dataset.sph != null; const st = d.steps[Number(cap ? b.dataset.sph : b.dataset.salb)]; const files = await pickFile("image/*", { capture: cap, multiple: !cap }); if (!files.length) return;
    busy(true, "사진 저장 중…"); await addPhotos(d.id, files, "after", { ...stampOf(d), work: `${st.trade} · ${stampOf(d).work}` }, { stepId: st.id }); busy(false); rerender();
  }));
  $$("[data-sed]", view()).forEach((b) => b.addEventListener("click", () => editStep(d, Number(b.dataset.sed))));
}
/** 업체 고르기(그 공종을 맡은 업체 먼저) */
async function pickVendorFor(trade, cur = "") {
  const t = String(trade || ""); const fit = (v) => (v.trades || []).some((x) => x && (M.sameTrade(x, t) || t.includes(x) || x.includes(t)));
  const vs = [...S.vendors].sort((a, b) => (fit(b) ? 1 : 0) - (fit(a) ? 1 : 0) || a.name.localeCompare(b.name, "ko"));
  return choose(`‘${trade}’ 업체`, [...vs.map((v) => ({ label: v.name, value: v.id, sub: [fit(v) ? "이 공종 담당" : "", v.id === cur ? "현재" : ""].filter(Boolean).join(" · ") })), { label: "업체 미지정", value: "_none", icon: "—" }]);
}
const autoVendor = (trade) => { const t = String(trade || ""); return M.suggestVendor(S.vendors, t, P()?.id, PD())?.id || S.vendors.find((v) => (v.trades || []).some((x) => x && (t.includes(x) || x.includes(t))))?.id || ""; };
async function addStep(d) {
  const r = await formSheet({ title: "후속 공정 추가", ok: "다음: 업체 고르기", hint: "앞 공정이 끝나면 이 공정 업체에 보내라고 알려 드려요.",
    fields: [{ k: "trade", label: "공종", placeholder: "예: 석고보드 교체, 도배, 미장" }, { k: "due", label: "기한 (선택)", type: "date" }], validate: ({ trade }) => (!trade ? "공종을 입력하세요" : trade.length > 20 ? "20자 이내로" : "") });
  if (!r) return;
  const vid = await pickVendorFor(r.trade); if (vid == null) return;
  ensureSteps(d); d.steps.push({ id: M.uid("st"), trade: r.trade, vendorId: vid === "_none" ? "" : vid, status: "대기", due: r.due || "" });
  if (["조치완료", "확인완료"].includes(d.status)) setStatus(d, "조치중", `후속 공정 ‘${r.trade}’ 추가`);
  d.history = [...(d.history || []), { at: new Date().toISOString(), status: d.status, note: `후속 공정 추가: ${r.trade}` }];
  await saveDefect(d); toast(`${d.steps.length}단계 ‘${r.trade}’ 추가`); rerender();
}
async function applyTemplate(d) {
  const tpls = M.stepTemplatesOf(P());
  const t = await choose("후속 공정 템플릿", [...tpls.map((x, i) => ({ label: x.name, value: String(i), sub: x.steps.join(" → ") })), { label: "템플릿 편집", value: "_edit", icon: "✎" }]);
  if (t == null) return; if (t === "_edit") return editTemplates();
  const tp = tpls[Number(t)];
  if (M.hasSteps(d) && !(await ask(`지금 공정(${M.stepsText(d)})을 ‘${tp.steps.join(" → ")}’(으)로 바꿀까요?`, { ok: "바꾸기" }))) return;
  const own = (x) => !!d.trade && (x.includes(d.trade) || d.trade.includes(x));
  let usedOwn = false;
  d.steps = tp.steps.map((x) => { const o = !usedOwn && own(x); if (o) usedOwn = true; return { id: M.uid("st"), trade: o ? d.trade : x, vendorId: o ? d.vendorId || "" : autoVendor(x), status: "대기", due: "", ...(o ? { own: true } : {}) }; });
  if (["조치완료", "확인완료"].includes(d.status)) setStatus(d, "조치중", "후속 공정 템플릿 적용");
  d.history = [...(d.history || []), { at: new Date().toISOString(), status: d.status, note: `공정 템플릿 ‘${tp.name}’: ${tp.steps.join(" → ")}` }];
  await saveDefect(d); toast(`‘${tp.name}’ ${d.steps.length}단계 적용 — 업체는 각 단계 ✎에서 바꿀 수 있어요`, { ms: 3500 }); rerender();
}
async function editTemplates() {
  const p = P(); const cur = M.templatesText(M.stepTemplatesOf(p));
  const s = openSheet({ title: "후속 공정 템플릿", cls: "dialog", html: `<p class="help">한 줄에 하나씩 ‘이름: 공정 → 공정’ 형식으로 쓰세요.</p><textarea class="inp" id="tpl-t" rows="8">${esc(cur)}</textarea><p class="fs-err" role="alert"></p>`,
    footer: `<button type="button" class="btn" data-a="reset">기본값</button><button type="button" class="btn btn-primary" data-a="save">저장</button>` });
  $("[data-a=reset]", s.el).addEventListener("click", () => { $("#tpl-t", s.el).value = M.templatesText(M.DEFAULT_STEP_TEMPLATES); });
  $("[data-a=save]", s.el).addEventListener("click", async () => {
    const list = M.parseTemplates($("#tpl-t", s.el).value); if (!list.length) { $(".fs-err", s.el).textContent = "‘이름: 공정 → 공정’ 형식으로 한 줄 이상 쓰세요"; return; }
    p.stepTemplates = list; await saveProject(p); await s.close(); toast(`템플릿 ${list.length}개 저장`); rerender();
  });
}
async function editStep(d, i) {
  const st = d.steps[i];
  const a = await choose(`${i + 1}단계 · ${st.trade}`, [{ label: "업체 바꾸기", value: "v", icon: "🏢" }, { label: "기한 바꾸기", value: "due", icon: "📅" }, ...(st.own ? [] : [{ label: "공종 이름 바꾸기", value: "t", icon: "✎" }]),
    ...(i > 0 ? [{ label: "앞으로 옮기기", value: "up", icon: "↑" }] : []), ...(st.own ? [] : [{ label: "이 단계 삭제", value: "del", icon: "🗑" }])]);
  if (!a) return;
  if (a === "v") { const vid = await pickVendorFor(st.trade, st.vendorId); if (vid == null) return; st.vendorId = vid === "_none" ? "" : vid; if (st.own) d.vendorId = st.vendorId; }
  if (a === "due") { const r = await formSheet({ title: "기한", ok: "저장", fields: [{ k: "due", label: "기한", type: "date", value: st.due || "" }] }); if (!r) return; st.due = r.due; }
  if (a === "t") { const r = await prompt2("공종 이름", st.trade, { ok: "저장" }); if (!r) return; st.trade = r.trim().slice(0, 20) || st.trade; }
  if (a === "up") { [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; }
  if (a === "del") { if (!(await ask(`${i + 1}단계 ‘${st.trade}’를 삭제할까요?`, { ok: "삭제", danger: true }))) return; d.steps.splice(i, 1); if (d.steps.length < 2) d.steps = []; }
  if (M.hasSteps(d) && d.steps.every((x) => x.status === "완료") && M.isOpen(d)) setStatus(d, "조치완료", "모든 공정 완료");
  await saveDefect(d); rerender();
}
/** 단계 상태 바꾸기. 완료면 다음 단계 업체에 보낼지 묻고, 마지막이면 하자를 조치완료로 */
async function setStepStatus(d, i, st) {
  const step = d.steps[i]; if (step.status === st) return;
  const now = new Date().toISOString(); const prevSt = step.status; const prevDefect = d.status;
  step.status = st; if (st === "완료") step.doneAt = now; else step.doneAt = ""; if (st === "전달" && !step.sentAt) step.sentAt = now;
  const note = `${i + 1}단계 ${step.trade}: ${prevSt} → ${st}`;
  if (d.steps.every((x) => x.status === "완료")) setStatus(d, "조치완료", `모든 공정 완료 (${note})`);
  else {
    if (["조치완료", "확인완료"].includes(d.status)) setStatus(d, "조치중", note);
    else if (d.status === "접수" && st !== "대기") setStatus(d, st === "전달" ? "업체전달" : "조치중", note);
    else d.history = [...(d.history || []), { at: now, status: d.status, note, ...(Sync.attached() && Sync.signedIn() ? { by: Sync.actorName() } : {}) }];
  }
  await saveDefect(d); rerender();
  const undo = async () => { step.status = prevSt; step.doneAt = ""; if (d.status !== prevDefect) setStatus(d, prevDefect, "되돌리기"); await saveDefect(d); rerender(); };
  if (st !== "완료") return toast(`${i + 1}단계 ‘${step.trade}’ ${st}`, { action: "되돌리기", onAction: undo });
  const next = d.steps.find((x, k) => k > i && x.status !== "완료");
  if (!next) return toast(`모든 공정 완료 → ‘조치완료’${photoCount(d).after ? "" : " · 조치 후 사진은 📷에서"}`, { ms: 3500, action: "되돌리기", onAction: undo });
  await sendNextStep(d, i, next);
}
/** 다음 공정 업체에 카톡·문자로 보내기(앞 공정 사진 첨부) */
async function sendNextStep(d, i, next) {
  const v = V(next.vendorId); const vps = M.vendorPhones(v);
  let how = await choose(`${i + 1}단계 완료 — 다음 ‘${next.trade}’ ${v ? v.name : "(업체 미지정)"}에 보낼까요?`, [
    { label: "카톡·공유로 보내기 (사진 포함)", value: "kakao", icon: "💬" }, ...vps.map((x, k) => ({ label: `문자로 보내기 · ${M.contactLabel(x)}`, sub: x.phone, value: "sms:" + k, icon: "✉" })),
    ...(v ? [] : [{ label: "업체 먼저 고르기", value: "pick", icon: "🏢" }]), { label: "나중에", value: "later", icon: "⏱" }]);
  if (!how || how === "later") return toast(`다음 차례: ${next.trade}`);
  if (how === "pick") { const vid = await pickVendorFor(next.trade); if (vid && vid !== "_none") { next.vendorId = vid; await saveDefect(d); } return sendNextStep(d, i, next); }
  let phone = ""; if (how.startsWith("sms:")) { phone = vps[Number(how.slice(4))]?.phone || ""; how = "sms"; }
  const text = M.stepMessage({ project: P(), d, step: next, prev: d.steps[i] });
  const photos = await db.byIndex("photos", "by_defect", d.id);
  const prevId = d.steps[i].id; const ph = photos.filter((x) => x.stepId === prevId).pop() || photos.filter((x) => x.kind === "after").pop() || photos.filter((x) => x.kind !== "after")[0];
  const files = ph ? [new File([await photoOut(ph, d)], `하자_${next.trade}_요청.jpg`, { type: "image/jpeg" })] : [];
  window.__lastStepSend = { how, text, files: files.length, vendor: v?.name || "", phone };
  if (how === "kakao") { const { shareKakao } = await import("./share.js"); const r = await shareKakao({ text, files }).catch(() => ""); if (r === "kakao-pc" && files[0]) { toast("문구를 복사했어요 · 사진은 내려받아 카톡에 붙여 주세요", { ms: 4000 }); shareOrDownload(files[0], files[0].name); } }
  else { location.href = M.smsHref(phone, text); if (files.length) toast("문자에는 사진이 자동으로 붙지 않아요 — 사진은 카톡으로 보내 주세요", { ms: 4000 }); }
  next.status = "전달"; next.sentAt = new Date().toISOString();
  d.history = [...(d.history || []), { at: next.sentAt, status: d.status, note: `${d.steps.indexOf(next) + 1}단계 ${next.trade} ${how === "kakao" ? "카톡" : "문자"}로 전달` }];
  await saveDefect(d); rerender();
}
/** 하자를 조치완료·확인완료로 바꿀 때 남은 공정이 있으면 묻기 */
async function stepsGuard(d, st) {
  if (!["조치완료", "확인완료"].includes(st) || !M.hasSteps(d)) return true;
  const left = d.steps.filter((x) => x.status !== "완료"); if (!left.length) return true;
  if (!(await ask(`남은 공정 ${left.length}개(${left.map((x) => x.trade).join(", ")})가 있어요. 모두 완료로 표시하고 ‘${st}’로 바꿀까요?`, { ok: "모두 완료" }))) return false;
  const now = new Date().toISOString(); left.forEach((x) => { x.status = "완료"; x.doneAt = now; }); return true;
}
function photoViewer(photos, id, onChange, d = null) {
  let i = Math.max(0, photos.findIndex((p) => p.id === id)); let url = "";
  const s = openSheet({ title: "사진", full: true, cls: "viewer", html: `<div class="pv"><img id="pv-img" alt="사진"></div><div class="pv-nav"><button type="button" class="btn" data-n="-1">‹ 이전</button><span id="pv-i"></span><button type="button" class="btn" data-n="1">다음 ›</button></div>`,
    footer: `<button type="button" class="btn" data-a="share">공유</button><button type="button" class="btn btn-danger" data-a="del">삭제</button>` });
  const show = () => { if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(photos[i].blob); $("#pv-img", s.el).src = url; $("#pv-i", s.el).textContent = `${i + 1} / ${photos.length} · ${photos[i].kind === "after" ? "조치 후" : "조치 전"}`; };
  show();
  $$("[data-n]", s.el).forEach((b) => b.addEventListener("click", () => { i = (i + Number(b.dataset.n) + photos.length) % photos.length; show(); }));
  $("[data-a=share]", s.el).addEventListener("click", () => (async () => shareOrDownload(d ? await photoOut(photos[i], d) : photos[i].blob, `하자사진_${i + 1}.jpg`))());
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
  const vps = M.vendorPhones(vendor); const phones = vps.map((x) => x.phone);
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
        ${vps.map((x) => `<a class="btn btn-lg" data-s="sms" href="#" data-ph="${esc(x.phone)}">💬 문자 ${vps.length > 1 || x.name ? `<small>${esc(M.contactLabel(x))}</small> ` : ""}${esc(x.phone)}</a><a class="btn btn-lg" href="${M.telHref(x.phone)}" data-s="tel">📞 전화 ${vps.length > 1 || x.name ? `<small>${esc(M.contactLabel(x))}</small> ` : ""}${esc(x.phone)}</a>`).join("")}
        <button type="button" class="btn btn-lg" data-s="copy">📋 내용 복사</button>
        <button type="button" class="btn btn-lg" data-s="share">📤 다른 앱으로 공유</button>
        <button type="button" class="btn btn-lg" data-s="img">🧾 요청서 이미지</button>
        <button type="button" class="btn btn-lg" data-s="wo">📋 작업지시 및 완료확인서</button>
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
        for (const d of sel()) { if (!phOn.has(d.id)) continue; for (const ph of (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 2)) if (files.length < 10) files.push(new File([await photoOut(ph, d)], `${M.locText(d).replace(/\s+/g, "_")}_${files.length + 1}.jpg`, { type: "image/jpeg" })); }
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
    if (k === "img") { const items2 = sel(); await s.close(); return requestImageFor(items2, vendor); }
    if (k === "wo") { const items2 = sel(); await s.close(); return workOrderSheet({ items: items2, filter: S.filter }); }
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
  for (const d of items) { const ph = (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 2); const u = []; for (const x of ph) u.push(URL.createObjectURL(await photoOut(x, d))); all.push(...u); urls.set(d.id, u); }
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

/* ---------- 1.2.3 공종 이름 합치기: ‘도장’·‘도장공사’ 같은 이름을 하나로(현장 목록·하자·공정 단계·업체 담당 공종·템플릿·필터) ---------- */
function tradeUsage(p = P()) {
  const cnt = new Map(); const add = (t, k = 1) => { if (t) cnt.set(t, (cnt.get(t) || 0) + k); };
  for (const d of S.defects) if (d.projectId === p.id) { add(d.trade); for (const st of d.steps || []) if (st.trade !== d.trade) add(st.trade); }
  for (const v of S.vendors) for (const t of v.trades || []) add(t, 0.5);
  for (const t of p.trades || []) add(t.name, 0);
  return cnt;
}
function tradeDupesNow(p = P()) { const cnt = tradeUsage(p); return M.tradeDuplicates([...cnt.keys()], (n0) => cnt.get(n0) || 0).map((g) => ({ ...g, counts: Object.fromEntries(g.names.map((n0) => [n0, Math.round(cnt.get(n0) || 0)])) })); }
/** map: Map(원래 이름 → 합칠 이름). 바뀐 하자·업체만 저장(동기화는 평소 수정과 같이 올라감) */
async function mergeTrades(map) {
  const p = P(); const to = (t) => (t && map.has(t) ? map.get(t) : t); const res = { defects: 0, vendors: 0, steps: 0, pairs: [...map.entries()].filter(([a, b]) => a !== b) };
  if (!res.pairs.length) return res;
  const nt = [];
  for (const t of p.trades || []) { const name = to(t.name); const ex = nt.find((x) => x.name === name); if (ex) { for (const s2 of t.subs || []) if (!ex.subs.includes(s2)) ex.subs.push(s2); } else nt.push({ ...t, name, subs: [...(t.subs || [])] }); }
  for (const v of new Set(map.values())) if (v && !nt.some((x) => x.name === v)) nt.push({ name: v, subs: [] });
  p.trades = nt;
  if (Array.isArray(p.stepTemplates)) p.stepTemplates = p.stepTemplates.map((tp) => ({ ...tp, steps: tp.steps.map(to) }));
  await saveProject(p);
  for (const d of S.defects) {
    if (d.projectId !== p.id) continue; let ch = false;
    if (map.has(d.trade) && to(d.trade) !== d.trade) { d.trade = to(d.trade); ch = true; }
    for (const st of d.steps || []) if (map.has(st.trade) && to(st.trade) !== st.trade) { st.trade = to(st.trade); ch = true; res.steps++; }
    if (ch) { await saveDefect(d); res.defects++; }
  }
  for (const v of S.vendors) {
    const nv = [...new Set((v.trades || []).map(to))];
    if (nv.length !== (v.trades || []).length || nv.some((x, i) => x !== v.trades[i])) { v.trades = nv; await saveVendor(v); res.vendors++; }
  }
  if (S.filter.trade) { S.filter.trade = Array.isArray(S.filter.trade) ? [...new Set(S.filter.trade.map(to))] : to(S.filter.trade); LS.set("filter", S.filter); }
  db.setVendorNames?.(S.vendors);
  return res;
}
const mergeText = (r) => `${r.pairs.map(([a, b]) => `${a} → ${b}`).join(", ")} (하자 ${r.defects}건${r.vendors ? ` · 업체 ${r.vendors}곳` : ""})`;
/** 한 번만 자동 정리(현장마다). 보기 전용·동기화 중이면 나중에 */
async function autoMergeTrades(tries = 0) {
  const p = P(); if (!p || isViewerNow()) return;
  const key = `tradeMerged:${p.id}`; if (LS.get(key, "")) return;
  if (Sync.attached() && Sync.status().key !== "ok") { if (tries < 6) setTimeout(() => autoMergeTrades(tries + 1), 10000); return; }
  const dupes = tradeDupesNow(p);
  const map = new Map(); for (const g of dupes) for (const n0 of g.names) if (n0 !== g.to) map.set(n0, g.to);
  if (map.size) {
    try { const r = await mergeTrades(map); LS.set("tradeMergeLog", [...LS.get("tradeMergeLog", []), { at: new Date().toISOString(), pid: p.id, auto: true, pairs: r.pairs, defects: r.defects, vendors: r.vendors }].slice(-20)); window.__tradeMerge = r;
      rerender(); toast(`같은 공종 이름을 합쳤어요: ${mergeText(r)}`, { ms: 9000, action: "자세히", onAction: () => tradeMergeSheet() }); }
    catch (e) { console.warn(e); return; }
  }
  LS.set(key, APP_VERSION);
}
async function tradeMergeSheet() {
  const p = P(); if (!p) return;
  const ro = isViewerNow(); const cnt = tradeUsage(p); const all = [...cnt.keys()].sort((a, b) => a.localeCompare(b, "ko")); const dupes = tradeDupesNow(p);
  const log = LS.get("tradeMergeLog", []).filter((x) => x.pid === p.id).slice(-5).reverse();
  const n0 = (t) => Math.round(cnt.get(t) || 0);
  const s = openSheet({ title: "공종 이름 정리/합치기", full: true, cls: "tm-sheet",
    html: `${ro ? '<p class="warnbox help">보기 전용 멤버라 바꿀 수 없어요.</p>' : ""}
      <p class="help">띄어쓰기나 끝의 ‘공사’만 다른 이름(예: 도장 · 도장공사)은 같은 공종이에요. 합치면 이 현장의 하자·공정 단계·업체 담당 공종·필터가 모두 한 이름으로 바뀌고, 팀 현장이면 팀원에게도 동기화돼요.</p>
      <h4 class="sec">비슷한 이름 ${dupes.length}묶음</h4>
      <div id="tm-dupes">${dupes.map((g, i) => `<div class="tm-row" data-g="${i}"><div class="tm-names">${g.names.map((x) => `<span class="chip">${esc(x)} <small>${g.counts[x]}건</small></span>`).join("")}</div>
        <div class="row"><label class="fld"><span>대표 이름</span><select class="inp" data-to="${i}">${g.names.map((x) => `<option ${x === g.to ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><button type="button" class="btn btn-primary" data-merge="${i}" ${ro ? "disabled" : ""}>합치기</button></div></div>`).join("") || '<p class="help" id="tm-none">겹치는 공종 이름이 없어요 👍</p>'}</div>
      <h4 class="sec">직접 합치기</h4>
      <p class="help small">이름이 많이 달라도 같은 공종이면(예: 실리콘 → 코킹공사) 직접 골라 합쳐요.</p>
      <div class="grid2"><label class="fld"><span>이 공종을</span><select class="inp" id="tm-from"><option value="">선택…</option>${all.map((x) => `<option value="${esc(x)}">${esc(x)} (${n0(x)})</option>`).join("")}</select></label>
        <label class="fld"><span>여기로 합치기</span><select class="inp" id="tm-into"><option value="">선택…</option>${all.map((x) => `<option value="${esc(x)}">${esc(x)} (${n0(x)})</option>`).join("")}</select></label></div>
      <button type="button" class="btn btn-block" id="tm-manual" ${ro ? "disabled" : ""}>합치기</button>
      ${log.length ? `<h4 class="sec">최근 합친 기록</h4><ul class="help small" id="tm-log">${log.map((x) => `<li>${fmtDT(x.at)} ${x.auto ? "(자동)" : ""} ${esc(x.pairs.map(([a, b]) => `${a} → ${b}`).join(", "))} · 하자 ${x.defects}건${x.vendors ? ` · 업체 ${x.vendors}곳` : ""}</li>`).join("")}</ul>` : ""}` });
  const run = async (map) => {
    busy(true, "공종 합치는 중…"); let r;
    try { r = await mergeTrades(map); } catch (e) { busy(false); return toast(e.readOnly ? e.message : "합치지 못했어요: " + e.message); }
    busy(false); LS.set("tradeMergeLog", [...LS.get("tradeMergeLog", []), { at: new Date().toISOString(), pid: p.id, pairs: r.pairs, defects: r.defects, vendors: r.vendors }].slice(-20)); window.__tradeMerge = r;
    await s.close(); rerender(); toast(`합쳤어요: ${mergeText(r)}`, { ms: 7000 }); tradeMergeSheet();
  };
  $$("[data-merge]", s.el).forEach((b) => b.addEventListener("click", async () => { const g = dupes[+b.dataset.merge]; const to = $(`[data-to="${b.dataset.merge}"]`, s.el).value;
    const from = g.names.filter((x) => x !== to); if (!(await ask(`${from.join(", ")} → ‘${to}’로 합칠까요?\n하자 ${from.reduce((a, x) => a + g.counts[x], 0)}건의 공종 이름이 바뀌어요.`, { ok: "합치기" }))) return;
    run(new Map(from.map((x) => [x, to]))); }));
  $("#tm-manual", s.el).addEventListener("click", async () => { const a = $("#tm-from", s.el).value, b = $("#tm-into", s.el).value;
    if (!a || !b) return toast("합칠 두 공종을 고르세요"); if (a === b) return toast("서로 다른 공종을 고르세요");
    if (!(await ask(`‘${a}’ → ‘${b}’로 합칠까요? 하자 ${n0(a)}건의 공종 이름이 바뀌어요.`, { ok: "합치기" }))) return; run(new Map([[a, b]])); });
  return s;
}

/* ---------- 1.2.4 하자 유형 이름 합치기: ‘찍힘’·‘흠집/찍힘’·‘찍힘 자국’, ‘깨짐’·‘파손’ 같은 이름을 하나로 ---------- */
function typeUsage(p = P()) {
  const cnt = new Map(); const add = (t, k = 1) => { if (t) cnt.set(t, (cnt.get(t) || 0) + k); };
  for (const d of S.defects) if (d.projectId === p.id) add(d.type);
  for (const t of p.types || []) add(t, 0);
  return cnt;
}
function typeDupesNow(p = P()) { const cnt = typeUsage(p); return M.typeDuplicates([...cnt.keys()], (n0) => cnt.get(n0) || 0, p.types || []).map((g) => ({ ...g, counts: Object.fromEntries(g.names.map((n0) => [n0, cnt.get(n0) || 0])) })); }
async function mergeTypes(map) {
  const p = P(); const to = (t) => (t && map.has(t) ? map.get(t) : t); const res = { defects: 0, pairs: [...map.entries()].filter(([a, b]) => a !== b), kind: "type" };
  if (!res.pairs.length) return res;
  const nt = []; for (const t of p.types || []) { const x = to(t); if (!nt.includes(x)) nt.push(x); }
  for (const v of new Set(map.values())) if (v && !nt.includes(v)) nt.push(v);
  p.types = nt; await saveProject(p);
  for (const d of S.defects) { if (d.projectId !== p.id || !map.has(d.type) || to(d.type) === d.type) continue; d.type = to(d.type); await saveDefect(d); res.defects++; }
  if (S.filter.type) { S.filter.type = Array.isArray(S.filter.type) ? [...new Set(S.filter.type.map(to))] : to(S.filter.type); LS.set("filter", S.filter); }
  return res;
}
const typeMergeText = (r) => `${r.pairs.map(([a, b]) => `${a} → ${b}`).join(", ")} (하자 ${r.defects}건)`;
const logTypeMerge = (p, r, auto) => { LS.set("typeMergeLog", [...LS.get("typeMergeLog", []), { at: new Date().toISOString(), pid: p.id, auto, pairs: r.pairs, defects: r.defects }].slice(-20)); window.__typeMerge = r; };
async function autoMergeTypes(tries = 0) {
  const p = P(); if (!p || isViewerNow()) return;
  const key = `typeMerged:${p.id}`; if (LS.get(key, "")) return;
  if (Sync.attached() && Sync.status().key !== "ok") { if (tries < 6) setTimeout(() => autoMergeTypes(tries + 1), 10000); return; }
  const map = new Map(); for (const g of typeDupesNow(p)) for (const n0 of g.names) if (n0 !== g.to) map.set(n0, g.to);
  if (map.size) {
    try { const r = await mergeTypes(map); logTypeMerge(p, r, true); rerender(); toast(`같은 하자 유형을 합쳤어요: ${typeMergeText(r)}`, { ms: 9000, action: "자세히", onAction: () => typeMergeSheet() }); }
    catch (e) { console.warn(e); return; }
  }
  LS.set(key, APP_VERSION);
}
async function typeMergeSheet() {
  const p = P(); if (!p) return;
  const ro = isViewerNow(); const cnt = typeUsage(p); const all = [...cnt.keys()].sort((a, b) => a.localeCompare(b, "ko")); const dupes = typeDupesNow(p);
  const log = LS.get("typeMergeLog", []).filter((x) => x.pid === p.id).slice(-5).reverse();
  const opts = all.map((x) => `<option value="${esc(x)}">${esc(x)} (${cnt.get(x) || 0})</option>`).join("");
  const s = openSheet({ title: "하자 유형 정리/합치기", full: true, cls: "ty-sheet",
    html: `${ro ? '<p class="warnbox help">보기 전용 멤버라 바꿀 수 없어요.</p>' : ""}
      <p class="help">띄어쓰기·기호만 다르거나 흔히 같은 뜻으로 쓰는 이름(예: 찍힘 · 흠집/찍힘 · 찍힘 자국, 깨짐 · 파손)은 같은 유형으로 봐요. 합치면 이 현장의 하자·유형 목록·필터가 한 이름으로 바뀌고, 팀 현장이면 팀원에게도 동기화돼요.</p>
      <h4 class="sec">비슷한 이름 ${dupes.length}묶음</h4>
      <div id="ty-dupes">${dupes.map((g, i) => `<div class="tm-row" data-g="${i}"><div class="tm-names">${g.names.map((x) => `<span class="chip">${esc(x)} <small>${g.counts[x]}건</small></span>`).join("")}</div>
        <div class="row"><label class="fld"><span>대표 이름</span><select class="inp" data-to="${i}">${g.names.map((x) => `<option ${x === g.to ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><button type="button" class="btn btn-primary" data-merge="${i}" ${ro ? "disabled" : ""}>합치기</button></div></div>`).join("") || '<p class="help" id="ty-none">겹치는 유형 이름이 없어요 👍</p>'}</div>
      <h4 class="sec">직접 합치기</h4>
      <div class="grid2"><label class="fld"><span>이 유형을</span><select class="inp" id="ty-from"><option value="">선택…</option>${opts}</select></label>
        <label class="fld"><span>여기로 합치기</span><select class="inp" id="ty-into"><option value="">선택…</option>${opts}</select></label></div>
      <button type="button" class="btn btn-block" id="ty-manual" ${ro ? "disabled" : ""}>합치기</button>
      ${log.length ? `<h4 class="sec">최근 합친 기록</h4><ul class="help small" id="ty-log">${log.map((x) => `<li>${fmtDT(x.at)} ${x.auto ? "(자동)" : ""} ${esc(x.pairs.map(([a, b]) => `${a} → ${b}`).join(", "))} · 하자 ${x.defects}건</li>`).join("")}</ul>` : ""}` });
  const run = async (map) => {
    busy(true, "유형 합치는 중…"); let r;
    try { r = await mergeTypes(map); } catch (e) { busy(false); return toast(e.readOnly ? e.message : "합치지 못했어요: " + e.message); }
    busy(false); logTypeMerge(p, r, false); await s.close(); rerender(); toast(`합쳤어요: ${typeMergeText(r)}`, { ms: 7000 }); typeMergeSheet();
  };
  $$("[data-merge]", s.el).forEach((b) => b.addEventListener("click", async () => { const g = dupes[+b.dataset.merge]; const to = $(`[data-to="${b.dataset.merge}"]`, s.el).value;
    const from = g.names.filter((x) => x !== to); if (!(await ask(`${from.join(", ")} → ‘${to}’로 합칠까요?`, { ok: "합치기" }))) return; run(new Map(from.map((x) => [x, to]))); }));
  $("#ty-manual", s.el).addEventListener("click", async () => { const a = $("#ty-from", s.el).value, b = $("#ty-into", s.el).value;
    if (!a || !b) return toast("합칠 두 유형을 고르세요"); if (a === b) return toast("서로 다른 유형을 고르세요");
    if (!(await ask(`‘${a}’ → ‘${b}’로 합칠까요? 하자 ${cnt.get(a) || 0}건의 유형 이름이 바뀌어요.`, { ok: "합치기" }))) return; run(new Map([[a, b]])); });
  return s;
}

/* ---------- 1.2.5 코어 설정: 동마다 호 라인 → 코어 (기본: 라인 2개씩 한 코어). 현장 문서에 저장 → 팀 현장이면 동기화 ---------- */
async function coreSheet() {
  const p = P(); if (!p) return;
  const ro = isViewerNow();
  const cfg = JSON.parse(JSON.stringify(M.coreRule(p))); cfg.dongs ||= {};
  let dn = p.dongs[0]?.name || "";
  const dongOf = (name) => p.dongs.find((d) => d.name === name);
  const linesFor = (name) => { const d = dongOf(name); const ls = d ? M.linesOf(d) : []; if (ls.length) return ls; return [...new Set(PD().filter((x) => M.locParts(x).dong === name).map((x) => M.locParts(x).line).filter((x) => x != null))].sort((a, b) => a - b); };
  const ruleCore = (l) => (cfg.per > 0 ? Math.ceil(l / cfg.per) : null);
  const coreFor = (name, l) => { const m = cfg.dongs[name]; if (m && m[l] != null && m[l] !== "") return Number(m[l]); const c = dongOf(name)?.cores?.find?.((x) => (x.lines || []).map(Number).includes(l)); return c ? Number(c.core) : ruleCore(l); };
  const pad = (l) => String(l).padStart(2, "0");
  const linesHtml = () => { const ls = linesFor(dn); const maxC = Math.max(4, ...ls.map((l) => coreFor(dn, l) || 0)) + 1;
    if (!ls.length) return '<p class="help">이 동은 라인 정보가 없어요(동 설정에서 층·라인을 넣거나 하자를 등록하면 나와요).</p>';
    const cnt = new Map(); for (const d of PD()) { const lp = M.locParts(d); if (lp.dong === dn && lp.line != null) { const c = coreFor(dn, lp.line); cnt.set(c, (cnt.get(c) || 0) + 1); } }
    return `<div class="co-lines">${ls.map((l) => { const own = cfg.dongs[dn]?.[l] != null && cfg.dongs[dn]?.[l] !== "";
      return `<label class="co-line ${own ? "own" : ""}"><span>${pad(l)}호 라인</span><select class="inp inp-sm" data-line="${l}" ${ro ? "disabled" : ""}><option value="">기본${ruleCore(l) ? ` (${ruleCore(l)}코어)` : " (미지정)"}</option>${Array.from({ length: maxC }, (_, i) => i + 1).map((c) => `<option value="${c}" ${own && Number(cfg.dongs[dn][l]) === c ? "selected" : ""}>${c}코어</option>`).join("")}</select></label>`; }).join("")}</div>
      <p class="help small" id="co-sum">이 동: ${[...new Set(ls.map((l) => coreFor(dn, l)))].filter(Boolean).sort((a, b) => a - b).map((c) => `${c}코어 = ${ls.filter((l) => coreFor(dn, l) === c).map(pad).join("·")}호 (하자 ${cnt.get(c) || 0}건)`).join(" · ") || "코어 미지정"}</p>`; };
  const s = openSheet({ title: "코어 설정", full: true, cls: "co-sheet",
    html: `${ro ? '<p class="warnbox help">보기 전용 멤버라 바꿀 수 없어요.</p>' : ""}
      <p class="help">호수 끝 두 자리(라인)로 코어를 정해요. 예: 01·02호 = 1코어, 03·04호 = 2코어. 동마다 다르면 아래에서 바꾸세요. 방풍실·계단실 같은 동 공용부는 등록할 때 코어를 고르거나, 목록에서 체크 후 ‘코어 지정’으로 정해요(안 정하면 ‘코어 미지정’).</p>
      <label class="fld"><span>기본 규칙: 라인 몇 개씩 한 코어 (0 = 기본 규칙 쓰지 않음)</span><input class="inp" id="co-per" type="number" min="0" max="10" value="${cfg.per}" ${ro ? "disabled" : ""}></label>
      <label class="fld"><span>동</span><select class="inp" id="co-dong">${p.dongs.map((d) => `<option ${d.name === dn ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <div id="co-body">${linesHtml()}</div>
      <div class="row wrap"><button type="button" class="btn" id="co-reset" ${ro ? "disabled" : ""}>이 동 기본 규칙으로</button><button type="button" class="btn" id="co-copy" ${ro ? "disabled" : ""}>다른 동에 복사</button></div>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="co-save" ${ro ? "disabled" : ""}>저장</button>` });
  const el = s.el; const body = () => { $("#co-body", el).innerHTML = linesHtml(); };
  el.addEventListener("change", (e) => { const sel = e.target.closest("[data-line]"); if (!sel) return; cfg.dongs[dn] ||= {}; if (sel.value === "") delete cfg.dongs[dn][sel.dataset.line]; else cfg.dongs[dn][sel.dataset.line] = Number(sel.value); if (!Object.keys(cfg.dongs[dn]).length) delete cfg.dongs[dn]; body(); });
  $("#co-per", el).addEventListener("input", (e) => { cfg.per = Math.max(0, Math.min(10, Number(e.target.value) || 0)); body(); });
  $("#co-dong", el).addEventListener("change", (e) => { dn = e.target.value; body(); });
  $("#co-reset", el).addEventListener("click", () => { delete cfg.dongs[dn]; body(); });
  $("#co-copy", el).addEventListener("click", async () => {
    const n0 = linesFor(dn).length; const same = p.dongs.filter((d) => d.name !== dn && linesFor(d.name).length === n0);
    const v = await choose(`${dn} 코어 설정을 복사`, [{ label: `라인 수가 같은 동 (${same.length}개)`, value: "same", icon: "🏢", sub: same.map((d) => d.name).slice(0, 8).join(", ") }, { label: `모든 동 (${p.dongs.length - 1}개)`, value: "all", icon: "🏙" }]);
    if (!v) return; const targets = v === "same" ? same : p.dongs.filter((d) => d.name !== dn);
    const src = {}; for (const l of linesFor(dn)) src[l] = coreFor(dn, l);
    for (const d of targets) cfg.dongs[d.name] = { ...src };
    toast(`${targets.length}개 동에 복사했어요 — 저장을 누르면 적용돼요`); body();
  });
  $("#co-save", el).addEventListener("click", async () => {
    if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
    p.coreCfg = { per: cfg.per, dongs: cfg.dongs }; try { await saveProject(p); } catch (e) { return toast(e.readOnly ? e.message : "저장하지 못했어요: " + e.message); }
    S.locIdx = null; await s.close(); toast("코어 설정을 저장했어요"); rerender();
  });
  return s;
}

/* ---------- 1.2.3 업체 이관: 다른 업체로 넘기기(공종 변경·사유·접수로 되돌리기) + 이력 ---------- */
const isViewerNow = () => !!(Sync.attached() && Sync.state.ws?.role === "viewer");
async function transferSheet(items) {
  items = items.filter(Boolean); if (!items.length) return toast("이관할 하자를 고르세요");
  if (isViewerNow()) return toast("보기 전용 멤버라 이 팀 현장을 고칠 수 없어요");
  const p = P(); const curV = [...new Set(items.map((d) => d.vendorId || ""))];
  const curTrades = [...new Set(items.map((d) => d.trade).filter(Boolean))];
  const resetDef = items.some((d) => d.status === "업체전달" || d.status === "조치중");
  let to = null, q = "", tf = "", tradeSel = "", subSel = "", tradeTouched = false;
  const tradeNames = () => [...new Set([...p.trades.map((t) => t.name), ...items.map((d) => d.trade).filter(Boolean)])];
  const fitTrade = (v) => { if (!v) return ""; const names = tradeNames(); const vts = [...(v.trades || [])].sort((a, b) => (b === tf) - (a === tf)); for (const vt of vts) { const hit = names.find((n0) => n0 === vt) || names.find((n0) => vt && (n0.includes(vt) || vt.includes(n0))); if (hit) return hit; } return ""; };
  const vTrades = [...new Set(S.vendors.flatMap((v) => v.trades || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const vlist = () => S.vendors.filter((v) => (!q || M.sameKey(v.name + (v.trades || []).join("") + M.contactsText(v)).includes(M.sameKey(q)) || M.koMatch(v.name, q)) && (!tf || (v.trades || []).includes(tf)))
    .sort((a, b) => (curV.includes(a.id) - curV.includes(b.id)) || a.name.localeCompare(b.name, "ko"));
  const optHtml = () => vlist().map((v) => `<button type="button" class="tv-opt ${to === v.id ? "on" : ""}" data-v="${v.id}" ${curV.length === 1 && curV[0] === v.id ? "disabled" : ""} aria-pressed="${to === v.id}"><b>${esc(v.name)}</b><small>${esc([(v.trades || []).join(", ") || "공종 미지정", M.contactSummary ? M.contactSummary(v) : ""].filter(Boolean).join(" · "))}${curV.length === 1 && curV[0] === v.id ? " · 현재 업체" : ""}</small></button>`).join("") || '<p class="help">맞는 업체가 없어요. 아래 ‘＋ 새 업체 등록’</p>';
  const subsOf = (t) => p.trades.find((x) => x.name === t)?.subs || [];
  const s = openSheet({ title: `🔁 업체 이관 · ${items.length}건`, full: true, cls: "tv-sheet",
    html: `<p class="tv-cur">지금: <b>${esc(curV.map((id) => (id ? vLabel(id) : "업체 미지정")).join(", "))}</b>${curTrades.length ? ` · ${esc(curTrades.join(", "))}` : ""}${items.length === 1 ? ` · ${esc(M.locText(items[0]))}` : ""}</p>
      <h4 class="sec">1. 넘길 업체</h4>
      <input class="inp" id="tv-q" type="search" placeholder="업체·공종·담당자 검색 · 초성 가능(ㄷㅎ)" aria-label="업체 검색">
      <div class="chips scroll" id="tv-tf"><button type="button" class="chip on" data-tf="">전체</button>${vTrades.map((t) => `<button type="button" class="chip" data-tf="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="tv-list" id="tv-list">${optHtml()}</div>
      <button type="button" class="btn btn-block" id="tv-new">＋ 새 업체 등록</button>
      <h4 class="sec">2. 공종 (선택)</h4>
      <div class="grid2"><label class="fld"><span>공종 <small id="tv-sugg" class="sugg" hidden>업체 공종 추천</small></span><select class="inp" id="tv-trade"><option value="">그대로${curTrades.length === 1 ? ` (${esc(curTrades[0])})` : ""}</option>${tradeNames().map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select></label>
        <label class="fld"><span>세부공종</span><select class="inp" id="tv-sub" disabled><option value="">-</option></select></label></div>
      <label class="fld"><span>3. 사유 (선택)</span><input class="inp" id="tv-reason" maxlength="80" placeholder="예: 코킹 하자라 코킹업체로"></label>
      <label class="check"><input type="checkbox" id="tv-reset" ${resetDef ? "checked" : ""}> 상태를 ‘접수’로 되돌리기</label><p class="help small tv-hint">새 업체에 다시 보내야 할 때 켜 두세요(업체전달·조치중이던 건은 기본으로 켜져 있어요).</p>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="tv-ok" disabled>업체를 고르세요</button>` });
  const el = s.el; const okB = $("#tv-ok", el);
  const paintSub = () => { const t = $("#tv-trade", el).value; const subs = subsOf(t); const sb = $("#tv-sub", el); sb.innerHTML = `<option value="">${t ? "없음" : "-"}</option>${subs.map((x) => `<option ${x === subSel ? "selected" : ""}>${esc(x)}</option>`).join("")}`; sb.disabled = !t || !subs.length; };
  const paint = () => {
    $("#tv-list", el).innerHTML = optHtml();
    const v = V(to); okB.disabled = !v; okB.textContent = v ? `${v.name}(으)로 이관` : "업체를 고르세요";
  };
  const choose2 = (id) => {
    to = id; const v = V(id); const ft = fitTrade(v);
    if (!tradeTouched) { tradeSel = ft && !curTrades.every((t) => t === ft) ? ft : ""; $("#tv-trade", el).value = tradeSel; subSel = ""; paintSub(); }
    $("#tv-sugg", el).hidden = !(tradeSel && tradeSel === ft); paint();
  };
  $("#tv-q", el).addEventListener("input", (e) => { q = e.target.value.trim(); paint(); });
  $("#tv-tf", el).addEventListener("click", (e) => { const b = e.target.closest("[data-tf]"); if (!b) return; tf = b.dataset.tf; $$("[data-tf]", el).forEach((x) => x.classList.toggle("on", x === b)); paint(); });
  $("#tv-list", el).addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && !b.disabled) choose2(b.dataset.v); });
  $("#tv-trade", el).addEventListener("change", (e) => { tradeTouched = true; tradeSel = e.target.value; subSel = ""; $("#tv-sugg", el).hidden = true; paintSub(); });
  $("#tv-sub", el).addEventListener("change", (e) => { subSel = e.target.value; });
  $("#tv-new", el).addEventListener("click", async () => { const v = await quickVendor(tf || tradeSel || ""); if (v) { q = ""; $("#tv-q", el).value = ""; tf = ""; choose2(v.id); } });
  okB.addEventListener("click", async () => {
    const v = V(to); if (!v) return;
    const reason = $("#tv-reason", el).value.trim(); const reset = $("#tv-reset", el).checked; const nt = $("#tv-trade", el).value; const ns = $("#tv-sub", el).value;
    const who = Sync.attached() && Sync.signedIn?.() ? "" : S.issuer || "";
    const prev = items.map((d) => JSON.parse(JSON.stringify(d)));
    busy(true, "이관 중…");
    try {
      for (const d of items) {
        const fromN = d.vendorId ? vLabel(d.vendorId) : "업체 미지정"; const fromT = M.tradeText(d);
        d.vendorId = v.id;
        if (nt) { d.trade = nt; d.subTrade = ns; }
        if (M.hasSteps(d)) { const own = d.steps.find((x) => x.own) || d.steps[Math.max(0, M.curStepIdx(d))]; if (own) { own.vendorId = v.id; if (nt) own.trade = nt; if (reset && own.status !== "완료") own.status = "대기"; } }
        const toT = M.tradeText(d);
        const note = `업체 이관: ${fromN} → ${v.name}${nt && toT !== fromT ? ` · 공종 ${fromT || "-"} → ${toT}` : ""}${reason ? ` · 사유: ${reason}` : ""}`;
        setStatus(d, reset ? "접수" : d.status, note);
        const h = d.history[d.history.length - 1]; h.kind = "transfer"; h.fromVendor = fromN; h.toVendor = v.name; if (reason) h.reason = reason; if (!h.by && who) h.by = who;
        if (reset) { delete d.reqAt; delete d.reqNo; }
        d.transferAt = h.at;
        await saveDefect(d);
      }
    } catch (e) { busy(false); if (e.readOnly) return toast(e.message); throw e; }
    busy(false); await s.close(); S.select.clear(); rerender();
    toast(`${items.length}건을 ${v.name}(으)로 이관했어요${reset ? " · ‘접수’로 되돌림" : ""}`, { ms: 7000, action: "되돌리기", onAction: async () => { for (const o of prev) { const d = S.defects.find((x) => x.id === o.id); if (!d) continue; Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, o, { history: [...o.history, { at: new Date().toISOString(), status: o.status, note: "업체 이관 취소" }] }); await saveDefect(d); } rerender(); } });
  });
  return s;
}

/* ---------- 1.2.2 요청서 이미지: 만들기 → 미리보기 → 카톡 공유(이미지 첨부)·이미지 복사·저장·문자 (자동 발송 없음) ---------- */
function nextDocNo() { const t = M.todayStr(); const c = LS.get("reqSeq", {}); const k = c.d === t ? (c.n || 0) + 1 : 1; LS.set("reqSeq", { d: t, n: k }); return { no: `HS-${t.replace(/-/g, "")}-${String(k).padStart(3, "0")}`, today: t }; }
/** 체크/목록에서 업체가 여럿이면 업체부터 고름 */
/* ---------- 1.3.0 작업지시 및 완료확인서(표 형식 요청서): 미리보기 · 인쇄(A4 가로)/PDF · 이미지 여러 장 ---------- */
async function workOrderSheet({ items, filter = null }) {
  items = (items || []).filter(Boolean); if (!items.length) return toast("확인서에 넣을 하자가 없어요");
  const W = await import("./workorder.js"); M.setCoreProject(P());
  if (!document.getElementById("wo-css")) { const st = document.createElement("style"); st.id = "wo-css"; st.textContent = W.WO_CSS; document.head.appendChild(st); }
  const p = P(); const allP = PD(); let high = !!LS.get("woHigh", false);
  const defName = S.issuer || (Sync.signedIn?.() ? Sync.actorName() : "");
  let who = { name: LS.get("woName", "") || defName, team: LS.get("woTeam", "") };
  const cond = W.woCondition(items, { filter: filter || {}, vendorName: vName });
  const meta = () => ({ date: M.todayStr(), who: who.name ? `${who.name}${who.team ? `(${who.team})` : ""}` : who.team ? `(${who.team})` : "", cond });
  const rows = () => W.woRows(items, { project: p, all: allP, high });
  let imgs = null; // { key, files, pngs }
  const s = openSheet({ title: `${W.WO_TITLE} · ${n(items.length)}건`, full: true, cls: "wo-sheet",
    html: `<div class="wo-bar"><label class="wo-tg"><input type="checkbox" id="wo-high" ${high ? "checked" : ""}><span class="wo-sw" aria-hidden="true"></span> 고층부터</label><span class="sp"></span>
        <button type="button" class="rbtn" data-w="print" id="wo-print">🖨<small>인쇄</small></button><button type="button" class="rbtn" data-w="close" id="wo-close">✕<small>닫기</small></button></div>
      <div class="wo-who"><label>출력자 <input class="inp" id="wo-name" value="${esc(who.name)}" placeholder="이름" maxlength="20"></label><label>팀 <input class="inp" id="wo-team" value="${esc(who.team)}" placeholder="(선택)" maxlength="20"></label></div>
      <div class="wo-prev" id="wo-prev"></div>
      <div class="send-grid wo-share"><button type="button" class="btn btn-kakao btn-lg" data-w="share">카톡으로 공유 <small>이미지</small></button>
        <button type="button" class="btn btn-lg" data-w="copy">🖼 이미지 복사</button><button type="button" class="btn btn-lg" data-w="save">💾 이미지 저장</button><button type="button" class="btn btn-lg" data-w="pdf">🖨 PDF 저장(인쇄)</button><button type="button" class="btn btn-kakao btn-lg" data-w="pdffile">📄 PDF 파일 <small>사진 포함 · ${isMobileDevice() ? "공유" : "저장"}</small></button></div>
      <p class="help small">인쇄·PDF는 A4 가로, 쪽마다 표 머리글이 반복돼요(PDF는 인쇄 창에서 ‘PDF로 저장’). 이미지는 장당 ${W.IMG_ROWS}건씩 여러 장으로 나눠요.</p>` });
  const el = s.el;
  const draw = () => { const r = rows(); $("#wo-prev", el).innerHTML = W.woHtml({ rows: r, meta: meta() }); fit(); window.__wo = { n: r.length, high, rows: r.map((x) => ({ no: x.no, stage: x.stage, dong: x.dong, ho: x.ho, utype: x.utype, movein: x.movein, room: x.room, trade: x.trade, core: x.core, head: x.head, text: x.text, status: x.status, date: x.date })), meta: meta() }; imgs = null; };
  const fit = () => { const pv = $("#wo-prev", el); const doc = $(".wo-doc", pv); if (!doc) return; const z = Math.min(1, Math.max(0.5, (pv.clientWidth - 2) / 1200)); doc.style.zoom = z; };
  const makeImgs = async () => {
    const key = `${high}|${meta().who}`; if (imgs && imgs.key === key) return imgs;
    busy(true, "확인서 이미지 만드는 중…");
    try { const R = await import("./reqimg.js"); const pages = await W.renderWoImages({ rows: rows(), meta: meta() });
      const jpgs = await Promise.all(pages.map((pg) => R.toBlob(pg.canvas, "image/jpeg", 0.92))); const pngs = await Promise.all(pages.map((pg) => R.toBlob(pg.canvas, "image/png")));
      const base = `작업지시확인서_${M.todayStr()}`; const files = jpgs.map((b, i) => new File([b], `${base}${jpgs.length > 1 ? "_" + (i + 1) : ""}.jpg`, { type: "image/jpeg" }));
      imgs = { key, files, pngs }; window.__woImg = { n: pages.length, sizes: pages.map((x) => [x.w, x.h]), rows: pages.map((x) => x.rows), jpg: jpgs.map((b) => b.size) };
    } catch (e) { console.error(e); toast("이미지를 만들지 못했어요: " + (e.message || e)); imgs = null; }
    busy(false); return imgs;
  };
  const print = () => { const root = $("#print-root"); root.innerHTML = W.woHtml({ rows: rows(), meta: meta() }); document.body.classList.add("printing", "printing-wo");
    const cleanup = () => { document.body.classList.remove("printing", "printing-wo"); root.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup); S.lastPrintHtml = root.innerHTML.length; window.__woPrinted = (window.__woPrinted || 0) + 1;
    if (window.__noPrint) return; setTimeout(() => window.print(), 50); };
  $("#wo-high", el).addEventListener("change", (e) => { high = e.target.checked; LS.set("woHigh", high); draw(); });
  for (const [id, k] of [["#wo-name", "name"], ["#wo-team", "team"]]) $(id, el).addEventListener("input", (e) => { who[k] = e.target.value.trim(); LS.set(k === "name" ? "woName" : "woTeam", who[k]); draw(); });
  $$("[data-w]", el).forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.w;
    if (k === "close") return s.close();
    if (k === "print" || k === "pdf") return print();
    if (k === "pdffile") { busy(true, "확인서 만드는 중…"); let pages; try { pages = await W.renderWoImages({ rows: rows(), meta: meta() }); } catch (e) { busy(false); return toast("확인서를 만들지 못했어요"); } busy(false);
      const rs = rows(); const byId = new Map(items.map((d) => [d.id, d])); const list = rs.map((r) => byId.get(r.id)).filter(Boolean); const no = new Map(rs.map((r) => [r.id, r.no]));
      const vs = [...new Set(items.map((d) => d.vendorId || ""))]; const Pd = await import("./pdfdoc.js"); window.__woImg = window.__woImg || {};
      return pdfSend({ title: W.WO_TITLE, fileName: `작업지시확인서_${vs.length === 1 && vs[0] ? Pd.safeName(vLabel(vs[0])) + "_" : ""}${ymdCompact()}.pdf`, docPages: pages.map((p) => p.canvas), landscape: true, photos: await pdfPhotos(list, (d) => no.get(d.id) || ""), log: window.__woImg, shareText: `${W.WO_TITLE} ${items.length}건` }); }
    const im = await makeImgs(); if (!im) return;
    if (k === "share") {
      if (canShareFiles(im.files)) { try { await navigator.share({ files: im.files, title: W.WO_TITLE, text: `${W.WO_TITLE} ${items.length}건` }); window.__woImg.shared = true; return; } catch (er) { if (er?.name === "AbortError") return; } }
      im.files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 300)); window.__woImg.fallback = true; return toast("이미지 공유가 안 되는 환경이라 이미지를 저장했어요. 카톡에서 사진으로 첨부해 주세요.", { ms: 7000 });
    }
    if (k === "copy") { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": im.pngs[0] })]); window.__woImg.copied = 1; return toast(`${im.pngs.length > 1 ? `1/${im.pngs.length}장 ` : ""}이미지를 복사했어요 — 카톡에 붙여넣기(Ctrl+V)`); } catch { return toast("이미지 복사가 막혔어요 — ‘이미지 저장’을 써 주세요"); } }
    if (k === "save") { im.files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 300)); window.__woImg.saved = true; return toast(`이미지 ${im.files.length}장을 저장했어요`); }
  }));
  const ro = new ResizeObserver(fit); ro.observe($("#wo-prev", el)); s.onClose = () => ro.disconnect();
  draw(); return s;
}
/* ---------- 1.3.2 사진 포함 PDF (요청서·확인서) ---------- */
/** 하자 순서대로 사진(조치 전, 하자당 최대 4장) + 설명 */
async function pdfPhotos(list, noOf, max = 4) { const out = [];
  for (const d of list) { const ph = (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, max);
    for (const x of ph) out.push({ blob: await photoOut(x, d), no: noOf(d), loc: M.locText(d), trade: M.tradeText(d), content: d.content || "" }); }
  return out; }
const ymdCompact = () => M.todayStr().replace(/-/g, "");
/** PDF 만들고 보내기: 폰은 공유창(파일 1개), PC는 저장(다운로드) + 되면 클립보드에 파일 복사. 반환 "shared" | "saved" | null */
async function pdfSend({ title, fileName, docPages, landscape = false, photos, log = {}, shareText = "", onSent = null }) {
  busy(true, "PDF 만드는 중…"); let r;
  try { const Pd = await import("./pdfdoc.js"); r = await Pd.buildPdf({ title, docPages, landscape, photos }); }
  catch (e) { busy(false); console.error(e); toast("PDF를 만들지 못했어요: " + (e.message || e)); return null; }
  busy(false);
  const file = new File([r.blob], fileName, { type: "application/pdf" });
  Object.assign(log, { pdf: { name: fileName, pages: r.pages, docPages: r.docPages, photoPages: r.photoPages, photos: r.photos, bytes: r.bytes, q: r.q } }); window.__pdfBlob = r.blob;
  const mb = (r.bytes / 1048576).toFixed(1);
  if (isMobileDevice() && canShareFiles([file])) {
    try { await navigator.share({ files: [file], title, text: shareText }); log.pdf.shared = true; return "shared"; } catch (er) { if (er?.name === "AbortError") return null; }
  }
  downloadBlob(file, fileName); log.pdf.saved = true;
  let clip = false; try { if (window.ClipboardItem?.supports?.("application/pdf")) { await navigator.clipboard.write([new ClipboardItem({ "application/pdf": r.blob })]); clip = true; } } catch {}
  log.pdf.clip = clip;
  toast(`PDF ${r.pages}쪽(${mb}MB)을 저장했어요${clip ? " · 클립보드에도 복사(카톡 PC에 Ctrl+V)" : ""} — 카톡 PC 대화방에 파일을 끌어다 놓으세요`, { ms: 10000, ...(onSent ? { action: "보냄으로 표시", onAction: onSent } : {}) });
  return "saved"; }

async function requestImageFor(items, vendor = null) {
  items = items.filter(Boolean); if (!items.length) return toast("요청서에 넣을 하자를 고르세요");
  if (!vendor) {
    const byV = new Map(); for (const d of items) { const k = d.vendorId || ""; if (!byV.has(k)) byV.set(k, []); byV.get(k).push(d); }
    let vid = [...byV.keys()][0];
    if (byV.size > 1) {
      vid = await choose(`요청서는 업체별로 만들어요 · ${byV.size}곳`, [...byV.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, l]) => ({ icon: "🏢", label: id ? vLabel(id) : "업체 미지정", sub: `${l.length}건`, value: id || "_none" })));
      if (vid === null) return; if (vid === "_none") vid = "";
    }
    items = byV.get(vid) || []; vendor = vid ? V(vid) : null;
  }
  return requestImageSheet({ vendor, items });
}
async function requestImageSheet({ vendor, items }) {
  busy(true, "요청서 이미지 만드는 중…");
  let pages = [], urls = [], jpgs = [], pngs = [], docNo = "", text = ""; const photosAll = new Map();
  try {
    const R = await import("./reqimg.js");
    const { no, today } = nextDocNo(); docNo = no;
    const photos = photosAll; const single = items.length === 1;
    for (const d of items) {
      const ph = (await db.byIndex("photos", "by_defect", d.id)).filter((x) => x.kind !== "after").slice(0, 4); const bl = [];
      for (const x of ph) bl.push(single ? await photoOut(x, d) : x.thumb || x.blob);
      photos.set(d.id, bl);
    }
    pages = await R.renderRequestImages({ project: P(), vendor, items, photos, issuer: S.issuer || (Sync.signedIn?.() ? Sync.actorName() : ""), today, docNo, watermark: !Pro.can("pdfNoWatermark") });
    jpgs = await Promise.all(pages.map((pg) => R.toBlob(pg.canvas, "image/jpeg", 0.9)));
    pngs = await Promise.all(pages.map((pg) => R.toBlob(pg.canvas, "image/png")));
    urls = jpgs.map((b) => URL.createObjectURL(b));
    text = R.requestText({ project: P(), vendor, items, docNo });
  } catch (e) { busy(false); console.error(e); return toast("요청서 이미지를 만들지 못했어요: " + (e.message || e)); }
  busy(false);
  const files = jpgs.map((b, i) => new File([b], `하자조치요청서_${docNo}${jpgs.length > 1 ? "_" + (i + 1) : ""}.jpg`, { type: "image/jpeg" }));
  window.__reqImg = { docNo, n: pages.length, sizes: pages.map((p) => [p.w, p.h]), jpg: jpgs.map((b) => b.size), text, items: items.map((d) => d.id) };
  const mobile = isMobileDevice(); const canFiles = canShareFiles(files); const canClip = !!(window.ClipboardItem && navigator.clipboard?.write);
  const vps = M.vendorPhones(vendor);
  const hasPh = [...photosAll.values()].some((l) => l.length);
  const btnPdf = hasPh ? `<button type="button" class="btn btn-kakao btn-lg" data-r="pdf">📄 ${mobile ? "PDF로 공유" : "PDF 저장"} <small>사진 크게 포함 · 파일 1개</small></button>` : "";
  const btnShare = `<button type="button" class="btn btn-kakao btn-lg" data-r="share">카톡으로 공유 <small>이미지 첨부</small></button>`;
  const btnCopy = canClip ? `<button type="button" class="btn ${mobile ? "" : "btn-kakao"} btn-lg" data-r="copy" data-i="0">🖼 이미지 복사${mobile ? "" : " <small>카톡 PC에 Ctrl+V</small>"}</button>` : "";
  const s = openSheet({ title: `요청서 이미지 · ${vendor?.name || "업체 미지정"} ${items.length}건`, full: true, cls: "req-sheet",
    html: `<p class="help small">문서번호 <b>${esc(docNo)}</b>${pages.length > 1 ? ` · ${pages.length}장(장당 6건)` : ""}. 내용을 고치려면 하자를 수정한 뒤 다시 만드세요.</p>
      <div class="req-prev" id="req-prev">${urls.map((u, i) => `<figure><img src="${u}" alt="요청서 이미지 ${i + 1}">${pages.length > 1 && canClip ? `<button type="button" class="btn btn-sm" data-r="copy" data-i="${i}">${i + 1}장 복사</button>` : ""}</figure>`).join("")}</div>
      ${hasPh ? `<p class="help small pdf-tip">사진이 있는 요청서는 <b>PDF 한 파일</b>(요청서 → 사진 크게, 한 쪽에 2장)로 보내면 사진이 모두 가요.</p>` : ""}
      <div class="send-grid">${btnPdf}${mobile ? btnShare + btnCopy : btnCopy + btnShare}
        <button type="button" class="btn btn-lg" data-r="save">💾 이미지 저장</button>
        <button type="button" class="btn btn-lg" data-r="text">📋 문구 복사</button>
        <button type="button" class="btn btn-lg" data-r="wo">📋 작업지시서(표) 형식</button>
        ${vps.map((x) => `<a class="btn btn-lg" data-r="sms" href="${esc(M.smsHref(x.phone, text))}">💬 문자 ${x.name ? `<small>${esc(M.contactLabel(x))}</small> ` : ""}${esc(x.phone)}</a>`).join("")}</div>
      <p class="help small">${mobile ? "‘카톡으로 공유’ → 공유창에서 <b>카카오톡</b> → 업체 대화방을 고르면 이미지가 첨부돼요. 보내기는 카톡에서 직접 눌러요." : "PC: ‘이미지 복사’ 후 카카오톡 PC 업체 대화방에 <b>Ctrl+V</b>. 복사가 안 되면 ‘이미지 저장’ 후 끌어다 놓으세요."}${vps.length ? " 문자는 문구만 채워져요 — 이미지는 저장 후 문자에 직접 첨부하세요." : ""}${canFiles ? "" : " 이 브라우저는 이미지 공유가 안 돼서 ‘카톡으로 공유’를 누르면 저장 + 문구 복사로 대신해요."}</p>
      <label class="check"><input type="checkbox" id="req-mark" checked> 보낸 뒤 ‘접수’ 건을 ‘업체전달’로 바꾸고 요청서 발송 시각 기록</label>` });
  const el = s.el; const cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  const done = async (via, note = "") => {
    if (!$("#req-mark", el)?.checked) { if (note) toast(note, { ms: 6000 }); return; }
    const at = new Date().toISOString();
    for (const d of items) { d.reqAt = at; d.reqNo = docNo; try { await saveDefect(d); } catch (e) { console.warn(e); } }
    await s.close(); cleanup(); await markSent(items, via, note || `요청서 ${docNo} 발송 기록`);
  };
  const save = () => files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 300));
  $$("[data-r]", el).forEach((b) => b.addEventListener("click", async (e) => {
    const k = b.dataset.r;
    if (k === "share") {
      if (canFiles) {
        try { await navigator.share({ files, text, title: "하자 조치 요청서" }); window.__reqImg.shared = true; return done("요청서 이미지(카톡·공유)"); }
        catch (er) { if (er?.name === "AbortError") return; }
      }
      save(); const ok = await copyText(text); window.__reqImg.fallback = true;
      return toast(`이미지 공유가 안 되는 환경이라 이미지를 저장${ok ? "하고 문구를 복사" : ""}했어요. 카톡에서 사진으로 첨부해 주세요.`, { ms: 8000, action: "보냄으로 표시", onAction: () => done("요청서 이미지") });
    }
    if (k === "copy") {
      const i = Number(b.dataset.i || 0);
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": pngs[i] })]); window.__reqImg.copied = i + 1; }
      catch (er) { console.warn(er); return toast("이미지 복사가 막혔어요 — ‘이미지 저장’ 후 첨부해 주세요"); }
      return toast(`${pages.length > 1 ? `${i + 1}장 ` : ""}이미지를 복사했어요 — 카카오톡 대화방에 붙여넣기(Ctrl+V)`, { ms: 8000, action: "보냄으로 표시", onAction: () => done("요청서 이미지(복사)") });
    }
    if (k === "save") { save(); return toast("이미지를 저장했어요", { ms: 6000, action: "보냄으로 표시", onAction: () => done("요청서 이미지(저장)") }); }
    if (k === "text") return toast((await copyText(text)) ? "문구를 복사했어요" : "복사 실패");
    if (k === "pdf") { const list = [...items].sort(M.sortDefects); const noOf = (d) => list.indexOf(d) + 1;
      const r = await pdfSend({ title: `하자 조치 요청서 ${docNo}`, fileName: `요청서_${(await import("./pdfdoc.js")).safeName(vendor?.name || "업체미지정")}_${ymdCompact()}.pdf`, docPages: pages.map((p) => p.canvas), photos: await pdfPhotos(list, noOf), log: window.__reqImg, shareText: text, onSent: () => done("요청서 PDF") });
      if (r === "shared") return done("요청서 PDF(카톡·공유)");
      return; }
    if (k === "wo") { await s.close(); cleanup(); return workOrderSheet({ items }); }
    if (k === "sms") { e.preventDefault(); S.lastSms = b.getAttribute("href"); if (!window.__noNav) location.href = S.lastSms; return toast("문자 앱에서 이미지를 직접 첨부해 주세요", { ms: 7000, action: "보냄으로 표시", onAction: () => done("요청서 이미지(문자)") }); }
  }));
  return s;
}

/* ---------- 업체 ---------- */
ROUTES.vendors = async () => {
  setTab("vendors"); setHeader("업체", { backBtn: navDepth() > 1, action: `<button type="button" class="hdr-btn" id="btn-vadd">＋ 등록</button>` });
  const list = PD(); const today = M.todayStr();
  const stat = (vid) => { const a = list.filter((d) => d.vendorId === vid); return { open: a.filter(M.isOpen).length, od: a.filter((d) => M.isOverdue(d, today)).length, unsent: a.filter((d) => d.status === "접수" || d.status === "재접수").length, all: a.length }; };
  const vs = S.vendors.map((v) => ({ v, s: stat(v.id) })).sort((a, b) => b.s.unsent - a.s.unsent || b.s.open - a.s.open || a.v.name.localeCompare(b.v.name, "ko"));
  const none = list.filter((d) => !d.vendorId && M.isOpen(d)).length;
  view().innerHTML = `
    <button type="button" class="btn btn-block" id="btn-contacts">📇 연락처에서 업체 가져오기</button>
    ${vs.map(({ v, s }) => `<article class="vcard" data-v="${v.id}" tabindex="0"><div class="vc-main"><b>${esc(v.name)}</b><small>${esc(M.contactSummary(v) || "연락처 없음")}</small>
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
  const cs = await contactImportSheet({ title: "연락처에서 업체 가져오기", forVendors: true }); if (!cs?.length) return;
  let k = 0;
  for (const c of cs) { if (!c.name && !c.phones.length) continue; const v = { id: M.uid("v"), name: (c.org || c.name || c.phones[0]).slice(0, 30), trades: [], memo: "", createdAt: new Date().toISOString() }; M.setContacts(v, [{ name: c.name, role: c.role, phones: c.phones }]); await saveVendor(v); k++; }
  if (k) { toast(`${k}개 업체를 추가했어요. 공종을 지정해 주세요`); rerender(); }
}
/** 담당자 번호 고르기(한 명이면 바로) */
async function pickPhone(v, verb = "연락") {
  const list = M.vendorPhones(v); if (!list.length) { toast("등록된 전화번호가 없어요"); return ""; }
  if (list.length === 1) return list[0].phone;
  return (await choose(`${v.name} — 누구에게 ${verb}할까요?`, list.map((x) => ({ icon: verb === "전화" ? "📞" : "💬", label: M.contactLabel(x), sub: x.phone, value: x.phone })))) || "";
}
/** 1.1.1 연락처 가져오기: ① 휴대폰 연락처 고르기(되는 기기만) ② 복사한 글 붙여넣기 ③ 연락처 파일(.vcf). 고른 담당자 목록을 돌려줌 */
function contactImportSheet({ title = "연락처에서 가져오기", forVendors = false } = {}) {
  return new Promise((resolve) => {
    const info = contactPickerInfo(); let result = null;
    const s = openSheet({ title, full: true, cls: "cimp-sheet",
      html: `<div class="cimp-opts">
        ${info.ok ? `<button type="button" class="btn btn-lg btn-block" id="ci-pick">📱 휴대폰 연락처에서 고르기</button>` : `<p class="help warnbox" id="ci-nopick">📱 휴대폰 연락처 바로 고르기는 이 기기에서 안 돼요 — ${esc(info.why)}. 아래 두 방법을 쓰세요.</p>`}
        <p class="help" id="ci-err" hidden></p>
        <label class="fld"><span>📋 복사한 글 붙여넣기 <small>(카톡 프로필·연락처 공유·문자 내용 등 — 이름과 010 번호를 찾아요)</small></span>
          <textarea class="inp" id="ci-text" rows="4" placeholder="예)
김철수 반장 010-1234-5678
이영희 소장 010-9876-5432"></textarea></label>
        <div class="row wrap"><button type="button" class="btn" id="ci-paste">붙여넣기</button><button type="button" class="btn btn-primary" id="ci-read">글에서 찾기</button><button type="button" class="btn" id="ci-vcf">📁 연락처 파일(.vcf) 열기</button></div>
        <p class="help small">연락처 파일 만드는 법(삼성 연락처): 연락처 앱 → 사람 길게 눌러 고르기 → <b>공유</b> → <b>vCard 파일(VCF)</b> → ‘내 파일’에 저장한 뒤 여기서 열기.</p></div>
        <div id="ci-list"></div>`,
      footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="ok" id="ci-ok" disabled>추가</button>`,
 });
    s.onClose = () => resolve(result); const el = s.el; let found = [];
    const show = (list, src) => {
      found = list.filter((c) => c.name || c.phones?.length);
      $("#ci-list", el).innerHTML = found.length ? `<p class="help"><b>${esc(src)}</b>에서 ${found.length}명 찾음 — 체크한 사람만 ${forVendors ? "업체로" : "담당자로"} 추가돼요(이름·직책은 고칠 수 있어요)</p>${found.map((c, i) => `<div class="ci-it"><label class="check"><input type="checkbox" data-ci="${i}" checked></label><input class="inp" data-cn="${i}" value="${esc(c.name)}" placeholder="이름"><input class="inp ci-role" data-cr="${i}" value="${esc(c.role || "")}" placeholder="직책" list="ci-roles"><small>${esc(c.phones.join(", ") || "번호 없음")}${c.org ? ` · ${esc(c.org)}` : ""}</small></div>`).join("")}<datalist id="ci-roles">${M.CONTACT_ROLES.map((r) => `<option value="${r}">`).join("")}</datalist>` : `<p class="help warnbox">${esc(src)}에서 이름이나 전화번호를 찾지 못했어요</p>`;
      $("#ci-ok", el).disabled = !found.length; $("#ci-ok", el).textContent = found.length ? `${found.length}명 추가` : "추가";
      setTimeout(() => $("#ci-list", el)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
      el.querySelector("#ci-list").addEventListener("change", () => { const n = $$("[data-ci]:checked", el).length; $("#ci-ok", el).textContent = `${n}명 추가`; $("#ci-ok", el).disabled = !n; });
    };
    const err = (msg) => { const e = $("#ci-err", el); e.hidden = false; e.className = "help warnbox"; e.textContent = msg; };
    $("#ci-pick", el)?.addEventListener("click", async () => {
      try { const cs = await pickContacts({ multiple: true }); window.__contactPick = { ok: true, n: cs.length }; if (!cs.length) return err("고른 연락처가 없어요"); show(cs.map((c) => ({ ...c, phones: c.phones.map(M.normPhone) })), "휴대폰 연락처"); }
      catch (e) { window.__contactPick = { ok: false, name: e?.name, msg: e?.message }; try { localStorage.setItem("hs:contactPickErr", JSON.stringify({ at: new Date().toISOString(), name: e?.name, msg: String(e?.message || e).slice(0, 200), ua: navigator.userAgent })); } catch { /* 무시 */ }
        if (e?.name === "AbortError") return; err(`연락처 선택 창을 열지 못했어요(${e?.name || "오류"}${e?.message ? ": " + e.message : ""}). 아래 ‘복사한 글 붙여넣기’나 ‘연락처 파일’을 써 주세요.`); }
    });
    $("#ci-paste", el).addEventListener("click", async () => { try { const t = await navigator.clipboard.readText(); $("#ci-text", el).value = t; if (t.trim()) show(M.parseContactText(t), "붙여넣은 글"); else err("복사된 글이 없어요 — 칸을 길게 눌러 붙여넣기 하세요"); } catch { err("자동 붙여넣기가 막혀 있어요 — 칸을 길게 눌러 ‘붙여넣기’ 하세요"); $("#ci-text", el).focus(); } });
    $("#ci-read", el).addEventListener("click", () => { const t = $("#ci-text", el).value; if (!t.trim()) return err("먼저 글을 붙여넣으세요"); show(M.parseContactText(t), "붙여넣은 글"); });
    $("#ci-vcf", el).addEventListener("click", async () => {
      const [f] = await pickFile(".vcf,text/vcard,text/x-vcard,text/directory,text/plain"); if (!f) return;
      const t = await f.text(); const list = /BEGIN:VCARD/i.test(t) ? M.parseVcf(t) : M.parseContactText(t); show(list, f.name);
    });
    $("[data-a=no]", el).addEventListener("click", () => s.close());
    $("[data-a=ok]", el).addEventListener("click", () => {
      result = found.map((c, i) => ({ ...c, name: ($(`[data-cn="${i}"]`, el)?.value || "").trim(), role: ($(`[data-cr="${i}"]`, el)?.value || "").trim() })).filter((c, i) => $(`[data-ci="${i}"]`, el)?.checked && (c.name || c.phones.length));
      s.close();
    });
  });
}
ROUTES.vendor = async (qq) => {
  const v = V(qq.id); if (!v) return replace("#/vendors");
  setTab("vendors"); setHeader(v.name, { backBtn: true, action: `<button type="button" class="hdr-btn" id="btn-vedit">수정</button>` });
  const mode = LS.get("vmode", "unsent");
  const all = PD().filter((d) => d.vendorId === v.id || (M.hasSteps(d) && d.steps.some((x) => x.vendorId === v.id)));
  const sets = { turn: all.filter((d) => M.isTurnOf(d, v.id)), later: all.filter((d) => M.isLaterOf(d, v.id)), unsent: all.filter((d) => d.status === "접수" || d.status === "재접수"), open: all.filter(M.isOpen), od: all.filter((d) => M.isOverdue(d)), done: all.filter((d) => d.status === "조치완료"), all };
  const list = (sets[mode] || sets.unsent).sort(M.sortDefects);
  const ph = v.phones || []; const cs = M.contactsOf(v);
  view().innerHTML = `
    <section class="card"><div class="vinfo"><div><small>${esc((v.trades || []).join(", ") || "공종 미지정")}</small>${v.memo ? `<small>${esc(v.memo)}</small>` : ""}</div></div>
      ${cs.map((c) => `<div class="vcontact"><b>${esc(c.name || "담당자")}${c.role ? ` <small class="tag">${esc(c.role)}</small>` : ""}</b><div class="contact-row">${c.phones.map((p) => `<a class="btn" href="${M.telHref(p)}">📞 ${esc(p)}</a>`).join("") || '<span class="help">번호 없음</span>'}</div></div>`).join("") || '<div class="contact-row"><span class="help">담당자·전화번호가 없어요 · 수정에서 추가</span></div>'}</section>
    <div class="chips scroll">${[["turn", "내 차례 대기"], ...(sets.later.length ? [["later", "앞 공정 대기"]] : []), ["unsent", "미전달"], ["open", "미조치"], ["od", "기한초과"], ["done", "조치완료(확인 대기)"], ["all", "전체"]].map(([k, l]) => `<button type="button" class="chip ${k === mode ? "on" : ""}" data-m="${k}">${l} ${sets[k].length}</button>`).join("")}</div>
    <div class="send-bar"><button type="button" class="btn btn-kakao btn-lg" id="btn-send">보내기 · 건별 선택 (${list.filter((d) => d.status !== "확인완료").length})</button>
      ${ph[0] ? `<button type="button" class="btn btn-lg" id="btn-sms">💬 문자</button>` : ""}<button type="button" class="btn btn-lg" id="btn-reqimg">🧾 요청서 만들기</button><button type="button" class="btn btn-lg" id="btn-pdf">📄 PDF</button></div>
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
  $("#btn-reqimg").addEventListener("click", () => { const picked = selItems().filter((d) => all.includes(d)); const pool = picked.length ? picked : list.filter((d) => d.status !== "확인완료"); return pool.length ? requestImageFor(pool, v) : toast("요청서에 넣을 하자가 없어요"); });
  $("#btn-confirm-all")?.addEventListener("click", async () => { if (!(await ask(`${list.length}건을 확인완료로 바꿀까요?`))) return; for (const d of list) { setStatus(d, "확인완료", "일괄 확인"); await saveDefect(d); } rerender(); });
};
ROUTES["vendor-edit"] = async (qq) => {
  const p = P(); const v = V(qq.id) ? structuredClone(V(qq.id)) : { id: M.uid("v"), name: "", person: "", phones: [], trades: [], memo: "", createdAt: new Date().toISOString() };
  const isNew = !V(qq.id);
  setTab(null); setHeader(isNew ? "업체 등록" : "업체 수정", { backBtn: true });
  const trades = [...new Set([...p.trades.map((t) => t.name), ...(v.trades || [])])];
  view().innerHTML = `<form id="vform" class="form fsteps">
    <section class="fsec"><h3 class="fsec-h">🏢 업체</h3>
    <label class="fld"><span>업체명 <em>*</em></span><input class="inp" id="v-name" value="${esc(v.name)}" placeholder="예: ○○타일" required></label>
    <div class="fld"><span>담당 공종 <small>(이 공종 하자 등록 시 자동 지정)</small></span><div class="chips wrap" id="v-trades">${trades.map((t) => `<button type="button" class="chip ${(v.trades || []).includes(t) ? "on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div></div></section>
    <section class="fsec"><h3 class="fsec-h">👤 담당자 <small>여러 명 가능 · 소장·반장 등</small></h3><div id="v-contacts"></div>
      <div class="row wrap"><button type="button" class="btn btn-sm" id="v-addc">＋ 담당자 추가</button><button type="button" class="btn btn-sm" id="v-pick">📇 연락처에서</button></div>
      <datalist id="v-roles">${M.CONTACT_ROLES.map((r) => `<option value="${r}">`).join("")}</datalist></section>
    <section class="fsec"><h3 class="fsec-h">📝 메모</h3><label class="fld"><span class="sr-only">메모</span><input class="inp" id="v-memo" value="${esc(v.memo || "")}" placeholder="예: 오전 현장 상주"></label></section>
    <div class="form-act">${isNew ? "" : `<button type="button" class="btn btn-danger" id="v-del">삭제</button>`}<button type="submit" class="btn btn-primary btn-lg">저장</button></div></form>`;
  const phRow = (val = "") => `<div class="row vc-ph"><input class="inp" type="tel" inputmode="tel" data-c="phone" value="${esc(val)}" placeholder="010-0000-0000"><button type="button" class="btn btn-sm" data-rmp aria-label="번호 삭제">✕</button></div>`;
  const addContact = (c = { name: "", role: "", phones: [""] }) => {
    const box = document.createElement("div"); box.className = "vc-ed card";
    box.innerHTML = `<div class="row"><input class="inp" data-c="name" value="${esc(c.name || "")}" placeholder="이름 (예: 김철수)" aria-label="담당자 이름"><input class="inp vc-role" data-c="role" value="${esc(c.role || "")}" placeholder="직책" list="v-roles" aria-label="직책"><button type="button" class="btn btn-sm btn-danger" data-rmc aria-label="담당자 삭제">삭제</button></div>
      <div class="vc-phs">${(c.phones?.length ? c.phones : [""]).map(phRow).join("")}</div><button type="button" class="btn btn-sm" data-addph>＋ 번호</button>`;
    $("#v-contacts").appendChild(box);
  };
  const cs0 = M.contactsOf(v); (cs0.length ? cs0 : [undefined]).forEach((c) => addContact(c));
  $("#v-contacts").addEventListener("click", (e) => {
    if (e.target.matches("[data-rmp]")) { const phs = e.target.closest(".vc-phs"); if (phs.children.length > 1) e.target.parentElement.remove(); else e.target.previousElementSibling.value = ""; }
    else if (e.target.matches("[data-addph]")) e.target.previousElementSibling.insertAdjacentHTML("beforeend", phRow());
    else if (e.target.matches("[data-rmc]")) { if ($$(".vc-ed", $("#v-contacts")).length > 1) e.target.closest(".vc-ed").remove(); else $$("input", e.target.closest(".vc-ed")).forEach((i) => { i.value = ""; }); }
  });
  $("#v-addc").addEventListener("click", () => { addContact(); $$(".vc-ed [data-c=name]").pop()?.focus(); });
  const readContacts = () => $$(".vc-ed", $("#v-contacts")).map((b) => ({ name: $("[data-c=name]", b).value, role: $("[data-c=role]", b).value, phones: $$("[data-c=phone]", b).map((i) => i.value) }));
  $("#v-pick").addEventListener("click", async () => {
    const got = await contactImportSheet({ title: "담당자 가져오기" }); if (!got?.length) return;
    const cur = readContacts().filter((c) => c.name.trim() || c.phones.some((x) => x.trim()));
    $("#v-contacts").innerHTML = ""; [...cur, ...got.map((c) => ({ name: c.name, role: c.role, phones: c.phones }))].forEach((c) => addContact(c));
    if (!$("#v-name").value && got[0]?.org) $("#v-name").value = got[0].org;
    toast(`담당자 ${got.length}명 추가 — 저장을 눌러 주세요`);
  });
  $("#v-trades").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) b.classList.toggle("on"); });
  $("#vform").addEventListener("submit", async (e) => {
    e.preventDefault(); const name = $("#v-name").value.trim(); if (!name) return toast("업체명을 입력하세요");
    Object.assign(v, { name, trades: $$("#v-trades .chip.on").map((b) => b.dataset.t), memo: $("#v-memo").value.trim() }); M.setContacts(v, readContacts());
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
  const v = M.setContacts({ id: M.uid("v"), name, trades: trade ? [trade] : [], memo: "", createdAt: new Date().toISOString() }, phone ? [{ name: "", role: "", phones: [phone] }] : []);
  await saveVendor(v); toast(`‘${name}’ 등록${trade ? ` · ${trade} 담당` : ""}`); return v;
}

/* ---------- 내보내기 ---------- */
async function exportSheet(list, title) {
  if (!list.length) return toast("내보낼 하자가 없어요");
  const k = await choose(`${title} 내보내기 · ${list.length}건`, [{ label: "엑셀(.xlsx)", value: "xlsx", icon: "📊" }, { label: "CSV", value: "csv", icon: "🧾" }, { label: "요청서 PDF(인쇄)", value: "pdf", icon: "📄", sub: "업체별로 묶어서 인쇄" }, { label: "작업지시 및 완료확인서", value: "wo", icon: "📋", sub: "표 형식 · A4 가로 인쇄/PDF · 이미지" }]);
  if (!k) return;
  if (k === "wo") return workOrderSheet({ items: list, filter: S.filter });
  const { toXlsx, toCsv } = await import("./exporter.js");
  const ctx = { vendorName: vName, photos: photoCount, vendorOf: (d) => V(d.vendorId), vendors: S.vendors };
  const fn = `${P().name}_${title}_${M.todayStr()}`.replace(/[\\/:*?"<>|\s]+/g, "_");
  if (k === "xlsx") { busy(true, "엑셀 만드는 중…"); const b = await toXlsx(list, ctx); busy(false); S.lastExport = { name: fn + ".xlsx", size: b.size }; return shareOrDownload(b, fn + ".xlsx"); }
  if (k === "csv") { const b = toCsv(list, ctx); S.lastExport = { name: fn + ".csv", size: b.size }; return shareOrDownload(b, fn + ".csv"); }
  const byV = new Map(); for (const d of list) byV.set(d.vendorId || "", [...(byV.get(d.vendorId || "") || []), d]);
  if (byV.size === 1) return printRequest({ vendor: V([...byV.keys()][0]), items: list });
  const vid = await choose("어느 업체 요청서?", [...byV.entries()].map(([id, a]) => ({ label: id ? vLabel(id) : "업체 미지정", sub: `${a.length}건`, value: id || "_none" })));
  if (vid) printRequest({ vendor: V(vid), items: byV.get(vid === "_none" ? "" : vid) });
}

/* ---------- 1.3.0 설정 › 공종·세부공종 → 업체 자동 지정 표(현장별, 현장 문서로 동기화) ---------- */
function vendorMapSheet() {
  const p = P(); if (!p) return; let rows = structuredClone(p.vendorMap || []);
  const learned = vendorLearned(); const tName = (tk) => p.trades.find((t) => M.tradeKey(t.name) === tk)?.name || tk;
  const learnedRows = () => [...learned.entries()].filter(([k]) => k.startsWith("s:") || k.startsWith("t:")).map(([k, x]) => { const [tk, sk] = k.slice(2).split("|"); const t = tName(tk); const sub = sk ? (p.trades.find((q) => M.tradeKey(q.name) === tk)?.subs || []).find((s2) => M.sameKey(s2) === sk) || sk : ""; return { trade: t, sub, ...x }; })
    .filter((r) => V(r.id) && !rows.some((q) => M.tradeKey(q.trade) === M.tradeKey(r.trade) && M.sameKey(q.sub || "") === M.sameKey(r.sub || ""))).sort((a, b) => b.n - a.n).slice(0, 30);
  const vOpts = (sel) => `<option value="">업체 고르기…</option>${S.vendors.map((v) => `<option value="${v.id}" ${v.id === sel ? "selected" : ""}>${esc(v.name)}</option>`).join("")}`;
  const tOpts = (sel) => `<option value="">공종…</option>${[...new Set([...p.trades.map((t) => t.name), ...(sel ? [sel] : [])])].map((t) => `<option ${t === sel ? "selected" : ""}>${esc(t)}</option>`).join("")}`;
  const s = openSheet({ title: "공종 → 업체 자동 지정", full: true, cls: "vm-sheet", html: `<p class="help">하자 등록·수정에서 공종이나 세부공종을 고르면 <b>담당업체가 미지정일 때</b> 자동으로 채워요(이미 있으면 ‘→ 업체로 변경’ 버튼만). 순서: 이 표의 세부공종 → 공종 → 기록에서 가장 많이 맡은 업체 → 업체 담당 공종.</p>
      <div id="vm-rows"></div><button type="button" class="btn btn-sm" id="vm-add">＋ 줄 추가</button>
      <h4 class="sec">기록으로 배운 것 <small class="help">가장 많이 맡은 업체 — 표에 넣으면 고정돼요</small></h4><div id="vm-learn"></div>`,
    footer: `<button type="button" class="btn" data-close>취소</button><button type="button" class="btn btn-primary" id="vm-save">저장</button>` });
  const el = s.el;
  const draw = () => {
    $("#vm-rows", el).innerHTML = rows.map((r, i) => { const subs = p.trades.find((t) => t.name === r.trade)?.subs || []; return `<div class="vm-row" data-i="${i}"><select class="inp" data-f="trade" aria-label="공종">${tOpts(r.trade)}</select>
      <input class="inp" data-f="sub" list="vm-subs-${i}" value="${esc(r.sub || "")}" placeholder="세부공종(전체)" aria-label="세부공종"><datalist id="vm-subs-${i}">${subs.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <select class="inp" data-f="vendorId" aria-label="업체">${vOpts(r.vendorId)}</select><button type="button" class="btn btn-sm" data-rm="${i}" aria-label="줄 지우기">✕</button></div>`; }).join("") || '<p class="help small">아직 없어요 · 아래 ‘기록으로 배운 것’에서 넣거나 줄을 추가해요</p>';
    const lr = learnedRows(); window.__vmLearn = lr.length;
    $("#vm-learn", el).innerHTML = lr.map((r, i) => `<div class="vm-l"><span><b>${esc(r.trade)}</b>${r.sub ? ` › ${esc(r.sub)}` : ""} → ${esc(V(r.id)?.name || "")} <small class="help">${r.n}/${r.all}건</small></span><button type="button" class="btn btn-sm" data-lp="${i}">표에 넣기</button></div>`).join("") || '<p class="help small">업체가 지정된 하자가 쌓이면 여기에 나와요</p>';
    $$(".vm-row", el).forEach((row) => $$("[data-f]", row).forEach((inp) => inp.addEventListener("change", () => { rows[+row.dataset.i][inp.dataset.f] = inp.value.trim(); if (inp.dataset.f === "trade") draw(); })));
    $$("[data-rm]", el).forEach((b) => b.addEventListener("click", () => { rows.splice(+b.dataset.rm, 1); draw(); }));
    $$("[data-lp]", el).forEach((b) => b.addEventListener("click", () => { const r = lr[+b.dataset.lp]; rows.push({ trade: r.trade, sub: r.sub || "", vendorId: r.id }); draw(); }));
  };
  $("#vm-add", el).addEventListener("click", () => { rows.push({ trade: "", sub: "", vendorId: "" }); draw(); });
  $("#vm-save", el).addEventListener("click", async () => { p.vendorMap = rows.filter((r) => r.vendorId && (r.trade || r.sub)).map((r) => ({ trade: r.trade || "", sub: r.sub || "", vendorId: r.vendorId })); await saveProject(p); toast(`자동 지정 ${p.vendorMap.length}줄 저장`); s.close(); });
  draw(); return s;
}
/* ---------- 설정 ---------- */
ROUTES.help = async (qq) => {
  setTab(null); setHeader("사용법", { backBtn: true, help: "" });
  const { renderHelp } = await import("./help.js");
  renderHelp(view(), { s: qq.s || "", onboard: "#/onboard?again=1" });
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  if (qq.s) return "keep-scroll";
};
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
      ${item("", "🧪", "샘플 현장 불러오기", "기능을 둘러볼 수 있는 가상 데이터", 'data-a="sample"')}</div>
    <h3 class="sec">사진·표시</h3><div class="slist">
      ${item("", "📷", "사진에 위치·일시 새기기", stampOn() ? "켬 · 찍을 때 사진 아래에 현장·위치·공종·조치 전/후·일시 표시" : "끔 · 원본 그대로 저장(보낼 때도 새기지 않음)", 'data-a="stamp" id="si-stamp"')}
      ${p ? item("", "🎨", "동현황 색 기준", M.heatLegendText(M.heatThresholds(p, PD())) + ` · ${M.heatCfg(p).basis === "all" ? "전체" : "미조치"}${M.heatCfg(p).mode === "auto" ? " · 자동" : ""}`, 'data-a="heat"') : ""}
      ${item("", "✍️", "요청자 이름", esc(S.issuer || "요청서에 표시될 이름(선택)"), 'data-a="issuer"')}
      ${p ? item("", "🏷", "공종 → 업체 자동 지정", `표 ${(p.vendorMap || []).length}줄 · 없으면 기록에서 가장 많이 맡은 업체`, 'data-a="vendor-map" id="si-vmap"') : ""}
      ${item("", "🧹", "공종 이름 정리/합치기", (() => { const n1 = P() ? tradeDupesNow().length : 0; return n1 ? `비슷한 이름 ${n1}묶음 — 합치기` : "도장 · 도장공사 같은 이름을 하나로"; })(), 'data-a="trade-merge" id="si-trademerge"')}
      ${item("", "🏷", "하자 유형 정리/합치기", (() => { const n1 = P() ? typeDupesNow().length : 0; return n1 ? `비슷한 이름 ${n1}묶음 — 합치기` : "찍힘 · 흠집/찍힘 같은 이름을 하나로"; })(), 'data-a="type-merge" id="si-typemerge"')}</div>
    <h3 class="sec">동기화·팀</h3><div class="slist">
      ${item("#/sync", "👥", "동기화·팀 현장", Sync.attached() ? `${esc(Sync.state.ws.name)} · ${ROLE_KO[Sync.state.ws.role] || ""}${Sync.state.wsDoc ? ` · 팀원 ${Object.keys(Sync.state.wsDoc.members || {}).length}/${Sync.memberCap(Sync.state.wsDoc)} (${Sync.planOf(Sync.state.wsDoc) === "pro" ? "유료" : "무료"})` : ""} · ${esc(Sync.status().label)}` : `꺼짐 · 팀원·PC·폰이 같은 현장을 실시간으로 공유 (무료: 현장당 ${Sync.FREE_MEMBERS}명)`, 'id="si-sync"')}</div>
    <h3 class="sec">데이터</h3><div class="slist">
      ${p ? item("#/import", "📥", "엑셀·CSV 가져오기", "다른 시스템 하자 목록 → 열 매핑 후 가져오기") : ""}
      ${p ? item("", "📤", "전체 내보내기", "엑셀·CSV·요청서", 'data-a="export"') : ""}
      ${item("", "💾", "백업 파일 만들기 (zip)", "데이터+사진 전체 · 기기 변경 시 필수", 'data-a="backup"')}
      ${item("#/restore", "♻️", "백업에서 복원", "")}
      ${item("", "🛡", "저장공간 보호", persisted ? "켜짐 · 브라우저가 데이터를 지우지 않아요" : `꺼짐 · 눌러서 요청${est ? " · " + est : ""}`, 'data-a="persist"')}</div>
    <h3 class="sec">도움말·정보</h3><div class="slist">
      ${item("#/help", "📘", "사용법 보기", "등록·도면·보내기·팀 공유·자주 묻는 질문", 'id="si-help"')}
      ${item("#/about", "ℹ️", "앱 정보", `버전 ${APP_VERSION}`)}
      ${item("#/privacy", "🔒", "개인정보처리방침", Sync.attached() ? "동기화 중: 데이터가 Google Firebase에 저장돼요" : "동기화를 켜기 전에는 기기에만 저장")}
      ${item("#/pro", "⭐", Pro.isPro() ? "하자싹 프로 (사용 중)" : "하자싹 프로", Pro.isPro() ? "모든 기능 사용 중" : "현장 무제한 · 요청서 워터마크 제거")}</div>
    <h3 class="sec">주의</h3><div class="slist">
      ${item("", "🗑", "모든 데이터 삭제", Sync.attached() ? "현장·하자·사진·업체 · 팀 현장 전체(모든 팀원 기기·클라우드)에서도 삭제" : "이 기기의 현장·하자·사진·업체", 'data-a="wipe"')}</div>`;
  bindVerFoot();
  $$("[data-go]", view()).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$("[data-a]", view()).forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a;
    if (a === "switch") return switchProject();
    if (a === "sample") return loadSample();
    if (a === "heat") return heatSheet();
    if (a === "stamp") { LS.set("stampPhotos", !stampOn()); toast(stampOn() ? "사진에 위치·일시를 새겨요" : "사진을 원본 그대로 저장해요"); return rerender(); }
    if (a === "export") return exportSheet(PD(), "전체");
    if (a === "backup") return doBackup();
    if (a === "persist") { const ok = await navigator.storage?.persist?.(); toast(ok ? "저장공간 보호가 켜졌어요" : "브라우저가 거절했어요. 앱을 홈 화면에 설치하면 보통 허용돼요"); return rerender(); }
    if (a === "trade-merge") return tradeMergeSheet();
    if (a === "vendor-map") return vendorMapSheet();
    if (a === "type-merge") return typeMergeSheet();
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
    <h3 class="sec">코어 <small>계단·엘리베이터 코어 — 목록 코어별 정렬·묶음·필터</small></h3>
    <div class="slist"><button type="button" class="sitem" id="si-core"><span class="si-ico">🧱</span><span><b>코어 설정</b><small>${(() => { const c = M.coreRule(p); const nd = Object.keys(c.dongs || {}).filter((k) => Object.keys(c.dongs[k] || {}).length).length; return c.per > 0 ? `기본: 라인 ${c.per}개씩 한 코어 (01·02호 = 1코어${c.per === 2 ? ", 03·04호 = 2코어" : ""})${nd ? ` · 직접 정한 동 ${nd}개` : ""}` : `기본 규칙 끔${nd ? ` · 직접 정한 동 ${nd}개` : ""}`; })()}</small></span><span class="chev">›</span></button></div>
    <h3 class="sec">목록 편집</h3><div class="slist">
      ${[["dongCommons", "🏢", "동 공용부(계단실·EV홀 등)", M.dongCommonsOf(p)], ["commons", "🅿", "단지 공용", p.commons], ["trades", "🧱", "공종·세부공종", p.trades.map((t) => t.name)], ["types", "🏷", "하자 유형", p.types], ["categories", "🗂", "구분", M.catsOf(p)], ["rooms", "🚪", "실", p.rooms], ["parts", "🧩", "부위", p.parts]]
        .map(([k, ico, t, arr]) => `<button type="button" class="sitem" data-list="${k}"><span class="si-ico">${ico}</span><span><b>${t}</b><small>${esc(arr.slice(0, 6).join(", "))}${arr.length > 6 ? " …" : ""}</small></span><span class="chev">›</span></button>`).join("")}</div>
    <h3 class="sec">도면 <small>동·층별 평면도 이미지 → 하자 위치를 도면에 찍기</small></h3>
    <div class="slist">${plans.map((pl) => `<button type="button" class="sitem" data-plan="${pl.id}"><span class="si-ico">🗺</span><span><b>${esc(pl.name)}</b><small>${esc(pl.utype ? `평형 ${pl.utype} 세대` : pl.dongs?.length ? pl.dongs.join(", ") : M.placeOf(pl, p) ? `단지 공용 · ${M.placeOf(pl, p)}` : "전체 동")} · ${esc(pl.floors || "전체 층")}${pl.rooms?.length ? ` · 실 ${pl.rooms.length}` : ""}</small></span><span class="chev">›</span></button>`).join("") || '<p class="help">등록된 도면이 없어요</p>'}</div>
    <div class="row wrap"><button type="button" class="btn" id="btn-addplan">＋ 도면 이미지 추가</button><button type="button" class="btn" id="btn-bulkplan">🗂 도면 가져오기(PDF·이미지)</button><button type="button" class="btn" id="btn-planrooms">🚪 도면에서 실 목록 자동 채우기</button></div>
    <p class="help">설계 도면 <b>PDF</b>(여러 개·여러 쪽·PDF 묶은 .zip)를 고르면 도면 이름·동·층·평형을 읽고, 실·공용부 이름과 위치를 자동으로 뽑아 하자 등록 위치를 만들어요(인터넷 없이 이 기기 안에서만). 사진·스캔 이미지는 글자를 못 읽어 실은 직접 추가해야 해요. 이미지 zip에 매핑표(TSV/CSV)·rooms.json을 넣어도 돼요.</p>
    <button type="button" class="btn btn-danger btn-block" id="btn-delproj">이 현장 삭제</button>`;
  $("#si-core").addEventListener("click", () => coreSheet());
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
  $("#btn-bulkplan").addEventListener("click", () => bulkPlans());
  $("#btn-planrooms").addEventListener("click", () => planRoomsFromFile());
  $("#btn-delproj").addEventListener("click", async () => {
    const cnt = PD().length;
    if (!(await ask(`‘${p.name}’ 현장과 하자 ${cnt}건·사진을 모두 삭제할까요? 되돌릴 수 없어요.`, { ok: "현장 삭제", danger: true }))) return;
    busy(true, "삭제 중…");
    for (const d of PD()) await db.delByIndex("photos", "by_defect", d.id);
    await db.delByIndex("defects", "by_project", p.id); await db.delByIndex("plans", "by_project", p.id); await db.del("projects", p.id);
    await loadAll(); busy(false); toast("현장을 삭제했어요"); replace("#/home");
  });
};
/* ---------- 1.0.8 도면 여러 장 가져오기 · 실 목록 자동 채우기 ---------- */
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const mimeOf = (n) => (/\.png$/i.test(n) ? "image/png" : /\.webp$/i.test(n) ? "image/webp" : /\.gif$/i.test(n) ? "image/gif" : "image/jpeg");
/** 고른 파일(이미지·zip·매핑표·rooms.json)을 펼쳐 읽기 */
async function readPlanFiles(files) {
  const imgs = [], pdfs = []; let mapText = "", rooms = null;
  const take = async (name, blob, text) => {
    const base = name.split("/").pop(); if (!base || base.startsWith(".") || name.includes("__MACOSX")) return;
    if (IMG_RE.test(base)) { if (/^contact_sheet/i.test(base)) return; imgs.push({ file: base, blob: await blob() }); }
    else if (/\.pdf$/i.test(base)) pdfs.push({ file: base, blob: await blob() });
    else if (/\.(tsv|csv|txt)$/i.test(base)) mapText = await text();
    else if (/\.json$/i.test(base)) { try { const j = JSON.parse(await text()); if (j && typeof j === "object") rooms = j; } catch { /* 무시 */ } }
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      if (!globalThis.JSZip) throw new Error("JSZip을 불러오지 못했어요");
      const zip = await globalThis.JSZip.loadAsync(f);
      for (const e of Object.values(zip.files)) if (!e.dir) await take(e.name, async () => new Blob([await e.async("arraybuffer")], { type: /\.pdf$/i.test(e.name) ? "application/pdf" : mimeOf(e.name) }), () => e.async("string"));
    } else await take(f.name, async () => f, () => f.text());
  }
  imgs.sort((a, b) => a.file.localeCompare(b.file, "ko", { numeric: true })); pdfs.sort((a, b) => a.file.localeCompare(b.file, "ko", { numeric: true }));
  return { imgs, pdfs, mapText, rooms };
}
async function bulkPlans() {
  const p = P();
  const files = await pickFile("application/pdf,.pdf,image/*,.zip,.tsv,.csv,.txt,.json", { multiple: true }); if (!files.length) return;
  busy(true, "파일 읽는 중…"); let got;
  try { got = await readPlanFiles(files); } catch (e) { busy(false); return toast("파일을 읽지 못했어요: " + (e.message || e)); }
  busy(false);
  if (!got.imgs.length && !got.pdfs.length) return got.rooms ? planRoomsFrom(got.rooms) : toast("도면 PDF나 이미지(jpg·png)가 없어요");
  const map = M.parseMapping(got.mapText);
  const mine = S.plans.filter((x) => x.projectId === p.id);
  const rows = got.imgs.map((x) => { const m = map.get(x.file); const g = M.guessPlan(x.file, p); const dup = mine.find((pl) => pl.file === x.file);
    return { ...x, on: true, dup, src: m ? "표" : "이름", name: m?.name || dup?.name || g.name, dongs: (m ? m.dongs : g.dongs).join(","), floors: m ? m.floors : g.floors, utype: m?.utype || g.utype, rooms: got.rooms?.[x.file] || null, imgOnly: !got.rooms?.[x.file] }; });
  if (got.pdfs.length) { const pr = await scanPdfs(got.pdfs, mine); if (!pr) return; rows.push(...pr); }
  planReview(rows, { mapped: map.size, hasRooms: !!got.rooms, pdf: got.pdfs.length });
}
/** 1.1.0 PDF 훑기(쪽마다 글자만) → 검토 표 줄. 그림은 저장할 때 고른 쪽만 그림 */
let PDFP = null; window.__pdfScan = null;
async function scanPdfs(pdfs, mine) {
  const t0 = performance.now(); let pagesDone = 0;
  try {
    busy(true, "도면 PDF 읽기 준비 중…"); PDFP = PDFP || (await import("./pdfplan.js")); await PDFP.loadPdfjs();
    const out = [];
    for (const [k, f] of pdfs.entries()) {
      const r = await PDFP.scanPdf(f.blob, f.file, { onPage: (i, n) => busy(true, `도면 PDF 읽는 중${pdfs.length > 1 ? ` (${k + 1}/${pdfs.length})` : ""} · ${i}/${n}쪽…`) });
      pagesDone += r.pages;
      for (const x of r.rows) {
        const inf = x.info; const dup = mine.find((pl) => pl.file === x.file);
        out.push({ file: x.file, pdf: x.pdf, page: x.page, no: x.no, on: inf.check, more: !inf.check, dup, src: `PDF ${x.page}쪽${x.no ? " · " + x.no : ""}`, why: inf.why,
          name: dup?.name || PDFP.displayName(inf, x.no), dongs: inf.dongs.join(","), floors: inf.floors, utype: inf.kind === "unit" ? inf.utype : "",
          kind: x.kind === "other" ? "" : x.kind, rooms: x.rooms.length ? { kind: x.kind, rooms: x.rooms } : null, imgOnly: x.nText < 5 });
      }
    }
    window.__pdfScan = { pages: pagesDone, ms: Math.round(performance.now() - t0), rows: out.map((r) => ({ file: r.file, page: r.page, on: r.on, name: r.name, dongs: r.dongs, floors: r.floors, utype: r.utype, why: r.why, kind: r.kind, rooms: r.rooms?.rooms || [] })) };
    busy(false); return out;
  } catch (e) { busy(false); toast("PDF를 읽지 못했어요: " + (e.message || e), { ms: 4000 }); return null; }
}
function planReview(rows, { mapped, hasRooms, pdf = 0 }) {
  const p = P(); const dn = new Set(p.dongs.map((d) => d.name));
  const warn = (r) => r.dongs.split(/[,\s]+/).filter(Boolean).filter((x) => !dn.has(x)).join(",");
  const s = openSheet({ title: `도면 ${rows.length}장 확인`, full: true, cls: "pimp-sheet",
    html: `<p class="help">${pdf ? `PDF ${pdf}개에서 평면도 ${rows.filter((r) => r.pdf && r.on).length}장을 골라 이름·동·층·평형을 채웠어요(실 ${rows.filter((r) => r.pdf && r.on).reduce((a, r) => a + (r.rooms?.rooms?.length || 0), 0)}개 발견) → 저장하면 실·공용부 위치를 자동으로 만들어요` : mapped ? `매핑표 ${mapped}행으로 채웠어요` : "매핑표가 없어 파일 이름으로 추측했어요"}${hasRooms ? " · rooms.json 있음 → 저장 후 실 목록 검토" : ""}. 동은 쉼표로(비우면 전체 동), 층은 2-26 · B2,1 형식(비우면 전체 층), 평형은 세대 평면도일 때만.</p>
      ${rows.some((r) => r.more) ? `<button type="button" class="btn btn-sm" id="pi-more">평면도가 아닌 쪽 ${rows.filter((r) => r.more).length}개도 보기</button>` : ""}
      <div class="pimp-wrap"><table class="pimp"><thead><tr><th><input type="checkbox" id="pi-all" checked aria-label="모두 선택"></th><th>파일</th><th>이름</th><th>동</th><th>층</th><th>평형</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-i="${i}" class="${r.more ? "pi-more" : ""}" ${r.more ? "hidden" : ""}><td><input type="checkbox" class="pi-on" ${r.on ? "checked" : ""} aria-label="${esc(r.file)} 저장"></td><td class="fn" title="${esc(r.file)}">${r.pdf ? `<b>${r.page}쪽</b>${r.no ? ` <small>${esc(r.no)}</small>` : ""}` : esc(r.file)}${r.dup ? '<br><small class="help">기존 도면 교체</small>' : ""}<br><small class="help">${r.pdf ? "" : esc(r.src)}${r.rooms?.rooms?.length ? `${r.pdf ? "" : " · "}실 ${r.rooms.rooms.length}` : ""}${r.why ? ` · ${esc(r.why)}` : ""}</small></td>
        <td><input class="inp" data-f="name" value="${esc(r.name)}"></td><td><input class="inp" data-f="dongs" value="${esc(r.dongs)}" placeholder="전체"><span class="warn">${warn(r) ? "없는 동: " + esc(warn(r)) : ""}</span></td>
        <td><input class="inp" data-f="floors" value="${esc(r.floors)}" placeholder="전체"></td><td><input class="inp" data-f="utype" value="${esc(r.utype)}" placeholder="-" size="4"></td></tr>`).join("")}</tbody></table></div>`,
    footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="save" id="pi-save">저장</button>` });
  const cnt = () => { const n = $$(".pi-on:checked", s.el).length; $("#pi-save", s.el).textContent = `${n}장 저장`; };
  cnt();
  $("#pi-more", s.el)?.addEventListener("click", (e) => { const show = $$("tr.pi-more", s.el).some((t) => t.hidden); $$("tr.pi-more", s.el).forEach((t) => { t.hidden = !show; }); e.target.textContent = show ? "평면도만 보기" : `평면도가 아닌 쪽 ${rows.filter((r) => r.more).length}개도 보기`; });
  $("#pi-all", s.el).addEventListener("change", (e) => { $$("tr:not([hidden]) .pi-on", s.el).forEach((c) => { c.checked = e.target.checked; }); cnt(); });
  $$(".pi-on", s.el).forEach((c) => c.addEventListener("change", cnt));
  $$("input[data-f=dongs]", s.el).forEach((inp) => inp.addEventListener("input", () => { const r = { dongs: inp.value }; inp.nextElementSibling.textContent = warn(r) ? "없는 동: " + warn(r) : ""; }));
  $("[data-a=no]", s.el).addEventListener("click", () => s.close());
  $("[data-a=save]", s.el).addEventListener("click", async () => {
    const pick = $$("tbody tr", s.el).filter((tr) => $(".pi-on", tr).checked).map((tr) => { const r = rows[Number(tr.dataset.i)]; const v = (f) => $(`[data-f=${f}]`, tr).value.trim();
      return { ...r, name: v("name") || r.file.replace(/\.\w+$/, ""), dongs: v("dongs").split(/[,\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? x + "동" : x)), floors: v("floors").replace(/\s+/g, ""), utype: M.normType(v("utype")) }; });
    if (!pick.length) return toast("저장할 도면을 고르세요");
    await s.close();
    const saved = []; let fail = 0;
    for (const [k, r] of pick.entries()) {
      busy(true, `도면 ${r.pdf ? "그리기" : "압축"}·저장 ${k + 1}/${pick.length}…`);
      try {
        const t1 = performance.now();
        const src = r.pdf ? await PDFP.renderPage(r.pdf, r.page, { max: 2400 }) : r.blob;
        const c = await compressImage(src, { max: 2400, quality: 0.8 });
        if (r.pdf) (window.__pdfRender = window.__pdfRender || []).push(Math.round(performance.now() - t1));
        const kind = r.rooms?.kind || r.kind || r.dup?.kind || "";
        const rooms = r.rooms?.rooms?.length ? M.roomCandidates(r.rooms.rooms, { evac: false, kind }).filter((x) => x.on).map(({ name, x, y }) => ({ name, x, y })) : r.dup?.rooms || [];
        const pl = { ...(r.dup || {}), id: r.dup?.id || M.uid("pl"), projectId: p.id, name: r.name.slice(0, 40), dongs: r.dongs, floors: r.floors, utype: r.utype, file: r.file, kind, rooms, blob: c.blob, w: c.w, h: c.h };
        pl.place = M.guessPlace(pl, p);
        await db.put("plans", pl); const j = S.plans.findIndex((x) => x.id === pl.id); if (j >= 0) S.plans[j] = pl; else S.plans.push(pl);
        saved.push({ pl, raw: r.rooms });
      } catch (e) { fail++; }
    }
    busy(false); toast(`도면 ${saved.length}장 저장${fail ? ` · 실패 ${fail}` : ""}`, { ms: 3000 });
    for (const pd of [...new Set(pick.map((r) => r.pdf).filter(Boolean))]) { try { await pd.destroy(); } catch { /* 무시 */ } }
    await offerMissingDongs(saved.map((x) => ({ ...x.pl, rooms: x.raw?.rooms || x.pl.rooms }))); rerender();
    const withRooms = saved.filter((x) => x.raw?.rooms?.length);
    const noText = pick.filter((r) => r.imgOnly).length;
    if (noText) await ask(`사진·스캔 도면 ${noText}장은 글자를 읽을 수 없어 실·공용부를 자동으로 만들 수 없어요. 도면은 저장됐어요 — 실은 ‘목록 편집 › 실’이나 하자 등록 화면에서 직접 추가해 주세요.`, { ok: "확인", cancel: "" });
    if (withRooms.length) roomsReview(withRooms);
  });
}
/** 도면에서 찾은 동이 현장에 없으면 추가 제안(층수·지하·라인은 도면에서 추측, 나중에 고칠 수 있음) */
async function offerMissingDongs(pls) {
  const p = P(); const have = new Set(p.dongs.map((d) => d.name)); const by = new Map();
  for (const pl of pls) for (const dn of pl.dongs || []) if (!have.has(dn)) { if (!by.has(dn)) by.set(dn, []); by.get(dn).push(pl); }
  if (!by.size) return;
  const names = [...by.keys()].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  if (!(await ask(`도면에 있는 ${names.length}개 동(${names.slice(0, 6).join(", ")}${names.length > 6 ? " …" : ""})이 현장에 없어요. 추가할까요?`, { ok: "동 추가" }))) return;
  for (const name of names) {
    const fl = by.get(name).flatMap((pl) => String(pl.floors || "").split(/[,\s]+/).flatMap((t) => t.split(/[-~]/))).filter(Boolean);
    const up = fl.filter((x) => /^\d+$/.test(x)).map(Number), dn = fl.filter((x) => /^B\d+$/i.test(x)).map((x) => Number(x.slice(1)));
    const lines = Math.max(0, ...by.get(name).flatMap((pl) => (pl.rooms || []).map((r) => (/^(\d+)라인$/.exec(r.name) || [])[1]).filter(Boolean).map(Number)));
    const num = name.replace(/동$/, "");
    p.dongs.push({ id: M.uid("d"), name, alias: M.aliasOf(num), floors: up.length ? Math.max(...up) : 15, lines: lines || 4, basement: dn.length ? Math.max(...dn) : 0, unitStart: 1, roof: true, skipLines: "" });
  }
  p.dongs.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  await saveProject(p); toast(`동 ${names.length}개 추가 — 층수·라인은 ‘동’에서 확인하세요`, { ms: 3500 });
}
/** 이미 올린 도면에 rooms.json(또는 그게 든 zip)으로 실 목록 채우기 */
async function planRoomsFromFile() {
  const files = await pickFile(".json,.zip", { multiple: true }); if (!files.length) return;
  busy(true, "읽는 중…"); let got; try { got = await readPlanFiles(files); } catch (e) { busy(false); return toast("파일을 읽지 못했어요: " + (e.message || e)); } busy(false);
  if (!got.rooms) return toast("rooms.json이 없어요");
  planRoomsFrom(got.rooms);
}
function planRoomsFrom(rooms) {
  const p = P(); const mine = S.plans.filter((x) => x.projectId === p.id);
  const items = Object.entries(rooms).map(([file, raw]) => ({ pl: mine.find((x) => x.file === file || x.name === file.replace(/\.\w+$/, "")), raw })).filter((x) => x.pl && x.raw?.rooms?.length);
  for (const it of items) { if (!it.pl.kind && it.raw.kind) it.pl.kind = it.raw.kind; if (!it.pl.place) it.pl.place = M.guessPlace(it.pl, p); }
  if (!items.length) return toast("rooms.json의 파일 이름과 맞는 도면이 없어요 — 먼저 ‘도면 여러 장 가져오기’로 올리세요", { ms: 4000 });
  roomsReview(items);
}
/** 실 목록 검토: 도면마다 체크·이름 고치기 → 평형별 실 / 동 공용부 / 단지 공용에 추가, 좌표는 도면에 저장 */
function roomsReview(items) {
  const p = P();
  const target = (pl) => { const pc = M.placeOf(pl, p); return pl.utype ? { k: "type", label: `${pl.utype} 평형 실 목록` } : pl.dongs?.length ? { k: "dongCommons", label: "동 공용부 목록" } : pc ? { k: "place", label: `단지 공용 ‘${pc}’ 세부 위치`, place: pc } : { k: "commons", label: "단지 공용 목록" }; };
  const QUICK = (pl) => (pl.utype ? ["발코니", "발코니2", "대피공간"] : ["계단실", "복도", "전실", "발코니"]);
  const groups = items.map(({ pl, raw }) => ({ pl, t: target(pl), cands: M.roomCandidates(raw.rooms, { evac: false, kind: raw.kind || pl.kind }).map((c) => ({ ...c, on: c.on && target(pl).k !== "commons" })) }));
  const s = openSheet({ title: "도면에서 실 목록 채우기", full: true,
    html: `<label class="check"><input type="checkbox" id="rv-evac" checked> ‘하향식피난구’를 ‘대피공간’으로 바꾸기</label>
      <p class="help">체크한 이름만 추가돼요. 이름은 바로 고칠 수 있어요. 지하주차장·부대시설 도면의 실은 그 단지 공용 장소의 ‘세부 위치’가 돼요(하자 등록에서 지하주차장 → 층 → 세부 위치). 단지 배치도처럼 장소가 없는 도면은 기본으로 꺼 뒀어요.</p>
      ${groups.map((g, gi) => `<details class="rv-plan" data-g="${gi}" ${gi < 4 ? "open" : ""}><summary>${esc(g.pl.name)} <small>→ ${esc(g.t.label)} · <span class="rv-n"></span></small></summary>
        <div class="rv-list">${g.cands.map((c, ci) => `<label class="rv-it"><input type="checkbox" data-ci="${ci}" ${c.on ? "checked" : ""}><input type="text" class="inp" data-cn="${ci}" value="${esc(c.name === "하향식피난구" ? "대피공간" : c.name)}" data-orig="${esc(c.name)}"></label>`).join("")}</div>
        <div class="rv-quick">${QUICK(g.pl).map((x) => `<button type="button" class="btn btn-sm" data-qa="${esc(x)}">＋ ${esc(x)}</button>`).join("")}<button type="button" class="btn btn-sm" data-all="1">전체 선택/해제</button></div></details>`).join("")}`,
    footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="ok">실 목록에 추가</button>` });
  const count = () => $$(".rv-plan", s.el).forEach((d) => { $(".rv-n", d).textContent = `${$$(".rv-list input[type=checkbox]:checked", d).length}개 선택`; });
  count(); s.el.addEventListener("change", count);
  $("#rv-evac", s.el).addEventListener("change", (e) => $$("input[data-orig='하향식피난구']", s.el).forEach((i) => { if (["하향식피난구", "대피공간"].includes(i.value)) i.value = e.target.checked ? "대피공간" : "하향식피난구"; }));
  $$("[data-qa]", s.el).forEach((b) => b.addEventListener("click", () => {
    const list = $(".rv-list", b.closest(".rv-plan")); const n = list.children.length;
    list.insertAdjacentHTML("beforeend", `<label class="rv-it"><input type="checkbox" data-ci="q${n}" checked><input type="text" class="inp" data-cn="q${n}" value="${esc(b.dataset.qa)}" data-orig=""></label>`); count();
  }));
  $$("[data-all]", s.el).forEach((b) => b.addEventListener("click", () => { const cs = $$(".rv-list input[type=checkbox]", b.closest(".rv-plan")); const on = !cs.every((c) => c.checked); cs.forEach((c) => { c.checked = on; }); count(); }));
  $("[data-a=no]", s.el).addEventListener("click", () => s.close());
  $("[data-a=ok]", s.el).addEventListener("click", async () => {
    const tally = { type: 0, dongCommons: 0, commons: 0, place: 0 }; const uniq = (a) => [...new Set(a.filter(Boolean))];
    if (!Array.isArray(p.dongCommons)) p.dongCommons = [...M.DEFAULT_DONG_COMMONS];
    busy(true, "실 목록 저장 중…");
    for (const [gi, g] of groups.entries()) {
      const box = $(`.rv-plan[data-g="${gi}"]`, s.el);
      const picked = $$(".rv-it", box).map((it) => ({ on: $("input[type=checkbox]", it).checked, name: $("input[type=text]", it).value.trim().slice(0, 20), ci: $("input[type=checkbox]", it).dataset.ci })).filter((x) => x.on && x.name);
      const names = uniq(picked.map((x) => x.name));
      if (g.t.k === "type") { p.roomsByType = p.roomsByType || {}; const before = p.roomsByType[g.pl.utype] || []; p.roomsByType[g.pl.utype] = uniq([...before, ...names]); tally.type += p.roomsByType[g.pl.utype].length - before.length; }
      else if (g.t.k === "place") { g.pl.place = g.t.place; if (!p.commons.includes(g.t.place)) p.commons.push(g.t.place); tally.place += names.length; }
      else { const arr = g.t.k === "dongCommons" ? p.dongCommons : p.commons; const add = names.filter((x) => !arr.includes(x)); arr.push(...add); tally[g.t.k] += add.length; }
      // 좌표: 체크한 실(이름 고친 것 포함)을 도면에 저장 → 하자 등록 때 그 실 고르면 도면 핀을 그 자리에
      g.pl.rooms = uniq(picked.map((x) => x.name)).map((name) => { const x = picked.find((y) => y.name === name); const c = /^q/.test(x.ci) ? null : g.cands[Number(x.ci)]; return c ? { name, x: c.x, y: c.y } : { name }; });
      await db.put("plans", g.pl);
    }
    await saveProject(p); busy(false); await s.close();
    toast(`실 목록 추가: 평형별 ${tally.type} · 동 공용부 ${tally.dongCommons} · 단지 공용 세부 위치 ${tally.place}${tally.commons ? ` · 단지 공용 ${tally.commons}` : ""}`, { ms: 4000 }); rerender();
  });
}
function planEdit(pl, isNew = false) {
  const p = P();
  const s = openSheet({ title: isNew ? "도면 추가" : "도면 수정", full: true,
    html: `<div class="plan mini"><img id="pe-img" alt="도면"></div>
      <label class="fld"><span>이름</span><input class="inp" id="pe-name" value="${esc(pl.name)}" placeholder="예: 84A 기준층"></label>
      <div class="fld"><span>적용 동 <small>(아무것도 안 고르면 전체 동)</small></span><div class="chips wrap" id="pe-dongs">${p.dongs.map((d) => `<button type="button" class="chip ${pl.dongs?.includes(d.name) ? "on" : ""}" data-d="${esc(d.name)}">${esc(d.name)}</button>`).join("")}</div></div>
      <label class="fld"><span>적용 층 <small>(예: 3-25, B2-B1 · 비우면 전체)</small></span><input class="inp" id="pe-floors" value="${esc(pl.floors || "")}" placeholder="3-25"></label>
      <label class="fld"><span>단지 공용 장소 <small>(지하주차장·부대복리시설 등 — 이 도면의 실이 그 장소의 세부 위치가 돼요)</small></span><input class="inp" id="pe-place" value="${esc(M.placeOf(pl, p))}" placeholder="예: 지하주차장"></label>
      <label class="fld"><span>세대 평형 <small>(세대 평면도일 때: 예 84A · 비우면 동·층 도면)</small></span><input class="inp" id="pe-utype" value="${esc(pl.utype || "")}" placeholder="84A"></label>`,
    footer: `${isNew ? "" : '<button type="button" class="btn btn-danger" data-a="del">삭제</button>'}<button type="button" class="btn btn-primary" data-a="save">저장</button>` });
  const u = URL.createObjectURL(pl.blob); $("#pe-img", s.el).src = u; s.onClose = () => URL.revokeObjectURL(u);
  $("#pe-dongs", s.el).addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) b.classList.toggle("on"); });
  $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.a === "del") { await db.del("plans", pl.id); S.plans = S.plans.filter((x) => x.id !== pl.id); }
    else { Object.assign(pl, { name: $("#pe-name", s.el).value.trim() || "평면도", dongs: $$("#pe-dongs .chip.on", s.el).map((x) => x.dataset.d), floors: $("#pe-floors", s.el).value.trim(), utype: M.normType($("#pe-utype", s.el).value), place: $("#pe-place", s.el).value.trim().slice(0, 15) });
      if (pl.place && !p.commons.includes(pl.place)) { p.commons.push(pl.place); await saveProject(p); }
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
  const title = { dongCommons: "동 공용부", commons: "단지 공용", trades: "공종", types: "하자 유형", categories: "구분", rooms: "실", parts: "부위" }[k] || "목록";
  if (k === "categories" && !Array.isArray(p.categories)) p.categories = [...M.catsOf(p)];
  if (k === "dongCommons" && !Array.isArray(p.dongCommons)) p.dongCommons = [...M.DEFAULT_DONG_COMMONS];
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
    const D = { dongCommons: M.DEFAULT_DONG_COMMONS, commons: M.DEFAULT_COMMONS, types: M.DEFAULT_TYPES, rooms: M.DEFAULT_ROOMS, parts: M.DEFAULT_PARTS, categories: M.CATEGORIES };
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
  const undo = { at: new Date().toISOString(), file: imp.file, projectId: p.id, added: [], prev: [], newVendorIds: res.newVendors.map((v) => v.id), prevVendors: (res.updatedVendors || []).map((v) => V(v.id)).filter(Boolean).map((v) => structuredClone(v)), prevDongs: structuredClone(p.dongs) };
  for (const d of res.toPut) { const o = byId.get(d.id); if (o) undo.prev.push(o); else undo.added.push(d.id); }
  await db.setMeta("importUndo", undo);
  await db.putMany("defects", res.toPut); for (const v of res.newVendors) await saveVendor(v); for (const v of res.updatedVendors || []) await saveVendor(v);
  Object.assign(p, { dongs: pcopy.dongs, dongCommons: pcopy.dongCommons, commons: pcopy.commons, ...(pcopy.unitTypes ? { unitTypes: pcopy.unitTypes } : {}) }); await saveProject(p);
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
  for (const v of undo.prevVendors || []) await saveVendor(v);
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
    ${Sync.attached() ? `<dt>팀 현장</dt><dd id="sync-ws">${esc(Sync.state.ws.name)} · ${ROLE_KO[Sync.state.ws.role] || ""}</dd><dt>대기 중</dt><dd id="sync-pending">${Number(Sync.state.pending).toLocaleString("ko-KR")}건${Sync.state.pending ? `<small class="help" id="sync-pending-by"> (${esc(Sync.pendingText())})</small>` : ""}</dd>
    <dt>마지막 동기화</dt><dd>${at ? fmtDT(new Date(at).toISOString()) : "-"}</dd>` : `<dt>지금 데이터</dt><dd>이 기기 전용(동기화 안 함)</dd>`}${stt.detail && stt.key === "error" ? `<dt>오류</dt><dd class="err">${esc(stt.detail)}</dd>` : ""}${stt.key === "busy" && (stt.quota || stt.why !== undefined) ? `<dt>상태</dt><dd id="sync-why" class="help">${esc(stt.quota ? stt.detail : stt.why === "quota" ? "무료 한도 초과로 서버가 기다리게 하고 있어요" : stt.why === "network" ? "인터넷이 느리거나 끊겨서 오래 걸리고 있어요 — 와이파이에서 앱을 켜 두세요" : stt.why === "offline" ? "오프라인이에요" : "원인 확인 중… (잠시 뒤 다시 보기)")}</dd>` : ""}</dl>`;
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
        <p class="help small">링크를 받은 사람이 구글로 로그인하면 <b>편집</b> 멤버로 들어와요.</p>${mem.length >= Sync.memberCap(wd) ? `<p class="help warnbox" id="team-full">팀 인원이 꽉 찼어요(${mem.length}/${Sync.memberCap(wd)}명) — 더 초대해도 참여할 수 없어요. 누군가 나가거나 내보내면 자리가 생겨요.</p>` : ""}` : ""}
      ${wd ? `<div class="team-cap" id="team-cap"><b>팀원 ${mem.length}/${Sync.memberCap(wd)} (${Sync.planOf(wd) === "pro" ? "유료" : "무료"})</b><div class="rate-bar"><i style="width:${Math.min(100, Math.round((mem.length / Sync.memberCap(wd)) * 100))}%"></i></div>${Sync.planOf(wd) === "pro" ? "" : `<small class="help">무료 버전은 현장당 ${Sync.FREE_MEMBERS}명까지(소유자 포함). ${Sync.FREE_MEMBERS + 1}명 이상은 <b>유료 버전</b>(준비 중) — 필요하면 문의해 주세요.</small>`}</div>` : ""}
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
      <li>무료 버전: 팀 현장 ${Pro.FREE_LIMITS.workspaces}개 · 현장당 팀원 ${Sync.FREE_MEMBERS}명까지(소유자 포함). ${Sync.FREE_MEMBERS + 1}명 이상은 유료 버전(준비 중 · 문의).</li></ul>`)}`;
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
        busy(true, "팀 현장 만드는 중…"); await Sync.createWorkspace(name.trim() || "팀 현장", { workspaceCount: n0, isPro: Pro.isPro() });
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
  setTimeout(() => autoMergeTrades().catch((e) => console.warn(e)), 1500);
  setTimeout(() => autoMergeTypes().catch((e) => console.warn(e)), 2600);
  window.__hs = { S, M, db, Pro, go, replace, UPD, APP_VERSION, Sync }; // 테스트·디버그용
}
main();
