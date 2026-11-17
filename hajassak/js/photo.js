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
/** EXIF 회전 반영해서 디코딩: createImageBitmap(imageOrientation) 우선, 없으면 <img>(브라우저 기본 from-image) */
async function decode(file) {
  if (typeof createImageBitmap === "function") { try { const b = await createImageBitmap(file, { imageOrientation: "from-image" }); return { src: b, w: b.width, h: b.height, close: () => b.close?.() }; } catch {} }
  const img = await loadImage(file); return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
}
/** 사진 아래 띠에 현장·위치·공종·조치 전/후·일시를 새긴다.
 *  info: { project, loc, work, tag: "조치 전"|"조치 후", at: "2026-11-17 15:40" } — 옛 방식 문자열(줄바꿈)도 받음 */
export function drawStamp(ctx, w, h, info) {
  if (!info) return;
  if (typeof info === "string") { const ls = info.split("\n"); info = { project: "", loc: ls[0] || "", work: ls[1] || "", tag: "", at: ls[2] || "" }; }
  const fs = Math.max(15, Math.round(Math.min(w, h * 1.4) / 26)); const pad = Math.round(fs * 0.55); const lh = Math.round(fs * 1.32);
  const FONT = '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const fit = (t, max, weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; if (ctx.measureText(t).width <= max) return t; let a = t; while (a.length > 1 && ctx.measureText(a + "…").width > max) a = a.slice(0, -1); return a + "…"; };
  const inner = w - pad * 2;
  const tagW = info.tag ? (ctx.font = `800 ${fs}px ${FONT}`, ctx.measureText(info.tag).width + pad * 1.6) : 0;
  const lines = [
    { t: info.loc || "", wgt: 800, size: Math.round(fs * 1.08), max: inner - (tagW ? tagW + pad : 0) },
    { t: [info.work, info.project].filter(Boolean).join("  ·  "), wgt: 600, size: fs, max: inner },
    { t: info.at || "", wgt: 500, size: Math.round(fs * 0.92), max: inner },
  ].filter((l) => l.t);
  const bh = pad * 2 + lines.reduce((a, l) => a + Math.round(l.size * 1.32), 0);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(0, h - bh, w, bh);
  ctx.textBaseline = "alphabetic"; let y = h - bh + pad;
  lines.forEach((l) => { y += Math.round(l.size * 1.1); ctx.fillStyle = "#fff"; ctx.font = `${l.wgt} ${l.size}px ${FONT}`; ctx.fillText(fit(l.t, l.max, l.wgt, l.size), pad, y); y += Math.round(l.size * 0.22); });
  if (info.tag) { // 오른쪽 위 배지: 조치 전(주황)·조치 후(초록)
    const bx = w - pad - tagW, by = h - bh + pad * 0.7, bhh = Math.round(fs * 1.5);
    ctx.fillStyle = /후/.test(info.tag) ? "#15803d" : "#c2410c";
    const r = Math.round(bhh / 3); ctx.beginPath(); ctx.moveTo(bx + r, by); ctx.arcTo(bx + tagW, by, bx + tagW, by + bhh, r); ctx.arcTo(bx + tagW, by + bhh, bx, by + bhh, r); ctx.arcTo(bx, by + bhh, bx, by, r); ctx.arcTo(bx, by, bx + tagW, by, r); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `800 ${fs}px ${FONT}`; ctx.textBaseline = "middle"; ctx.fillText(info.tag, bx + pad * 0.8, by + bhh / 2 + 1);
  }
  ctx.restore();
}
export async function compressImage(file, { max = 1600, quality = 0.72, stamp = null } = {}) {
  const im = await decode(file);
  const s = Math.min(1, max / Math.max(im.w, im.h));
  const w = Math.round(im.w * s), h = Math.round(im.h * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(im.src, 0, 0, w, h); im.close();
  if (stamp) drawStamp(ctx, w, h, stamp);
  const blob = await toBlob(c, quality);
  const ts = Math.min(1, 240 / Math.max(w, h));
  const t = document.createElement("canvas"); t.width = Math.round(w * ts); t.height = Math.round(h * ts);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return { blob, thumb: await toBlob(t, 0.7), w, h };
}
/** 이미 저장된(스탬프 없는) 사진에 보낼 때·내보낼 때만 스탬프를 새겨 새 Blob으로(원본은 그대로) */
export async function stampBlob(blob, info, quality = 0.8) {
  const im = await decode(blob); const c = document.createElement("canvas"); c.width = im.w; c.height = im.h;
  const ctx = c.getContext("2d"); ctx.drawImage(im.src, 0, 0); im.close(); drawStamp(ctx, im.w, im.h, info); return toBlob(c, quality);
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
