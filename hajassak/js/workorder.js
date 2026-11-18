/** 1.3.0 작업지시 및 완료확인서: 표 형식 요청서(인쇄 A4 가로 · PDF · 이미지 여러 장)
 *  열: 하자 No. | 단계 | 동 | 호 | 타입 | 입주/키불 | 실명 | 공종 | EV/호기 | 하자내용 | 처리상태 | 접수일/예약일시 | 완료확인/서명 */
import { locParts, roomOf, coreOf, unitTypeOf, floorLabel, fArr, commonOf } from "./model.js";
import { FONT, wrapText } from "./reqimg.js";

export const WO_TITLE = "작업지시 및 완료확인서";
export const WO_COLS = [["no", "하자 No.", 62], ["stage", "단계", 78], ["dong", "동", 52], ["ho", "호", 58], ["utype", "타입", 52], ["movein", "입주/키불", 64], ["room", "실명", 78], ["trade", "공종", 92], ["core", "EV/호기", 66], ["body", "하자내용", 330], ["status", "처리상태", 70], ["date", "접수일/예약일시", 100], ["sign", "완료확인/서명", 98]];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const yymmdd = (iso) => (iso ? String(iso).slice(2, 10) : "");
/** 하자 No.: 현장 안에서 등록 순서(1부터) — 저장된 번호(d.no)가 있으면 그 번호 */
export function seqMap(all) { const m = new Map(); [...all].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))).forEach((d, i) => m.set(d.id, i + 1)); return m; }
/** 줄 만들기. high=true면 고층부터(층 내림 → 동 → 호) */
export function woRows(items, { project, all = items, high = false } = {}) {
  const seq = seqMap(all);
  const rows = items.map((d) => { const lp = locParts(d); const c = coreOf(project, d);
    const head = [d.subTrade, d.type].some(Boolean) ? `( ${d.subTrade || ""} ) / ( ${d.type || ""} )` : "";
    return { id: d.id, _f: lp.floorNum, _d: lp.dongNum ?? 1e9, _ds: lp.dong || "", _h: lp.hoNum ?? 1e9,
      no: String(d.extId || d.no || seq.get(d.id) || ""), stage: d.stage || d.category || "", dong: lp.dong ? lp.dong.replace(/동$/, "") : commonOf(d), ho: lp.ho || (lp.floor && !lp.ho ? floorLabel(lp.floor) : ""),
      utype: unitTypeOf(project, lp.dong, lp.ho) || d.utype || "", movein: d.moveIn || "", room: roomOf(d) || (lp.dong ? d.common || "" : ""), trade: d.trade || "",
      core: c ? `${String(c).padStart(2, "0")}코어` : "", head, text: d.content || "", status: d.status || "", date: `${yymmdd(d.createdAt)} /${d.resvAt ? " " + d.resvAt : ""}`, sign: "" }; });
  const nul = (v, dir) => (v == null ? 1e9 * dir : v);
  if (high) rows.sort((a, b) => nul(b._f, -1) - nul(a._f, -1) || a._d - b._d || a._ds.localeCompare(b._ds, "ko") || a._h - b._h || (Number(a.no) || 0) - (Number(b.no) || 0));
  if (!high) rows.sort((a, b) => a._d - b._d || a._ds.localeCompare(b._ds, "ko") || nul(a._f, 1) - nul(b._f, 1) || a._h - b._h || (Number(a.no) || 0) - (Number(b.no) || 0));
  return rows;
}
/** 검색조건: 동 목록 / 공종 / 유형 / 상태 / 업체 (빈 칸은 비워 둠) */
export function woCondition(items, { filter = {}, vendorName = () => "", statusText = (s) => s } = {}) {
  const dongs = [...new Set((fArr(filter.dong).length ? fArr(filter.dong).filter((x) => x !== "_none") : items.map((d) => locParts(d).dong).filter(Boolean)))].map((x) => x.replace(/동$/, "")).sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b, "ko"));
  const vend = [...new Set(items.map(vendorName).filter(Boolean))];
  return [dongs.join(","), fArr(filter.trade).join(","), fArr(filter.type).join(","), fArr(filter.status).map(statusText).join(","), vend.join(",")].join(" / ");
}
export function woHtml({ rows, meta }) {
  const cell = (r, k) => (k === "body" ? `<td class="wo-body">${r.head ? `<div class="wo-h">${esc(r.head)}</div>` : ""}<div>${esc(r.text)}</div></td>` : `<td class="c wo-${k}">${esc(r[k])}</td>`);
  return `<div class="wo-doc">
  <h1 class="wo-title">${WO_TITLE}</h1>
  <div class="wo-meta"><div>출력일자 : ${esc(meta.date)}</div><div>출력자 : ${esc(meta.who)}</div><div>검색조건 : ${esc(meta.cond)}</div><div>출력건수 : ${rows.length.toLocaleString()}건</div></div>
  <table class="wo-t"><colgroup>${WO_COLS.map(([, , w]) => `<col style="width:${w}px">`).join("")}</colgroup>
  <thead><tr>${WO_COLS.map(([k, t]) => `<th class="wo-th-${k}">${esc(t).replace("/", "/<br>")}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr data-wo="${esc(r.id)}">${WO_COLS.map(([k]) => cell(r, k)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export const WO_CSS = `
.wo-doc{color:#000;background:#fff;font:12px/1.35 ${FONT};padding:10px 12px}
.wo-title{text-align:center;font-size:22px;font-weight:800;margin:4px 0 10px;letter-spacing:.06em}
.wo-meta{font-size:12px;margin:0 0 6px;line-height:1.6}
.wo-t{width:100%;border-collapse:collapse;table-layout:fixed}
.wo-t th,.wo-t td{border:1px solid #333;padding:3px 4px;vertical-align:middle;word-break:keep-all;overflow-wrap:anywhere}
.wo-t th{background:#eef0f3;font-weight:700;font-size:11.5px;text-align:center}
.wo-t td.c{text-align:center}.wo-body{text-align:center}.wo-h{font-weight:700}
.wo-t tr{break-inside:avoid;page-break-inside:avoid}.wo-t thead{display:table-header-group}
.wo-sign{height:34px}
@media print{ .wo-doc{page:wo;padding:0;font-size:10pt} .wo-t th,.wo-t td{font-size:9pt} }
@page wo{size:A4 landscape;margin:8mm}`;

/* ---------- 이미지(장당 ROWS건, 가로형) ---------- */
export const IMG_W = 1754, IMG_ROWS = 14;
export async function renderWoImages({ rows, meta }) {
  const pages = []; const per = IMG_ROWS; const n = Math.max(1, Math.ceil(rows.length / per));
  const total = WO_COLS.reduce((a, [, , w]) => a + w, 0); const PAD = 40; const scale = (IMG_W - PAD * 2) / total; const colW = WO_COLS.map(([, , w]) => w * scale);
  const meas = document.createElement("canvas").getContext("2d");
  for (let p = 0; p < n; p++) {
    const part = rows.slice(p * per, (p + 1) * per);
    meas.font = `400 17px ${FONT}`;
    const lines = part.map((r) => { const bw = colW[9] - 12; meas.font = `700 17px ${FONT}`; const h = r.head ? wrapText(meas, r.head, bw, 1) : []; meas.font = `400 17px ${FONT}`; return { h, t: wrapText(meas, r.text, bw, 2) }; });
    const rowH = lines.map((l) => Math.max(56, 14 + (l.h.length + l.t.length) * 22));
    const top = PAD + 50 + 4 * 26 + 10; const headH = 52; const H = top + headH + rowH.reduce((a, b) => a + b, 0) + PAD + 26;
    const cv = document.createElement("canvas"); cv.width = IMG_W; cv.height = H; const c = cv.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, IMG_W, H); c.fillStyle = "#000"; c.textBaseline = "middle";
    c.font = `800 34px ${FONT}`; c.textAlign = "center"; c.fillText(WO_TITLE, IMG_W / 2, PAD + 20);
    c.font = `400 18px ${FONT}`; c.textAlign = "left";
    [`출력일자 : ${meta.date}`, `출력자 : ${meta.who}`, `검색조건 : ${meta.cond}`, `출력건수 : ${rows.length.toLocaleString()}건`].forEach((t, i) => c.fillText(t, PAD, PAD + 60 + i * 26));
    let x = PAD; const y0 = top;
    c.fillStyle = "#eef0f3"; c.fillRect(PAD, y0, IMG_W - PAD * 2, headH); c.fillStyle = "#000"; c.font = `700 16px ${FONT}`; c.textAlign = "center";
    WO_COLS.forEach(([, t], i) => { const ps = t.includes("/") ? t.split("/").map((s, j, a) => (j < a.length - 1 ? s + "/" : s)) : [t]; ps.forEach((s, j) => c.fillText(s, x + colW[i] / 2, y0 + headH / 2 + (j - (ps.length - 1) / 2) * 19)); x += colW[i]; });
    let y = y0 + headH;
    part.forEach((r, ri) => { x = PAD; const h = rowH[ri];
      WO_COLS.forEach(([k], i) => { const cx = x + colW[i] / 2;
        if (k === "body") { const L = lines[ri]; const all = [...L.h.map((t) => [t, 700]), ...L.t.map((t) => [t, 400])]; all.forEach(([t, w], j) => { c.font = `${w} 17px ${FONT}`; c.fillText(t, cx, y + h / 2 + (j - (all.length - 1) / 2) * 22); }); }
        else if (r[k]) { c.font = `400 16px ${FONT}`; const t = wrapText(c, r[k], colW[i] - 8, 2); t.forEach((s, j) => c.fillText(s, cx, y + h / 2 + (j - (t.length - 1) / 2) * 20)); }
        x += colW[i]; });
      y += h; });
    c.strokeStyle = "#333"; c.lineWidth = 1.2; c.strokeRect(PAD, y0, IMG_W - PAD * 2, y - y0);
    x = PAD; for (let i = 0; i < colW.length - 1; i++) { x += colW[i]; c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y); c.stroke(); }
    let yy = y0 + headH; c.beginPath(); c.moveTo(PAD, yy); c.lineTo(IMG_W - PAD, yy); c.stroke(); for (const h of rowH.slice(0, -1)) { yy += h; c.beginPath(); c.moveTo(PAD, yy); c.lineTo(IMG_W - PAD, yy); c.stroke(); }
    c.font = `400 15px ${FONT}`; c.fillStyle = "#555"; c.textAlign = "right"; c.fillText(`${p + 1} / ${n}`, IMG_W - PAD, H - PAD / 2 - 6);
    pages.push({ canvas: cv, w: IMG_W, h: H, rows: part.length });
  }
  return pages;
}
