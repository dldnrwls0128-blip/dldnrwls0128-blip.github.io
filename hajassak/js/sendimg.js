/** 1.6.0 업체 보내기: 표(번호·위치·공종·내용·상태) + 번호 붙인 참고 사진. PNG, 여러 장. */
import { FONT as FONT0, wrapText, toBlob as toBlob0 } from "./reqimg.js";

export const FONT = FONT0;
export const W = 1080;
export const toPng = (cv) => toBlob0(cv, "image/png");
export const toBlob = toBlob0;

const INK = "#111827", SUB = "#4b5563", LINE = "#d1d5db", BG = "#ffffff", HEAD = "#0f3d38", SOFT = "#f3f4f6", ACC = "#147a6b", RED = "#b45309";
const PAD = 44;

const rr = (ctx, x, y, w, h, r = 12) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
};
const f = (px, w = 400) => `${w} ${px}px ${FONT}`;

async function bitmap(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { try { return await createImageBitmap(blob); } catch { return null; } }
}
function cover(ctx, bmp, x, y, s) {
  const r = Math.max(s / bmp.width, s / bmp.height);
  const w = bmp.width * r, h = bmp.height * r;
  ctx.save(); rr(ctx, x, y, s, s, 12); ctx.clip();
  ctx.drawImage(bmp, x + (s - w) / 2, y + (s - h) / 2, w, h);
  ctx.restore();
}

const locOf = (d, locText) => locText(d) || "위치 미지정";
const tradeOf = (d, tradeText) => tradeText(d) || "공종 미지정";

/** 한 쪽에 넣을 건수: 사진이 있으면 적게, 폰에서 표·사진이 읽히게. */
export function chunkItems(items, photos) {
  const out = []; let i = 0;
  while (i < items.length) {
    let take = 0, photoN = 0;
    while (i + take < items.length) {
      const d = items[i + take];
      const pn = Math.min(4, (photos.get(d.id) || []).length);
      const nextP = photoN + pn;
      // 표 행 + 사진. 사진 8장 또는 5건이 한 쪽 한도
      if (take && (take >= 5 || nextP > 8)) break;
      photoN = nextP; take++;
    }
    if (!take) take = 1;
    out.push(items.slice(i, i + take));
    i += take;
  }
  return out.length ? out : [[]];
}

function drawHeader(ctx, { project, vendor, today, page, pages, total }) {
  ctx.fillStyle = HEAD; ctx.fillRect(0, 0, W, 132);
  ctx.fillStyle = "#fff"; ctx.font = f(36, 800);
  ctx.fillText("하자 조치 요청", PAD, 36);
  ctx.font = f(24, 500);
  const sub = [project?.name || "현장", vendor?.name || "업체 미지정", today].filter(Boolean).join("  ·  ");
  ctx.fillText(sub, PAD, 82);
  ctx.font = f(22, 600);
  const right = pages > 1 ? `${page}/${pages}쪽 · ${total}건` : `${total}건`;
  const tw = ctx.measureText(right).width;
  ctx.fillText(right, W - PAD - tw, 82);
}

function drawTable(ctx, y, rows, { locText, tradeText, uiStatus }) {
  const inner = W - PAD * 2;
  const cols = [
    { k: "no", h: "번호", w: 70 },
    { k: "loc", h: "위치", w: 250 },
    { k: "tr", h: "공종", w: 160 },
    { k: "what", h: "하자 내용", w: 350 },
    { k: "st", h: "상태", w: 106 },
  ];
  // last col fills remainder
  const sum = cols.reduce((a, c) => a + c.w, 0);
  cols[3].w += inner - sum;
  ctx.fillStyle = ACC; rr(ctx, PAD, y, inner, 52, 10); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = f(22, 700);
  let x = PAD;
  for (const c of cols) { ctx.fillText(c.h, x + 10, y + 14); x += c.w; }
  y += 52;
  for (const r of rows) {
    const loc = wrapText(ctx, r.loc, cols[1].w - 16, 3);
    const tr = wrapText(ctx, r.tr, cols[2].w - 16, 2);
    const what = wrapText(ctx, r.what, cols[3].w - 16, 3);
    const rh = Math.max(56, 8 + Math.max(loc.length, tr.length, what.length, 1) * 32);
    ctx.fillStyle = r.i % 2 ? SOFT : "#fff";
    ctx.fillRect(PAD, y, inner, rh);
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.strokeRect(PAD, y, inner, rh);
    ctx.fillStyle = INK; ctx.font = f(24, 700);
    const cells = [String(r.no), loc, tr, what, [r.st]];
    x = PAD;
    for (let i = 0; i < cols.length; i++) {
      const lines = Array.isArray(cells[i]) ? cells[i] : [cells[i]];
      ctx.font = f(i === 0 || i === 4 ? 24 : 22, i === 0 ? 800 : 500);
      ctx.fillStyle = i === 4 && r.st === "미조치" ? RED : INK;
      const cx = x + 10;
      lines.forEach((l, j) => ctx.fillText(l, i === 0 ? x + cols[i].w / 2 - ctx.measureText(l).width / 2 : cx, y + 12 + j * 30));
      x += cols[i].w;
    }
    r._h = rh;
    y += rh;
  }
  return y + 16;
}

async function drawPhotos(ctx, y, rows, photos) {
  const inner = W - PAD * 2;
  const withPh = rows.filter((r) => (photos.get(r.d.id) || []).length);
  if (!withPh.length) {
    ctx.fillStyle = SUB; ctx.font = f(22, 500);
    ctx.fillText("참고 사진 없음", PAD, y);
    return y + 40;
  }
  ctx.fillStyle = INK; ctx.font = f(26, 700);
  ctx.fillText("참고 사진", PAD, y); y += 44;
  const gap = 16, thumb = 220;
  const cols = Math.max(1, Math.floor((inner + gap) / (thumb + gap)));
  for (const r of withPh) {
    const phs = (photos.get(r.d.id) || []).slice(0, 4);
    // number badge + photos in a row (wrap)
    let col = 0;
    const rowH = thumb + 28;
    for (let k = 0; k < phs.length; k++) {
      if (col >= cols) { y += rowH + gap; col = 0; }
      const x = PAD + col * (thumb + gap);
      if (k === 0) {
        ctx.fillStyle = ACC; rr(ctx, x, y, 44, 36, 8); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = f(22, 800);
        const ns = String(r.no); ctx.fillText(ns, x + 22 - ctx.measureText(ns).width / 2, y + 6);
      }
      const py = y + (k === 0 ? 0 : 0);
      const px = k === 0 ? x + 52 : x;
      const sz = k === 0 ? thumb - 12 : thumb;
      // if first with badge, draw photo to the right of badge on same row start
      const ox = k === 0 ? x + 52 : x;
      const oy = y;
      const s = thumb;
      const bmp = await bitmap(phs[k]);
      if (bmp) { cover(ctx, bmp, ox, oy, s); bmp.close?.(); }
      else { ctx.fillStyle = LINE; rr(ctx, ox, oy, s, s, 12); ctx.fill(); }
      col++;
      if (k === 0) { /* badge sits in margin; photo uses full thumb from ox — may overflow. simpler: badge overlay */ }
    }
    y += thumb + gap + 8;
  }
  return y;
}

async function drawPhotosSimple(ctx, y, rows, photos) {
  const inner = W - PAD * 2;
  const withPh = rows.filter((r) => (photos.get(r.d.id) || []).length);
  if (!withPh.length) {
    ctx.fillStyle = SUB; ctx.font = f(22, 500);
    ctx.fillText("참고 사진 없음", PAD, y);
    return y + 48;
  }
  ctx.fillStyle = INK; ctx.font = f(26, 700);
  ctx.fillText("참고 사진", PAD, y); y += 48;
  const gap = 18, thumb = 230;
  const cols = 4;
  for (const r of withPh) {
    const phs = (photos.get(r.d.id) || []).slice(0, 4);
    // one row per item: badge + up to 4 thumbs
    ctx.fillStyle = ACC; rr(ctx, PAD, y, 52, 52, 10); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = f(26, 800);
    const ns = String(r.no); ctx.fillText(ns, PAD + 26 - ctx.measureText(ns).width / 2, y + 12);
    const startX = PAD + 66;
    const avail = inner - 66;
    const s = Math.min(thumb, Math.floor((avail - (phs.length - 1) * gap) / Math.max(1, phs.length)));
    for (let k = 0; k < phs.length; k++) {
      const x = startX + k * (s + gap);
      const bmp = await bitmap(phs[k]);
      if (bmp) { cover(ctx, bmp, x, y, s); bmp.close?.(); }
      else { ctx.fillStyle = LINE; rr(ctx, x, y, s, s, 12); ctx.fill(); }
    }
    y += Math.max(56, s) + gap + 6;
  }
  return y;
}

export async function renderVendorPages({ project, vendor, items, photos = new Map(), today, locText, tradeText, uiStatus }) {
  const chunks = chunkItems(items, photos);
  const pages = [];
  let no = 1;
  for (let p = 0; p < chunks.length; p++) {
    const part = chunks[p];
    const rows = part.map((d, i) => ({
      i, d, no: no + i,
      loc: locOf(d, locText),
      tr: tradeOf(d, tradeText),
      what: (d.content || d.type || "").trim() || "(내용 없음)",
      st: uiStatus(d),
    }));
    no += part.length;
    // measure on offscreen
    const cv0 = document.createElement("canvas"); cv0.width = W; cv0.height = 200;
    const ctx0 = cv0.getContext("2d"); ctx0.font = f(22, 500);
    let h = 132 + 40 + 52;
    for (const r of rows) {
      const loc = wrapText(ctx0, r.loc, 234, 3);
      const tr = wrapText(ctx0, r.tr, 144, 2);
      const what = wrapText(ctx0, r.what, 390, 3);
      h += Math.max(56, 8 + Math.max(loc.length, tr.length, what.length, 1) * 32);
    }
    h += 40 + 48;
    for (const r of rows) {
      const pn = Math.min(4, (photos.get(r.d.id) || []).length);
      if (pn) h += 230 + 24;
      else if (r === rows[rows.length - 1] && !rows.some((x) => (photos.get(x.d.id) || []).length)) h += 48;
    }
    h += 60;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = Math.max(800, Math.ceil(h));
    const ctx = cv.getContext("2d");
    ctx.fillStyle = BG; ctx.fillRect(0, 0, cv.width, cv.height);
    drawHeader(ctx, { project, vendor, today, page: p + 1, pages: chunks.length, total: items.length });
    let y = 152;
    y = drawTable(ctx, y, rows, { locText, tradeText, uiStatus });
    y = await drawPhotosSimple(ctx, y + 8, rows, photos);
    ctx.fillStyle = SUB; ctx.font = f(18, 400);
    ctx.fillText("하자싹 · 표의 번호와 참고 사진 번호가 같아요.", PAD, cv.height - 28);
    pages.push({ canvas: cv, w: cv.width, h: cv.height });
  }
  return pages;
}
