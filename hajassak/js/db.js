/** IndexedDB — 이 기기 저장소(오프라인 캐시). 동기화를 켜면 sync.js가 변경분을 outbox에 모아 Firebase로 올린다. */
export const DB_NAME = "hajassak";
export const DB_VERSION = 2; // v2: outbox(동기화 대기열)
export const STORES = ["projects", "defects", "photos", "vendors", "plans", "meta"];
/** 기기 간 동기화 대상: 저장소 전체 + meta 중 일부 키 */
export const SYNC_STORES = ["projects", "defects", "vendors", "plans", "photos"];
export const SYNC_META = new Set(["importMaps"]);
const isSynced = (store, v) => SYNC_STORES.includes(store) || (store === "meta" && SYNC_META.has(typeof v === "string" ? v : v?.key));
/* 쓰기 훅: 동기화 대상 레코드에 _u(수정 시각 ms)·_dev(기기 ID)를 찍고, 동기화가 켜져 있으면 outbox에 기록 */
let _dev = "";
export function deviceId() {
  if (_dev) return _dev;
  try { _dev = localStorage.getItem("hs:deviceId") || ""; if (!_dev) { _dev = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem("hs:deviceId", _dev); } } catch { _dev = "d-mem"; }
  return _dev;
}
let _outboxOn = false; const _listeners = new Set();
export function setOutboxEnabled(on) { _outboxOn = !!on; }
export function onOutbox(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
const keyOf = (store, v) => (store === "meta" ? v.key : v.id);
function stamp(store, v) { if (v && typeof v === "object" && isSynced(store, v)) { v._u = Math.max(Date.now(), (v._u || 0) + 1); v._dev = deviceId(); } }
function obEntry(store, id, del, v) {
  const e = { k: store + "/" + id, store, id, at: Date.now(), del: !!del };
  if (del && v && (store === "photos" || store === "plans")) e.blobSizes = Object.fromEntries(Object.entries(v).filter(([, x]) => x instanceof Blob).map(([f, x]) => [f, x.size]));
  return e;
}

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
      mk("outbox", "k");
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
async function writeOutbox(entries) {
  if (!entries.length) return;
  const db = await openDb();
  for (let i = 0; i < entries.length; i += 2000) { const tx = db.transaction("outbox", "readwrite"); const os = tx.objectStore("outbox"); for (const e of entries.slice(i, i + 2000)) os.put(e); await done(tx); }
  _listeners.forEach((f) => { try { f(entries); } catch {} });
}
/** 동기화 훅을 거치는 일반 쓰기(앱 코드용) */
export async function put(store, value) {
  stamp(store, value);
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value); await done(tx);
  if (_outboxOn && isSynced(store, value)) await writeOutbox([obEntry(store, keyOf(store, value), false)]);
  return value;
}
export async function del(store, key) { return delMany(store, [key]); }
export async function putMany(store, values) {
  for (const v of values) stamp(store, v);
  await rawPutMany(store, values);
  if (_outboxOn) await writeOutbox(values.filter((v) => isSynced(store, v)).map((v) => obEntry(store, keyOf(store, v), false)));
}
export async function delMany(store, keys) {
  const track = _outboxOn && keys.some((k) => isSynced(store, k));
  const entries = [];
  if (track) { for (const k of keys) if (isSynced(store, k)) entries.push(obEntry(store, k, true, (store === "photos" || store === "plans") ? await get(store, k) : null)); }
  await rawDelMany(store, keys);
  if (entries.length) await writeOutbox(entries);
}
export async function clear(store) {
  if (_outboxOn && (SYNC_STORES.includes(store) || store === "meta")) return delMany(store, await allKeys(store));
  return rawClear(store);
}
export async function delByIndex(store, index, key) {
  if (_outboxOn && SYNC_STORES.includes(store)) { const db = await openDb(); const keys = await rq(db.transaction(store).objectStore(store).index(index).getAllKeys(key)); return delMany(store, keys); }
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  const r = tx.objectStore(store).index(index).openKeyCursor(IDBKeyRange.only(key));
  r.onsuccess = () => { const c = r.result; if (!c) return; tx.objectStore(store).delete(c.primaryKey); c.continue(); };
  await done(tx);
}
export async function allKeys(store) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).getAllKeys()); }
export async function count(store) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).count()); }
/* ---- 훅 없는 원시 쓰기(동기화 엔진이 원격 변경을 반영할 때) ---- */
export async function rawPut(store, value) { const db = await openDb(); const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); await done(tx); return value; }
export async function rawPutMany(store, values) {
  const db = await openDb();
  for (let i = 0; i < values.length; i += 2000) {
    const tx = db.transaction(store, "readwrite"); const os = tx.objectStore(store);
    for (const v of values.slice(i, i + 2000)) os.put(v);
    await done(tx);
  }
}
export async function rawDelMany(store, keys) {
  const db = await openDb();
  for (let i = 0; i < keys.length; i += 2000) {
    const tx = db.transaction(store, "readwrite"); const os = tx.objectStore(store);
    for (const k of keys.slice(i, i + 2000)) os.delete(k);
    await done(tx);
  }
}
export async function rawClear(store) { const db = await openDb(); const tx = db.transaction(store, "readwrite"); tx.objectStore(store).clear(); await done(tx); }
export async function byIndex(store, index, key) { const db = await openDb(); return rq(db.transaction(store).objectStore(store).index(index).getAll(key)); }
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
