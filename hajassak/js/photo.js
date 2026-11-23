/** 사진 압축(긴 변 2048px, JPEG 0.85) + 위치·시간 스탬프 + 미리보기 썸네일(약 960px, JPEG 0.8) */
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
  /** 내용: 최대 2줄로 줄바꿈하고 넘치면 말줄임 */
  const wrap = (t, max, weight, size, maxLines) => { if (!t) return []; ctx.font = `${weight} ${size}px ${FONT}`; const out = []; let cur = "";
    for (const ch of t) { if (ctx.measureText(cur + ch).width > max && cur) { out.push(cur); cur = ch.trim() ? ch : ""; if (out.length === maxLines) break; } else cur += ch; }
    if (out.length < maxLines && cur) out.push(cur);
    else if (out.length === maxLines && (cur || t.length > out.join("").length)) { let l = out[maxLines - 1]; const rest = t.slice(out.join("").length); if (rest.trim()) { while (l.length > 1 && ctx.measureText(l + "…").width > max) l = l.slice(0, -1); out[maxLines - 1] = l + "…"; } }
    return out; };
  const tagW = info.tag ? (ctx.font = `800 ${fs}px ${FONT}`, ctx.measureText(info.tag).width + pad * 1.6) : 0;
  const lines = [
    { t: info.loc || "", wgt: 800, size: Math.round(fs * 1.08), max: inner - (tagW ? tagW + pad : 0) },
    { t: info.work || "", wgt: 600, size: fs, max: inner },
    ...wrap(info.content || "", inner, 500, Math.round(fs * 0.96), 2).map((t) => ({ t, wgt: 500, size: Math.round(fs * 0.96), max: inner, raw: true })),
    { t: info.project || "", wgt: 500, size: Math.round(fs * 0.92), max: inner },
    { t: info.at || "", wgt: 500, size: Math.round(fs * 0.86), max: inner },
  ].filter((l) => l.t);
  const bh = pad * 2 + lines.reduce((a, l) => a + Math.round(l.size * 1.32), 0);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(0, h - bh, w, bh);
  ctx.textBaseline = "alphabetic"; let y = h - bh + pad;
  lines.forEach((l) => { y += Math.round(l.size * 1.1); ctx.fillStyle = "#fff"; ctx.font = `${l.wgt} ${l.size}px ${FONT}`; ctx.fillText(l.raw ? l.t : fit(l.t, l.max, l.wgt, l.size), pad, y); y += Math.round(l.size * 0.22); });
  if (info.tag) { // 오른쪽 위 배지: 조치 전(주황)·조치 후(초록)
    const bx = w - pad - tagW, by = h - bh + pad * 0.7, bhh = Math.round(fs * 1.5);
    ctx.fillStyle = /후/.test(info.tag) ? "#15803d" : "#c2410c";
    const r = Math.round(bhh / 3); ctx.beginPath(); ctx.moveTo(bx + r, by); ctx.arcTo(bx + tagW, by, bx + tagW, by + bhh, r); ctx.arcTo(bx + tagW, by + bhh, bx, by + bhh, r); ctx.arcTo(bx, by + bhh, bx, by, r); ctx.arcTo(bx, by, bx + tagW, by, r); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `800 ${fs}px ${FONT}`; ctx.textBaseline = "middle"; ctx.fillText(info.tag, bx + pad * 0.8, by + bhh / 2 + 1);
  }
  ctx.restore();
}
export const PHOTO_MAX = 2048;
export const PHOTO_QUALITY = 0.85;
export const THUMB_MAX = 960;
export const THUMB_QUALITY = 0.8;
function thumbCanvas(src, sw, sh, thumbMax = THUMB_MAX) {
  const ts = Math.min(1, thumbMax / Math.max(sw, sh));
  const t = document.createElement("canvas"); t.width = Math.max(1, Math.round(sw * ts)); t.height = Math.max(1, Math.round(sh * ts));
  t.getContext("2d").drawImage(src, 0, 0, t.width, t.height);
  return t;
}
/** 이미 저장된 원본에서 미리보기용 썸네일을 다시 만든다(옛 240px 캐시 교체). 동기화 문서는 건드리지 않고 호출 쪽에서 로컬만 씀 */
export async function makeThumb(blob, thumbMax = THUMB_MAX, quality = THUMB_QUALITY) {
  const im = await decode(blob);
  const t = thumbCanvas(im.src, im.w, im.h, thumbMax); im.close();
  const b = await toBlob(t, quality);
  return { blob: b, w: t.width, h: t.height };
}
export async function compressImage(file, { max = PHOTO_MAX, quality = PHOTO_QUALITY, stamp = null, thumbMax = THUMB_MAX, thumbQuality = THUMB_QUALITY } = {}) {
  const im = await decode(file);
  const s = Math.min(1, max / Math.max(im.w, im.h));
  const w = Math.round(im.w * s), h = Math.round(im.h * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(im.src, 0, 0, w, h); im.close();
  if (stamp) drawStamp(ctx, w, h, stamp);
  const blob = await toBlob(c, quality);
  const t = thumbCanvas(c, w, h, thumbMax);
  return { blob, thumb: await toBlob(t, thumbQuality), w, h, tw: t.width, th: t.height };
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
