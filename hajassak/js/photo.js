/** 사진 압축(긴 변 1600px, JPEG 0.72) + 위치·시간 스탬프 + 썸네일 */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
    img.src = url;
  });
}
const toBlob = (c, q) => new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", q));
/** EXIF 회전은 브라우저 디코딩(image-orientation: from-image)이 적용된 상태로 그린다 */
export async function compressImage(file, { max = 1600, quality = 0.72, stamp = "" } = {}) {
  const img = await loadImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const s = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * s), h = Math.round(h0 * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
  if (stamp) {
    const fs = Math.max(14, Math.round(w / 34));
    ctx.font = `700 ${fs}px sans-serif`;
    const pad = Math.round(fs * 0.5); const lines = stamp.split("\n");
    const bh = lines.length * fs * 1.3 + pad * 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, h - bh, w, bh);
    ctx.fillStyle = "#fff";
    lines.forEach((ln, i) => ctx.fillText(ln, pad, h - bh + pad + fs * (i + 1) * 1.15, w - pad * 2));
  }
  const blob = await toBlob(c, quality);
  const ts = Math.min(1, 240 / Math.max(w, h));
  const t = document.createElement("canvas"); t.width = Math.round(w * ts); t.height = Math.round(h * ts);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return { blob, thumb: await toBlob(t, 0.7), w, h };
}
export function downloadBlob(blob, filename) {
  const a = document.createElement("a"); const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function shareOrDownload(blob, filename, title = "") {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return "shared"; }
  } catch (e) { if (e?.name === "AbortError") return "cancel"; }
  downloadBlob(blob, filename); return "downloaded";
}
