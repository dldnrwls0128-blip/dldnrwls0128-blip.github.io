/** 내보내기: 엑셀·CSV, 업체별 하자조치 요청서(인쇄 → PDF 저장) */
import { locText, tradeText, sortDefects, isOverdue, floorLabel, hasSteps, stepsText, stepProgress, contactsOf, contactsText } from "./model.js";
const COLS = [
  ["번호", (d, i) => i + 1], ["외부ID", (d) => d.extId || ""], ["동", (d) => d.dong], ["층", (d) => floorLabel(d.floor)], ["호", (d) => d.ho],
  ["공용부", (d) => d.common || ""], ["실", (d) => d.room], ["부위", (d) => d.part], ["공종", (d) => d.trade], ["세부공종", (d) => d.subTrade],
  ["유형", (d) => d.type], ["구분", (d) => d.category], ["중요도", (d) => d.severity], ["내용", (d) => d.content],
  ["업체", (d, i, c) => c.vendorName(d)], ["업체 담당자·연락처", (d, i, c) => contactsText(c.vendorOf?.(d))], ["상태", (d) => d.status], ["접수일", (d) => (d.createdAt || "").slice(0, 10)],
  ["조치기한", (d) => d.due || ""], ["기한초과", (d) => (isOverdue(d) ? "Y" : "")], ["조치완료일", (d) => d.doneAt?.slice(0, 10) || ""],
  ["확인완료일", (d) => d.confirmedAt?.slice(0, 10) || ""], ["메모", (d) => d.memo || ""], ["조치전 사진", (d, i, c) => c.photos(d).before],
  ["조치후 사진", (d, i, c) => c.photos(d).after],
  ["공정 단계", (d) => stepsText(d)], ["공정 진행", (d) => stepProgress(d)],
];
export function tableOf(list, ctx) {
  const rows = [...list].sort(sortDefects);
  return [COLS.map((c) => c[0]), ...rows.map((d, i) => COLS.map((c) => c[1](d, i, ctx) ?? ""))];
}
export async function toXlsx(list, ctx, sheetName = "하자목록") {
  const XLSX = await import("../vendor/xlsx/xlsx.mjs");
  const ws = XLSX.utils.aoa_to_sheet(tableOf(list, ctx));
  ws["!cols"] = COLS.map(([h]) => ({ wch: h === "내용" ? 40 : h === "메모" ? 24 : 10 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
  const vrows = vendorRows(list, ctx);
  if (vrows.length > 1) { const vs = XLSX.utils.aoa_to_sheet(vrows); vs["!cols"] = [16, 14, 10, 8, 16, 20].map((wch) => ({ wch })); XLSX.utils.book_append_sheet(wb, vs, sheetName.slice(0, 30) === "업체" ? "업체연락처" : "업체"); }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
/** 업체 시트: 담당자 한 명당 한 줄(목록에 나온 업체만) */
export function vendorRows(list, ctx) {
  const seen = new Set(); const rows = [["업체", "공종", "담당자", "직책", "전화번호", "메모"]];
  for (const d of list) {
    const v = ctx.vendorOf?.(d); if (!v || seen.has(v.id)) continue; seen.add(v.id);
    const cs = contactsOf(v); const base = [v.name, (v.trades || []).join(", ")];
    if (!cs.length) rows.push([...base, "", "", "", v.memo || ""]);
    cs.forEach((c, k) => rows.push([...base, c.name, c.role, c.phones.join(", "), k ? "" : v.memo || ""]));
  }
  return rows;
}
export function toCsv(list, ctx) {
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return new Blob(["\uFEFF" + tableOf(list, ctx).map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** 요청서 HTML (사진은 objectURL) */
export function requestDocHtml({ project, vendor, items, photoUrls, watermark, issuer = "", today }) {
  const rows = [...items].sort(sortDefects).map((d, i) => {
    const ph = (photoUrls.get(d.id) || []).slice(0, 2).map((u) => `<img src="${u}" alt="">`).join("");
    return `<tr><td class="c">${i + 1}</td><td>${esc(locText(d))}</td><td>${esc(tradeText(d))}<br><small>${esc(d.type || "")}</small></td>
      <td>${esc(d.content || "")}${d.severity === "긴급" ? ' <b class="urg">긴급</b>' : ""}${hasSteps(d) ? `<br><small class="steps">공정 ${esc(stepProgress(d))}: ${d.steps.map((s) => (s.status === "완료" ? `<s>${esc(s.trade)}</s>` : vendor && s.vendorId === vendor.id ? `<b>${esc(s.trade)}</b>` : esc(s.trade))).join(" → ")}</small>` : ""}</td><td class="c">${esc(d.due || "")}</td><td class="ph">${ph}</td><td class="sig"></td></tr>`;
  }).join("");
  return `<div class="doc">
    ${watermark ? '<div class="wm">하자싹 무료판</div>' : ""}
    <h1>하자 조치 요청서</h1>
    <table class="hd"><tr><th>현장</th><td>${esc(project?.name || "")}</td><th>요청일</th><td>${esc(today)}</td></tr>
    <tr><th>업체</th><td>${esc(vendor?.name || "업체 미지정")}</td><th>담당자·연락처</th><td>${esc(contactsText(vendor)).replace(/; /g, "<br>")}</td></tr>
    <tr><th>건수</th><td>${items.length}건</td><th>요청자</th><td>${esc(issuer)}</td></tr></table>
    <table class="lst"><thead><tr><th>No</th><th>위치</th><th>공종/유형</th><th>내용</th><th>기한</th><th>조치 전 사진</th><th>조치 확인</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="foot">위 하자를 조치 기한 내 보수하고 조치 후 사진을 회신해 주시기 바랍니다.</p>
  </div>`;
}
