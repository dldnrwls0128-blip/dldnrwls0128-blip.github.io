/** 하자싹 기기 간 동기화 — Firebase(구글 로그인 + Firestore).
 *  - IndexedDB가 원본 캐시(오프라인 그대로 사용). 로그인하지 않으면 이 파일은 아예 불러오지 않는다(완전 로컬).
 *  - 위로: db.js 쓰기 훅이 outbox에 쌓은 변경을 배치로 업로드(오프라인이면 대기 → 연결되면 전송).
 *  -아래로: 컬렉션별 onSnapshot(where _su > 마지막 커서) → 바뀐 문서만 받아 IndexedDB에 반영.
 *  - 충돌: 문서 단위 최신 수정 우선(_u = 수정 시각 ms, 같으면 _dev 비교). 삭제는 묘비(_del) 문서.
 *  - 경로: users/{uid}/{projects|defects|vendors|plans|photos|meta|chunks}/{id}
 *  - 사진·도면: Firestore Bytes 필드(문서 1MB 한도 → 900KB 넘으면 chunks 컬렉션에 나눠 저장). Cloud Storage 미사용(무료 Spark 요금제). */
import * as db from "./db.js";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAqf65q8GiW6lFW_gV0YAEXGBmz13Hl3Kw",
  authDomain: "hajassak-app-d17048.firebaseapp.com",
  projectId: "hajassak-app-d17048",
  storageBucket: "hajassak-app-d17048.firebasestorage.app",
  messagingSenderId: "860212730001",
  appId: "1:860212730001:web:71377d7b681ba85afa0730",
};
// GitHub Pages(사용자 사이트)에는 /__/auth/ 도우미를 직접 올려 두었다 → 같은 도메인 authDomain(리디렉트 로그인이 서드파티 저장소 차단에 안 걸림)
const SELF_HOSTED_AUTH = ["dldnrwls0128-blip.github.io"];
const COLLS = [...db.SYNC_STORES, "meta"];
const INLINE_MAX = 900_000;  // 한 문서에 넣을 블롭 합계 상한(Firestore 문서 1MB)
const CHUNK = 900_000;
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("hs:" + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("hs:" + k, JSON.stringify(v)); } catch {} } };
const VBASE = new URL("../vendor/firebase/", import.meta.url).href;

/* ---------- 상태 ---------- */
const st = {
  F: null, app: null, auth: null, fs: null, user: null, uid: LS.get("sync.uid", ""), email: LS.get("sync.email", ""),
  phase: "off",          // off | loading | ready | error
  pending: 0, pushing: false, pulling: 0, lastSync: LS.get("sync.last", 0), err: "",
  unsubs: [], listeners: new Set(), onRemote: null, askMerge: null, emu: false,
};
export const state = st;
export const attached = () => !!st.uid;
export function onChange(fn) { st.listeners.add(fn); return () => st.listeners.delete(fn); }
const emit = () => st.listeners.forEach((f) => { try { f(status()); } catch {} });
/** 헤더 칩용 요약 */
export function status() {
  const online = navigator.onLine !== false;
  if (!st.uid) return { key: "login", label: "로그인 필요" };
  if (st.phase === "error") return { key: "error", label: "동기화 오류", detail: st.err };
  if (st.phase === "off" || st.phase === "needauth") return { key: "login", label: "로그인 필요", detail: st.email };
  if (!online) return { key: "offline", label: `오프라인 · 대기 ${st.pending}건`, n: st.pending };
  if (st.phase === "loading" || st.pushing || st.pulling || st.pending) return { key: "busy", label: st.pending ? `동기화 중 · ${st.pending}건` : "동기화 중", n: st.pending };
  return { key: "ok", label: "동기화됨" };
}

/* ---------- Firebase 지연 로드 ---------- */
async function loadSdk() {
  if (st.F) return st.F;
  const [A, U, S] = await Promise.all([import(VBASE + "firebase-app.js"), import(VBASE + "firebase-auth.js"), import(VBASE + "firebase-firestore.js")]);
  st.F = { ...A, ...U, ...S };
  return st.F;
}
const isLocalHost = () => ["localhost", "127.0.0.1"].includes(location.hostname);
async function ensureApp() {
  const F = await loadSdk();
  if (st.app) return F;
  const cfg = { ...FIREBASE_CONFIG };
  if (SELF_HOSTED_AUTH.includes(location.hostname)) cfg.authDomain = location.hostname;
  st.app = F.initializeApp(cfg);
  st.auth = F.initializeAuth(st.app, { persistence: [F.indexedDBLocalPersistence, F.browserLocalPersistence], popupRedirectResolver: F.browserPopupRedirectResolver });
  st.fs = F.initializeFirestore(st.app, { localCache: F.memoryLocalCache(), ignoreUndefinedProperties: true });
  // 테스트 전용: localhost에서 ?emu=1(또는 hs:emu) → 로컬 에뮬레이터
  st.emu = isLocalHost() && (new URLSearchParams(location.search).has("emu") || LS.get("emu", false));
  if (st.emu) { F.connectAuthEmulator(st.auth, "http://127.0.0.1:9099", { disableWarnings: true }); F.connectFirestoreEmulator(st.fs, "127.0.0.1", 8080); }
  return F;
}

/* ---------- 시작 / 로그인 / 로그아웃 ---------- */
let _started = false;
/** 앱 시작 시 호출. 로그인 기록이 없고 리디렉트 진행 중도 아니면 Firebase를 불러오지 않는다. */
export async function boot({ onRemote, askMerge } = {}) {
  st.onRemote = onRemote || st.onRemote; st.askMerge = askMerge || st.askMerge;
  window.addEventListener("online", () => { emit(); pushSoon(0); });
  window.addEventListener("offline", emit);
  db.onOutbox(() => { refreshPending(); pushSoon(); });
  if (!st.uid && !LS.get("sync.redirect", false)) { emit(); return; }
  db.setOutboxEnabled(!!st.uid);
  await refreshPending();
  st.phase = st.uid ? "loading" : "off"; emit();
  try { await startAuth(); } catch (e) { fail(e); }
}
async function startAuth() {
  const F = await ensureApp();
  if (_started) return; _started = true;
  if (LS.get("sync.redirect", false)) {
    LS.set("sync.redirect", false);
    try { await F.getRedirectResult(st.auth); } catch (e) { st.err = errText(e); emit(); }
  }
  F.onAuthStateChanged(st.auth, (u) => handleUser(u).catch(fail));
}
async function handleUser(u) {
  st.user = u;
  if (!u) {
    stopListeners();
    st.phase = st.uid ? "needauth" : "off"; emit(); return;
  }
  if (st.uid && st.uid !== u.uid) {
    // 다른 계정으로 로그인: 이 기기 데이터는 이전 계정 것 → 새로 붙이기(병합 질문)
    await detachLocal();
  }
  if (!st.uid) { const ok = await firstAttach(u); if (!ok) return; }
  st.email = u.email || ""; LS.set("sync.email", st.email);
  st.phase = "loading"; st.err = ""; emit();
  db.setOutboxEnabled(true);
  startListeners();
  pushSoon(0);
}
function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }
function isStandalone() { return matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true || document.referrer.startsWith("android-app://"); }
/** 구글 로그인. 데스크톱: 팝업. 모바일·설치형 앱: 리디렉트(같은 도메인 auth 도우미가 있을 때), 실패하면 팝업. */
export async function signIn() {
  const F = await ensureApp();
  if (!_started) await startAuth();
  const provider = new F.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  const redirectOk = SELF_HOSTED_AUTH.includes(location.hostname);
  if ((isMobile() || isStandalone()) && redirectOk) {
    try { LS.set("sync.redirect", true); await F.signInWithRedirect(st.auth, provider); return "redirect"; }
    catch (e) { LS.set("sync.redirect", false); console.warn("redirect 실패 → 팝업", e); }
  }
  try { await F.signInWithPopup(st.auth, provider); return "popup"; }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      LS.set("sync.redirect", true); await F.signInWithRedirect(st.auth, provider); return "redirect";
    }
    throw new Error(errText(e));
  }
}
/** 테스트(에뮬레이터) 전용 로그인 */
export async function emuSignIn(sub, email) {
  const F = await ensureApp(); if (!st.emu) throw new Error("emulator only");
  if (!_started) await startAuth();
  await F.signInWithCredential(st.auth, F.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true })));
}
/** 로그아웃: 이 기기 데이터는 그대로 두고 동기화만 끊는다(대기 중 변경이 있으면 먼저 확인). */
export async function signOut() {
  stopListeners();
  if (st.auth) await st.F.signOut(st.auth);
  await detachLocal();
  st.user = null; st.phase = "off"; emit();
}
async function detachLocal() {
  stopListeners();
  st.uid = ""; LS.set("sync.uid", ""); LS.set("sync.cursors", {}); st.lastSync = 0; LS.set("sync.last", 0);
  db.setOutboxEnabled(false); await db.rawClear("outbox"); await refreshPending();
}
function fail(e) { console.error("[sync]", e); st.phase = "error"; st.err = errText(e); emit(); }
function errText(e) {
  const c = e?.code || "";
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "로그인 창이 닫혔어요";
  if (c === "auth/unauthorized-domain") return "이 주소는 로그인이 허용되지 않았어요";
  if (c === "auth/network-request-failed") return "인터넷 연결을 확인해 주세요";
  if (c === "permission-denied") return "권한이 없어요(다시 로그인해 주세요)";
  if (c === "resource-exhausted") return "오늘 무료 사용량을 넘었어요. 내일 다시 동기화돼요";
  return e?.message || String(e);
}

/* ---------- 처음 연결: 이 기기 데이터 처리 ---------- */
async function localCounts() {
  const o = {}; for (const s of db.SYNC_STORES) o[s] = await db.count(s); return o;
}
async function cloudHasData(uid) {
  const F = st.F;
  for (const c of ["projects", "defects"]) {
    try { const snap = await F.getDocs(F.query(F.collection(st.fs, "users", uid, c), F.limit(1))); if (!snap.empty) return true; } catch (e) { if (e.code === "permission-denied") throw e; return true; }
  }
  return false;
}
async function firstAttach(u) {
  const lc = await localCounts();
  const hasLocal = lc.projects + lc.defects + lc.vendors > 0;
  let mode = "merge";
  if (hasLocal && (await cloudHasData(u.uid))) {
    mode = st.askMerge ? await st.askMerge({ local: lc, email: u.email }) : "merge";
    if (!mode) { await st.F.signOut(st.auth); st.phase = "off"; emit(); return false; } // 취소: 아무것도 바꾸지 않음
  }
  st.uid = u.uid; LS.set("sync.uid", u.uid); LS.set("sync.cursors", {});
  db.setOutboxEnabled(true);
  if (mode === "replace") {
    for (const s of db.SYNC_STORES) await db.rawClear(s);
    for (const k of db.SYNC_META) await db.rawDelMany("meta", [k]);
    await db.rawClear("outbox");
    st.onRemote?.(new Set(db.SYNC_STORES));
  } else {
    // merge: 기록된 수정 시각 그대로(최신 우선) / upload: 이 기기 것을 지금 시각으로 찍어 우선
    const now = Date.now(); const entries = [];
    for (const s of [...db.SYNC_STORES, "meta"]) {
      const all = await db.getAll(s);
      for (const v of all) {
        if (s === "meta" && !db.SYNC_META.has(v.key)) continue;
        const t0 = v._u || Date.parse(v.updatedAt || v.createdAt || v.at || "") || 1;
        const u2 = mode === "upload" ? now : t0;
        if (v._u !== u2 || !v._dev) { v._u = u2; v._dev = v._dev || db.deviceId(); await db.rawPut(s, v); }
        entries.push({ k: s + "/" + (s === "meta" ? v.key : v.id), store: s, id: s === "meta" ? v.key : v.id, at: u2, del: false });
      }
    }
    if (entries.length) { const d = await db.openDb(); for (let i = 0; i < entries.length; i += 2000) { const tx = d.transaction("outbox", "readwrite"); for (const e of entries.slice(i, i + 2000)) tx.objectStore("outbox").put(e); await db.done(tx); } }
  }
  await refreshPending();
  return true;
}

/* ---------- 위로(업로드) ---------- */
async function refreshPending() { try { st.pending = await db.count("outbox"); } catch { st.pending = 0; } emit(); }
let _pushT = 0;
function pushSoon(ms = 400) { if (!st.user || !st.uid) return; clearTimeout(_pushT); _pushT = setTimeout(() => push().catch(fail), ms); }
const ref = (coll, id) => st.F.doc(st.fs, "users", st.uid, coll, String(id));
const chunkId = (coll, id, field, i) => `${coll}~${id}~${field}~${i}`;
async function toDoc(coll, v) {
  const F = st.F; const out = {}; const blobs = {}; const chunks = [];
  let total = 0; for (const x of Object.values(v)) if (x instanceof Blob) total += x.size;
  for (const [k, x] of Object.entries(v)) {
    if (x instanceof Blob) {
      const u8 = new Uint8Array(await x.arrayBuffer());
      if (total <= INLINE_MAX) { out[k] = F.Bytes.fromUint8Array(u8); blobs[k] = { t: x.type || "image/jpeg" }; }
      else { const n = Math.ceil(u8.length / CHUNK); blobs[k] = { t: x.type || "image/jpeg", n }; for (let i = 0; i < n; i++) chunks.push({ id: chunkId(coll, v.id, k, i), b: F.Bytes.fromUint8Array(u8.subarray(i * CHUNK, (i + 1) * CHUNK)) }); }
    } else if (x !== undefined && typeof x !== "function") out[k] = x;
  }
  if (Object.keys(blobs).length) out._blobs = blobs;
  out._su = F.serverTimestamp();
  return { data: out, chunks, bytes: total + JSON.stringify(v, (kk, vv) => (vv instanceof Blob ? 0 : vv)).length };
}
async function push() {
  if (st.pushing || !st.user || !st.uid) return;
  st.pushing = true; emit();
  try {
    for (let round = 0; round < 1000; round++) {
      const all = (await db.getAll("outbox")).sort((a, b) => a.at - b.at);
      if (!all.length) break;
      const F = st.F; const batch = F.writeBatch(st.fs); const used = []; let ops = 0, bytes = 0;
      for (const e of all) {
        if (ops >= 400 || bytes > 7_000_000) break;
        if (e.del) {
          batch.set(ref(e.store, e.id), { _del: true, _u: e.at, _dev: db.deviceId(), _su: F.serverTimestamp() }); ops++;
          for (const [f, size] of Object.entries(e.blobSizes || {})) { const tot = Object.values(e.blobSizes).reduce((a, b) => a + b, 0); if (tot > INLINE_MAX) for (let i = 0; i < Math.ceil(size / CHUNK); i++) { batch.delete(ref("chunks", chunkId(e.store, e.id, f, i))); ops++; } }
        } else {
          const v = await db.get(e.store, e.id);
          if (!v) { used.push(e); continue; } // 그사이 지워짐(삭제 항목이 따로 있음)
          const d = await toDoc(e.store, v);
          if (used.length && bytes + d.bytes > 7_000_000) break;
          batch.set(ref(e.store, e.id), d.data); ops++; bytes += d.bytes;
          for (const c of d.chunks) { batch.set(ref("chunks", c.id), { o: e.store + "/" + e.id, b: c.b, _u: v._u || e.at }); ops++; }
        }
        used.push(e);
      }
      if (ops) await batch.commit(); // 오프라인이면 연결될 때까지 대기
      // 커밋 중에 같은 항목이 다시 수정됐으면(at 변경) 남겨 둔다
      const d = await db.openDb(); const tx = d.transaction("outbox", "readwrite"); const os = tx.objectStore("outbox");
      for (const e of used) { const r = os.get(e.k); r.onsuccess = () => { if (r.result && r.result.at === e.at) os.delete(e.k); }; }
      await db.done(tx);
      await refreshPending();
    }
    st.lastSync = Date.now(); LS.set("sync.last", st.lastSync);
  } finally { st.pushing = false; if (st.phase === "loading" && !st.pulling) st.phase = "ready"; emit(); }
}

/* ---------- 아래로(실시간 수신) ---------- */
function stopListeners() { st.unsubs.splice(0).forEach((u) => { try { u(); } catch {} }); }
function startListeners() {
  stopListeners();
  const F = st.F; const cursors = LS.get("sync.cursors", {});
  let first = COLLS.length; st.pulling = 0;
  for (const c of COLLS) {
    const since = F.Timestamp.fromMillis(Math.max(0, (cursors[c] || 0) - 2000));
    const qy = F.query(F.collection(st.fs, "users", st.uid, c), F.where("_su", ">", since));
    let gotFirst = false;
    const un = F.onSnapshot(qy, (snap) => {
      const ch = snap.docChanges().filter((x) => x.type !== "removed" && !x.doc.metadata.hasPendingWrites);
      const done = () => { if (!gotFirst) { gotFirst = true; if (--first === 0 && st.phase === "loading") { st.phase = "ready"; st.lastSync = Date.now(); LS.set("sync.last", st.lastSync); } } emit(); };
      if (!ch.length) return done();
      st.pulling++; emit();
      applyQueue = applyQueue.then(() => applyRemote(c, ch)).catch(fail).finally(() => { st.pulling--; done(); });
    }, (e) => fail(e));
    st.unsubs.push(un);
  }
}
let applyQueue = Promise.resolve();
const newer = (a, b) => (a._u || 0) > (b._u || 0) || ((a._u || 0) === (b._u || 0) && String(a._dev || "") > String(b._dev || ""));
async function fromDoc(coll, id, data) {
  const v = { ...data }; delete v._su; delete v._blobs; delete v._del;
  for (const [k, info] of Object.entries(data._blobs || {})) {
    if (info.n) {
      const parts = [];
      for (let i = 0; i < info.n; i++) { const s = await st.F.getDoc(ref("chunks", chunkId(coll, id, k, i))); if (!s.exists()) throw new Error("사진 조각 누락 " + id); parts.push(s.data().b.toUint8Array()); }
      v[k] = new Blob(parts, { type: info.t });
    } else if (data[k]?.toUint8Array) v[k] = new Blob([data[k].toUint8Array()], { type: info.t });
  }
  if (coll === "meta") v.key = id; else v.id = id;
  return v;
}
async function applyRemote(coll, changes) {
  const store = coll; const cursors = LS.get("sync.cursors", {}); let maxSu = cursors[coll] || 0;
  const touched = new Set(); let requeue = false;
  for (const ch of changes) {
    const id = ch.doc.id; const data = ch.doc.data({ serverTimestamps: "estimate" });
    const su = data._su?.toMillis?.() || 0; if (su > maxSu) maxSu = su;
    const pend = await db.get("outbox", store + "/" + id);
    const remote = { _u: data._u || 0, _dev: data._dev || "" };
    if (pend && pend.at > remote._u) continue;                       // 이 기기 변경이 더 최신 → 곧 올라감
    const local = await db.get(store, id);
    if (local && !pend && newer(local, remote)) { requeue = true; await db.rawPut("outbox", { k: store + "/" + id, store, id, at: local._u, del: false }); continue; }
    if (local && local._u === remote._u && local._dev === remote._dev && !data._del) { if (pend) await db.rawDelMany("outbox", [pend.k]); continue; } // 내 변경의 메아리
    if (data._del) { if (local) { await db.rawDelMany(store, [id]); touched.add(store); } }
    else { await db.rawPut(store, await fromDoc(coll, id, data)); touched.add(store); }
    if (pend) await db.rawDelMany("outbox", [pend.k]);
  }
  cursors[coll] = maxSu; LS.set("sync.cursors", cursors);
  await refreshPending();
  if (requeue) pushSoon();
  if (touched.size) st.onRemote?.(touched);
}

/** 수동 ‘지금 동기화’: 대기열 업로드 + 리스너 재연결(놓친 변경 다시 받기) */
export async function syncNow() {
  if (!st.uid) throw new Error("로그인이 필요해요");
  if (!st.user) { await startAuth(); if (!st.user) throw new Error("다시 로그인해 주세요"); }
  if (st.phase === "error") st.phase = "loading";
  st.err = ""; startListeners(); await push();
}
