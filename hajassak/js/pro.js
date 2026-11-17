/**
 * 무료/프로 기능 플래그 — 결제 연동 없음(준비 단계).
 * 모든 유료 제한은 이 모듈 하나에서만 판단한다. 나중에 Google Play Billing(Digital Goods API, TWA)을
 * 붙일 때 purchase()/restore()만 구현하면 된다. (README·store/결제연동.md 참고)
 */
import { getMeta, setMeta } from "./db.js";

export const PRO_SKU = "hajassak_pro_lifetime"; // Play Console 인앱 상품 ID(일회성, 예정)
export const FREE_LIMITS = { projects: 1, pdfWatermark: true, workspaces: 1, members: 10 }; // members: 현장(팀)당 인원 — 서버 규칙이 강제
export const PRO_LIMITS = { workspaces: Infinity, members: 100 }; // 팀 인원은 기기 프로가 아니라 팀 현장 문서의 plan:"pro"+maxMembers(관리자만 설정)로 정해짐
export const PRO_FEATURES = [
  "현장 무제한 (무료: 1개)",
  "업체 요청서 PDF 워터마크 제거",
  "팀 현장 무제한 (무료: 1개)",
  "현장당 팀원 11명 이상 — 유료 버전(준비 중 · 문의) (무료: 10명까지)",
];
let _pro = false;
// 프로 여부는 기기 단위(localStorage) — 팀 현장마다 저장소가 달라도 같게 유지. 옛 버전 값(meta)도 읽음
const lsPro = () => { try { return localStorage.getItem("hs:pro") === "1"; } catch { return false; } };
export async function loadPro() { _pro = lsPro() || !!(await getMeta("pro", false)); return _pro; }
export const isPro = () => _pro;
/** feature: "multiProject" | "pdfNoWatermark" | "workspace"(ctx.workspaceCount) | "member"(ctx.memberCount) */
export function can(feature, ctx = {}) {
  if (_pro) return true;
  if (feature === "multiProject") return (ctx.projectCount || 0) < FREE_LIMITS.projects;
  if (feature === "pdfNoWatermark") return false;
  if (feature === "workspace") return (ctx.workspaceCount || 0) < FREE_LIMITS.workspaces;
  if (feature === "member") return (ctx.memberCount || 0) < FREE_LIMITS.members;
  return true;
}
/** 결제는 아직 연결되지 않음. TWA에서 Digital Goods API가 있으면 여기서 PaymentRequest로 구매한다. */
export async function purchase() {
  if ("getDigitalGoodsService" in window) {
    // TODO(결제 연동): const svc = await window.getDigitalGoodsService("https://play.google.com/billing");
    //   const [d] = await svc.getDetails([PRO_SKU]); new PaymentRequest([{ supportedMethods: "https://play.google.com/billing", data: { sku: PRO_SKU } }], {...}).show()
    //   → 서버 없이도 svc.listPurchases()로 구매 확인 후 acknowledge 필요.
  }
  return { ok: false, reason: "준비 중" };
}
export async function restore() {
  // TODO(결제 연동): const svc = await window.getDigitalGoodsService(...); (await svc.listPurchases()).some(p => p.itemId === PRO_SKU)
  return { ok: false, reason: "준비 중" };
}
/** 개발·테스트용(설정 > 앱 정보 > 버전 7번 탭). 출시 빌드에서는 DEV_UNLOCK=false로. */
export const DEV_UNLOCK = false;
export async function setProForTest(on) { _pro = !!on; try { localStorage.setItem("hs:pro", _pro ? "1" : "0"); } catch {} await setMeta("pro", _pro); }
export const memberLimit = () => FREE_LIMITS.members; // 새 팀 현장은 항상 무료 10명으로 시작(유료 전환은 관리자가 서버에서)
export const PAID_MEMBER_MSG = `무료 버전은 현장당 ${FREE_LIMITS.members}명까지예요. ${FREE_LIMITS.members + 1}명 이상은 유료 버전(준비 중)이에요 — 필요하면 문의해 주세요.`;
