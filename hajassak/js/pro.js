/**
 * 무료/프로 기능 플래그 — 결제 연동 없음(준비 단계).
 * 모든 유료 제한은 이 모듈 하나에서만 판단한다. 나중에 Google Play Billing(Digital Goods API, TWA)을
 * 붙일 때 purchase()/restore()만 구현하면 된다. (README·store/결제연동.md 참고)
 */
import { getMeta, setMeta } from "./db.js";

export const PRO_SKU = "hajassak_pro_lifetime"; // Play Console 인앱 상품 ID(일회성, 예정)
export const FREE_LIMITS = { projects: 1, pdfWatermark: true };
export const PRO_FEATURES = [
  "현장 무제한 (무료: 1개)",
  "업체 요청서 PDF 워터마크 제거",
  "앞으로 추가될 프로 기능(팀 공유 등) 우선 제공",
];
let _pro = false;
export async function loadPro() { _pro = !!(await getMeta("pro", false)); return _pro; }
export const isPro = () => _pro;
/** feature: "multiProject" | "pdfNoWatermark" */
export function can(feature, ctx = {}) {
  if (_pro) return true;
  if (feature === "multiProject") return (ctx.projectCount || 0) < FREE_LIMITS.projects;
  if (feature === "pdfNoWatermark") return false;
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
export async function setProForTest(on) { _pro = !!on; await setMeta("pro", _pro); }
