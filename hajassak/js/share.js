/** 공유: 카톡(Web Share → 공유창에서 카카오톡 선택), 문자(sms:), 전화(tel:), 복사 */
export const canShareText = () => typeof navigator.share === "function";
export function canShareFiles(files) {
  try { return !!navigator.canShare?.({ files }); } catch { return false; }
}
/** 카카오톡은 앱에서 특정 친구(전화번호)를 지정해 열 수 없다(카카오 SDK·비즈 승인 필요). 공유창에서 사용자가 대화방을 고른다. */
export async function shareKakao({ text, files = [] }) {
  if (files.length && canShareFiles(files)) {
    try { await navigator.share({ text, files }); return "shared"; } catch (e) { if (e?.name === "AbortError") return "cancel"; }
  }
  if (canShareText()) {
    try { await navigator.share({ text }); return "shared"; } catch (e) { if (e?.name === "AbortError") return "cancel"; }
  }
  return (await copyText(text)) ? "copied" : "fail";
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
