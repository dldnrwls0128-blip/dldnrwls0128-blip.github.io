/** 1.4.0 역할(화면 구성) — 이 기기에서 화면만 바꾼다. 데이터·권한·동기화 규칙과는 무관. */
export const ROLE_IDS = ["manager", "vendor", "auditor", "resident"];
export const ROLES = {
  manager: {
    id: "manager", ico: "🏗", name: "시공관리자", sub: "현장 전체 기능 · 등록·업체·보내기·도면까지",
    tabs: ["places", "list", "new", "sets", "more"], tabLabel: {}, tabHref: {},
    more: null, // null = 전부
    home: ["search", "stat", "kpimine", "presets", "new", "places", "find", "send", "sendph", "recent"],
  },
  vendor: {
    id: "vendor", ico: "🛠", name: "협력업체", sub: "내 하자 확인 · 조치 후 사진 올리기",
    tabs: ["places", "list", "sets", "more"], tabLabel: { list: "내 하자" }, tabHref: {},
    more: ["wo", "export", "settings", "help", "role", "simple", "photos", "home"],
    home: ["stat", "kpimine", "afterphoto", "recent"],
  },
  auditor: {
    id: "auditor", ico: "🔍", name: "감리·발주처", sub: "현황·기한초과 확인 · 업체별 조치 점검",
    tabs: ["places", "list", "sets", "more"], tabLabel: {}, tabHref: {},
    more: ["vendors", "places", "dash", "wo", "export", "settings", "help", "role", "simple", "photos", "home"],
    home: ["search", "stat", "kpimine", "places", "find", "recent"],
  },
  resident: {
    id: "resident", ico: "🏠", name: "입주자 점검(개인)", sub: "내 집 하나 · 사진·위치·내용만 등록",
    tabs: ["list", "new", "sets", "more"], tabLabel: { list: "내 하자" }, tabHref: {},
    more: ["export", "settings", "help", "role", "simple", "photos", "home"],
    home: ["new", "stat", "exportbtn", "recent"],
  },
};
export const roleOf = (id) => ROLES[id] || ROLES.manager;
/** 더보기 항목 키 → 이 역할에 보이나 */
export const moreShows = (id, key) => { const r = roleOf(id); return !r.more || r.more.includes(key); };
export const homeShows = (id, key) => roleOf(id).home.includes(key);
