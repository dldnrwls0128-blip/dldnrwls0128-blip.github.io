/** 1.4.2 간단 모드 · 역할별 첫 사용 안내 · 쉬운 말.
 *  이 기기 화면만 바꾼다. 데이터·권한·동기화 규칙과는 무관. */
import { roleOf } from "./roles.js";

/** 저장된 값. 한 번도 안 고르면 null(기존 사용자는 꺼짐). */
export const simplePref = (get) => { const v = get("simple", null); return v === true || v === false ? v : null; };
export const simpleOn = (get) => simplePref(get) === true;
/** 새 사용자(첫 역할 고르기)이면서 입주자·협력업체면 기본 켜짐. */
export const defaultSimpleFor = (role, first) => !!(first && (role === "resident" || role === "vendor"));

export function simpleTabs(roleId) {
  const base = roleOf(roleId).tabs.filter((t) => t !== "photos");
  return base;
}
export function simpleTabLabel(roleId) {
  const o = { ...(roleOf(roleId).tabLabel || {}) };
  o.places = "목록";
  return o;
}
export function simpleTabHref(roleId) {
  const o = { ...(roleOf(roleId).tabHref || {}) };
  o.places = "#/list";
  return o;
}

/** 마법사 · 입주자 · 협력업체 화면, 또는 간단 모드일 때 쉬운 말. 시공관리자 기본 화면은 전문 용어 유지. */
export function easyLang(get, role, route) {
  if (route === "wizard" || route === "guide") return true;
  if (role === "resident" || role === "vendor") return true;
  return simpleOn(get);
}

export const WORDS = {
  trade: { pro: "공종", easy: "공사 종류" },
  tradeSub: { pro: "세부 공종", easy: "더 자세한 공사 종류" },
  unit: { pro: "세대", easy: "집(호)" },
  line: { pro: "라인", easy: "호 줄" },
  hoRule: { pro: "호수 규칙", easy: "호 번호를 어떻게 매길지" },
  template: { pro: "양식 받기", easy: "빈 엑셀 보기" },
  wizard: { pro: "마법사", easy: "단계 따라 만들기" },
  commons: { pro: "공용·실", easy: "공용 장소·방" },
  part: { pro: "부위", easy: "어디(벽·천장 등)" },
  skipFloor: { pro: "없는 층", easy: "빼 둘 층" },
  skipLine: { pro: "없는 라인", easy: "빼 둘 호 줄" },
  unitStart: { pro: "호가 시작되는 층", easy: "몇 층부터 호가 있는지" },
  lines: { pro: "층당 호 수", easy: "한 층에 호가 몇 개인지" },
  vendor: { pro: "협력업체", easy: "공사하는 업체" },
};

export const word = (key, easy) => { const w = WORDS[key]; return w ? (easy ? w.easy : w.pro) : key; };

/** 역할별 첫 사용 안내(3~4장). 기존 사용자에게는 자동으로 띄우지 않는다(첫 역할 고르기 직후에만). */
export const GUIDES = {
  manager: [
    { ico: "📷", t: "하자를 등록해요", d: "동·호·위치를 고르고 사진을 찍은 뒤, 공종과 내용을 남기면 됩니다." },
    { ico: "📋", t: "목록에서 상태를 봐요", d: "미조치·조치중·완료를 한눈에 보고, 작업이 끝나면 ‘조치완료’를 누르세요." },
    { ico: "📲", t: "업체로 바로 보내요", d: "‘보내기’로 카톡·파일·문자를 전합니다. 보낸 건은 ‘업체전달’로 바뀌어요." },
    { ico: "✨", t: "화면을 단순하게 쓸 수도 있어요", d: "설정이나 더보기에서 ‘간단 모드’를 켜면 등록·목록·조치완료·보내기만 큰 버튼으로 남아요." },
  ],
  vendor: [
    { ico: "🛠", t: "내 할 일만 보여요", d: "시공사에서 맡긴 하자만 목록에 나와요. 내 업체를 한 번 고르면 됩니다." },
    { ico: "📷", t: "고친 뒤 사진을 올려요", d: "현장에서 고친 다음, ‘조치 후 사진’을 찍고 ‘조치완료’를 누르세요." },
    { ico: "📋", t: "목록에서 이어서 처리해요", d: "남은 건은 목록에서 바로 열고, 사진을 붙이거나 완료할 수 있어요." },
    { ico: "✨", t: "필요한 버튼만 크게 보여요", d: "지금 간단 모드예요. 더 많은 기능이 필요하면 설정이나 더보기에서 끌 수 있어요." },
  ],
  auditor: [
    { ico: "🔍", t: "현황을 먼저 확인해요", d: "홈에서 미조치·기한초과 건수를 보고, 필요한 목록만 열어 보세요." },
    { ico: "🧱", t: "위치별로 살펴봐요", d: "하자위치에서 동·층·호 건수를 확인하고, 기한이 지난 건을 따로 볼 수 있어요." },
    { ico: "🏢", t: "업체별 조치를 점검해요", d: "더보기 › 업체에서 진행을 보고, 필요하면 요청서나 확인서를 열어 보세요." },
    { ico: "✨", t: "화면을 단순하게 쓸 수도 있어요", d: "설정이나 더보기에서 ‘간단 모드’를 켜면 핵심 흐름만 큰 버튼으로 남아요." },
  ],
  resident: [
    { ico: "🏠", t: "내 집만 등록해요", d: "동·호를 한 번만 적어 두면, 이후에는 내 집에서 발견한 문제만 남기면 됩니다." },
    { ico: "📷", t: "사진과 내용이면 충분해요", d: "어디가 문제인지 사진을 찍고, 짧은 설명을 적으면 등록됩니다. 공사 종류를 몰라도 돼요." },
    { ico: "📋", t: "목록에서 내가 남긴 걸 봐요", d: "홈의 ‘목록 보기’나 아래 ‘목록’에서 지금까지 남긴 내용을 확인하고 이어서 추가할 수 있어요." },
    { ico: "✨", t: "필요한 버튼만 크게 보여요", d: "지금 간단 모드예요. 더 많은 화면이 필요하면 설정이나 더보기에서 끌 수 있어요." },
  ],
};
export const guideOf = (role) => GUIDES[role] || GUIDES.manager;
