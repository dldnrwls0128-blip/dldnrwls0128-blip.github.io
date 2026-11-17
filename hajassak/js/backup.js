/** 백업 zip: data.json(현장·하자·업체·설정) + photos/ + plans/ */
import * as db from "./db.js";
const J = () => { if (!globalThis.JSZip) throw new Error("JSZip을 불러오지 못했습니다."); return globalThis.JSZip; };
export async function exportBackup(appVersion) {
  const zip = new (J())();
  const [projects, defects, vendors, photos, plans, meta] = await Promise.all(["projects", "defects", "vendors", "photos", "plans", "meta"].map((s) => db.getAll(s)));
  const pmeta = [], plmeta = [];
  for (const p of photos) {
    const file = `photos/${p.id}.jpg`; zip.file(file, p.blob);
    if (p.thumb) zip.file(`thumbs/${p.id}.jpg`, p.thumb);
    const { blob, thumb, ...rest } = p; pmeta.push({ ...rest, file, thumbFile: p.thumb ? `thumbs/${p.id}.jpg` : null });
  }
  for (const p of plans) {
    const file = `plans/${p.id}.jpg`; zip.file(file, p.blob);
    const { blob, ...rest } = p; plmeta.push({ ...rest, file });
  }
  const data = { app: "hajassak", format: 1, appVersion, exportedAt: new Date().toISOString(),
    projects, defects, vendors, photos: pmeta, plans: plmeta, meta: meta.filter((m) => m.key !== "pro") };
  zip.file("data.json", JSON.stringify(data));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
export async function readBackup(file) {
  const zip = await J().loadAsync(file);
  const f = zip.file("data.json");
  if (!f) throw new Error("하자싹 백업 파일이 아닙니다(data.json 없음).");
  const data = JSON.parse(await f.async("string"));
  if (data.app !== "hajassak") throw new Error("하자싹 백업 파일이 아닙니다.");
  return { zip, data };
}
/** mode: "replace" 전체 교체 | "merge" 같은 ID는 백업본으로 덮어쓰기 */
export async function restoreBackup({ zip, data }, mode = "replace") {
  if (mode === "replace") for (const s of ["projects", "defects", "vendors", "photos", "plans"]) await db.clear(s);
  await db.putMany("projects", data.projects || []);
  await db.putMany("defects", data.defects || []);
  await db.putMany("vendors", data.vendors || []);
  for (const m of data.meta || []) await db.put("meta", m);
  let n = 0;
  for (const p of data.photos || []) {
    const bf = zip.file(p.file); if (!bf) continue;
    const blob = new Blob([await bf.async("arraybuffer")], { type: "image/jpeg" });
    const tf = p.thumbFile && zip.file(p.thumbFile);
    const thumb = tf ? new Blob([await tf.async("arraybuffer")], { type: "image/jpeg" }) : blob;
    const { file, thumbFile, ...rest } = p; await db.put("photos", { ...rest, blob, thumb }); n++;
  }
  for (const p of data.plans || []) {
    const bf = zip.file(p.file); if (!bf) continue;
    const { file, ...rest } = p; await db.put("plans", { ...rest, blob: new Blob([await bf.async("arraybuffer")], { type: "image/jpeg" }) });
  }
  return { projects: (data.projects || []).length, defects: (data.defects || []).length, vendors: (data.vendors || []).length, photos: n };
}
