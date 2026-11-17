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
export const DEFAULT_COMMONS = ["지하주차장", "주출입구", "코어(계단·EV홀)", "옥상", "외벽", "커뮤니티", "관리동", "단지 외부"];
export const CATEGORIES = ["시공불량", "사전점검", "입주자하자", "AS"];
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
  return out;
}
export const floorLabel = (f) => (!f ? "" : /^B\d/.test(f) || f === "옥상" ? f : `${f}층`);
/** 층별 호수: 1~N호 라인, 호 = 층*100+라인 (startFloor 미만은 세대 없음: 필로티 등).
 *  dong.units(엑셀 데이터에서 찾은 실제 세대 목록)가 있으면 그 세대만 */
export function unitsOf(dong, floor) {
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
    dongs: [], commons: [...DEFAULT_COMMONS],
    trades: DEFAULT_TRADES.map((t) => ({ name: t.name, subs: [...t.subs] })),
    types: [...DEFAULT_TYPES], rooms: [...DEFAULT_ROOMS], parts: [...DEFAULT_PARTS],
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
    if (f.trade && d.trade !== f.trade) return false;
    if (f.vendorId && (f.vendorId === "_none" ? d.vendorId : d.vendorId !== f.vendorId)) return false;
    if (f.type && d.type !== f.type) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.severity && d.severity !== f.severity) return false;
    if (f.status === "_open" ? !isOpen(d) : f.status && d.status !== f.status) return false;
    if (f.overdue && !isOverdue(d, today)) return false;
    if (text) {
      const hay = `${d.dong} ${d.ho} ${d.room} ${d.part} ${d.trade} ${d.subTrade} ${d.type} ${d.content} ${ctx.vendorName?.(d) || ""} ${d.memo || ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
export const filterCount = (f) => ["dong", "ho", "trade", "vendorId", "type", "category", "severity", "status", "overdue", "text"].filter((k) => f[k]).length;

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

export const locText = (d) => [d.dong, d.ho ? `${d.ho}호` : floorLabel(d.floor), d.common, d.room, d.part].filter(Boolean).join(" ");
export const tradeText = (d) => [d.trade, d.subTrade].filter(Boolean).join("/");

/** 업체 전달 문구(카톡·문자) */
export function shareMessage({ project, vendor, items, appName = "하자싹" }) {
  const head = `[${project?.name || "현장"}] ${vendor ? vendor.name + " " : ""}하자 조치 요청 ${items.length}건`;
  const byLoc = new Map();
  for (const d of [...items].sort(sortDefects)) {
    const k = [d.dong, d.ho ? d.ho + "호" : floorLabel(d.floor) || d.common].filter(Boolean).join(" ") || "위치 미지정";
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k).push(d);
  }
  const lines = [head];
  for (const [loc, arr] of byLoc) {
    lines.push("", `■ ${loc}`);
    for (const d of arr) {
      const where = [d.room, d.part].filter(Boolean).join(" ");
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
