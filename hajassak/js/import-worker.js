/** 엑셀/CSV 파싱 워커: 첫 시트(또는 지정 시트)를 2차원 배열로 */
import * as XLSX from "../vendor/xlsx/xlsx.mjs";
export function parseSheet(buf, sheetName) {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, dense: true });
  const names = wb.SheetNames;
  const ws = wb.Sheets[sheetName && names.includes(sheetName) ? sheetName : names[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
  return { sheets: names, rows };
}
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) self.onmessage = (e) => {
  try { const r = parseSheet(e.data.buf, e.data.sheet); self.postMessage({ ok: true, ...r }); }
  catch (err) { self.postMessage({ ok: false, error: String(err?.message || err) }); }
};
