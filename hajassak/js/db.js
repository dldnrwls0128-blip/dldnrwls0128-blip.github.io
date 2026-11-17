/** IndexedDB — 모든 데이터는 이 기기 안에만 저장됩니다(서버 전송 없음). */
export const DB_NAME = "hajassak";
export const DB_VERSION = 1;
export const STORES = ["projects", "defects", "photos", "vendors", "plans", "meta"];

let _dbp;
export function openDb() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, key, idx = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: key });
        for (const [n, k] of idx) s.createIndex(n, k, { unique: false });
      };
      mk("projects", "id");
      mk("defects", "id", [["by_project", "projectId"]]);
      mk("photos", "id", [["by_defect", "defectId"]]);
      mk("vendors", "id");
      mk("plans", "id", [["by_project", "projectId"]]);
      mk("meta", "key");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}
export function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function getAll(store) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).get(key)); }
export async function put(store, value) {
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value); await done(tx); return value;
}
export async function del(store, key) {
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key); await done(tx);
}
export async function putMany(store, values) {
  const db = await openDb();
  for (let i = 0; i < values.length; i += 2000) {
    const tx = db.transaction(store, "readwrite"); const os = tx.objectStore(store);
    for (const v of values.slice(i, i + 2000)) os.put(v);
    await done(tx);
  }
}
export async function clear(store) { const db = await openDb(); const tx = db.transaction(store, "readwrite"); tx.objectStore(store).clear(); await done(tx); }
export async function byIndex(store, index, key) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).index(index).getAll(key)); }
export async function delByIndex(store, index, key) {
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  const r = tx.objectStore(store).index(index).openKeyCursor(IDBKeyRange.only(key));
  r.onsuccess = () => { const c = r.result; if (!c) return; tx.objectStore(store).delete(c.primaryKey); c.continue(); };
  await done(tx);
}
/** 사진 개수/종류만 집계(블롭 미로딩) */
export async function photoIndex() {
  const db = await openDb(); const map = new Map();
  await new Promise((resolve, reject) => {
    const r = db.transaction("photos").objectStore("photos").openCursor();
    r.onsuccess = () => {
      const c = r.result; if (!c) return resolve();
      const v = c.value; const m = map.get(v.defectId) || { before: 0, after: 0 };
      m[v.kind === "after" ? "after" : "before"]++; map.set(v.defectId, m); c.continue();
    };
    r.onerror = () => reject(r.error);
  });
  return map;
}
export async function getMeta(key, d) { const v = (await get("meta", key))?.value; return v === undefined ? d : v; }
export async function setMeta(key, value) { return put("meta", { key, value }); }
