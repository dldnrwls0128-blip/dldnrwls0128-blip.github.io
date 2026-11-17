/** 도메인 모델: 기본 목록, 위치 생성, 검색·필터·집계, 전달 문구 */
export const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return todayStr(d); };

export const DEFAULT_TRADES = [
  { name: "철근콘크리트", subs: ["거푸집", "철근", "타설", "면처리"] },
  { name: "방수", subs: ["도막방수", "시트방수", "우레탄", "액체방수"] },
  { name: "조적", subs: ["벽돌", "블록", "ALC"] },
  { name: "미장", subs: ["바닥미장", "벽미장", "방통"] },
  { name: "타일", subs: ["벽타일", "바닥타일", "아트월", "줄눈"] },
  { name: "도장", subs: ["내부도장", "외부도장", "탄성코트", "에폭시"] },
  { name: "도배", subs: ["벽지", "천장지", "초배"] },
  { name: "바닥재", subs: ["마루", "장판", "걸레받이"] },
  { name: "창호", subs: ["PL창호", "AL창호", "방화문", "현관문", "유리"] },
  { name: "가구", subs: ["주방가구", "붙박이장", "신발장", "욕실장"] },
  { name: "석공사", subs: ["창대석", "주방상판", "현관디딤판", "외벽석재"] },
  { name: "코킹", subs: ["실리콘", "외부코킹"] },
  { name: "수장", subs: ["몰딩", "문틀·문짝", "중문", "천장"] },
  { name: "금속", subs: ["난간", "점검구", "코너비드"] },
  { name: "설비", subs: ["위생기구", "수전", "배관", "배수", "환기"] },
  { name: "전기", subs: ["조명", "콘센트·스위치", "분전반", "월패드"] },
  { name: "통신", subs: ["단자함", "인터폰", "CCTV"] },
  { name: "소방", subs: ["스프링클러", "감지기", "소화전"] },
  { name: "기계", subs: ["보일러", "에어컨", "환기장치"] },
  { name: "조경", subs: ["식재", "포장", "시설물"] },
  { name: "기타", subs: [] },
];
export const DEFAULT_TYPES = ["미시공", "파손", "들뜸", "틈새", "오염", "흠집/찍힘", "도장불량", "수직수평불량",
  "코킹불량", "누수", "균열", "이음불량", "이색/변색", "줄눈불량", "고정불량", "단차", "작동불량", "기타"];
export const DEFAULT_ROOMS = ["현관", "거실", "주방", "침실1", "침실2", "침실3", "드레스룸", "욕실1", "욕실2",
  "다용도실", "발코니", "실외기실", "복도", "전체"];
export const DEFAULT_PARTS = ["바닥", "벽", "천장", "문", "창", "가구", "기구", "기타"];
/** 단지 공용(동 없이): 새 현장 기본값. 예전 현장은 저장된 목록 그대로 */
export const DEFAULT_COMMONS = ["지하주차장", "부대복리시설", "조경", "기계/전기실", "주출입구", "관리동", "단지 외부", "기타"];
/** 동별 공용부(동 + 선택 층 + 세부위치): 예) 301동 12층 계단실 */
export const DEFAULT_DONG_COMMONS = ["계단실", "복도/세대현관 앞", "EV홀", "피트(PIT)실", "옥상", "지하층/필로티", "출입구/로비", "외벽", "기타"];
export const dongCommonsOf = (p) => (Array.isArray(p?.dongCommons) ? p.dongCommons : DEFAULT_DONG_COMMONS);
/** 동 공용부 하자: 동이 있고 호가 없으며 공용부(세부위치)가 있는 건 */
export const isDongCommon = (d) => !!(d.dong && !d.ho && d.common);
export const CATEGORIES = ["시공불량", "사전점검", "입주자하자", "AS"];
/** 현장별 구분 목록(직접 추가 포함). 예전 현장은 기본 4개 */
export const catsOf = (p) => (Array.isArray(p?.categories) && p.categories.length ? p.categories : CATEGORIES);
/** 기본 제공 목록(직접 추가 항목 판별용) */
export const defaultsOf = (k) => ({ commons: [...DEFAULT_COMMONS, "코어(계단·EV홀)", "옥상", "외벽", "커뮤니티"], dongCommons: DEFAULT_DONG_COMMONS, types: DEFAULT_TYPES, rooms: DEFAULT_ROOMS, parts: DEFAULT_PARTS, categories: CATEGORIES, trades: DEFAULT_TRADES.map((t) => t.name) }[k] || []);
/** 목록 중복 검사용 키(공백·대소문자 무시) */
export const sameKey = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
export const hasSame = (arr, v, except = null) => arr.some((x) => x !== except && sameKey(x) === sameKey(v));
export const CATEGORY_HINT = { 시공불량: "공사 중", 사전점검: "입주 전", 입주자하자: "입주 후", AS: "사후" };
export const SEVERITIES = ["긴급", "보통", "경미"];
export const STATUSES = ["접수", "업체전달", "조치중", "조치완료", "확인완료", "재접수"];
export const OPEN_STATUSES = new Set(["접수", "업체전달", "조치중", "재접수"]);
export const STATUS_CLS = { 접수: "s0", 업체전달: "s1", 조치중: "s2", 조치완료: "s3", 확인완료: "s4", 재접수: "s5" };
/** 다음 단계(주 흐름) */
export const NEXT = { 접수: "업체전달", 업체전달: "조치중", 조치중: "조치완료", 재접수: "업체전달", 조치완료: "확인완료" };

export const isOpen = (d) => OPEN_STATUSES.has(d.status);
export const isOverdue = (d, today = todayStr()) => !!d.due && d.due < today && d.status !== "조치완료" && d.status !== "확인완료";
export const ageDays = (d, now = Date.now()) => Math.max(0, Math.floor((now - new Date(d.createdAt).getTime()) / 864e5));

/* ---------- 현장 구조 ---------- */
export function floorsOf(dong) {
  const out = [];
  for (let b = dong.basement || 0; b >= 1; b--) out.push(`B${b}`);
  for (let f = 1; f <= (dong.floors || 0); f++) out.push(String(f));
  if (dong.roof) out.push("옥상");
  for (const x of dong.extraFloors || []) if (!out.includes(x)) out.push(x); // 위치 선택기에서 직접 추가한 층
  return out.sort((a, b) => floorRank(a) - floorRank(b));
}
/** 층 정렬 순위: B9…B1 < 1…99 < 옥상 */
export const floorRank = (f) => (/^B(\d+)$/.test(f) ? -Number(f.slice(1)) : f === "옥상" ? 1000 : Number(f) || 0);
/** 층 입력 정규화: "지하3"·"b3"·"B3층" → "B3", "27층" → "27", "옥상"/"RF"/"지붕" → "옥상". 잘못된 값이면 "" */
export function normFloor(v) {
  const s = String(v ?? "").trim().replace(/\s+/g, "").replace(/층$/, "").toUpperCase();
  if (!s) return "";
  if (/^(옥상|RF|ROOF|지붕)$/.test(s)) return "옥상";
  let m = s.match(/^(?:B|지하|-)(\d{1,2})$/); if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 9 ? `B${Number(m[1])}` : "";
  m = s.match(/^(?:지상)?(\d{1,2})$/); if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 99 ? String(Number(m[1])) : "";
  return "";
}
export const floorLabel = (f) => (!f ? "" : /^B\d/.test(f) || f === "옥상" ? f : `${f}층`);
/** 층별 호수: 1~N호 라인, 호 = 층*100+라인 (startFloor 미만은 세대 없음: 필로티 등).
 *  dong.units(엑셀 데이터에서 찾은 실제 세대 목록)가 있으면 그 세대만 */
export function unitsOf(dong, floor) {
  const base = baseUnitsOf(dong, floor);
  const ex = (dong.extraUnits || []).filter((h) => floorOfHo(h) === String(floor) && !base.includes(h));
  return ex.length ? [...base, ...ex].sort((a, b) => Number(a) - Number(b)) : base;
}
function baseUnitsOf(dong, floor) {
  const f = Number(floor);
  if (!Number.isFinite(f) || f < (dong.unitStart || 1) || f > (dong.floors || 0)) return [];
  if (Array.isArray(dong.units) && dong.units.length) return dong.units.filter((h) => Math.floor(Number(h) / 100) === f).sort((a, b) => a - b);
  const skip = new Set(String(dong.skipLines || "").split(/[,\s]+/).filter(Boolean).map(Number));
  const out = [];
  for (let l = 1; l <= (dong.lines || 0); l++) if (!skip.has(l)) out.push(String(f * 100 + l));
  return out;
}
/** 호수 정규화: "0901"·"901호"·"309-901"·"309동 901호" → "901". 층 1~99, 라인 1~20 밖이면 "" (오인식 방지: 9010, 90101 등) */
export function normHo(v) {
  const s = String(v ?? "").trim(); if (!s) return "";
  const groups = s.match(/\d+/g); if (!groups) return "";
  let t = groups[groups.length - 1];
  if (/^\d{6,}$/.test(t) && groups.length === 1) t = t.slice(-4); // 3090901 → 0901 (동+호 붙은 값). 5자리는 모호 → 버림
  if (!/^\d{3,4}$/.test(t)) return "";
  const n = Number(t), f = Math.floor(n / 100), l = n % 100;
  return f >= 1 && f <= 99 && l >= 1 && l <= 20 ? String(n) : "";
}
/** 실제 호수 목록 → 동 구조(층 범위·라인·없는 라인·세대 목록) */
export function deriveDong(hos) {
  let us = [...new Set(hos.map(normHo).filter(Boolean))].map(Number).sort((a, b) => a - b);
  if (!us.length) return null;
  // 오입력 방지: 층이 3개 층 이상 끊긴 덩어리 중 세대가 가장 많은 덩어리만 사용 (예: 9010 → 90층 같은 유령 층 제외)
  const cnt = new Map(); for (const h of us) { const f = Math.floor(h / 100); cnt.set(f, (cnt.get(f) || 0) + 1); }
  const fs = [...cnt.keys()].sort((a, b) => a - b); const groups = [[fs[0]]];
  for (let i = 1; i < fs.length; i++) { if (fs[i] - fs[i - 1] > 3) groups.push([]); groups.at(-1).push(fs[i]); }
  const best = groups.reduce((a, g) => (g.reduce((s, f) => s + cnt.get(f), 0) > a.reduce((s, f) => s + cnt.get(f), 0) ? g : a));
  const keep = new Set(best); const dropped = us.filter((h) => !keep.has(Math.floor(h / 100)));
  us = us.filter((h) => keep.has(Math.floor(h / 100)));
  const fl = us.map((h) => Math.floor(h / 100)), ln = us.map((h) => h % 100);
  const lines = Math.max(...ln); const seen = new Set(ln);
  const skip = []; for (let l = 1; l <= lines; l++) if (!seen.has(l)) skip.push(l);
  return { floors: Math.max(...fl), unitStart: Math.min(...fl), lines, skipLines: skip.join(","), units: us.map(String), dropped: dropped.map(String) };
}
/** 동의 실제 세대 라인 번호(그리드 열) */
export function linesOf(dong) {
  if (Array.isArray(dong.units) && dong.units.length) return [...new Set(dong.units.map((h) => Number(h) % 100))].sort((a, b) => a - b);
  const skip = new Set(String(dong.skipLines || "").split(/[,\s]+/).filter(Boolean).map(Number));
  const out = []; for (let l = 1; l <= (dong.lines || 0); l++) if (!skip.has(l)) out.push(l); return out;
}
export const floorOfHo = (ho) => { const n = Number(ho); return Number.isFinite(n) && n >= 100 ? String(Math.floor(n / 100)) : ""; };
export function makeDongs({ start = 101, count = 5, floors = 20, lines = 4, basement = 2, unitStart = 1, step = 1 }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const num = start + i * step;
    out.push({ id: uid("d"), name: `${num}동`, alias: aliasOf(num), floors, lines, basement, unitStart, roof: true, skipLines: "" });
  }
  return out;
}
/** 101 → "1", 109 → "9", 112 → "12", 1203 → "3" (백 단위 이하) */
export const aliasOf = (num) => { const n = Number(num); return Number.isFinite(n) && n >= 100 ? String(n % 100) : ""; };
export function newProject(name = "새 현장") {
  return {
    id: uid("p"), name, createdAt: new Date().toISOString(),
    dongs: [], commons: [...DEFAULT_COMMONS], dongCommons: [...DEFAULT_DONG_COMMONS],
    trades: DEFAULT_TRADES.map((t) => ({ name: t.name, subs: [...t.subs] })),
    types: [...DEFAULT_TYPES], rooms: [...DEFAULT_ROOMS], parts: [...DEFAULT_PARTS], categories: [...CATEGORIES],
    dueDays: 7,
  };
}
export const dongNum = (name) => String(name || "").replace(/동$/, "");
export const findDong = (p, q) => {
  if (!p || q == null) return null;
  const s = String(q).trim().replace(/동$/, "");
  return p.dongs.find((d) => dongNum(d.name) === s) || p.dongs.find((d) => d.alias && d.alias === s) || null;
};

/* ---------- 빠른 검색: "9동 1203", "109-1203", "109동", "1203" ---------- */
export function parseQuery(p, q) {
  const s = String(q || "").trim();
  if (!s) return {};
  let m = s.match(/^(\S+?)\s*(?:동)?\s*[-\s]\s*(\d{3,4})\s*(?:호)?$/) || s.match(/^(\S+?)동\s*(\d{3,4})\s*호?$/);
  if (m) { const d = findDong(p, m[1]); if (d) return { dong: d.name, ho: m[2] }; }
  m = s.match(/^(\S+?)동?$/);
  if (m) {
    const d = findDong(p, m[1]);
    if (d && (/동$/.test(s) || p.dongs.some((x) => dongNum(x.name) === m[1]))) return { dong: d.name };
    if (d && /^\d{1,2}$/.test(m[1])) return { dong: d.name };
  }
  if (/^\d{3,4}호?$/.test(s)) return { ho: s.replace(/호$/, "") };
  return { text: s };
}

/* ---------- 필터 ---------- */
export function applyFilter(list, f = {}, ctx = {}) {
  const today = todayStr();
  const text = (f.text || "").trim().toLowerCase();
  return list.filter((d) => {
    if (f.dong && d.dong !== f.dong) return false;
    if (f.ho && d.ho !== f.ho) return false;
    if (f.common && (f.common === "_any" ? d.ho : f.common === "_bare" ? d.ho || d.common : d.common !== f.common)) return false;
    if (f.floor && (f.floor === "_none" ? d.floor || d.ho : (d.floor || floorOfHo(d.ho)) !== f.floor)) return false;
    if (f.trade && d.trade !== f.trade) return false;
    if (f.turn && !isTurnOf(d, f.turn)) return false;
    if (f.chain && !hasSteps(d)) return false;
    if (f.mine && !isMyTurn(d)) return false;
    if (f.vendorId && (f.vendorId === "_none" ? d.vendorId : d.vendorId !== f.vendorId)) return false;
    if (f.type && d.type !== f.type) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.severity && d.severity !== f.severity) return false;
    if (f.status === "_open" ? !isOpen(d) : f.status === "_done" ? !(d.status === "조치완료" || d.status === "확인완료") : f.status && d.status !== f.status) return false;
    if (f.overdue && !isOverdue(d, today)) return false;
    if (text) {
      const hay = `${d.dong} ${d.ho} ${d.floor ? floorLabel(d.floor) : ""} ${d.common || ""} ${d.locEtc || ""} ${d.room} ${d.part} ${d.trade} ${d.subTrade} ${(d.steps || []).map((x) => x.trade).join(" ")} ${d.type} ${d.content} ${ctx.vendorName?.(d) || ""} ${d.memo || ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
export const filterCount = (f) => ["dong", "ho", "common", "floor", "trade", "turn", "chain", "vendorId", "type", "category", "severity", "status", "overdue", "text"].filter((k) => f[k]).length;

export function countBy(list, key) {
  const m = new Map();
  for (const d of list) { const k = typeof key === "function" ? key(d) : d[key]; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
/** 세대 보기: 공종·업체별 묶음 */
export function groupByTradeVendor(list, vendorName) {
  const m = new Map();
  for (const d of list) {
    const k = `${d.trade || "미지정"}|${d.vendorId || ""}`;
    if (!m.has(k)) m.set(k, { trade: d.trade || "미지정", vendorId: d.vendorId || "", vendor: vendorName(d) || "업체 미지정", items: [] });
    m.get(k).items.push(d);
  }
  return [...m.values()].sort((a, b) => b.items.filter(isOpen).length - a.items.filter(isOpen).length || a.trade.localeCompare(b.trade, "ko"));
}
export const sortDefects = (a, b) =>
  (a.dong || "").localeCompare(b.dong || "", "ko", { numeric: true }) ||
  (Number(a.ho) || 0) - (Number(b.ho) || 0) || (a.trade || "").localeCompare(b.trade || "", "ko") || (a.createdAt < b.createdAt ? -1 : 1);

export const locText = (d) => [d.dong, d.ho ? `${d.ho}호` : floorLabel(d.floor), d.common, d.room, d.part, d.locEtc].filter(Boolean).join(" ");
export const tradeText = (d) => [d.trade, d.subTrade].filter(Boolean).join("/");

/** 업체 전달 문구(카톡·문자) */
export function shareMessage({ project, vendor, items, appName = "하자싹" }) {
  const head = `[${project?.name || "현장"}] ${vendor ? vendor.name + " " : ""}하자 조치 요청 ${items.length}건`;
  const byLoc = new Map();
  for (const d of [...items].sort(sortDefects)) {
    const k = [d.dong, d.ho ? d.ho + "호" : [floorLabel(d.floor), d.common].filter(Boolean).join(" ")].filter(Boolean).join(" ") || "위치 미지정";
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k).push(d);
  }
  const lines = [head];
  for (const [loc, arr] of byLoc) {
    lines.push("", `■ ${loc}`);
    for (const d of arr) {
      const where = [d.room, d.part, d.locEtc].filter(Boolean).join(" ");
      lines.push(`- ${where ? where + " · " : ""}${tradeText(d)} ${d.type ? "[" + d.type + "]" : ""} ${d.content || ""}`.replace(/\s+/g, " ").trim() +
        (d.due ? ` (기한 ${d.due.slice(5).replace("-", "/")})` : "") + (d.severity === "긴급" ? " ⚠긴급" : ""));
    }
  }
  lines.push("", `조치 후 사진 회신 부탁드립니다. — ${appName}`);
  return lines.join("\n");
}
export const telHref = (phone) => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;
/** 안드로이드 기본 문자앱: sms:번호?body=… (본문은 URL 인코딩) */
export const smsHref = (phone, body) => `sms:${String(phone || "").replace(/[^\d+]/g, "")}?body=${encodeURIComponent(body)}`;
export const normPhone = (s) => {
  const d = String(s || "").replace(/[^\d]/g, "").replace(/^82(?=1)/, "0");
  if (/^01\d{8,9}$/.test(d)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^02\d{7,8}$/.test(d)) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  if (/^0\d{9,10}$/.test(d)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return String(s || "").trim();
};
/** 공종으로 담당업체 추천 */
export function suggestVendor(vendors, trade, projectId) {
  if (!trade) return null;
  const c = vendors.filter((v) => (v.trades || []).includes(trade));
  return c.find((v) => !v.projectIds?.length || v.projectIds.includes(projectId)) || c[0] || null;
}
/** 도면 매칭: plan.dongs(빈 배열=전체), plan.floors "3-25, B1" */
export function planMatches(plan, dong, floor) {
  if (plan.dongs?.length && !plan.dongs.includes(dong)) return false;
  const spec = String(plan.floors || "").trim();
  if (!spec) return true;
  const fNum = /^B(\d+)$/.test(floor) ? -Number(floor.slice(1)) : Number(floor);
  return spec.split(/[,\s]+/).filter(Boolean).some((part) => {
    if (part === floor) return true;
    const m = part.match(/^(B?\d+)\s*[-~]\s*(B?\d+)$/);
    if (!m || !Number.isFinite(fNum)) return false;
    const v = (x) => (x.startsWith("B") ? -Number(x.slice(1)) : Number(x));
    return fNum >= Math.min(v(m[1]), v(m[2])) && fNum <= Math.max(v(m[1]), v(m[2]));
  });
}

/* ---------- 동현황 색 기준(현장별 설정: project.heat) ---------- */
export const HEAT_DEFAULT = { mode: "auto", basis: "open", low: 3, high: 10 };
export const heatCfg = (p) => ({ ...HEAT_DEFAULT, ...(p?.heat || {}) });
/** 세대 하자 수(기준: open=미조치만, all=전체) — ho가 있는 건만 */
export function unitCounts(defects, basis = "open") {
  const by = new Map();
  for (const d of defects) { if (!d.ho || !d.dong) continue; if (basis === "open" && !isOpen(d)) continue; const k = d.dong + "|" + d.ho; by.set(k, (by.get(k) || 0) + 1); }
  return [...by.values()];
}
const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
/** 자동 기준: 하자가 있는 세대 수 분포의 하위 1/3 → 적음 상한, 상위 20% → 많음 하한 */
export function autoThresholds(counts) {
  const s = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return { low: 2, high: 5 };
  let low = Math.max(1, quant(s, 1 / 3)); let high = Math.max(low + 1, quant(s, 0.8));
  if (high <= low) high = low + 1;
  return { low, high };
}
/** 실제 적용 기준 {low, high, basis, mode} */
export function heatThresholds(p, defects) {
  const c = heatCfg(p);
  if (c.mode === "auto") return { ...autoThresholds(unitCounts(defects, c.basis)), basis: c.basis, mode: "auto" };
  return { low: c.low, high: c.high, basis: c.basis, mode: "manual" };
}
export function validHeat(low, high) {
  if (!Number.isInteger(low) || !Number.isInteger(high)) return "숫자를 입력해 주세요";
  if (low < 1) return "적음 기준은 1건 이상이어야 해요";
  if (high <= low) return "많음 기준은 적음 기준보다 커야 해요";
  if (high > 999) return "많음 기준이 너무 커요";
  return "";
}
/** 0=없음, 1=적음(1~low), 2=보통(low+1~high-1), 3=많음(high 이상) */
export const heatLevel = (n, t) => (!n ? 0 : n >= t.high ? 3 : n <= t.low ? 1 : 2);
export function heatLegend(t) {
  const out = [{ lv: 0, label: "없음 0" }, { lv: 1, label: `적음 ${t.low > 1 ? "1~" + t.low : "1"}` }];
  if (t.high - 1 >= t.low + 1) out.push({ lv: 2, label: `보통 ${t.high - 1 > t.low + 1 ? `${t.low + 1}~${t.high - 1}` : t.low + 1}` });
  out.push({ lv: 3, label: `많음 ${t.high}+` });
  return out;
}
export const heatLegendText = (t) => heatLegend(t).filter((x) => x.lv).map((x) => x.label).join(" · ");

/* ---------- 1.0.8 후속 공정(공정 단계) ---------- */
/** 한 하자를 여러 공종이 차례로 고치는 경우(예: 석고보드 교체 → 도배). d.steps = [{id, trade, vendorId, status, due, sentAt, doneAt, own}] */
export const STEP_STATUSES = ["대기", "전달", "조치중", "완료"];
export const STEP_CLS = { 대기: "s0", 전달: "s1", 조치중: "s2", 완료: "s3" };
export const DEFAULT_STEP_TEMPLATES = [
  { name: "도배 찢김", steps: ["석고보드 교체", "도배"] },
  { name: "바닥 파손", steps: ["미장", "마루"] },
  { name: "누수", steps: ["방수", "석고보드", "도배"] },
];
export const stepTemplatesOf = (p) => (Array.isArray(p?.stepTemplates) ? p.stepTemplates : DEFAULT_STEP_TEMPLATES);
export const hasSteps = (d) => Array.isArray(d?.steps) && d.steps.length > 1;
export const stepsDone = (d) => (hasSteps(d) ? d.steps.filter((s) => s.status === "완료").length : 0);
export const curStepIdx = (d) => (hasSteps(d) ? d.steps.findIndex((s) => s.status !== "완료") : -1);
export const curStep = (d) => { const i = curStepIdx(d); return i >= 0 ? d.steps[i] : null; };
export const stepProgress = (d) => (hasSteps(d) ? `${stepsDone(d)}/${d.steps.length} 단계` : "");
export const stepsText = (d) => (hasSteps(d) ? d.steps.map((s) => `${s.trade}(${s.status})`).join(" → ") : "");
/** 지금 차례인 업체(공정이 없으면 하자 업체) */
export const turnVendorId = (d) => (hasSteps(d) ? curStep(d)?.vendorId || "" : d.vendorId || "");
/** 이 업체 차례로 기다리는 미조치 하자 */
/** 내 차례 대기: 앞 공정이 끝나 다음 공정 업체에 보낼 차례(아직 ‘대기’)인 하자 */
export const isMyTurn = (d) => isOpen(d) && hasSteps(d) && curStepIdx(d) > 0 && curStep(d)?.status === "대기";
export const isTurnOf = (d, vid) => isOpen(d) && turnVendorId(d) === vid && (!hasSteps(d) || curStep(d)?.status !== "완료");
/** 이 업체가 뒤 공정에 있어 앞 공정을 기다리는 하자 */
export const isLaterOf = (d, vid) => hasSteps(d) && isOpen(d) && turnVendorId(d) !== vid && d.steps.slice(curStepIdx(d) + 1).some((s) => s.vendorId === vid);
export const templatesText = (list) => list.map((t) => `${t.name}: ${t.steps.join(" → ")}`).join("\n");
export function parseTemplates(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.+)$/); if (!m) continue;
    const steps = m[2].split(/\s*(?:→|->|>|,|·)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (steps.length) out.push({ name: m[1].trim().slice(0, 20), steps });
  }
  return out;
}
/** 다음 공정 업체에 보낼 문구 */
export function stepMessage({ project, d, step, prev, appName = "하자싹" }) {
  const loc = locText(d) || "위치 미지정";
  return [`[${project?.name || "현장"}] 후속 공정 요청 — ${step.trade}`, "", `■ ${loc}`,
    `- ${tradeText(d)}${d.type ? " [" + d.type + "]" : ""} ${d.content || ""}`.replace(/\s+/g, " ").trim(),
    prev ? `- 앞 공정 ‘${prev.trade}’ 완료${prev.doneAt ? ` (${prev.doneAt.slice(5, 10).replace("-", "/")})` : ""}` : "",
    `- 이번 공정: ${step.trade}${step.due ? ` (기한 ${step.due.slice(5).replace("-", "/")})` : ""}`,
    "", `조치 후 사진 회신 부탁드립니다. — ${appName}`].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
}

/* ---------- 1.0.8 평형(타입)·도면 ---------- */
/** ‘84.97A’, ‘84㎡A’, ‘84A타입’ → ‘84A’ */
export function normType(s) {
  const t = String(s || "").replace(/㎡|m2|타입|type|형|평|\s/gi, "").toUpperCase();
  const m = t.match(/^(\d+)(?:\.\d+)?([A-Z]*)$/); return m ? m[1] + m[2] : t;
}
export const unitKey = (dong, ho) => `${dong}|${normHo(ho) || ho}`;
export const unitTypeOf = (p, dong, ho) => (dong && ho ? normType(p?.unitTypes?.[unitKey(dong, ho)] || "") : "");
/** 실 목록: 세대 평형을 알면 그 평형 실 먼저 */
export function roomsFor(p, dong, ho) {
  const t = unitTypeOf(p, dong, ho); const tr = t ? p.roomsByType?.[t] || [] : [];
  return { type: tr.length ? t : "", rooms: [...new Set([...tr, ...(p.rooms || [])])] };
}
/** 파일 이름으로 동·층·평형 추측: 301동_기준층 → 동, 지하주차장_B1 → 층 B1, 84A_세대평면 → 평형 84A(전체 동) */
export function guessPlan(fileName, p) {
  const base = String(fileName).split("/").pop().replace(/\.[a-z0-9]+$/i, "");
  const g = { name: base.slice(0, 40), dongs: [], floors: "", utype: "" };
  const dm = [...base.matchAll(/(\d{2,4})\s*동/g)].map((m) => m[1] + "동");
  if (dm.length) g.dongs = [...new Set(dm)].filter((x) => !p?.dongs?.length || p.dongs.some((d) => d.name === x) || true);
  const fm = base.match(/(?:^|[_\-\s])(B\d{1,2}|지하\d{1,2}|\d{1,2}F|\d{1,2}층)(?=$|[_\-\s.])/i);
  if (fm) { const f = normFloor(fm[1].replace(/F$/i, "")); if (f) g.floors = f; }
  const fr = base.match(/(?:^|[_\-\s])(B?\d{1,2})\s*[-~]\s*(B?\d{1,2})층?(?=$|[_\-\s])/i); if (fr && !dm.some((x) => fr[0].includes(x.replace("동", "")))) g.floors = `${fr[1].toUpperCase()}-${fr[2].toUpperCase()}`;
  if (/세대|평면|타입|unit/i.test(base) && !dm.length) { const tm = base.match(/^(\d{2,3}(?:\.\d+)?[A-Z]{0,2})(?=[_\-\s]|타입|형|$)/i); if (tm) g.utype = normType(tm[1]); }
  return g;
}
/** 매핑 표(TSV/CSV): file, dongs, floors, name, (평형) */
export function parseMapping(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return new Map();
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (l) => { if (sep === "\t") return l.split("\t"); const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = { file: col("file", "파일", "파일명", "filename"), dongs: col("dongs", "dong", "동"), floors: col("floors", "floor", "층"), name: col("name", "이름", "도면명"), utype: col("type", "utype", "평형", "타입") };
  if (ci.file < 0) return new Map();
  const m = new Map();
  for (const l of lines.slice(1)) {
    const c = split(l).map((x) => x.trim()); const f = c[ci.file]; if (!f) continue;
    m.set(f.split("/").pop(), { dongs: ci.dongs >= 0 && c[ci.dongs] ? c[ci.dongs].split(/[,\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? x + "동" : x)) : [], floors: ci.floors >= 0 ? (c[ci.floors] || "").replace(/\s+/g, "") : "", name: ci.name >= 0 ? c[ci.name] || "" : "", utype: ci.utype >= 0 ? normType(c[ci.utype] || "") : "" });
  }
  return m;
}
/** rooms.json의 실 이름 정리: 기본 체크 여부(라인·동 번호·기호 등은 끔) */
export function roomCandidates(rooms, { evac = true, kind = "" } = {}) {
  const by = new Map();
  for (const r of rooms || []) {
    let name = String(r.name || "").trim(); if (!name) continue;
    if (kind === "parking") { name = cleanSpot(name); if (!name) continue; }
    else name = name.replace(/\+$/, "").trim();
    if (evac && name === "하향식피난구") name = "대피공간";
    if (!by.has(name)) by.set(name, { name, x: r.x, y: r.y, n: 0, conf: r.confidence ?? 1 });
    by.get(name).n++;
  }
  const noise = (n) => /^\d+라인$/.test(n) || (kind !== "parking" && /^\d{2,4}동/.test(n)) || (/^[A-Z]{1,4}$/.test(n) && n !== "MDF") || /^(TPS|AV\/PD|DA|PIT|ELEV)$/i.test(n) || n.length < 2;
  return [...by.values()].map((c) => ({ ...c, on: !noise(c.name) && c.conf >= 0.5 }));
}

/* ---------- 1.0.9 단지 공용 세부 위치(도면 기반) ---------- */
/** 지하주차장 도면 라벨 정리: 동 번호 → ‘301동 연결통로’, 지상 시설·표 글자 등은 버림 */
export function cleanSpot(raw) {
  let n = String(raw || "").replace(/\s+/g, " ").replace(/\+$/, "").trim();
  if (!n || /\(1F\)$|^\(.*\)$/.test(n)) return "";
  const m = n.match(/^(\d{3,4})동$/); if (m) return `${m[1]}동 연결통로`;
  if (/경로당|어린이집|수영장|사우나|도서관|독서실|맘스테이션|경비실|용역원실|회의실|근린생활|카페|놀이터|돌봄|휴게쉼터|잔디|골프|운동시설|주민공동|스터디|멀티룸|소장실|숙직|탕비|사무실|클라스|플라워|입주민/.test(n)) return "";
  if (/^(빗물|하차|조|업|회|차|장치|관리|하부OPNE|하부OPEN|\(급기\)|\(배기\)|\(남\)|\(여\))$/.test(n)) return "";
  if (/^(조업|업조)$/.test(n)) return "조업공간";
  if (n === "MDF") return "MDF실";
  if (/^전기자동차/.test(n)) return "전기차 충전구역";
  return n.slice(0, 20);
}
/** 도면 → 단지 공용 장소 추측(세대·동 도면, 배치도는 없음) */
export function guessPlace(pl, p) {
  if (!pl || pl.utype || pl.dongs?.length) return "";
  const name = String(pl.name || pl.file || "").replace(/\.\w+$/, "");
  if (/배치도/.test(name)) return "";
  const cs = [...(p?.commons || [])].sort((a, b) => b.length - a.length);
  const hit = cs.find((c) => c.length >= 2 && name.replace(/\s/g, "").includes(c.replace(/\s/g, ""))); if (hit) return hit;
  if (pl.kind === "parking" || /주차/.test(name)) return "지하주차장";
  if (/주민공동|어린이집|돌봄|맘스테이션|경로당|관리사무소|도서관|커뮤니티|경비실|문주/.test(name)) return "부대복리시설";
  if (pl.kind === "amenity" || pl.kind === "") return name.split(/[_]/)[0].replace(/\s*\(.*$/, "").replace(/\s*(확대)?\s*평(면도|,).*$/, "").replace(/-\d+$/, "").trim().slice(0, 15);
  return "";
}
export const placeOf = (pl, p) => (pl?.place != null && pl.place !== "" ? pl.place : guessPlace(pl, p));
/** 층 표기 펼치기: ‘B2,1’ → [B2,1], ‘B2-B1’ → [B2,B1] (범위가 길면 끝 두 개만) */
export function expandFloors(spec) {
  const toN = (f) => (/^B\d+$/i.test(f) ? -Number(f.slice(1)) : Number(f)); const toF = (n) => (n < 0 ? `B${-n}` : String(n));
  const out = [];
  for (const t of String(spec || "").split(/[,\s]+/).filter(Boolean)) {
    const m = t.match(/^(B?\d+)\s*[-~]\s*(B?\d+)$/i);
    if (!m) { const f = normFloor(t) || t.toUpperCase(); out.push(f); continue; }
    let a = toN(m[1].toUpperCase()), b = toN(m[2].toUpperCase()); if (a > b) [a, b] = [b, a];
    if (b - a > 9) { out.push(toF(a), toF(b)); continue; }
    for (let n = a; n <= b; n++) if (n !== 0) out.push(toF(n));
  }
  return [...new Set(out)];
}
/** 단지 공용 장소의 도면들 */
export const placePlans = (p, plans, place) => (place ? plans.filter((pl) => pl.projectId === p.id && placeOf(pl, p) === place) : []);
/** 장소의 층(도면 층 표기에서) — 지하 깊은 층부터 */
export function placeFloors(p, plans, place) {
  const fs = new Set(); for (const pl of placePlans(p, plans, place)) expandFloors(pl.floors).forEach((f) => fs.add(f));
  const n = (f) => (/^B\d+$/.test(f) ? -Number(f.slice(1)) : Number(f) || 999);
  return [...fs].sort((a, b) => n(a) - n(b));
}
/** 장소의 세부 위치: 층을 골랐으면 그 층 도면만. [{plan, spots:[{name,x,y}]}] */
export function placeSpots(p, plans, place, floor = "") {
  const out = [];
  for (const pl of placePlans(p, plans, place)) {
    if (floor && pl.floors && !expandFloors(pl.floors).includes(floor)) continue;
    const seen = new Set(); const spots = [];
    for (const r of pl.rooms || []) { if (!r.name || seen.has(r.name)) continue; seen.add(r.name); spots.push(r); }
    if (spots.length) out.push({ plan: pl, spots: spots.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true })) });
  }
  return out;
}
/** 도면이 있는 장소(현장 단지 공용 목록에 없어도 첫 화면에 보이게) */
export const placesWithPlans = (p, plans) => [...new Set(plans.filter((pl) => pl.projectId === p.id && pl.rooms?.length).map((pl) => placeOf(pl, p)).filter(Boolean))];

/* ---------- 1.1.1 업체 담당자 여러 명: v.contacts = [{name, role, phones[]}] ---------- */
export const CONTACT_ROLES = ["소장", "반장", "과장", "대리", "팀장", "실장", "대표", "사무실", "기사"];
/** 담당자 목록(옛 기록 person·phones는 첫 담당자로 읽음) */
export function contactsOf(v) {
  if (!v) return [];
  if (Array.isArray(v.contacts) && v.contacts.length) return v.contacts.map((c) => ({ name: String(c.name || "").trim(), role: String(c.role || "").trim(), phones: (c.phones || []).filter(Boolean) }));
  const phones = (v.phones || []).filter(Boolean);
  return v.person || phones.length ? [{ name: String(v.person || "").trim(), role: "", phones }] : [];
}
/** 저장 전 정리: 빈 담당자 빼고, 옛 앱·다른 기기 호환용 person(첫 담당자)·phones(모든 번호)도 함께 */
export function setContacts(v, list) {
  const cs = (list || []).map((c) => ({ name: String(c.name || "").trim().slice(0, 30), role: String(c.role || "").trim().slice(0, 12), phones: [...new Set((c.phones || []).map(normPhone).filter(Boolean))] })).filter((c) => c.name || c.phones.length);
  v.contacts = cs; v.person = cs[0]?.name || ""; v.phones = [...new Set(cs.flatMap((c) => c.phones))];
  return v;
}
/** 담당자 표시 이름: ‘김철수 반장’ */
export const contactLabel = (c) => [c?.name, c?.role].filter(Boolean).join(" ") || "담당자";
/** 번호 하나하나: [{name, role, phone, label}] (문자·전화 고르기용) */
export function vendorPhones(v) {
  const out = [];
  for (const c of contactsOf(v)) for (const ph of c.phones) out.push({ name: c.name, role: c.role, phone: ph, label: `${contactLabel(c)} ${ph}` });
  return out;
}
/** 업체 한 줄 요약: ‘김반장 · 010-… 외 1명’ */
export function contactSummary(v) {
  const cs = contactsOf(v); if (!cs.length) return "";
  const c = cs[0]; return [contactLabel(c) === "담당자" && !c.name ? "" : contactLabel(c), c.phones[0]].filter(Boolean).join(" · ") + (cs.length > 1 ? ` 외 ${cs.length - 1}명` : "");
}
/** 엑셀·요청서용: ‘김철수 반장 010-…; 이영희 소장 010-…’ */
export const contactsText = (v) => contactsOf(v).map((c) => [contactLabel(c), c.phones.join(", ")].filter(Boolean).join(" ")).join("; ");
const PH_RE = /(?:\+?82[-\s.]?)?0?1[016789][-\s.)]?\d{3,4}[-\s.]?\d{4}|0(?:2|[3-6]\d)[-\s.)]?\d{3,4}[-\s.]?\d{4}/g;
const ROLE_RE = new RegExp(`(${CONTACT_ROLES.join("|")}|부장|차장|주임|사원|기사님|사장)`);
/** 복사한 글(카톡 프로필·연락처 공유·문자 등)에서 이름과 전화번호 뽑기 → [{name, role, phones}] */
export function parseContactText(text) {
  const lines = String(text || "").replace(/\r/g, "").split(/[\n;]/).map((l) => l.trim()).filter(Boolean);
  const out = []; let pendingName = "";
  const clean = (s) => s.replace(PH_RE, " ").replace(/\[[^\]]*\]/g, " ").replace(/(연락처|카카오톡|전화번호|휴대폰번호|핸드폰번호)/g, " ").replace(/(^|\s)(이름|성명|담당자?|연락처|전화(번호)?|휴대폰|핸드폰|HP|H\.P|TEL|Tel|tel|M|Mobile|mobile|전화|번호|사무실|팩스|FAX|fax)\s*[:：]\s*/g, " ").replace(/^(이름|성명|담당자?|연락처|전화(번호)?|휴대폰|핸드폰|HP|H\.P|TEL|Tel|tel|M|Mobile|mobile|전화|번호)\s*[:：]?\s*/g, "").replace(/[<>()[\]{}"'‘’“”:：,·|/\\-]+/g, " ").replace(/\s+/g, " ").trim();
  const okName = (r) => r && r.length <= 20 && /[가-힣A-Za-z]/.test(r) && !/https?:|www\.|카카오|공유|연락처를|프로필/.test(r);
  const push = (name0, phones) => {
    const rm = (name0 || "").match(ROLE_RE); const role = rm ? rm[1].replace(/님$/, "") : "";
    const name = (name0 || "").replace(ROLE_RE, " ").replace(/님(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
    const prev = out.find((c) => c.name && c.name === name);
    if (prev) { prev.phones.push(...phones.filter((p) => !prev.phones.includes(p))); if (!prev.role) prev.role = role; return prev; }
    const c = { name, role, phones: [...new Set(phones)] }; out.push(c); return c;
  };
  const np = (m) => normPhone(m.replace(/^\+?82[-\s.]?/, "0").replace(/^00/, "0"));
  for (const line of lines) {
    if (!line.match(PH_RE)) { const rest = clean(line); if (okName(rest)) pendingName = rest; continue; }
    // 한 줄에 여러 명: "김철수 010-… 이영희 010-…" → 번호마다 끊어 앞 글을 이름으로
    const chunks = line.replace(PH_RE, (m) => m + "\u0001").split("\u0001");
    const tail = clean(chunks.pop() || ""); let last = null; const lineOut = [];
    for (const ch of chunks) {
      const ph = np((ch.match(PH_RE) || [""]).pop()); const nm = clean(ch);
      if (okName(nm)) { last = push(nm, [ph]); lineOut.push(last); }
      else if (last) { if (!last.phones.includes(ph)) last.phones.push(ph); }
      else { last = push(pendingName, [ph]); lineOut.push(last); }
      pendingName = "";
    }
    // "010-1234-5678 김철수 반장"처럼 이름이 뒤에 오는 경우
    if (okName(tail) && lineOut.length === 1 && !lineOut[0].name) { const rm = tail.match(ROLE_RE); lineOut[0].role = rm ? rm[1].replace(/님$/, "") : lineOut[0].role; lineOut[0].name = tail.replace(ROLE_RE, " ").replace(/님(?=\s|$)/g, "").replace(/\s+/g, " ").trim(); }
  }
  // 같은 이름 합치기(번호 없는 빈 항목 제거)
  return out.filter((c) => c.name || c.phones.length);
}
/** vCard(.vcf) → [{name, role, phones, org}] — 휴대폰 연락처 앱 ‘공유 → vCard 파일’ */
export function parseVcf(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); // 접힌 줄 펴기
  const out = [];
  for (const card of raw.split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.split("\n"); const get = (key) => lines.filter((l) => new RegExp(`^(item\\d+\\.)?${key}[;:]`, "i").test(l));
    const val = (l) => { const i = l.indexOf(":"); let v = i >= 0 ? l.slice(i + 1) : ""; const head = l.slice(0, i);
      if (/ENCODING=QUOTED-PRINTABLE/i.test(head)) { const bytes = []; v = v.replace(/=\n/g, ""); for (let k = 0; k < v.length; k++) { if (v[k] === "=" && /^[0-9A-F]{2}$/i.test(v.substr(k + 1, 2))) { bytes.push(parseInt(v.substr(k + 1, 2), 16)); k += 2; } else bytes.push(v.charCodeAt(k)); } try { v = new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch { /* 그대로 */ } }
      return v.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim(); };
    let name = get("FN").map(val)[0] || "";
    if (!name) { const n = (get("N").map(val)[0] || "").split(";"); name = `${n[0] || ""}${n[1] || ""}`.trim(); }
    const phones = [...new Set(get("TEL").map(val).map(normPhone).filter(Boolean))];
    const title = get("TITLE").map(val)[0] || ""; const org = (get("ORG").map(val)[0] || "").replace(/;+$/, "").replace(/;/g, " ").trim();
    const rm = `${title} ${name}`.match(ROLE_RE);
    if (name || phones.length) out.push({ name: name.replace(ROLE_RE, " ").replace(/\s+/g, " ").trim() || name, role: rm ? rm[1].replace(/님$/, "") : title.slice(0, 12), phones, org });
  }
  return out;
}
