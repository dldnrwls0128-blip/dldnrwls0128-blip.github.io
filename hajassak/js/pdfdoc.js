/** 1.3.2 사진 포함 요청서·확인서 → PDF 한 파일(기기 안에서 만듦, 외부 라이브러리·CDN 없음)
 *  쪽마다 JPEG 한 장(DCTDecode)을 A4에 맞춰 넣는다. 한글은 캔버스로 그려 글꼴 내장이 필요 없다.
 *  앞쪽: 요청서/확인서 표 이미지 → 뒤쪽: 사진 쪽(한 쪽에 1~2장, 크게, 하자No·위치·공종·내용 설명). */
import { FONT, wrapText } from "./reqimg.js";
export const A4 = { w: 595.28, h: 841.89 }; // pt
const PX_W = 1240, PX_H = 1754; // 사진 쪽 150dpi
const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));
/** JPEG 바이트에서 크기 읽기 */
export function jpegSize(u8) { let i = 2; while (i < u8.length) { if (u8[i] !== 0xff) { i++; continue; } const m = u8[i + 1]; const len = (u8[i + 2] << 8) | u8[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8], comps: u8[i + 9] }; i += 2 + len; } return null; }
/** pages: [{ jpeg: Uint8Array, landscape?: bool }] → PDF Blob. 이미지는 쪽 안에 비율 유지·가운데 위 정렬 */
export function jpegPdf(pages, { title = "", margin = 18 } = {}) {
  const enc = new TextEncoder(); const chunks = []; const offs = []; let pos = 0;
  const put = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (n, body) => { offs[n] = pos; put(`${n} 0 obj\n`); body(); put("\nendobj\n"); };
  put("%PDF-1.4\n"); put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const N = pages.length; const kid = (i) => 3 + i * 3; // page, content, image
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Count ${N} /Kids [${pages.map((_, i) => `${kid(i)} 0 R`).join(" ")}] >>`));
  pages.forEach((p, i) => { const sz = jpegSize(p.jpeg) || { w: 1, h: 1, comps: 3 }; const pw = p.landscape ? A4.h : A4.w, ph = p.landscape ? A4.w : A4.h;
    const s = Math.min((pw - margin * 2) / sz.w, (ph - margin * 2) / sz.h); const dw = sz.w * s, dh = sz.h * s; const x = (pw - dw) / 2, y = ph - margin - dh;
    obj(kid(i), () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im${i} ${kid(i) + 2} 0 R >> >> /Contents ${kid(i) + 1} 0 R >>`));
    const cs = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;
    obj(kid(i) + 1, () => { put(`<< /Length ${cs.length} >>\nstream\n`); put(cs); put("\nendstream"); });
    obj(kid(i) + 2, () => { put(`<< /Type /XObject /Subtype /Image /Width ${sz.w} /Height ${sz.h} /ColorSpace /${sz.comps === 1 ? "DeviceGray" : sz.comps === 4 ? "DeviceCMYK" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); put(p.jpeg); put("\nendstream"); });
  });
  const info = 3 + N * 3; const hex = (t) => "<FEFF" + [...String(t)].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase() + ">";
  obj(info, () => put(`<< /Title ${hex(title)} /Producer (hajassak) >>`));
  const xref = pos; put(`xref\n0 ${info + 1}\n0000000000 65535 f \n`); for (let n = 1; n <= info; n++) put(`${String(offs[n]).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}
const u8 = async (b) => new Uint8Array(await b.arrayBuffer());
/** 사진 한 쪽(1~2장) 그리기. shots: [{ blob, cap: [줄1, 줄2] }] */
async function photoPage(shots, { head = "", page = 1, pages = 1, q = 0.8, scale = 1 } = {}) {
  const W = Math.round(PX_W * scale), H = Math.round(PX_H * scale); const k = scale;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, W, H);
  const f = (s, w = 400) => `${w} ${Math.round(s * k)}px ${FONT}`; const P = 60 * k;
  c.fillStyle = "#111827"; c.font = f(30, 800); c.textBaseline = "top"; c.fillText(head, P, P * 0.7);
  c.font = f(24); c.fillStyle = "#6b7280"; const pg = `사진 ${page} / ${pages}`; c.fillText(pg, W - P - c.measureText(pg).width, P * 0.7 + 4 * k);
  const top = P * 0.7 + 56 * k; const slotH = (H - top - P * 0.6) / 2; const capH = 112 * k;
  for (let i = 0; i < shots.length; i++) { const s = shots[i]; const y0 = top + i * slotH; const maxW = W - P * 2, maxH = (shots.length === 1 ? slotH * 2 : slotH) - capH - 20 * k;
    try { const bm = await createImageBitmap(s.blob); const r = Math.min(maxW / bm.width, maxH / bm.height); const dw = bm.width * r, dh = bm.height * r;
      c.drawImage(bm, (W - dw) / 2, y0, dw, dh); c.strokeStyle = "#d1d5db"; c.lineWidth = 2 * k; c.strokeRect((W - dw) / 2, y0, dw, dh); bm.close?.();
      let cy = y0 + dh + 14 * k; c.fillStyle = "#111827"; c.font = f(28, 700); for (const l of wrapText(c, s.cap[0] || "", maxW, 1)) { c.fillText(l, P, cy); cy += 38 * k; }
      c.fillStyle = "#374151"; c.font = f(25); for (const l of wrapText(c, s.cap[1] || "", maxW, 2)) { c.fillText(l, P, cy); cy += 34 * k; }
    } catch (e) { c.fillStyle = "#9ca3af"; c.font = f(26); c.fillText("사진을 읽지 못했어요", P, y0 + 20 * k); } }
  const b = await toBlob(cv, "image/jpeg", q); cv.width = cv.height = 0; return b;
}
/** 요청서/확인서 PDF 만들기.
 *  docPages: 표 쪽 canvas 배열, landscape: 표 쪽 방향
 *  photos: [{ blob, no, loc, trade, content }] (하자 순서대로)
 *  반환 { blob, pages, docPages, photoPages, photos, bytes, q } */
export async function buildPdf({ title, docPages = [], landscape = false, photos = [], perPage = 2, limit = 18 * 1024 * 1024 } = {}) {
  try { await document.fonts?.ready; } catch {}
  const docJ = []; for (const cv of docPages) docJ.push({ jpeg: await u8(await toBlob(cv, "image/jpeg", 0.88)), landscape });
  const docBytes = docJ.reduce((a, p) => a + p.jpeg.length, 0);
  const groups = []; for (let i = 0; i < photos.length; i += perPage) groups.push(photos.slice(i, i + perPage));
  /* 사진 많으면 처음부터 낮춰서, 그래도 크면 한 단계 더 낮춰 다시 */
  const steps = [[0.8, 1], [0.68, 0.85], [0.55, 0.7], [0.45, 0.6]]; let si = photos.length > 80 ? 2 : photos.length > 30 ? 1 : 0; let phJ = [];
  for (; si < steps.length; si++) { const [q, scale] = steps[si]; phJ = [];
    for (let g = 0; g < groups.length; g++) phJ.push({ jpeg: await u8(await photoPage(groups[g].map((p) => ({ blob: p.blob, cap: [`No.${p.no}  ${p.loc || "위치 미지정"}`, [p.trade, p.content].filter(Boolean).join(" · ")] })), { head: title, page: g + 1, pages: groups.length, q, scale })) });
    if (docBytes + phJ.reduce((a, p) => a + p.jpeg.length, 0) <= limit || si === steps.length - 1) break; }
  const blob = jpegPdf([...docJ, ...phJ], { title });
  return { blob, pages: docJ.length + phJ.length, docPages: docJ.length, photoPages: phJ.length, photos: photos.length, bytes: blob.size, q: steps[Math.min(si, steps.length - 1)][0] };
}
/** 파일 이름에 못 쓰는 글자 정리 */
export const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "").replace(/^\(주\)|㈜/g, "").slice(0, 30);
