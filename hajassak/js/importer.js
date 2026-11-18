/** 범용 엑셀/CSV 가져오기: 열 매핑(자동 추정 + 저장), 외부ID 기준 병합(내 수정 유지) */
import { isSiteDongName, siteCommonName, uid, STATUSES, CATEGORIES, SEVERITIES, floorOfHo, findDong, aliasOf, dongNum, normHo, deriveDong, DEFAULT_DONG_COMMONS, normType, unitKey, parseContactText, contactsOf, setContacts, normPhone } from "./model.js";

export const FIELDS = [
  { key: "extId", label: "외부 ID(순번·접수번호)", syn: ["순번", "번호", "접수번호", "id", "no", "하자번호", "관리번호"] },
  { key: "dong", label: "동", req: true, syn: ["동", "동명", "동번호", "building"] },
  { key: "ho", label: "호수", syn: ["호", "호수", "세대", "unit"] },
  { key: "floor", label: "층", syn: ["층", "floor"] },
  { key: "common", label: "공용부(세부위치)", syn: ["공용부", "공용위치", "세부위치", "공용"] },
  { key: "room", label: "실(위치)", syn: ["위치", "실", "실명", "공간", "room"] },
  { key: "part", label: "부위", syn: ["부위", "부위명"] },
  { key: "trade", label: "공종", syn: ["공종", "대공종", "공사종류", "trade"] },
  { key: "subTrade", label: "세부공종", syn: ["세부공종", "소공종", "상세공종"] },
  { key: "type", label: "유형", syn: ["유형", "하자유형", "불량유형", "type"] },
  { key: "content", label: "내용", req: true, syn: ["하자내용", "내용", "상세내용", "불량내용", "description", "비고"] },
  { key: "vendorName", label: "업체", syn: ["시공업체명", "업체", "업체명", "협력업체", "시공사", "담당업체"] },
  { key: "vendorPerson", label: "업체 담당자", syn: ["업체담당자", "현장대리인", "협력업체담당자", "업체담당"] },
  { key: "vendorPhone", label: "업체 연락처", syn: ["업체담당자·연락처", "업체연락처", "업체전화번호", "협력업체연락처", "업체전화", "업체휴대폰"] },
  { key: "status", label: "처리상태", syn: ["처리상태", "상태", "진행상태", "status"] },
  { key: "createdAt", label: "접수일", syn: ["접수일", "등록일", "접수일자", "date"] },
  { key: "due", label: "조치기한", syn: ["조치기한", "기한", "완료예정일", "due"] },
  { key: "category", label: "구분", syn: ["구분", "단계", "접수구분"] },
  { key: "moveIn", label: "입주/키불", syn: ["입주/키불", "입주키불", "키불", "입주구분"] },
  { key: "resvAt", label: "예약일시", syn: ["as예약일시", "예약일시", "입주예약일", "예약일"] },
  { key: "utype", label: "평형(타입)", syn: ["평형", "타입", "주택형", "평형타입", "세대타입", "주택타입"] },
];
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
export function headerSignature(headers) { return headers.map(norm).filter(Boolean).join("|"); }

/** 처음 15행 중 매핑 동의어가 가장 많이 맞는 행을 헤더로 */
export function detectHeaderRow(rows) {
  let best = 0, bestScore = -1;
  const all = new Set(FIELDS.flatMap((f) => f.syn.map(norm)));
  rows.slice(0, 15).forEach((r, i) => {
    const sc = r.filter((c) => all.has(norm(c))).length;
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return best;
}
export function guessMapping(headers) {
  const map = {}; const used = new Set();
  for (const f of FIELDS) {
    for (const syn of f.syn) {
      const i = headers.findIndex((h, j) => !used.has(j) && norm(h) === norm(syn));
      if (i >= 0) { map[f.key] = i; used.add(i); break; }
    }
  }
  return map;
}
const STATUS_WORDS = [
  [/재접수|재요청|반려/, "재접수"], [/확인완료|최종완료|종결|승인/, "확인완료"], [/조치완료|작업완료|처리완료|완료/, "조치완료"],
  [/조치중|작업중|처리중|진행/, "조치중"], [/전달|이관|배정|업체/, "업체전달"], [/미처리|접수|대기|신규/, "접수"],
];
export function mapStatus(s) {
  const v = String(s || "").trim(); if (!v) return "접수";
  if (STATUSES.includes(v)) return v;
  for (const [re, st] of STATUS_WORDS) if (re.test(v)) return st;
  return "접수";
}
export function mapCategory(s, fallback) {
  const v = String(s || "");
  if (CATEGORIES.includes(v)) return v;
  if (/사전|점검/.test(v)) return "사전점검";
  if (/입주|키불|세대/.test(v)) return "입주자하자";
  if (/as|a\/s|사후/i.test(v)) return "AS";
  if (/공사|시공/.test(v)) return "시공불량";
  return fallback;
}
const toDate = (s) => {
  const v = String(s || "").trim(); if (!v) return "";
  const m = v.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // m/d/yy
  if (m2) { const y = m2[3].length === 2 ? "20" + m2[3] : m2[3]; return `${y}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`; }
  return "";
};
export function normDongName(v) {
  const s = String(v ?? "").trim(); if (!s) return "";
  const m = s.match(/(\d{2,4})/);
  return m ? `${Number(m[1])}동` : s.endsWith("동") ? s : s;
}
/** 공용부 낱말 → 표준 세부위치. dong: 동 공용부(동 안), site: 단지 공용 */
const COMMON_RULES = [
  [/계단/, "계단실", "dong"], [/복도|세대\s*현관\s*앞|현관\s*앞|홀\s*복도/, "복도/세대현관 앞", "dong"], [/E\/?V|엘리베이터|엘레베이터|승강기|엘베/i, "EV홀", "dong"],
  [/피트|PIT|덕트\s*실|AD실|PD실/i, "피트(PIT)실", "dong"], [/옥상|지붕|옥탑|RF\b/i, "옥상", "dong"], [/필로티|지하층/, "지하층/필로티", "dong"],
  [/출입구|로비|공동\s*현관|주\s*현관/, "출입구/로비", "dong"], [/외벽|외부\s*벽|외부\s*도장/, "외벽", "dong"],
  [/지하\s*주차|주차장/, "지하주차장", "site"], [/조경|화단|놀이터|산책로|수목/, "조경", "site"], [/기계실|전기실|발전기|펌프실|저수조/, "기계/전기실", "site"],
  [/커뮤니티|부대|경로당|어린이집|관리\s*사무소|관리동|피트니스|독서실/, "부대복리시설", "site"],
];
export function detectCommon(text) { const t = String(text || ""); for (const [re, name, kind] of COMMON_RULES) if (re.test(t)) return { name, kind }; return /공용/.test(t) ? { name: "", kind: "dong" } : null; }
const floorFromText = (t) => { const m = String(t || "").match(/(?:B|지하)\s*(\d)\s*층?|(\d{1,2})\s*(?:층|F\b)/i); return m ? (m[1] ? "B" + m[1] : m[2]) : ""; };
/** 시트 행을 하자 레코드로 */
export function rowsToRecords(rows, headerRow, map, { project, defaultCategory = "입주자하자" }) {
  const out = []; const g = (r, k) => (map[k] == null || map[k] === "" ? "" : String(r[map[k]] ?? "").trim());
  for (const r of rows.slice(headerRow + 1)) {
    if (!r || !r.some((c) => String(c).trim())) continue;
    const dongRaw = g(r, "dong"), content = g(r, "content");
    if (!dongRaw && !content) continue;
    const siteRaw = isSiteDongName(dongRaw); // 1.3.0 동 칸에 ‘지하주차장’·‘B1’·‘부대시설’ 등 → 단지 공용
    let dong = siteRaw ? "" : normDongName(dongRaw);
    const dd = findDong(project, dongNum(dong)); if (dd) dong = dd.name;
    const hoRaw = g(r, "ho"); let ho = normHo(hoRaw); let common = g(r, "common"); let floor = g(r, "floor").replace(/층$/, "");
    // 호 칸이 비었거나 공용 낱말이면 공용부로: 예) 호="12층 계단실" → 12층 · 계단실, 실="EV홀"(호 없음) → EV홀
    const hoIsCommon = hoRaw && detectCommon(hoRaw) && !/^\s*\d{3,4}\s*호?\s*$/.test(hoRaw);
    if (hoIsCommon || (!ho && !common)) {
      const c = detectCommon(common || hoRaw) || (!ho ? detectCommon(`${g(r, "room")} ${g(r, "part")}`) : null);
      if (hoIsCommon) { ho = ""; if (!floor) floor = floorFromText(hoRaw); }
      if (c && !common) { common = c.name || (hoIsCommon ? hoRaw.replace(/\d+\s*층/, "").trim() : ""); if (!common || /^공용$/.test(common)) common = "공용부"; }
    }
    if (siteRaw && !common) { common = siteCommonName(dongRaw); if (!floor) floor = floorFromText(dongRaw); }
    const created = toDate(g(r, "createdAt"));
    out.push({
      extId: g(r, "extId"), dong, ho, floor: floor || floorOfHo(ho), common,
      room: common && g(r, "room") === common ? "" : g(r, "room"), part: g(r, "part"), trade: g(r, "trade"), subTrade: g(r, "subTrade"), type: g(r, "type"),
      content, vendorName: g(r, "vendorName"), vendorPerson: g(r, "vendorPerson"), vendorPhone: g(r, "vendorPhone"), status: mapStatus(g(r, "status")),
      createdAt: created ? new Date(created + "T09:00:00").toISOString() : new Date().toISOString(),
      due: toDate(g(r, "due")), category: mapCategory(g(r, "category"), defaultCategory), stage: g(r, "category"), moveIn: g(r, "moveIn"), resvAt: g(r, "resvAt").replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"), utype: normType(g(r, "utype")),
    });
  }
  return out;
}
/**
 * 병합: 외부ID(없으면 동+호+공종+내용)로 기존 건 찾기.
 * 기존 건에 내 수정(localEdited)이 있으면 상태·업체·기한·메모·사진은 유지하고 원본 필드만 갱신.
 */
export function mergeRecords({ project, existing, records, vendors, addMissingDongs = true, fitDongs = true }) {
  const key = (d) => (d.extId ? "x:" + d.extId : `k:${d.dong}|${d.ho}|${d.trade}|${d.content}`);
  const old = new Map(existing.filter((d) => d.projectId === project.id).map((d) => [key(d), d]));
  const vByName = new Map(vendors.map((v) => [norm(v.name), v]));
  const newVendors = []; const updatedVendors = []; const toPut = [];
  /** 엑셀의 담당자·연락처를 새 업체(또는 담당자가 비어 있던 업체)에 넣기 — 기존 담당자는 건드리지 않음 */
  function addImportedContacts(v) {
    const r = cur; let add = parseContactText(`${r.vendorPerson || ""} ${r.vendorPhone || ""}`.trim());
    if (!add.length && r.vendorPerson) add = [{ name: r.vendorPerson, role: "", phones: [] }];
    if (add.length === 1 && !add[0].name && r.vendorPerson && !/\d{3}/.test(r.vendorPerson)) add[0].name = r.vendorPerson;
    const have = contactsOf(v); const phs = new Set(have.flatMap((c) => c.phones));
    const fresh = add.filter((c) => !c.phones.length ? !have.some((h) => h.name === c.name) : c.phones.some((p) => !phs.has(normPhone(p))));
    if (!fresh.length) return v;
    if (!newVendors.includes(v) && !updatedVendors.includes(v)) { v = structuredClone(v); vByName.set(norm(v.name), v); updatedVendors.push(v); }
    setContacts(v, [...have, ...fresh]); return v;
  }
  let cur = null; const newDongs = new Set();
  let added = 0, updated = 0, kept = 0, same = 0;
  const now = new Date().toISOString();
  for (const r of records) {
    cur = r; let vendorId = "";
    if (r.vendorName) {
      let v = vByName.get(norm(r.vendorName));
      if (!v) { v = { id: uid("v"), name: r.vendorName, person: "", phones: [], trades: r.trade ? [r.trade] : [], memo: "가져오기로 추가", createdAt: now }; vByName.set(norm(v.name), v); newVendors.push(v); }
      else if (r.trade && !v.trades.includes(r.trade) && newVendors.includes(v)) v.trades.push(r.trade);
      if ((r.vendorPerson || r.vendorPhone) && (newVendors.includes(v) || !contactsOf(v).length || updatedVendors.includes(v))) v = addImportedContacts(v);
      vendorId = v.id;
    }
    if (r.dong && !findDong(project, dongNum(r.dong))) newDongs.add(r.dong);
    const src = { dong: r.dong, ho: r.ho, floor: r.floor, common: r.common || "", room: r.room, part: r.part, trade: r.trade, subTrade: r.subTrade, type: r.type, content: r.content, category: r.category };
    const o = old.get(key(r));
    // 1.3.0 작업지시서용 원본 칸(단계·입주/키불·예약일시): 있으면 넣되, 이것만으로는 ‘바뀜’으로 치지 않음(재가져오기 때 쓰기 폭증 방지)
    const extra = Object.fromEntries([["stage", r.stage], ["moveIn", r.moveIn], ["resvAt", r.resvAt]].filter(([, v]) => v));
    if (!o) {
      toPut.push({ id: uid("h"), projectId: project.id, extId: r.extId, ...src, ...extra, severity: "보통", vendorId, status: r.status, due: r.due,
        memo: "", createdAt: r.createdAt, updatedAt: now, origin: "import", history: [{ at: now, status: r.status, note: "엑셀 가져오기" }] });
      added++; continue;
    }
    const changed = Object.keys(src).some((k) => (o[k] || "") !== (src[k] || "")) || (!o.localEdited && (o.status !== r.status || (o.vendorId || "") !== vendorId || (o.due || "") !== (r.due || "")));
    if (!changed) { same++; continue; }
    const next = { ...o, ...src, ...extra, updatedAt: now };
    if (o.localEdited) kept++;
    else {
      if (o.status !== r.status) next.history = [...(o.history || []), { at: now, status: r.status, note: "엑셀 갱신" }];
      Object.assign(next, { status: r.status, vendorId: vendorId || o.vendorId, due: r.due || o.due });
    }
    toPut.push(next); updated++;
  }
  if (addMissingDongs && newDongs.size) {
    const sorted = [...newDongs].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
    for (const name of sorted) {
      const num = Number(dongNum(name));
      const dv = deriveDong(records.filter((r) => r.dong === name).map((r) => r.ho));
      if (dv) { const cells = (dv.floors - dv.unitStart + 1) * (dv.lines - (dv.skipLines ? dv.skipLines.split(",").length : 0)); if (dv.units.length < 0.7 * cells) delete dv.units; }
      project.dongs.push({ id: uid("d"), name, alias: Number.isFinite(num) ? aliasOf(num) : "", floors: 15, lines: 4, basement: 2, unitStart: 1, roof: true, skipLines: "", ...(dv || {}) }); delete project.dongs.at(-1).dropped;
    }
  }
  // 평형 열이 있으면 세대(동|호) → 평형 기억: 도면의 평형별 실 목록·평면도 고르기에 사용
  for (const r of records) { if (!r.utype || !r.dong || !r.ho) continue; project.unitTypes = project.unitTypes || {}; project.unitTypes[unitKey(r.dong, r.ho)] = r.utype; }
  // 가져온 공용부 이름을 현장 목록에 추가(동 있는 건 → 동 공용부, 동 없는 건 → 단지 공용)
  if (!Array.isArray(project.dongCommons)) project.dongCommons = [...DEFAULT_DONG_COMMONS];
  if (!Array.isArray(project.commons)) project.commons = [];
  for (const r of records) {
    if (!r.common) continue;
    const arr = r.dong ? project.dongCommons : project.commons;
    if (!arr.includes(r.common) && !(r.dong ? project.commons : project.dongCommons).includes(r.common)) arr.push(r.common);
  }
  // 동 구조를 실제 데이터(이번 파일 + 이 현장의 기존 하자)에서 찾은 층·세대로 맞춤 → 없는 층/세대(예: 27층 이상, 1층 필로티) 자동 제거
  const fitted = [];
  if (fitDongs) {
    const inFile = new Set(records.map((r) => r.dong).filter(Boolean));
    for (const d of project.dongs) {
      if (!inFile.has(d.name)) continue;
      const hos = [...records.filter((r) => r.dong === d.name).map((r) => r.ho), ...existing.filter((x) => x.projectId === project.id && x.dong === d.name).map((x) => x.ho)];
      const dv = deriveDong(hos); if (!dv) continue;
      const before = { floors: d.floors, unitStart: d.unitStart || 1, count: (Array.isArray(d.units) && d.units.length) ? d.units.length : null };
      const { dropped, ...st } = dv;
      // 데이터가 세대를 거의 다 덮으면(층×라인 칸의 70% 이상) 실제 세대 그대로, 듬성듬성한 부분 엑셀이면 기존 구조를 줄이지 않고 넓히기만
      const cells = (st.floors - st.unitStart + 1) * (st.lines - (st.skipLines ? st.skipLines.split(",").length : 0));
      const full = st.units.length >= 0.7 * cells;
      if (full) Object.assign(d, st);
      else {
        Object.assign(d, { floors: Math.max(d.floors || 0, st.floors), unitStart: Math.min(d.unitStart || 1, st.unitStart), lines: Math.max(d.lines || 0, st.lines) });
        if (Array.isArray(d.units)) d.units = [...new Set([...d.units, ...st.units])].sort((a, b) => a - b);
        continue;
      }
      fitted.push({ name: d.name, unitStart: dv.unitStart, floors: dv.floors, floorCount: new Set(dv.units.map((h) => Math.floor(h / 100))).size, units: dv.units.length, lines: dv.lines, dropped, before });
    }
  }
  return { toPut, newVendors, updatedVendors, newDongs: [...newDongs], fitted, stats: { added, updated, kept, same, total: records.length } };
}

export async function parseFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    // CSV는 UTF-8(BOM) 우선, 깨지면 EUC-KR
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) { try { text = new TextDecoder("euc-kr").decode(buf); } catch {} }
    const XLSX = await import("../vendor/xlsx/xlsx.mjs");
    const wb = XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string", raw: true });
    return { sheets: wb.SheetNames, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }) };
  }
  try {
    return await new Promise((resolve, reject) => {
      const w = new Worker(new URL("./import-worker.js", import.meta.url), { type: "module" });
      const t = setTimeout(() => { w.terminate(); reject(new Error("timeout")); }, 60000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); reject(new Error(e.message || "worker")); };
      w.postMessage({ buf: buf.slice(0) });
    });
  } catch {
    const m = await import("./import-worker.js");
    return m.parseSheet(buf);
  }
}
