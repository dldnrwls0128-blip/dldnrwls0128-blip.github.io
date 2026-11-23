/* 1.4.3 도면 글자 → 마법사 초안. 브라우저 안 pdf.js만 쓰고, 도면은 기기를 떠나지 않음(외부 API 없음). */
import * as M from "./model.js";
import { scanPdf, floorsFrom } from "./pdfplan.js";

export const NO_TEXT_MSG = "글자를 읽지 못했어요. 직접 입력하거나 엑셀로 불러오세요.";

const DONG_RE = /(\d{2,4})\s*동(?![가-힣])/g;
const DONG_NAME_RE = /(본관|신관|별관|본동|별동|[A-Za-z])\s*동(?![가-힣])/g;
const HO_RE = /(\d{3,4})\s*호/g;
const LINE_RE = /(\d{1,2})\s*라인/g;
const UNIT_ROOMS = /^(거실|침실\d*|안방|주방|식당|주방\/식당|욕실\d*|화장실\d*|현관|발코니\d*|드레스룸|파우더룸|팬트리|실외기실|대피공간|하향식피난구|알파룸|서재|공부방)$/;
const COMMON_ROOMS = /^(계단실|계단|ELEV홀|EV홀|ELEV|전실|방풍실|복도|필로티|EPS|TPS|휀룸|제연휀룸|기계실|전기실|발전기실|펌프실|저수조|주차장|지하주차장)$/i;

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
const same = (s) => M.sameKey(s);
const uniq = (arr) => { const out = [], seen = new Set(); for (const x of arr) { const k = String(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); } return out; };

export function fileKind(file) {
  const n = file?.name || "", t = file?.type || "";
  if (/pdf$/i.test(t) || /\.pdf$/i.test(n)) return "pdf";
  if (/^image\//i.test(t) || /\.(png|jpe?g|gif|webp|bmp|tif{1,2}|heic|heif)$/i.test(n)) return "image";
  return "other";
}

/** "B2,1-26" / "B1,15" / "2-26" → { basement, floors, unitStart } */
export function parseFloorsSpec(spec) {
  let basement = 0, floors = 0, rangeLo = null;
  for (const raw of String(spec || "").split(",")) {
    const p = raw.trim(); if (!p) continue;
    const m = p.match(/^(B)?(\d{1,2})(?:-(?:B)?(\d{1,2}))?$/i); if (!m) continue;
    if (m[1]) { basement = Math.max(basement, Math.max(+m[2], m[3] ? +m[3] : +m[2])); continue; }
    const a = +m[2], c = m[3] ? +m[3] : a;
    const lo = Math.min(a, c), hi = Math.max(a, c);
    floors = Math.max(floors, hi);
    if (m[3]) rangeLo = rangeLo == null ? lo : Math.min(rangeLo, lo);
  }
  return { basement, floors, unitStart: rangeLo != null ? rangeLo : 1 };
}

export function dongsFromTexts(texts, title = "", fileName = "") {
  const blob = [title, fileName.replace(/\.pdf$/i, ""), ...(texts || [])].join(" ");
  const out = [];
  for (const m of blob.matchAll(DONG_RE)) out.push(m[1] + "동");
  for (const m of blob.matchAll(DONG_NAME_RE)) out.push(m[1] + ( /동$/.test(m[1]) ? "" : "동" ));
  return uniq(out);
}

export function hosFromTexts(texts, title = "") {
  const blob = [title, ...(texts || [])].join(" ");
  const out = [];
  for (const m of blob.matchAll(HO_RE)) {
    const h = M.normHo ? M.normHo(m[1]) : String(+m[1]);
    if (h) out.push(String(h));
  }
  return uniq(out).sort((a, b) => Number(a) - Number(b));
}

export function linesFromTexts(texts, title = "") {
  const blob = [title, ...(texts || [])].join(" ");
  let max = 0;
  for (const m of blob.matchAll(LINE_RE)) max = Math.max(max, +m[1]);
  return max > 20 ? 20 : max;
}

export function roomsFromNames(names) {
  const rooms = [], commons = [];
  for (const raw of names || []) {
    const t = String(raw || "").replace(/\s+/g, "").trim();
    if (!t || /^\d{2,}$/.test(t) || DIMISH(t)) continue;
    if (UNIT_ROOMS.test(t) || /^(침실|욕실|발코니|화장실)/.test(t)) rooms.push(t);
    else if (COMMON_ROOMS.test(t) || /홀$/.test(t) && /ELEV|EV|계단/.test(t)) commons.push(t === "ELEV" ? "ELEV홀" : t);
  }
  return { rooms: uniq(rooms), commons: uniq(commons) };
}
const DIMISH = (t) => /^\d{3,}$/.test(t) || /^[A-Z]\d{2}-\d{3}$/i.test(t) || /^PW-?\d+$/i.test(t) || /^SCALE/i.test(t);

function upsertDong(map, name, extra = {}) {
  const key = same(name); if (!key) return;
  const cur = map.get(key) || { id: "d" + (map.size + 1), name, checked: true, floors: 0, basement: 0, unitStart: 1, lines: 0, hos: [], sources: [] };
  if (extra.name && String(extra.name).length > String(cur.name).length) cur.name = extra.name;
  if (extra.floors > cur.floors) cur.floors = extra.floors;
  if (extra.basement > cur.basement) cur.basement = extra.basement;
  if (extra.unitStart && extra.unitStart > 1) cur.unitStart = cur.floors && cur.unitStart === 1 && !cur._range ? extra.unitStart : Math.min(cur.unitStart || 1, extra.unitStart);
  if (extra.unitStart && extra.unitStart > 1) cur._range = true;
  if (extra.lines > cur.lines) cur.lines = extra.lines;
  if (extra.hos?.length) cur.hos = uniq([...(cur.hos || []), ...extra.hos]).sort((a, b) => Number(a) - Number(b));
  if (extra.source) cur.sources = uniq([...(cur.sources || []), extra.source]);
  map.set(key, cur);
}

/**
 * scanPdf 결과(여러 파일) → 마법사 초안. 아직 마법사 값에는 넣지 않음.
 * @param {Array<{file:string, kind?:string, rows?:object[], error?:string}>} scans
 */
export function buildDraft(scans) {
  const warnings = [];
  const pages = [];
  const dongMap = new Map();
  const roomNames = [], commonNames = [];
  let readable = 0, unreadable = 0;
  const files = [];

  for (const scan of scans || []) {
    const file = scan.file || "파일";
    files.push(file);
    if (scan.kind === "image" || scan.kind === "other" || scan.error === "image") {
      warnings.push({ file, msg: NO_TEXT_MSG });
      unreadable++;
      pages.push({ file, page: 1, title: "", kind: scan.kind || "image", nText: 0, ok: false });
      continue;
    }
    const rows = scan.rows || [];
    if (scan.error && !rows.length) {
      warnings.push({ file, msg: "도면을 열지 못했어요. " + NO_TEXT_MSG });
      unreadable++;
      continue;
    }
    if (!rows.length) {
      warnings.push({ file, msg: NO_TEXT_MSG });
      unreadable++;
      continue;
    }
    let fileText = 0;
    for (const row of rows) {
      const title = row.title || row.info?.title || "";
      const texts = row.texts || [];
      const nText = row.nText ?? texts.filter((t) => String(t).trim()).length;
      const noText = nText < 5 && !(row.rooms || []).length && !(row.info?.dongs || []).length && !dongsFromTexts(texts, title, file).length;
      const src = `${file}${rows.length > 1 ? " " + (row.page || "") + "쪽" : ""}`;
      pages.push({ file, page: row.page || 0, title, kind: row.kind || row.info?.kind || "", nText, ok: !noText });
      if (noText) {
        warnings.push({ file, page: row.page, msg: NO_TEXT_MSG });
        unreadable++;
        continue;
      }
      fileText++;
      readable++;
      const dongs = uniq([...(row.info?.dongs || []), ...dongsFromTexts(texts, title, file)]);
      const blob = [title, file, ...(texts || [])].join(" ");
      const fl = parseFloorsSpec(row.info?.floors || floorsFrom(blob.replace(/\d{2,4}\s*동/g, " ")));
      const hos = hosFromTexts(texts, title);
      const lines = Math.max(linesFromTexts(texts, title), 0);
      const extracted = roomsFromNames([...(row.rooms || []).map((r) => r.name || r), ...texts]);
      roomNames.push(...extracted.rooms);
      commonNames.push(...extracted.commons);
      if (dongs.length) {
        for (const name of dongs) upsertDong(dongMap, name, { name, floors: fl.floors, basement: fl.basement, unitStart: fl.unitStart, lines, hos, source: src });
      } else {
        // 동 이름 없이 층·호·실만 있는 쪽(세대 평면 등) — 실만 모으고, 호는 경고
        if (hos.length) warnings.push({ file, page: row.page, msg: "호 번호는 읽었지만 동 이름을 찾지 못했어요." });
      }
    }
    if (!fileText && rows.length) {
      /* 쪽마다 이미 경고를 넣음 */
    }
  }

  const dongs = [...dongMap.values()].map((d) => {
    const { _range, ...rest } = d;
    if (!rest.floors && rest.hos?.length) rest.floors = Math.max(...rest.hos.map((h) => Math.floor(Number(h) / 100)));
    if (!rest.lines && rest.hos?.length) rest.lines = Math.max(...rest.hos.map((h) => Number(h) % 100));
    rest.useUnits = !rest.lines && rest.hos?.length > 0;
    rest.hos = (rest.hos || []).map((no, i) => ({ id: rest.id + "-h" + i, no, checked: true }));
    return rest;
  });

  return {
    dongs,
    rooms: uniq(roomNames).map((name, i) => ({ id: "r" + (i + 1), name, checked: true })),
    commons: uniq(commonNames).map((name, i) => ({ id: "c" + (i + 1), name, checked: true })),
    pages,
    warnings,
    readable,
    unreadable,
    fileLabel: files.length ? `도면 ${files.length}개` : "도면",
    files,
    ok: dongs.length + uniq(roomNames).length + uniq(commonNames).length > 0,
  };
}

/** 체크된 초안만 마법사에 넣을 형태로 */
export function draftToImported(draft) {
  const dongs = (draft.dongs || []).filter((d) => d.checked && String(d.name || "").trim()).map((d) => {
    const name = String(d.name).trim().slice(0, 20);
    const floors = clamp(d.floors, 1, 99);
    const basement = clamp(d.basement, 0, 9);
    const unitStart = clamp(d.unitStart || 1, 1, floors);
    const lines = clamp(d.lines, 0, 20);
    const hos = (d.hos || []).filter((h) => h.checked !== false).map((h) => String(h.no || h).trim()).filter(Boolean);
    const out = { name, floors, basement, unitStart, lines, roof: !!d.roof, skipLines: "" };
    if (d.useUnits && hos.length) { out.units = uniq(hos).sort((a, b) => Number(a) - Number(b)); out.lines = Math.max(out.lines, ...out.units.map((h) => Number(h) % 100)); }
    return out;
  });
  return {
    dongs,
    rooms: (draft.rooms || []).filter((r) => r.checked && r.name).map((r) => String(r.name).trim()),
    commons: (draft.commons || []).filter((r) => r.checked && r.name).map((r) => String(r.name).trim()),
    file: draft.fileLabel || "도면",
    source: "plan",
    warnings: (draft.warnings || []).map((w) => w.msg || w).filter(Boolean),
  };
}

/** 확인 뒤에만 호출. w를 그 자리에서 바꿈. */
export function applyDraftToWizard(w, imported) {
  if (!w || !imported) return w;
  if (imported.dongs?.length) {
    w.imported = { dongs: imported.dongs, file: imported.file, source: "plan", warnings: imported.warnings || [] };
    w.naming = "file";
  }
  if (imported.rooms?.length) w.rooms = uniq([...(w.rooms || []), ...imported.rooms]);
  if (imported.commons?.length) w.dongCommons = uniq([...(w.dongCommons || []), ...imported.commons]);
  return w;
}

export async function scanFiles(files, { onProgress, signal } = {}) {
  const out = [];
  const list = [...(files || [])];
  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) break;
    const f = list[i];
    const name = f.name || "파일";
    const kind = fileKind(f);
    onProgress?.(i + 1, list.length, name);
    if (kind !== "pdf") { out.push({ file: name, kind, rows: [], error: kind }); continue; }
    try {
      const r = await scanPdf(f, name, { signal, onPage: (p, n) => onProgress?.(i + 1, list.length, `${name} ${p}/${n}쪽`) });
      const rows = (r.rows || []).map(({ pdf, ...rest }) => rest);
      r.doc?.destroy?.();
      out.push({ file: name, kind: "pdf", rows, pages: r.pages });
    } catch (e) {
      out.push({ file: name, kind: "pdf", rows: [], error: e.message || String(e) });
    }
  }
  return out;
}

/** 초안에서 건물 한 줄 추가(미리보기에서) */
export function addBlankDong(draft, name = "") {
  const id = "d" + ((draft.dongs?.length || 0) + 1) + "-" + Date.now().toString(36);
  const d = { id, name: name || "", checked: true, floors: 1, basement: 0, unitStart: 1, lines: 0, hos: [], sources: [], useUnits: false };
  (draft.dongs ||= []).push(d);
  return d;
}
