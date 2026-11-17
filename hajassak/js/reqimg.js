/** 하자 조치 요청서 이미지(1.2.2): 하자 1건 또는 같은 업체 여러 건 → 세로형 이미지(캔버스)
 *  - 한글: 시스템 글꼴 묶음 + 글자 단위 줄바꿈(띄어쓰기 우선)
 *  - 건이 많으면 장당 PER_PAGE건씩 여러 장
 *  - 결과: [{ canvas, w, h }] → toJpeg/toPng로 파일 만들기 */
import { locText, tradeText, contactsText, sortDefects, hasSteps, stepProgress } from "./model.js";

export const FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic","맑은 고딕","Noto Sans KR","Noto Sans CJK KR","Gothic A1","Nanum Gothic",system-ui,-apple-system,"Segoe UI",sans-serif';
export const W = 1080; export const PER_PAGE = 6;
const PAD = 56, INK = "#111827", SUB = "#4b5563", LINE = "#d1d5db", BRAND = "#0f766e", RED = "#dc2626", SOFT = "#f3f4f6";
const f = (px, w = 400) => `${w} ${px}px ${FONT}`;

/** 줄바꿈: 띄어쓰기 단위로 넣다가 한 단어가 너무 길면 글자 단위로 자름(한글은 글자 단위로도 자연스러움) */
export function wrapText(ctx, text, maxW, maxLines = 99) {
  const out = []; for (const para of String(text ?? "").split(/\n/)) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const t = line + word;
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = ""; }
      let w2 = word.replace(/^\s+/, "");
      for (const ch of [...w2]) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; }
    }
    out.push(line.trimEnd());
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  if (out.length > maxLines) { const cut = out.slice(0, maxLines); let l = cut[maxLines - 1]; while (l && ctx.measureText(l + "…").width > maxW) l = l.slice(0, -1); cut[maxLines - 1] = l + "…"; return cut; }
  return out;
}
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
async function bitmap(blob) { try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch { try { return await createImageBitmap(blob); } catch { return null; } } }
function cover(ctx, bmp, x, y, s, fit = false) { if (fit) { ctx.fillStyle = "#e5e7eb"; rr(ctx, x, y, s, s, 14); ctx.fill(); } const r = (fit ? Math.min : Math.max)(s / bmp.width, s / bmp.height); const w = bmp.width * r, h = bmp.height * r; ctx.save(); rr(ctx, x, y, s, s, 14); ctx.clip(); ctx.drawImage(bmp, x + (s - w) / 2, y + (s - h) / 2, w, h); ctx.restore(); }

/** 문서번호: 날짜-순번(이 기기 하루 순번) */
export function docNumber(today, seq) { return `HS-${String(today).replace(/-/g, "")}-${String(seq).padStart(3, "0")}`; }

/** 한 장 그리기(측정 → 높이 확정 → 그리기) */
async function drawPage({ project, vendor, items, photos, issuer, today, docNo, watermark, page, pages, start, total }) {
  const meas = document.createElement("canvas").getContext("2d");
  const inner = W - PAD * 2; const thumbGap = 14; const cols = items.length === 1 && total === 1 ? 2 : 4; const thumb = Math.floor((inner - 40 - thumbGap * (cols - 1)) / cols);
  // 머리 정보 줄
  const contact = contactsText(vendor) || "-";
  const head = [["현장", project?.name || "-"], ["문서번호", docNo + (pages > 1 ? ` (${page}/${pages})` : "")], ["요청일", today], ["업체", vendor?.name || "업체 미지정"], ["담당자", contact], ["요청자", issuer || "-"], ["건수", `${total}건${pages > 1 ? ` 중 ${start + 1}~${start + items.length}` : ""}`]];
  meas.font = f(30); const headLines = head.map(([, v]) => wrapText(meas, v, inner - 190, 3));
  const headH = headLines.reduce((s, l) => s + Math.max(1, l.length) * 40 + 16, 0) + 24;
  // 각 건 높이
  const blocks = items.map((d, i) => {
    meas.font = f(36, 700); const loc = wrapText(meas, locText(d) || "위치 미지정", inner - 40 - 90, 2);
    meas.font = f(30); const what = wrapText(meas, d.content || "-", inner - 40 - 150, 6);
    const trade = [tradeText(d), d.type].filter(Boolean).join(" · ") + (hasSteps(d) ? `  (공정 ${stepProgress(d)})` : "");
    meas.font = f(30); const tr = wrapText(meas, trade || "-", inner - 40 - 150, 2);
    const ph = (photos.get(d.id) || []).slice(0, 4);
    const h = 28 + loc.length * 46 + 14 + tr.length * 40 + 8 + what.length * 40 + 8 + 40 + (ph.length ? 18 + Math.ceil(ph.length / cols) * (thumb + thumbGap) - thumbGap : 0) + 28;
    return { d, no: start + i + 1, loc, what, tr, ph, h };
  });
  const H = Math.ceil(PAD + 120 + headH + 30 + blocks.reduce((s, b) => s + b.h + 22, 0) + 150);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.textBaseline = "top";
  ctx.fillStyle = BRAND; ctx.fillRect(0, 0, W, 14);
  let y = PAD;
  ctx.fillStyle = INK; ctx.font = f(58, 800); ctx.fillText("하자 조치 요청서", PAD, y);
  ctx.font = f(26, 600); ctx.fillStyle = BRAND; const tag = "하자싹"; ctx.fillText(tag, W - PAD - ctx.measureText(tag).width, y + 22);
  y += 96; ctx.fillStyle = INK; ctx.fillRect(PAD, y, inner, 4); y += 20;
  head.forEach(([k], i) => { const ls = headLines[i]; ctx.font = f(28, 700); ctx.fillStyle = SUB; ctx.fillText(k, PAD + 6, y + 2);
    ctx.font = f(30, k === "업체" || k === "현장" ? 700 : 400); ctx.fillStyle = INK; ls.forEach((l, j) => ctx.fillText(l, PAD + 190, y + j * 40));
    y += Math.max(1, ls.length) * 40 + 8; ctx.fillStyle = LINE; ctx.fillRect(PAD, y, inner, 1); y += 8; });
  y += 30;
  for (const b of blocks) {
    const d = b.d; const x = PAD; const od = d.due && d.due < today && !["조치완료", "확인완료"].includes(d.status);
    ctx.fillStyle = SOFT; rr(ctx, x, y, inner, b.h, 22); ctx.fill(); ctx.strokeStyle = d.severity === "긴급" ? RED : LINE; ctx.lineWidth = d.severity === "긴급" ? 3 : 1.5; rr(ctx, x, y, inner, b.h, 22); ctx.stroke();
    let yy = y + 28; const xi = x + 20;
    ctx.fillStyle = BRAND; rr(ctx, xi, yy, 70, 46, 12); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = f(28, 800); const ns = String(b.no); ctx.fillText(ns, xi + 35 - ctx.measureText(ns).width / 2, yy + 8);
    ctx.fillStyle = INK; ctx.font = f(36, 700); b.loc.forEach((l, j) => ctx.fillText(l, xi + 90, yy + 2 + j * 46)); yy += b.loc.length * 46 + 14;
    const kv = (k, lines, color = INK, w = 400) => { ctx.font = f(26, 700); ctx.fillStyle = SUB; ctx.fillText(k, xi, yy + 3); ctx.font = f(30, w); ctx.fillStyle = color; lines.forEach((l, j) => ctx.fillText(l, xi + 150, yy + j * 40)); yy += lines.length * 40 + 8; };
    kv("공종", b.tr); kv("하자내용", b.what, INK, 600);
    kv("조치기한", [`${d.due || "-"}${od ? "  (기한초과)" : ""}${d.severity === "긴급" ? "  ⚠ 긴급" : ""}`], od || d.severity === "긴급" ? RED : INK, 700);
    if (b.ph.length) { yy += 10; for (let k = 0; k < b.ph.length; k++) { const xx = xi + (k % cols) * (thumb + thumbGap), y2 = yy + Math.floor(k / cols) * (thumb + thumbGap); const bmp = await bitmap(b.ph[k]); if (bmp) { cover(ctx, bmp, xx, y2, thumb, cols === 2); bmp.close?.(); } else { ctx.fillStyle = LINE; rr(ctx, xx, y2, thumb, thumb, 14); ctx.fill(); } } }
    y += b.h + 22;
  }
  y += 10; ctx.fillStyle = INK; ctx.font = f(28, 600);
  wrapText(ctx, "위 하자를 조치 기한 내 보수하고 조치 후 사진을 회신해 주시기 바랍니다.", inner, 2).forEach((l, j) => ctx.fillText(l, PAD, y + j * 38));
  ctx.font = f(22); ctx.fillStyle = SUB; ctx.fillText(`${docNo} · 하자싹으로 작성`, PAD, H - 50);
  if (watermark) { ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = INK; ctx.font = f(90, 800); ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 7); const t = "하자싹 무료판"; ctx.fillText(t, -ctx.measureText(t).width / 2, -45); ctx.restore(); }
  return { canvas: cv, w: W, h: H };
}

/** items: 같은 업체 하자들, photos: Map(defectId → Blob[] 최대 4) */
export async function renderRequestImages({ project, vendor, items, photos = new Map(), issuer = "", today, docNo, watermark = false }) {
  try { await document.fonts?.ready; } catch {}
  const list = [...items].sort(sortDefects); const pages = Math.max(1, Math.ceil(list.length / PER_PAGE)); const out = [];
  for (let p = 0; p < pages; p++) out.push(await drawPage({ project, vendor, items: list.slice(p * PER_PAGE, (p + 1) * PER_PAGE), photos, issuer, today, docNo, watermark, page: p + 1, pages, start: p * PER_PAGE, total: list.length }));
  return out;
}
export const toBlob = (cv, type = "image/jpeg", q = 0.9) => new Promise((r) => cv.toBlob(r, type, q));
/** 공유·복사용 문구(이미지와 같이 보냄) */
export function requestText({ project, vendor, items, docNo }) {
  const due = items.map((d) => d.due).filter(Boolean).sort()[0];
  return `[${project?.name || "현장"}] ${vendor?.name ? vendor.name + " " : ""}하자 조치 요청서 ${items.length}건 (${docNo})${due ? `\n가장 빠른 조치기한: ${due}` : ""}\n첨부 이미지 확인 후 조치 사진 회신 부탁드립니다.`;
}
