/* 1.1.0 도면 PDF 자동 읽기 — 브라우저 안에서만(서버 없음). pdf.js(vendor/pdfjs)는 처음 쓸 때만 불러옴.
   쪽마다: 글자(위치 포함) → 도면 종류·동·층·평형 추측 + 실/공용부 이름과 좌표, 고른 쪽만 그림(긴 변 2400px)으로 */
import { cleanSpot, normType } from "./model.js";

/* ---------- 글자 조각 → 낱말 상자(왼쪽 위 원점) ---------- */
export function itemsToWords(items, W, H) {
  const out = [];
  for (const it of items || []) {
    const str = String(it.str || "").replace(/[\u0000-\u001f\ufffd]/g, ""); if (!str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform; const s = Math.hypot(c, d) || it.height || 1;
    if (Math.abs(b) > Math.abs(a) * 0.3 || Math.abs(c) > Math.abs(d) * 0.3) { // 돌린 글자: 통째로
      const len = it.width || s * str.length; const ux = a / (Math.hypot(a, b) || 1), uy = b / (Math.hypot(a, b) || 1);
      const xs = [e, e + ux * len, e - uy * s, e + ux * len - uy * s], ys = [f, f + uy * len, f + ux * s, f + uy * len + ux * s];
      out.push([Math.min(...xs), H - Math.max(...ys), Math.max(...xs), H - Math.min(...ys), str.replace(/\s+/g, "")]); continue;
    }
    const y1 = H - f + 0.07 * s, y0 = y1 - s; const cw = (it.width || s * str.length) / str.length;
    let i = 0;
    for (const m of str.matchAll(/\S+/g)) { const x0 = e + m.index * cw; out.push([x0, y0, x0 + m[0].length * cw, y1, m[0]]); i++; }
  }
  return out;
}
/* 붙어 있는 글자를 낱말로 (extract_rooms.py merge_words 이식) */
const PUNCT = new Set(["+", "-", "·", "/", "(", ")", "[", "]"]);
export function mergeWords(words) {
  const items = words.filter((w) => String(w[4]).trim()).map((w) => w.slice());
  items.sort((p, q) => (p[1] + p[3]) / 2 - (q[1] + q[3]) / 2 || p[0] - q[0]);
  if (!items.length) return [];
  const merged = [items[0].slice()];
  for (const w of items.slice(1)) {
    const last = merged[merged.length - 1];
    const lsz = Math.max(1, last[3] - last[1]), wsz = Math.max(1, w[3] - w[1]), mx = Math.max(lsz, wsz);
    const gap = w[0] - last[2];
    const same = Math.abs((last[1] + last[3]) / 2 - (w[1] + w[3]) / 2) <= 0.45 * mx;
    let close = gap <= 1.35 * mx && gap >= -0.4 * mx;
    const similar = Math.abs(lsz - wsz) / mx <= 0.45;
    if (PUNCT.has(last[4].trim()) || PUNCT.has(w[4].trim())) close = false;
    if (last[4] === w[4] && last[4].length >= 2) close = false;
    if (same && close && similar) { last[2] = Math.max(last[2], w[2]); last[1] = Math.min(last[1], w[1]); last[3] = Math.max(last[3], w[3]); last[4] += w[4]; }
    else merged.push(w.slice());
  }
  return merged;
}

/* ---------- 규칙(extract_rooms.py 이식) ---------- */
const NOTE_RE = /^(1층에만(해당)?|해당|천장|결로방지재.*|상부커텐박스|상부장식물|끝선|해당없음|FL[:±+\-\d.]*|SL[:±+\-\d.]*|GL[:±+\-\d.]*|축척.*|변경후|FILE.*|SHEET.*|DRAWING.*|NAME.*|SCALE.*|DATE.*|PROJECT.*|TEL.*|FAX.*|SEOUL|KOREA|REVISIONS|DESCRIPTION|PLANNING.*|CHECKED|DESIGNED|APPROVED|DRAWN|APPR\.?|NOTE|\d+x\d+|W=\d+|A3:.*|A1:.*)$/i;
const WIN_RE = /^(PW|WD|SD|FSD|AG|ABS|DN|UP|OH|O\.H)-?\d*$/i;
const DIM_RE = /^[+]?\d{3,6}$/;
const ELEV_RE = /^[FSG]L$|^[+\-±]|^\d+\.\d+$/;
const TITLE_RE = /전체평면도|단위세대|평면도|기준층|저층|지상\d+층|지하\d+층|옥탑|배치도|공동주택|신축공사|사업승인|최종|도면명|일련번호|축척|변경후|KEY PLAN|architect/i;
const UNIT_KEEP = /^(거실|주방|식당|주방\/식당|침실\d*|안방|욕실\d*|드레스룸|파우더룸|대피공간|하향식피난구|실외기실|발코니\d*|현관|현관홀|다용도실|다목적실|알파룸|팬트리|ELEV\.?홀|ELEV홀|EV홀|복도|창고|포켓|중문)$/;
const FLOOR_COMMON = /^(계단실|계단|ELEV홀|ELEV\.?홀|EV홀|ELEV|EV|전실|방풍실|복도|PIT|피트|동PIT|집수정.*|필로티|EPS\/?TPS|EPS|TPS|AV\/?PD|제연휀룸|휀룸|계절창고|자전거보관대|지하주차장|주출입구|코어|DA|MDF|창고|펌프실|기계실|전기실|발전기실|저수조)$/i;
const LINE_RE = /^\d{1,2}$/;
const PARK_KEEP = /(기계실|전기실|발전기실|저수조|우수조|빗물|우수처리|정수처리|출입구|램프|경사로|팬룸|휀룸|제연휀룸|옥외계단|외부계단|주차|펌프실|방재실|MDF|EPS|TPS|PIT|피트|조업|하역|경비실|맘스테이션|경로당|용역원실|어린이집|수영장|근린|관리사무|도서관|회의실|\d{3}동|주출입|부출입|탑라이트|TOP.?LIGHT|발전기|물탱크|저수|우수|오수|정화조|재활용|쓰레기|자전거|창고|홀|전실|방풍)/i;
const PARK_SKIP = /전기자동차|주차대수|산정제외|급속|완속|가능|제외|소계|합계|공동주택|지상\d+층|지하\d+층(?!.*평면도)|설치위치|비고|구분/;
const AMENITY_SKIP = /축척|변경후|도면|FILE|SHEET|SCALE|DATE|PROJECT|TEL|FAX|SEOUL|1층에만|해당$|천장|결로|커텐|장식물|끝선|FL:|SL:|GL:|^\d+x\d+$|W=|KEY PLAN|APPROVED|DESIGNED|CHECKED|DRAWN|^NO\.?$|^BY$|^NAME$|^TITLE$|^NOTE$|지정(강마루|바닥|비닐|자기|타일|마감|단열|석재)|모르타르|우레탄|방수|슬림트[렌랜]치|판넬히팅|SLOPE|1\/24|THK\d*|로이복층|도로경계|건축한계|인접대지|지하외벽|보행자|생활도로|\d+M도로|범례|세대수|^세대$|^비고$|경사각|경사도|천천히|학교앞|단면도|입면도|배면도|정면도|확대|지붕SL|지상\d+층SL|^자전거$|^주차장$|^출입구출입구$|여닫이|미서기|미닫이|철재|방화문|^.{1,6}문$/i;
const AMENITY_KEEP = /[가-힣]{2,}|ELEV|PIT|EPS|홀|실$|장$|룸$|탕$|풀$|실내|실외|사무실|도서관|회의|독서|수영|사우나|경로|운동|헬스|골프|맘스테|경비|용역|어린이|돌봄|근린|관리|방재|MDF|로비|화장실|탈의|샤워|주방|식당|창고|기계|전기|발전기|저수|펌프|팬룸|휀|계단|복도|전실|현관|출입|대기|카페|키즈|놀이|조경/;
const FRAG = new Set(["다함께", "테이션", "1/24이상)", "(SLOPE1/24이상)", "장치", "업", "조", "회", "차", "소", "계", "합"]);

export function normName(t) {
  t = String(t || "").trim().replace(/㎡/g, "").replace(/ /g, "").replace(/ELEV\.홀/g, "ELEV홀");
  if (t === "주방식당") t = "주방/식당"; if (t === "EPSTPS") t = "EPS/TPS"; if (t === "AVPD") t = "AV/PD";
  return t;
}
function inTitleBlock(x0, y0, x1, y1, W, H, kind) {
  if (x0 > 0.875 * W) return true;
  if (y0 > 0.9 * H) return true;
  if (y1 < 0.08 * H && kind !== "parking") return true;
  if (kind === "parking" && x0 > 0.67 * W) return true;
  return false;
}
function isNoise(text, sz, kind, y0, H) {
  const t = normName(text); if (!t) return true;
  if (NOTE_RE.test(t) || WIN_RE.test(t) || ELEV_RE.test(t)) return true;
  if (DIM_RE.test(t) && !(kind === "floor" && LINE_RE.test(t) && sz >= 5.5 && sz <= 9.5)) return true;
  if (TITLE_RE.test(t) && kind !== "amenity") {
    if (kind === "floor" && /^\d{3}동$/.test(t)) return true;
    if (kind === "unit") return true;
    if (kind === "floor" && /전체평면도|기준층|지상|지하|옥탑|축척/.test(t)) return true;
    if (kind === "parking" && /전체평면도|축척|주차대수/.test(t)) return true;
  }
  if (kind === "unit" && sz < 5.0) return true;
  if (kind === "parking" && sz < 1.6) return true;
  if (["+", "-", "N", "O", "T", "E", "1", "2"].includes(t) && kind !== "floor") return true;
  if ((t === "1" || t === "2") && y0 > 0.85 * H) return true;
  return false;
}
function keepFloor(t, sz) {
  t = normName(t);
  if (FLOOR_COMMON.test(t)) return t;
  if (LINE_RE.test(t) && sz >= 6 && sz <= 9 && +t >= 1 && +t <= 20) return `${String(+t).padStart(2, "0")}라인`;
  return null;
}
function keepParking(t) {
  t = normName(t);
  if (/^전기자동차/.test(t)) return "전기차 충전구역";
  if (PARK_SKIP.test(t)) return null;
  if (PARK_KEEP.test(t)) return t.replace("(급기)", " (급기)").replace("(배기)", " (배기)").replace(/\s+/g, " ").trim();
  return null;
}
function keepAmenity(t, sz) {
  t = normName(t);
  if (AMENITY_SKIP.test(t) || NOTE_RE.test(t) || WIN_RE.test(t) || DIM_RE.test(t)) return null;
  if (TITLE_RE.test(t) && sz >= 10) return null;
  if (AMENITY_KEEP.test(t) && t.length >= 2 && t.length <= 16 && sz >= 2.5) return t;
  return null;
}
function cleanupName(t) {
  if (!t) return t;
  t = t.replace(/\++$/, "").trim();
  for (let n = 2; n < 8; n++) if (t.length === 2 * n && t.slice(0, n) === t.slice(n)) { t = t.slice(0, n); break; }
  if (FRAG.has(t) || t.startsWith("지정") || t.startsWith("THK")) return "";
  return t;
}
/** 낱말 → 실 이름 + 좌표(0~1). kind: unit 세대 / floor 동 평면 / parking 지하주차장 / amenity 부대시설·배치도 */
export function extractRooms(words, W, H, kind) {
  const ext = kind === "site" ? "amenity" : kind;
  let rooms = [];
  for (const [x0, y0, x1, y1, text] of mergeWords(words)) {
    const sz = y1 - y0;
    if (inTitleBlock(x0, y0, x1, y1, W, H, ext) || isNoise(text, sz, ext, y0, H)) continue;
    let name = null, conf = 0.9;
    if (ext === "unit") { if (UNIT_KEEP.test(normName(text))) { name = normName(text); conf = 0.95; } }
    else if (ext === "floor") { name = keepFloor(text, sz); conf = name?.endsWith("라인") ? 0.9 : 0.88; }
    else if (ext === "parking") { name = keepParking(text); conf = name === "전기차 충전구역" ? 0.8 : 0.85; if (name) name = cleanSpot(name); }
    else if (ext === "amenity") { name = keepAmenity(text, sz); conf = 0.82; }
    name = cleanupName(name); if (!name) continue;
    const x = +(((x0 + x1) / 2) / W).toFixed(4), y = +(((y0 + y1) / 2) / H).toFixed(4);
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    rooms.push({ name, x, y, confidence: conf });
  }
  // 같은 이름이 가까이 있으면 하나만 (전기차 충전구역은 넓게 묶음)
  const out = [];
  for (const r of rooms) { const d = r.name === "전기차 충전구역" ? 0.12 : 0.015; if (!out.some((o) => o.name === r.name && Math.hypot(o.x - r.x, o.y - r.y) < d)) out.push(r); }
  const halls = out.filter((r) => r.name === "ELEV홀" || r.name === "EV홀");
  return out.filter((r) => !(r.name === "ELEV" && halls.some((h) => Math.hypot(r.x - h.x, r.y - h.y) < 0.035)));
}

/* ---------- 도면 종류·동·층·평형 추측 ---------- */
const NO_RE = /^[A-Z]{1,3}\d{1,3}-\d{2,4}(-\d+)?$/;
/** 표제란 후보 글자(오른쪽 표제란의 큰 글씨) */
export function titleCandidates(items, W, H) {
  const tb = [], cap = [];
  for (const it of items || []) {
    const s = String(it.str || "").replace(/[\u0000-\u001f\ufffd]/g, "").trim(); if (!s) continue;
    const sz = Math.hypot(it.transform[2], it.transform[3]); const x = it.transform[4], yTop = H - it.transform[5];
    if (x > 0.875 * W && sz >= 6.5) tb.push(s);
    else if (yTop > 0.9 * H && sz >= 10) cap.push(s);
  }
  return { tb, cap };
}
const JUNK = (s) => NO_RE.test(s) || /KEY\s*PLAN|^변경|^\d+$|^\d{2,3}[A-Z]?(\s+\d{2,3}[A-Z]?)*$|^축척|^SCALE|^\(?A3/i.test(s);
/** 표제란 글자에서 같은 PDF의 모든 쪽에 되풀이되는 글(공사명 등)을 빼고 도면 이름 만들기 */
export function makeTitle(cand, boiler) {
  let parts = cand.tb.filter((s) => !JUNK(s) && !boiler.has(s));
  if (!parts.join("").replace(/[^가-힣A-Za-z]/g, "")) parts = cand.cap.filter((s) => !JUNK(s) && !boiler.has(s) && /[가-힣]/.test(s));
  const no = cand.tb.find((s) => NO_RE.test(s)) || "";
  return { title: [...new Set(parts)].join(" ").replace(/\s+/g, " ").trim().slice(0, 60), no };
}
/** 층 표기: ‘(지하2층,지상1층)’→‘B2,1’, ‘(기준층2~26층,옥탑1)’→‘2-26’, ‘지하1층 전체평면도’→‘B1’ */
export function floorsFrom(t) {
  const s = String(t || "");
  const re = /(?:지하|B)\s*(\d{1,2})\s*층?|(?:지상|기준층)\s*(\d{1,2})\s*층?|(\d{1,2})\s*층/g; const toks = [];
  for (const m of s.matchAll(re)) toks.push({ v: m[1] ? `B${+m[1]}` : String(+(m[2] || m[3])), i: m.index, e: m.index + m[0].length });
  const parts = [];
  for (let k = 0; k < toks.length; k++) {
    const a = toks[k], b = toks[k + 1];
    if (b && /^\s*[~∼\-]\s*$/.test(s.slice(a.e, b.i))) { parts.push(`${a.v}-${b.v}`); k++; } else parts.push(a.v);
  }
  return [...new Set(parts)].join(",");
}
const FACILITY = /주민공동|어린이집|돌봄|맘스테이션|경로당|관리사무소|관리동|도서관|커뮤니티|경비실|문주|근린생활|유치원|피트니스|휘트니스|독서실|노인정|주민회의|게스트/;
const NOT_PLAN = /단면도(?!.*평)|입면도|정면도|배면도|측면도|상세|일람표|면적|산출|개요|목록|위치도|계획도|지침|검토|성능|내역|구조물|지붕|동선|체계|방화구획|MC중심선|방수|단열|결로|안내도|천장|전개도|마감|설계기준|배수판|인동거리|주차설치|창호|건식벽체|벽체|부호|가구|조명|전기설비|부분상세/;
/**
 * 쪽 하나 판단. 반환: { kind: unit|floor|parking|amenity|site|other, title, utype, variant, dongs[], floors, check, why }
 */
export function classifySheet(title, fileName = "", hasText = true) {
  const t = String(title || "").replace(/\s+/g, " "); const f = String(fileName || "");
  const r = { kind: "other", title: t, utype: "", variant: "", dongs: [], floors: "", check: false, why: "" };
  if (!hasText) { r.why = "글자 없음(스캔·그림) — 실 자동 읽기 불가"; return r; }
  if (!t) { r.why = "도면 이름을 못 찾음"; return r; }
  const isPlan = /평면도|평,\s*(입,\s*)?단면도|평,입,단면/.test(t);
  if (/배치도/.test(t) && !/시설물|인동|KEY/.test(t)) { r.kind = "site"; r.check = /단지\s*배치도|지반층\s*배치도|^배치도/.test(t); r.why = "배치도"; return r; }
  const dm = [...t.matchAll(/(\d{2,4})\s*동(?!\s*KEY)/g)].map((m) => m[1] + "동");
  const um = t.match(/(\d{2,3})(?:\.\d+)?\s*㎡?\s*([A-Z]?)\s*㎡?\s*([A-Z]?)\s*(?:㎡|m2)?\s*(?:형|타입|TYPE)/i);
  r.variant = (t.match(/(기본형|확장형|옵션형)/) || [])[1] || "";
  r.floors = floorsFrom(t.replace(/\d{2,4}\s*동/g, " "));
  if (!isPlan || NOT_PLAN.test(t.replace(/평,\s*입,\s*단면도|평,\s*단면도|확대평,입,단면도/g, "평면도"))) { r.why = isPlan ? "평면도 아님(방수·단열 등)" : "평면도 아님"; if (dm.length) r.dongs = [...new Set(dm)]; if (um && !dm.length) r.utype = normType(um[1] + (um[2] || um[3] || "")); return r; }
  if (um && !dm.length && /단위세대|세대|평면/.test(t)) { r.kind = "unit"; r.utype = normType(um[1] + (um[2] || um[3] || "")); r.check = true; r.why = `${r.utype} 세대 평면`; return r; }
  if (dm.length) {
    r.kind = "floor"; r.dongs = [...new Set(dm)];
    const roofOnly = /옥탑/.test(t) && !r.floors.replace(/,?$/, ""); const sub = /제연|휀룸|팬룸|주출입구|확대|지붕/.test(t);
    r.check = !roofOnly && !sub; r.why = roofOnly ? "옥탑층" : sub ? "부분 확대도" : "동 평면"; return r;
  }
  if (/지하\s*\d+\s*층|주차장|B\d\b/.test(t)) {
    r.kind = "parking"; r.check = !/확대|경사로|램프/.test(t) && !!r.floors; r.why = r.check ? "지하주차장 전체" : "지하주차장 부분"; return r;
  }
  r.kind = "amenity"; r.check = FACILITY.test(t) && !/지붕층|옥외계단|팬룸|TOP\s*LIGHT/i.test(t); r.why = r.check ? "부대시설" : "기타 평면";
  if (!r.floors) r.floors = "";
  void f; return r;
}
/** 같은 평형 세대 평면이 여러 장(기본·확장·옵션)이면 하나만 체크: 확장형 > 기본형 > 그 외 */
export function pickUnitVariants(rows) {
  const rank = (v) => (v === "확장형" ? 0 : v === "기본형" ? 1 : v ? 2 : 1);
  const by = new Map();
  for (const r of rows) if (r.info?.kind === "unit" && r.info.check) { const k = r.info.utype; const cur = by.get(k); if (!cur || rank(r.info.variant) < rank(cur.info.variant)) by.set(k, r); }
  for (const r of rows) if (r.info?.kind === "unit" && r.info.check && by.get(r.info.utype) !== r) { r.info.check = false; r.info.why = `${r.info.variant || "다른"} — ${by.get(r.info.utype).info.variant || "다른 장"} 사용`; }
}
export function displayName(info, no) {
  const t = info.title;
  if (info.kind === "unit") return `${info.utype} 세대 평면${info.variant ? `(${info.variant})` : ""}`;
  return (t || no || "도면").slice(0, 40);
}

/* ---------- pdf.js 불러오기·열기 ---------- */
let _lib = null;
export async function loadPdfjs() {
  if (_lib) return _lib;
  const base = new URL("../vendor/pdfjs/", import.meta.url).href;
  const lib = await import(base + "pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
  _lib = { lib, base }; return _lib;
}
/** File/Blob을 통째로 메모리에 올리지 않고 필요한 부분만 읽기(큰 PDF·휴대폰) */
export async function openPdf(blob) {
  const { lib, base } = await loadPdfjs();
  class Range extends lib.PDFDataRangeTransport {
    requestDataRange(begin, end) { blob.slice(begin, end).arrayBuffer().then((b) => this.onDataRange(begin, new Uint8Array(b))).catch(() => {}); }
  }
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
  const range = new Range(blob.size, head);
  const task = lib.getDocument({ range, length: blob.size, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144,
    cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", isEvalSupported: false, verbosity: 0 });
  return task.promise;
}
/** PDF 한 개 훑기: 쪽마다 글자만 읽어 판단(그림은 아직 안 그림). onPage(i, n) 진행 표시 */
export async function scanPdf(blob, fileName, { onPage, signal } = {}) {
  const doc = await openPdf(blob); const n = doc.numPages; const pages = []; const freq = new Map();
  for (let i = 1; i <= n; i++) {
    if (signal?.aborted) break;
    onPage?.(i, n);
    const page = await doc.getPage(i); const vp = page.getViewport({ scale: 1 }); const W = vp.width, H = vp.height;
    const tc = await page.getTextContent(); const items = tc.items.filter((x) => x.str != null);
    const cand = titleCandidates(items, W, H); for (const s of new Set(cand.tb)) freq.set(s, (freq.get(s) || 0) + 1);
    pages.push({ page: i, W, H, cand, words: itemsToWords(items, W, H), nText: items.filter((x) => String(x.str).trim()).length });
    page.cleanup();
  }
  const boiler = new Set(n >= 4 ? [...freq].filter(([, c]) => c >= Math.max(3, n * 0.5)).map(([s]) => s) : []);
  const base = String(fileName).split("/").pop().replace(/\.pdf$/i, "");
  const rows = pages.map((pg) => {
    const { title, no } = makeTitle(pg.cand, boiler);
    const info = classifySheet(title, fileName, pg.nText >= 5);
    const rooms = ["unit", "floor", "parking", "amenity", "site"].includes(info.kind) ? extractRooms(pg.words, pg.W, pg.H, info.kind) : [];
    return { pdf: doc, page: pg.page, file: n > 1 ? `${base}_p${pg.page}` : base, no, info, kind: info.kind === "site" ? "amenity" : info.kind, rooms, nText: pg.nText };
  });
  pickUnitVariants(rows);
  return { doc, rows, pages: n };
}
/** 쪽 하나를 그림으로(긴 변 max px, JPEG). 끝나면 캔버스 메모리 바로 놓아줌 */
export async function renderPage(doc, pageNo, { max = 2400, quality = 0.9 } = {}) {
  const page = await doc.getPage(pageNo); const vp1 = page.getViewport({ scale: 1 });
  const scale = max / Math.max(vp1.width, vp1.height); const vp = page.getViewport({ scale });
  const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext("2d", { alpha: false }); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
  c.width = c.height = 0; page.cleanup();
  return blob;
}
