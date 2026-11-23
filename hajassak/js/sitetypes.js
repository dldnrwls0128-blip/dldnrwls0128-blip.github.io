/** 1.4.1 현장 만들기 마법사: 현장 유형별 기본값 · 동 이름·호수 규칙 · 엑셀/CSV 불러오기·양식. (화면 코드는 app.js) */
import * as M from "./model.js";

/* ---------- 공종 모음(유형별로 이 중에서 미리 골라 둠) ---------- */
const EXTRA_TRADES = [
  { name: "철거", subs: ["내부철거", "폐기물", "보양"] }, { name: "목공", subs: ["가벽", "문틀", "몰딩", "걸레받이"] },
  { name: "경량·석고", subs: ["경량철골", "석고보드", "퍼티"] }, { name: "단열", subs: ["내단열", "외단열", "결로"] },
  { name: "외장", subs: ["외벽마감", "루버", "드라이비트"] }, { name: "지붕", subs: ["기와", "금속지붕", "홈통"] },
  { name: "엘리베이터", subs: ["승강기", "에스컬레이터"] }, { name: "간판·사인", subs: ["간판", "안내사인"] }, { name: "청소", subs: ["준공청소", "입주청소"] },
];
export const TRADE_CATALOG = [...M.DEFAULT_TRADES.filter((t) => t.name !== "기타"), ...EXTRA_TRADES, { name: "기타", subs: [] }];
const pickTrades = (names) => names.map((n) => TRADE_CATALOG.find((t) => t.name === n)).filter(Boolean).map((t) => ({ name: t.name, subs: [...t.subs] }));
const APT_TRADES = M.DEFAULT_TRADES.map((t) => t.name);

/* ---------- 현장 유형 ---------- */
const PARTS = [...M.DEFAULT_PARTS];
export const SITE_TYPES = [
  { id: "apt", ico: "🏢", name: "아파트·공동주택", sub: "여러 동, 층마다 호가 있어요 (101동 1203호)",
    w: { naming: "num", start: 101, count: 5, suffix: "동", floors: 20, basement: 2, lines: 4, unitStart: 1, roof: true, hoRule: "floor100" },
    commons: [...M.DEFAULT_COMMONS], dongCommons: [...M.DEFAULT_DONG_COMMONS], rooms: [...M.DEFAULT_ROOMS], parts: PARTS, trades: APT_TRADES, cats: [...M.CATEGORIES] },
  { id: "officetel", ico: "🏙", name: "오피스텔·주상복합", sub: "A동·B동처럼 이름으로, 층마다 호실이 있어요",
    w: { naming: "alpha", start: 1, count: 2, suffix: "동", floors: 30, basement: 4, lines: 8, unitStart: 1, roof: true, hoRule: "floor100" },
    commons: ["지하주차장", "로비·주출입구", "상가", "커뮤니티", "옥상", "기계/전기실", "단지 외부", "기타"],
    dongCommons: ["계단실", "복도", "EV홀", "피트(PIT)실", "옥상", "지하층", "출입구/로비", "외벽", "기타"],
    rooms: ["현관", "방(거실)", "주방", "욕실", "발코니", "다용도실", "복도", "전체"], parts: PARTS,
    trades: ["철근콘크리트", "방수", "미장", "타일", "도장", "도배", "바닥재", "창호", "가구", "코킹", "수장", "금속", "경량·석고", "설비", "전기", "통신", "소방", "기계", "엘리베이터", "청소", "기타"], cats: [...M.CATEGORIES] },
  { id: "commercial", ico: "🏬", name: "상가·업무시설", sub: "건물 하나, 층별 점포·사무실(호실 수가 층마다 달라도 돼요)",
    w: { naming: "custom", names: "본관", count: 1, suffix: "", floors: 6, basement: 2, lines: 6, unitStart: 1, roof: true, hoRule: "floor100" },
    commons: ["주차장", "옥상", "기계/전기실", "외부·광장", "주출입구", "외벽", "기타"],
    dongCommons: ["계단실", "복도", "EV홀", "화장실", "옥상", "지하층", "출입구/로비", "외벽", "기타"],
    rooms: ["매장·사무실", "로비", "복도", "화장실", "계단실", "EV홀", "창고", "기계실", "전체"], parts: PARTS,
    trades: ["철근콘크리트", "방수", "조적", "미장", "타일", "도장", "바닥재", "창호", "석공사", "코킹", "수장", "경량·석고", "금속", "외장", "설비", "전기", "통신", "소방", "기계", "엘리베이터", "간판·사인", "청소", "기타"],
    cats: ["시공불량", "준공점검", "인수점검", "AS"] },
  { id: "hotel", ico: "🏨", name: "호텔·숙박시설", sub: "객실 번호가 층·호로 이어져요 (1205호 객실)",
    w: { naming: "custom", names: "본관", count: 1, suffix: "", floors: 12, basement: 2, lines: 10, unitStart: 2, roof: true, hoRule: "floor100" },
    commons: ["로비", "주차장", "레스토랑·연회장", "피트니스·스파", "옥상", "기계/전기실", "외부", "기타"],
    dongCommons: ["객실 복도", "계단실", "EV홀", "린넨실", "피트(PIT)실", "옥상", "지하층", "출입구/로비", "외벽", "기타"],
    rooms: ["현관", "침실", "욕실", "화장대·옷장", "발코니", "복도", "전체"], parts: PARTS,
    trades: ["방수", "미장", "타일", "도장", "도배", "바닥재", "창호", "가구", "석공사", "코킹", "수장", "경량·석고", "설비", "전기", "통신", "소방", "기계", "엘리베이터", "청소", "기타"],
    cats: ["시공불량", "오픈 전 점검", "인수점검", "AS"] },
  { id: "house", ico: "🏡", name: "단독·전원주택", sub: "건물 한두 채, 호 번호 없이 층과 방으로",
    w: { naming: "custom", names: "본채", count: 1, suffix: "", floors: 2, basement: 0, lines: 0, unitStart: 1, roof: false, hoRule: "none" },
    commons: ["마당", "담장·대문", "주차장·차고", "옥상", "외벽", "기타"],
    dongCommons: ["계단", "복도", "지하실", "다락", "옥상", "외벽", "지붕", "기타"],
    rooms: ["현관", "거실", "주방", "침실1", "침실2", "침실3", "욕실1", "욕실2", "다용도실", "다락", "계단", "테라스·발코니", "복도", "전체"], parts: PARTS,
    trades: ["철근콘크리트", "방수", "조적", "미장", "단열", "타일", "도장", "도배", "바닥재", "창호", "가구", "석공사", "코킹", "수장", "지붕", "외장", "설비", "전기", "조경", "기타"],
    cats: ["시공불량", "준공점검", "입주자하자", "AS"] },
  { id: "remodel", ico: "🛠", name: "리모델링·인테리어", sub: "집·가게 한 곳, 공간(방)별로 점검",
    w: { naming: "custom", names: "공사 구역", count: 1, suffix: "", floors: 1, basement: 0, lines: 0, unitStart: 1, roof: false, hoRule: "none" },
    commons: ["외부", "공용 복도·계단", "주차장", "기타"],
    dongCommons: ["계단", "복도", "옥상", "외벽", "기타"],
    rooms: ["현관", "거실", "주방", "침실1", "침실2", "욕실1", "욕실2", "다용도실", "발코니", "복도", "전체"], parts: PARTS,
    trades: ["철거", "목공", "경량·석고", "방수", "타일", "도장", "도배", "바닥재", "창호", "가구", "수장", "코킹", "설비", "전기", "청소", "기타"],
    cats: ["시공불량", "중간점검", "준공점검", "AS"] },
  { id: "custom", ico: "✏️", name: "직접 설정", sub: "위 유형이 아니면 — 최소 기본값에서 시작해요",
    w: { naming: "custom", names: "본관", count: 1, suffix: "", floors: 5, basement: 0, lines: 4, unitStart: 1, roof: false, hoRule: "floor100" },
    commons: ["외부", "주차장", "옥상", "기타"], dongCommons: ["계단실", "복도", "옥상", "외벽", "기타"],
    rooms: ["입구", "복도", "계단", "화장실", "기타", "전체"], parts: PARTS,
    trades: ["도장", "설비", "전기", "기타"], cats: ["시공불량", "점검", "AS"] },
];
export const typeOf = (id) => SITE_TYPES.find((t) => t.id === id) || SITE_TYPES[0];

/** 유형을 고르면 마법사 상태를 그 유형의 기본값으로 */
export function wizDefaults(typeId, keep = {}) {
  const t = typeOf(typeId);
  return { name: "", names: "", perFloor: "", skipLines: "", skipFloors: "", ...t.w, type: t.id,
    commons: [...t.commons], dongCommons: [...t.dongCommons], rooms: [...t.rooms], parts: [...t.parts], categories: [...t.cats],
    trades: pickTrades(t.trades), vendors: [], imported: null, ...keep };
}

/* ---------- 동 이름 · 층 · 호수 ---------- */
export const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
const numList = (s) => [...new Set(String(s || "").split(/[,\s]+/).map((x) => x.replace(/층$/, "")).filter((x) => /^\d{1,2}$/.test(x)).map(Number))].filter((n) => n >= 1 && n <= 99).sort((a, b) => a - b);
/** "1:8, 2-3:6, 5~7:4" → { 1:8, 2:6, 3:6, 5:4, … } (층마다 호 수가 다를 때 적은 층만) */
export function parsePerFloor(text) {
  const out = {}; const re = /(\d{1,2})\s*(?:[-~]\s*(\d{1,2}))?\s*층?\s*[:：=]?\s*(\d{1,2})\s*(?:개|호)?/g; let m;
  const s = String(text || "").replace(/\s+(?=\d)/g, " ");
  for (const part of s.split(/[,\n;]+/)) { re.lastIndex = 0; m = re.exec(part.trim()); if (!m) continue; const a = Number(m[1]), b = Number(m[2] || m[1]), n = clamp(m[3], 0, 20); for (let f = Math.min(a, b); f <= Math.max(a, b) && f <= 99; f++) out[f] = n; }
  return out;
}
/** 동 이름 목록: [{ name, floors? }] (사용자가 자유롭게: A동·본관·신관…) */
export function dongSpecs(w) {
  const sfx = String(w.suffix ?? "");
  if (w.naming === "num") { const n = clamp(w.count, 1, 60), st = clamp(w.start, 1, 9999); return Array.from({ length: n }, (_, i) => ({ name: `${st + i}${sfx}` })); }
  if (w.naming === "alpha") { const n = clamp(w.count, 1, 26); return Array.from({ length: n }, (_, i) => ({ name: `${ALPHA[i]}${sfx}` })); }
  const out = []; const seen = new Set();
  for (const raw of String(w.names || "").split(/[,\n]+/)) {
    const t = raw.trim(); if (!t) continue; const m = t.match(/^(.+?)\s*[:：]\s*(\d{1,2})$/);
    const name = (m ? m[1] : t).trim().slice(0, 20); if (!name || seen.has(M.sameKey(name))) continue; seen.add(M.sameKey(name));
    out.push(m ? { name, floors: clamp(m[2], 1, 99) } : { name });
  }
  return out.slice(0, 60);
}
/** 자유 이름이 ‘단지 공용(지하주차장·커뮤니티 등)’으로 읽히면 알려 주기 */
export const nameProblems = (specs) => specs.filter((s) => M.isSiteDongName(s.name)).map((s) => s.name);
export function makeDongsFromSpec(w) {
  if (w.imported?.dongs?.length) return w.imported.dongs.map((d) => ({ id: M.uid("d"), alias: "", roof: false, skipLines: "", ...d }));
  const perFloor = w.hoRule === "perfloor" ? parsePerFloor(w.perFloor) : {};
  const skipF = numList(w.skipFloors);
  return dongSpecs(w).map((sp) => {
    const floors = clamp(sp.floors ?? w.floors, 1, 99), basement = clamp(w.basement, 0, 9);
    const none = w.hoRule === "none"; const lines = none ? 0 : clamp(w.lines, 0, 20); const unitStart = clamp(w.unitStart, 1, floors);
    const num = Number(String(sp.name).replace(/\D/g, "")); const alias = w.naming === "num" ? M.aliasOf(num) : "";
    const d = { id: M.uid("d"), name: sp.name, alias, floors, lines, basement, unitStart, roof: !!w.roof, skipLines: none ? "" : String(w.skipLines || "").replace(/[^\d,\s]/g, "").split(/[,\s]+/).filter(Boolean).join(",") };
    if (skipF.length) d.skipFloors = skipF.filter((f) => f <= floors);
    if (Object.keys(perFloor).length && !none) {
      const sk = new Set(d.skipFloors || []); const units = [];
      for (let f = unitStart; f <= floors; f++) { if (sk.has(f)) continue; const n = f in perFloor ? perFloor[f] : lines; for (let l = 1; l <= n; l++) units.push(String(f * 100 + l)); }
      d.units = units; d.lines = Math.max(0, ...Object.values(perFloor), lines); d.skipLines = "";
    }
    return d;
  });
}
/** 미리보기용 요약 */
export function dongStats(d) {
  const fl = M.floorsOf(d); const per = fl.map((f) => ({ f, u: M.unitsOf(d, f) }));
  const all = per.flatMap((x) => x.u); const nums = all.map(Number).sort((a, b) => a - b);
  return { floors: fl, per, total: all.length, first: nums.length ? String(nums[0]) : "", last: nums.length ? String(nums.at(-1)) : "", ground: Number(d.floors) || 0, basement: Number(d.basement) || 0 };
}

/* ---------- 엑셀/CSV: 동·호 목록 ---------- */
const nk = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
const DONG_SYN = ["동", "동명", "동이름", "건물", "건물명", "building"], HO_SYN = ["호", "호수", "호실", "세대", "객실", "unit", "room"], FLOOR_SYN = ["층", "floor", "층수"];
const V_NAME = ["업체", "업체명", "상호", "협력업체", "회사", "회사명", "vendor"], V_TRADE = ["담당공종", "공종", "담당", "공사종류", "trade"], V_PERSON = ["담당자", "담당자명", "이름", "대표", "소장", "person"], V_PHONE = ["연락처", "전화", "전화번호", "휴대폰", "핸드폰", "phone", "tel"], V_MEMO = ["메모", "비고", "memo"];
const headerHit = (row, syns) => row.findIndex((c) => syns.map(nk).includes(nk(c)));
function findHeader(rows, groups) { let best = { row: -1, score: 0 }; rows.slice(0, 15).forEach((r, i) => { const sc = groups.filter((g) => headerHit(r, g) >= 0).length; if (sc > best.score) best = { row: i, score: sc }; }); return best; }
export const looksDongSheet = (rows) => { const h = findHeader(rows, [DONG_SYN, HO_SYN, FLOOR_SYN]); return h.score >= 1 && (headerHit(rows[h.row], HO_SYN) >= 0 || headerHit(rows[h.row], FLOOR_SYN) >= 0); };
export const looksVendorSheet = (rows) => { const h = findHeader(rows, [V_NAME]); return h.score >= 1; };
const floorKey = (v) => { const s = String(v ?? "").trim().replace(/층$/, ""); let m; if ((m = s.match(/^(?:B|지하|-)\s*(\d{1,2})$/i))) return `B${m[1]}`; if (/^\d{1,2}$/.test(s) && Number(s) >= 1) return String(Number(s)); return ""; };
/** 동·호(·층) 열이 있는 표 → 동 목록. 동 칸이 비면 defaultDong 한 동으로 */
export function parseDongSheet(rows, { defaultDong = "본관" } = {}) {
  const h = findHeader(rows, [DONG_SYN, HO_SYN, FLOOR_SYN]); if (h.row < 0 || h.score < 1) return { dongs: [], rows: 0, skipped: 0, warnings: ["동·호 열을 찾지 못했어요. 첫 줄에 ‘동’, ‘층’, ‘호’ 제목이 있어야 해요."] };
  const head = rows[h.row]; const ci = { d: headerHit(head, DONG_SYN), h: headerHit(head, HO_SYN), f: headerHit(head, FLOOR_SYN) };
  const by = new Map(); let n = 0, skipped = 0; const warnings = [];
  for (const r of rows.slice(h.row + 1)) {
    if (!r.some((c) => String(c ?? "").trim())) continue; n++;
    const dn = ci.d >= 0 ? String(r[ci.d] ?? "").trim() : ""; const name = dn || defaultDong;
    const ho = ci.h >= 0 ? M.normHo(r[ci.h]) : ""; const fl = ci.f >= 0 ? floorKey(r[ci.f]) : "";
    if (!ho && !fl) { skipped++; continue; }
    const e = by.get(name) || { name, hos: new Set(), fl: new Set() }; by.set(name, e); if (ho) e.hos.add(ho); if (fl) e.fl.add(fl);
  }
  const dongs = [];
  for (const e of by.values()) {
    const dg = e.hos.size ? M.deriveDong([...e.hos]) : null;
    const gl = [...e.fl].filter((x) => !x.startsWith("B")).map(Number); const bs = [...e.fl].filter((x) => x.startsWith("B")).map((x) => Number(x.slice(1)));
    const floors = Math.max(dg?.floors || 0, ...gl, 1); const basement = Math.max(0, ...bs);
    const d = { name: e.name.slice(0, 20), alias: "", floors, basement, lines: dg?.lines || 0, unitStart: dg?.unitStart || 1, skipLines: dg?.skipLines || "", roof: false };
    if (dg) d.units = dg.units; if (dg?.dropped?.length) warnings.push(`${d.name}: ${dg.dropped.length}개 호는 층 번호가 떨어져 있어 뺐어요 (${dg.dropped.slice(0, 3).join(", ")}…)`);
    if (/^\d{3}동?$/.test(d.name)) d.alias = M.aliasOf(Number(d.name.replace(/\D/g, "")));
    dongs.push(d);
  }
  if (!dongs.length) warnings.push("읽을 수 있는 호·층이 없어요. 호는 101, 1203처럼 3~4자리 숫자로 적어 주세요.");
  return { dongs, rows: n, skipped, warnings };
}

/* ---------- 엑셀/CSV: 업체 목록 ---------- */
export function parseVendorSheet(rows) {
  const h = findHeader(rows, [V_NAME, V_TRADE, V_PERSON, V_PHONE]); if (h.row < 0 || headerHit(rows[h.row], V_NAME) < 0) return { vendors: [], rows: 0, warnings: ["‘업체명’ 열을 찾지 못했어요. 첫 줄에 ‘업체명’ 제목이 있어야 해요."] };
  const head = rows[h.row]; const ci = { n: headerHit(head, V_NAME), t: headerHit(head, V_TRADE), p: headerHit(head, V_PERSON), ph: headerHit(head, V_PHONE), m: headerHit(head, V_MEMO) };
  const out = []; const seen = new Set(); let n = 0;
  for (const r of rows.slice(h.row + 1)) {
    const name = String(r[ci.n] ?? "").trim(); if (!name) continue; n++;
    const key = M.nameKey(name); if (seen.has(key)) continue; seen.add(key);
    const trades = ci.t >= 0 ? String(r[ci.t] ?? "").split(/[,/·、;\n]+/).map((x) => x.trim()).filter(Boolean) : [];
    out.push({ name: name.slice(0, 30), trades, person: ci.p >= 0 ? String(r[ci.p] ?? "").trim() : "", phone: ci.ph >= 0 ? M.normPhone(String(r[ci.ph] ?? "").split(/[,/;\n]/)[0]) : "", memo: ci.m >= 0 ? String(r[ci.m] ?? "").trim() : "" });
  }
  return { vendors: out, rows: n, warnings: out.length ? [] : ["읽을 수 있는 업체가 없어요."] };
}
/** 마법사 업체 → 저장용 업체 기록(기존 업체와 같은 이름은 건너뜀: 기존 데이터는 안 바꿈) */
export function vendorRecords(list, existing = [], now = new Date().toISOString()) {
  const have = new Set(existing.map((v) => M.nameKey(v.name))); const recs = []; let skipped = 0;
  for (const v of list) {
    if (have.has(M.nameKey(v.name))) { skipped++; continue; } have.add(M.nameKey(v.name));
    const rec = { id: M.uid("v"), name: v.name, person: "", phones: [], trades: [...new Set(v.trades || [])], memo: v.memo || "", createdAt: now };
    M.setContacts(rec, [{ name: v.person || "", role: "", phones: v.phone ? [v.phone] : [] }]); recs.push(rec);
  }
  return { recs, skipped };
}

/* ---------- 양식 파일(예시는 가상 값) ---------- */
export const DONG_TEMPLATE = [["동", "층", "호"], ["A동", 1, 101], ["A동", 1, 102], ["A동", 2, 201], ["A동", 2, 202], ["B동", 1, 101], ["B동", 1, 102], ["B동", 2, 201]];
export const VENDOR_TEMPLATE = [["업체명", "담당 공종", "담당자", "연락처"], ["○○타일(예시)", "타일, 석공사", "김반장", "010-0000-0001"], ["△△도장(예시)", "도장, 도배", "이소장", "010-0000-0002"]];
export async function templateXlsx() {
  const XLSX = await import("../vendor/xlsx/xlsx.mjs");
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet(DONG_TEMPLATE); a["!cols"] = [10, 8, 10].map((wch) => ({ wch }));
  const b = XLSX.utils.aoa_to_sheet(VENDOR_TEMPLATE); b["!cols"] = [20, 22, 12, 16].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, a, "동·호"); XLSX.utils.book_append_sheet(wb, b, "업체");
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
export const templateCsv = (rows) => new Blob(["\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
/** 파일 → 시트별 표 [{ name, rows }] (엑셀은 모든 시트, CSV는 한 장) */
export async function readTables(file) {
  const buf = await file.arrayBuffer(); const XLSX = await import("../vendor/xlsx/xlsx.mjs");
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    let text = new TextDecoder("utf-8").decode(buf); if (text.includes("\uFFFD")) { try { text = new TextDecoder("euc-kr").decode(buf); } catch {} }
    const wb = XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string", raw: true });
    return [{ name: wb.SheetNames[0], rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }) }];
  }
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" }) }));
}
