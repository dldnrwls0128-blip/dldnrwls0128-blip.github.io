/** 공유: 카톡(PC: 복사+카카오톡 PC / 안드로이드: 카카오톡 intent → 공유창 / iOS: 공유창), 문자(sms:), 전화(tel:), 복사 */
export const canShareText = () => typeof navigator.share === "function";
export function canShareFiles(files) {
  try { return !!navigator.canShare?.({ files }); } catch { return false; }
}
/* 기기 구분 */
const UA = () => navigator.userAgent || "";
export const isAndroid = () => /Android/i.test(UA());
export const isIOS = () => /iPhone|iPad|iPod/i.test(UA()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isMobileDevice = () => isAndroid() || isIOS() || /Mobile/i.test(UA());
/** 안드로이드: 카카오톡 앱을 바로 지정하는 intent 주소(텍스트 공유) */
export const kakaoIntentUrl = (text) => `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${encodeURIComponent(text)};package=com.kakao.talk;end`;
/** 외부 앱 주소 열기(intent:, kakaoopen:) — 테스트에서는 window.__hsOpenExternal로 가로챔(헤드리스의 외부 프로토콜 대화상자 방지) */
function openExternal(url, { frame = false } = {}) {
  if (typeof window.__hsOpenExternal === "function") return window.__hsOpenExternal(url);
  if (!frame) { location.href = url; return; }
  // PC: 숨은 iframe으로 열어 본다 → 카카오톡 PC가 없어도 앱 화면이 바뀌거나 오류 페이지로 넘어가지 않음
  const f = document.createElement("iframe"); f.style.display = "none"; f.src = url; document.body.appendChild(f); setTimeout(() => f.remove(), 3000);
}
/** 다른 앱으로 넘어갔는지(페이지가 가려졌는지) 잠깐 지켜본다 */
function leftPage(ms = 1500) {
  return new Promise((resolve) => {
    let left = false; const on = () => { if (document.visibilityState === "hidden") left = true; };
    const blur = () => { left = true; };
    document.addEventListener("visibilitychange", on); window.addEventListener("pagehide", blur); window.addEventListener("blur", blur);
    setTimeout(() => { document.removeEventListener("visibilitychange", on); window.removeEventListener("pagehide", blur); window.removeEventListener("blur", blur); resolve(left); }, ms);
  });
}
async function webShare(data) {
  if (data.files?.length && !canShareFiles(data.files)) data = { text: data.text };
  if (!canShareText()) return null;
  try { await navigator.share(data); return "shared"; } catch (e) { return e?.name === "AbortError" ? "cancel" : null; }
}
/** 다른 앱으로 공유(기기 공유창) — 카톡 버튼과 별개 */
export async function shareGeneric({ text, files = [] }) {
  const r = await webShare({ text, files }); if (r) return r;
  return (await copyText(text)) ? "copied" : "fail";
}
/** 카톡으로 보내기. 결과: "kakao-pc"(PC: 복사+카카오톡 PC 열기 시도) | "kakao"(안드로이드 카톡 바로 열림) | "shared" | "cancel" | "copied" | "fail"
 *  - PC(모바일 아님): 공유창(윈도우 공유)을 띄우지 않는다. 내용을 복사하고 카카오톡 PC를 열어 본다(kakaoopen://, 없으면 아무 일 없음).
 *  - 안드로이드: 먼저 복사(안전망) → 사진이 없으면 카카오톡 intent로 바로 열기 → 안 열리면 공유창. 사진이 있으면 공유창(파일은 공유창으로만 전달 가능).
 *  - iOS: 먼저 복사 → 공유창(텍스트+사진).
 *  카카오톡은 앱이 특정 친구·대화방을 대신 고를 수 없다(카카오 SDK·비즈 승인 필요) → 카톡에서 대화방을 고른다. */
export async function shareKakao({ text, files = [] }) {
  if (!isMobileDevice()) {
    const ok = await copyText(text);
    try { if (/Windows|Macintosh/i.test(UA())) { openExternal("kakaoopen://", { frame: true }); } } catch {}
    return ok ? "kakao-pc" : "fail";
  }
  const copied = await copyText(text);
  if (isAndroid() && !files.length) {
    try { const wait = leftPage(1500); openExternal(kakaoIntentUrl(text)); if (await wait) return "kakao"; } catch {}
  }
  const r = await webShare({ text, files }); if (r) return r;
  return copied ? "copied" : "fail";
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}
export const contactPickerSupported = () => "contacts" in navigator && "select" in (navigator.contacts || {});
export async function pickContacts() {
  const res = await navigator.contacts.select(["name", "tel"], { multiple: true });
  return res.map((c) => ({ name: (c.name || [])[0] || "", phones: c.tel || [] }));
}
