/** 공통 UI + 안드로이드 뒤로가기(히스토리) 처리.
 * - 모든 화면 이동/시트/대화상자는 history 항목을 하나씩 쌓는다 → 뒤로가기 제스처는 항상 한 단계씩 돌아간다.
 * - 맨 처음 항목(d:0)은 가드: 홈이 아니면 홈으로, 홈이면 "한 번 더 누르면 종료" 안내.
 */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const n = (x) => Number(x || 0).toLocaleString("ko-KR");

export function toast(msg, { ms = 2400, action, onAction } = {}) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-act">${esc(action)}</button>` : ""}`;
  t.classList.add("show");
  if (action) $(".toast-act", t).onclick = () => { t.classList.remove("show"); onAction?.(); };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), action ? Math.max(ms, 6000) : ms);
}
export function busy(on, text = "처리 중…") { $("#busy").hidden = !on; $("#busy-text").textContent = text; }

/* ---------- 히스토리 내비게이션 ---------- */
const N = { depth: 0, layers: [], onRoute: null, exitArm: 0, waiters: [] };
export const navDepth = () => N.depth;
export function initNav(onRoute) {
  N.onRoute = onRoute;
  const start = location.hash && location.hash !== "#" ? location.hash : "#/home";
  history.replaceState({ d: 0, guard: true }, "", "#/home");
  history.pushState({ d: 1 }, "", start);
  N.depth = 1;
  window.addEventListener("popstate", (e) => {
    const st = e.state || { d: 0, guard: true };
    let popped = false;
    while (N.layers.length && N.layers[N.layers.length - 1].d > st.d) { const l = N.layers.pop(); try { l.undo(); } catch (err) { console.warn(err); } popped = true; }
    N.depth = st.d;
    const w = N.waiters.splice(0); w.forEach((f) => f());
    if (st.guard) {
      const atHome = (location.hash || "#/home").startsWith("#/home") && !N.lastRoute?.startsWith("#/onboard") && N.lastRoute?.startsWith("#/home");
      if (!atHome) { history.pushState({ d: 1 }, "", "#/home"); N.depth = 1; render(); return; }
      if (Date.now() - N.exitArm < 2200) return; // 두 번째: 가드에 머묾 → 다음 뒤로가기에서 앱 종료
      N.exitArm = Date.now();
      toast("뒤로 버튼을 한 번 더 누르면 종료됩니다");
      history.pushState({ d: 1 }, "", "#/home"); N.depth = 1;
      return;
    }
    if (st.layer) { if (!popped && location.hash !== N.lastRoute) render(); return; }
    if (!popped || location.hash !== N.lastRoute) render();
  });
  render();
}
function render() { N.lastRoute = location.hash; N.onRoute?.(); }
export function go(hash) {
  if (location.hash === hash) return render();
  N.depth++; history.pushState({ d: N.depth }, "", hash); render();
}
export function replace(hash) { history.replaceState({ d: N.depth }, "", hash); render(); }
export function rerender() { render(); }
export function back() {
  if (N.depth > 1) history.back();
  else replace("#/home");
}
const waitPop = () => new Promise((r) => N.waiters.push(r));
/** n단계 뒤로(팝스테이트까지 기다림) */
export function unwind(steps) { if (steps <= 0) return Promise.resolve(); const p = waitPop(); history.go(-steps); return p; }
/** 레이어(시트/대화상자/단계) 하나를 히스토리에 올린다. undo는 뒤로가기 시 호출 */
export function pushLayer(undo) {
  N.depth++;
  history.pushState({ d: N.depth, layer: true }, "", location.hash);
  const layer = { d: N.depth, undo };
  N.layers.push(layer);
  return layer;
}
/** 레이어를 닫는다(히스토리를 걷어 내며 undo 실행). 이미 닫혔으면 무시 */
export async function closeLayer(layer) {
  const i = N.layers.indexOf(layer);
  if (i < 0) return;
  const steps = N.layers.length - i;
  const p = waitPop();
  history.go(-steps);
  await p;
}

/* ---------- 시트 ---------- */
/** opts: { title, html, onMount(el, api), full, footer } → api {el, close, setTitle, setBackVisible} */
export function openSheet({ title = "", html = "", onMount, full = false, footer = "", onBack, cls = "" }) {
  const el = document.createElement("div");
  el.className = "sheet-wrap" + (full ? " full" : "") + (cls ? " " + cls : "");
  el.innerHTML = `<div class="sheet-dim" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-hd"><button type="button" class="sheet-back" aria-label="뒤로" hidden>← 뒤로</button>
        <h2 class="sheet-title">${esc(title)}</h2><button type="button" class="sheet-x" aria-label="닫기" data-close>✕</button></header>
      <div class="sheet-bd">${html}</div>${footer ? `<footer class="sheet-ft">${footer}</footer>` : ""}
    </section>`;
  document.body.appendChild(el);
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => el.classList.add("show"));
  const api = { el, closed: false };
  const remove = () => {
    if (api.closed) return; api.closed = true;
    el.classList.remove("show"); setTimeout(() => el.remove(), 180);
    if (!document.querySelector(".sheet-wrap.show:not([data-closing])")) document.body.classList.remove("sheet-open");
    el.dataset.closing = "1";
    setTimeout(() => { if (!$$(".sheet-wrap").some((x) => !x.dataset.closing)) document.body.classList.remove("sheet-open"); }, 0);
    api.onClose?.();
  };
  api.layer = pushLayer(remove);
  api.close = () => closeLayer(api.layer);
  api.setTitle = (t) => { $(".sheet-title", el).textContent = t; };
  api.setBackVisible = (v) => { $(".sheet-back", el).hidden = !v; };
  $$("[data-close]", el).forEach((b) => b.addEventListener("click", () => api.close()));
  $(".sheet-back", el).addEventListener("click", () => (onBack ? onBack() : history.back()));
  onMount?.(el, api);
  return api;
}
/** 확인 대화상자(레이어) → Promise<boolean> */
export function ask(message, { ok = "확인", cancel = "취소", danger = false, title = "" } = {}) {
  return new Promise((resolve) => {
    let val = false;
    const s = openSheet({
      title: title || "확인", cls: "dialog",
      html: `<p class="ask-msg">${esc(message).replace(/\n/g, "<br>")}</p>`,
      footer: `${cancel ? `<button type="button" class="btn" data-a="no">${esc(cancel)}</button>` : ""}<button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-a="yes">${esc(ok)}</button>`,
    });
    s.onClose = () => resolve(val);
    $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", () => { val = b.dataset.a === "yes"; s.close(); }));
  });
}
/** 한 줄 입력 대화상자 → Promise<string|null> */
export function prompt2(message, value = "", { ok = "확인", type = "text", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    let val = null;
    const s = openSheet({
      title: message, cls: "dialog",
      html: `<input class="inp" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(message)}">`,
      footer: `<button type="button" class="btn" data-a="no">취소</button><button type="button" class="btn btn-primary" data-a="yes">${esc(ok)}</button>`,
    });
    const inp = $("input", s.el); setTimeout(() => inp.focus(), 50);
    s.onClose = () => resolve(val);
    const yes = () => { val = inp.value.trim(); s.close(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") yes(); });
    $$("[data-a]", s.el).forEach((b) => b.addEventListener("click", () => (b.dataset.a === "yes" ? yes() : s.close())));
  });
}
/** 목록 중 선택 시트 → Promise<value|null> */
export function choose(title, options) {
  return new Promise((resolve) => {
    let val = null;
    const s = openSheet({ title, html: `<div class="opt-list">${options.map((o, i) => `<button type="button" class="opt" data-i="${i}">${o.icon ? `<span class="opt-ico">${o.icon}</span>` : ""}<span><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</span></button>`).join("")}</div>` });
    s.onClose = () => resolve(val);
    $$(".opt", s.el).forEach((b) => b.addEventListener("click", () => { val = options[+b.dataset.i].value; s.close(); }));
  });
}
export function pickFile(accept, { capture = false, multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept; if (capture) inp.setAttribute("capture", "environment"); inp.multiple = multiple;
    inp.style.display = "none"; document.body.appendChild(inp);
    inp.addEventListener("change", () => { resolve([...inp.files]); inp.remove(); }, { once: true });
    inp.addEventListener("cancel", () => { resolve([]); inp.remove(); }, { once: true });
    inp.click();
  });
}
