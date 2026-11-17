/** 하자싹 팀 동기화 — Firebase(구글 로그인 + Firestore). 팀 현장(워크스페이스) 단위로 멤버끼리 실시간 공유.
 *  - IndexedDB가 원본 캐시(오프라인 그대로 사용). 로그인하지 않으면 이 파일은 아예 불러오지 않는다(완전 로컬).
 *  - 위로: db.js 쓰기 훅이 outbox에 쌓은 변경을 배치로 업로드(오프라인이면 대기 → 연결되면 전송).
 *  -아래로: 컬렉션별 onSnapshot(where _su > 마지막 커서) → 바뀐 문서만 받아 IndexedDB에 반영.
 *  - 충돌: 문서 단위 최신 수정 우선(_u = 수정 시각 ms, 같으면 _dev 비교). 삭제는 묘비(_del) 문서.
 *  - 경로: workspaces/{wsId} (이름·ownerUid·members{uid:역할}·memberInfo·inviteCode·maxMembers)
 *          workspaces/{wsId}/{projects(동·세대·구분·위치 목록 포함)|defects|vendors|plans|photos|meta|chunks}/{id}
 *          inviteCodes/{CODE} → {wsId}   users/{uid} → 프로필·workspaces{wsId:{name,role}}·current
 *  - 이 기기 저장소: 이 기기 전용 "hajassak", 팀 현장마다 "hajassak-ws-{id}"(전환 = 저장소 바꿔 새로고침)
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
/* 작은 기록(현장·하자·업체·설정)은 ‘묶음 문서’에 여러 건을 담는다: b/{store~번호}.i.{id} = JSON 문자열.
 * 무료 Spark 요금제의 하루 쓰기 2만 회 한도 때문 — 하자 3만 건도 첫 업로드가 묶음 수(수백 회) 쓰기로 끝난다.
 * 사진·도면(큰 바이트)은 기존처럼 건별 문서. */
const PACKED = new Set(["projects", "defects", "vendors", "meta"]);
const NB = { projects: 4, defects: 512, vendors: 16, meta: 2 };
const BLOB_COLLS = ["plans", "photos"];
const PULL_COLLS = ["b", ...BLOB_COLLS];
function hashId(id) { let h = 2166136261; const t = String(id); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const bucketOf = (store, id) => `${store}~${hashId(id) % NB[store]}`;
const PUSH_TIMEOUT = 90_000;
const INLINE_MAX = 900_000;  // 한 문서에 넣을 블롭 합계 상한(Firestore 문서 1MB)
const CHUNK = 900_000;
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("hs:" + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("hs:" + k, JSON.stringify(v)); } catch {} } };
const VBASE = new URL("../vendor/firebase/", import.meta.url).href;

/* ---------- 상태 ---------- */
const st = {
  F: null, app: null, auth: null, fs: null, user: null, uid: LS.get("sync.uid", ""), email: LS.get("sync.email", ""),
  ws: LS.get("ws", null),   // 지금 열린 팀 현장 {id, name, role} — null이면 이 기기 전용
  wsDoc: null, removed: false,
  phase: "off",          // off | loading | ready | error
  pending: 0, pushing: false, pulling: 0, lastSync: 0, err: "",
  unsubs: [], listeners: new Set(), onRemote: null, onTeam: null, emu: false,
};
export const state = st;
export const attached = () => !!(st.ws && db.DB_NAME === db.wsDbName(st.ws.id));
export const signedIn = () => !!st.user;
const ck = (k) => `sync.${k}.${st.ws?.id || "-"}`;
st.lastSync = LS.get(ck("last"), 0);
export function onChange(fn) { st.listeners.add(fn); return () => st.listeners.delete(fn); }
const emit = () => st.listeners.forEach((f) => { try { f(status()); } catch {} });
/** 헤더 칩용 요약 */
export function status() {
  const online = navigator.onLine !== false;
  if (!attached()) return st.user ? { key: "local", label: "이 기기만", detail: st.email } : { key: "login", label: "로그인 필요" };
  if (st.removed) return { key: "error", label: "팀에서 빠짐", detail: "이 팀 현장의 멤버가 아니에요" };
  if (st.phase === "error") return { key: "error", label: "동기화 오류", detail: st.err };
  if (st.phase === "off" || st.phase === "needauth") return { key: "login", label: "로그인 필요", detail: st.email };
  if (!online) return { key: "offline", label: `오프라인 · 대기 ${st.pending}건`, n: st.pending };
  const nf = (n) => Number(n).toLocaleString("ko-KR");
  if (st.slow) return { key: "busy", label: `업로드 지연 · 대기 ${nf(st.pending)}건`, n: st.pending, detail: "오늘 무료 쓰기 한도를 넘었거나 연결이 불안정해요. 이 기기 데이터는 안전하게 남아 있고, 앱을 켜 두면 자동으로 이어서 올라가요(무료 한도는 매일 오후 5시쯤 초기화)." };
  if (st.pushing && st.pushTotal > 20) return { key: "busy", label: `올리는 중 ${nf(Math.min(st.pushDone, st.pushTotal))}/${nf(st.pushTotal)}`, n: st.pending };
  if (st.pulling && st.pullTotal > 3) return { key: "busy", label: `받는 중 ${nf(Math.min(st.pullDone || 0, st.pullTotal))}/${nf(st.pullTotal)}묶음`, n: st.pending };
  if (st.phase === "loading" || st.pushing || st.pulling || st.pending) return { key: "busy", label: st.pending ? `동기화 중 · ${nf(st.pending)}건` : "동기화 중", n: st.pending };
  return { key: "ok", label: st.ws?.role === "viewer" ? "동기화됨 · 보기 전용" : "동기화됨" };
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
/** 앱 시작 시 호출. 로그인 기록이 없고 리디렉트 진행 중도 아니면 Firebase를 불러오지 않는다(완전 로컬). */
export async function boot({ onRemote, onTeam } = {}) {
  st.onRemote = onRemote || st.onRemote; st.onTeam = onTeam || st.onTeam;
  window.addEventListener("online", () => { emit(); pushSoon(0); });
  window.addEventListener("offline", emit);
  db.onOutbox(() => { refreshPending(); pushSoon(); });
  if (st.ws && !attached()) { st.ws = null; LS.set("ws", null); } // 저장소와 어긋나면 이 기기 전용으로
  db.setOutboxEnabled(attached());
  if (attached()) { db.setReadOnly(st.ws.role === "viewer"); await refreshPending(); }
  if (!st.uid && !attached() && !LS.get("sync.redirect", false)) { emit(); return; }
  st.phase = attached() ? "loading" : "off"; emit();
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
  if (!u) { stopListeners(); st.phase = attached() ? "needauth" : "off"; emit(); st.onTeam?.(); return; }
  st.uid = u.uid; LS.set("sync.uid", u.uid); st.email = u.email || ""; LS.set("sync.email", st.email);
  db.setActor({ uid: u.uid, name: actorName() });
  st.profileP = saveProfile().catch(() => {});
  if (!attached()) { st.phase = "off"; emit(); st.onTeam?.(); return; }
  st.phase = "loading"; st.err = ""; st.removed = false; emit();
  watchWorkspace();
  db.setOutboxEnabled(true);
  startListeners();
  pushSoon(0);
}
export const actorName = () => st.user?.displayName || (st.user?.email || "").split("@")[0] || "멤버";
function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }
function isStandalone() { return matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true || document.referrer.startsWith("android-app://"); }
/** 동기화 화면을 열 때 미리 불러 둔다(클릭 직후 팝업이 막히지 않게: 사용자 동작과 팝업 사이에 긴 대기가 없어야 함) */
export async function preload() { try { await ensureApp(); if (!_started) await startAuth(); } catch (e) { console.warn("[sync] preload", e); } }
/** 구글 로그인. 데스크톱: 팝업. 모바일·설치형 앱: 리디렉트(같은 도메인 auth 도우미가 있을 때), 실패하면 팝업. */
export async function signIn() {
  if (navigator.onLine === false) throw new Error("인터넷에 연결된 뒤 다시 눌러 주세요");
  let F;
  try { F = st.app ? st.F : await ensureApp(); }
  catch (e) { console.warn(e); throw new Error("로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 앱을 껐다 켠 뒤 다시 눌러 주세요"); }
  if (!_started) startAuth().catch(fail);
  const provider = new F.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  const redirectOk = SELF_HOSTED_AUTH.includes(location.hostname);
  if ((isMobile() || isStandalone()) && redirectOk) {
    try { LS.set("sync.redirect", true); await F.signInWithRedirect(st.auth, provider); return "redirect"; }
    catch (e) { LS.set("sync.redirect", false); console.warn("redirect 실패 → 팝업", e); }
  }
  try { const r = await F.signInWithPopup(st.auth, provider); await handleUser(r.user); return "popup"; }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      LS.set("sync.redirect", true); await F.signInWithRedirect(st.auth, provider); return "redirect";
    }
    throw new Error(errText(e));
  }
}
/** 테스트(에뮬레이터) 전용 로그인 */
export async function emuSignIn(sub, email, name) {
  const F = await ensureApp(); if (!st.emu) throw new Error("emulator only");
  if (!_started) await startAuth();
  const r = await F.signInWithCredential(st.auth, F.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: name || sub })));
  if (name && !r.user.displayName) await F.updateProfile(r.user, { displayName: name });
  await handleUser(st.auth.currentUser);
}
/** 로그아웃: 동기화만 멈춘다. 팀 현장 데이터는 이 기기에 남겨 두고(다시 로그인하면 이어서), 화면은 이 기기 전용 데이터로. */
export async function signOut() {
  stopListeners();
  if (st.auth) await st.F.signOut(st.auth);
  st.user = null; st.uid = ""; LS.set("sync.uid", ""); db.setActor(null);
  if (attached()) return switchTo(null);
  st.phase = "off"; emit();
}
function fail(e) { console.error("[sync]", e); st.phase = "error"; st.err = errText(e); emit(); }
function errText(e) {
  const c = e?.code || "";
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "로그인 창이 닫혔어요";
  if (c === "auth/unauthorized-domain") return "이 주소는 로그인이 허용되지 않았어요";
  if (c === "auth/network-request-failed" || c === "unavailable") return "인터넷 연결을 확인해 주세요";
  if (c === "permission-denied") return "권한이 없어요(팀 멤버인지, 보기 전용인지 확인해 주세요)";
  if (c === "resource-exhausted") return "오늘 무료 사용량을 넘었어요. 내일 다시 동기화돼요";
  return e?.message || String(e);
}

/* ---------- 팀 현장(워크스페이스) ---------- */
const need = () => { if (!st.user) throw new Error("먼저 구글로 로그인해 주세요"); if (navigator.onLine === false) throw new Error("인터넷 연결이 필요해요"); };
const wsRef = (id) => st.F.doc(st.fs, "workspaces", id);
const userRef = () => st.F.doc(st.fs, "users", st.uid);
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O·1/I 제외
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ABC[b % CODE_ABC.length]).join("");
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
export const inviteLink = (code) => `https://dldnrwls0128-blip.github.io/hajassak/?join=${code}`;
async function saveProfile() {
  const F = st.F; await F.setDoc(userRef(), { name: actorName(), email: st.email, photo: st.user?.photoURL || "", seenAt: F.serverTimestamp() }, { merge: true });
}
/** 내가 속한 팀 현장 목록(users/{uid}.workspaces를 실제 멤버십으로 확인) */
export async function myWorkspaces() {
  need(); const F = st.F; const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  // 로그인 직후엔 Firestore가 새 토큰을 받기 전이라 잠깐 거부될 수 있어 몇 번 다시 시도
  await st.profileP; // 프로필 쓰기가 끝난 뒤 서버에서 읽기(대기 중인 로컬 쓰기만 보이는 경우 방지)
  let u = null; for (let i = 0; ; i++) { try { u = await F.getDocFromServer(userRef()).catch((e) => (e.code === "unavailable" ? F.getDoc(userRef()) : Promise.reject(e))); break; } catch (e) { if (i >= 4 || e.code !== "permission-denied") throw e; await nap(400 * (i + 1)); } }
  const map = u.exists() ? u.data().workspaces || {} : {};
  const out = [];
  for (const [id] of Object.entries(map)) {
    let w = null, gone = false;
    for (let i = 0; i < 3; i++) { try { w = await F.getDoc(wsRef(id)); gone = !w.exists() || !w.data().members?.[st.uid]; break; } catch (e) { if (e.code === "permission-denied") gone = true; else { gone = false; break; } await nap(400); } }
    if (w && !gone) out.push({ id, name: w.data().name, role: w.data().members[st.uid], members: Object.keys(w.data().members).length, owner: w.data().ownerUid === st.uid });
    else if (gone) await F.setDoc(userRef(), { workspaces: { [id]: F.deleteField() } }, { merge: true }).catch(() => {}); // 빠진 팀은 목록에서 정리
  }
  return out;
}
/** 팀 현장 만들기: 지금 이 기기 데이터(현장·하자·사진·업체…)를 새 팀 현장으로 복사해 올리고 그 현장으로 전환 */
const SLOW_MSG = "서버가 응답하지 않아요(오늘 무료 사용 한도를 넘었거나 연결이 불안정해요). 이 기기 데이터는 그대로 있어요. 잠시 뒤 다시 눌러 주세요(무료 한도는 매일 오후 5시쯤 초기화)";
function withTimeout(p, ms = 25000) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(SLOW_MSG), { code: "slow" })), ms))]); }
export async function createWorkspace(name, { workspaceCount = 0, isPro = false, memberLimit = 3 } = {}) {
  need(); const F = st.F;
  if (!isPro && workspaceCount >= 1) throw Object.assign(new Error("무료판은 팀 현장 1개까지예요. 하자싹 프로에서 늘릴 수 있어요"), { pro: true });
  const id = F.doc(F.collection(st.fs, "workspaces")).id;
  for (let tries = 0; tries < 5; tries++) {
    const code = newCode(); const b = F.writeBatch(st.fs);
    b.set(wsRef(id), { name: name || "팀 현장", ownerUid: st.uid, members: { [st.uid]: "owner" }, memberInfo: { [st.uid]: { name: actorName(), email: st.email } },
      inviteCode: code, maxMembers: memberLimit, createdAt: F.serverTimestamp() });
    b.set(F.doc(st.fs, "inviteCodes", code), { wsId: id, by: st.uid, at: F.serverTimestamp() });
    b.set(userRef(), { workspaces: { [id]: { name: name || "팀 현장", role: "owner" } }, current: id }, { merge: true });
    try { await withTimeout(b.commit()); break; } catch (e) { if (e.code !== "permission-denied" || tries === 4) throw e; } // 코드가 겹치면(이미 있음) 다시
  }
  await copyInto(db.DB_NAME, db.wsDbName(id), { includeMeta: true });
  return switchTo({ id, name: name || "팀 현장", role: "owner" });
}
/** 초대코드로 참여: 코드 → wsId 조회 후 나 자신만 ‘편집’ 멤버로 추가(규칙이 코드 일치·자기 자신만·정원 확인) */
export async function lookupCode(code) {
  need(); const F = st.F; code = normCode(code);
  if (code.length !== 6) throw new Error("초대코드 6자리를 확인해 주세요");
  const c = await F.getDoc(F.doc(st.fs, "inviteCodes", code));
  if (!c.exists()) throw new Error("초대코드가 맞지 않아요(바뀌었을 수 있어요)");
  return { code, wsId: c.data().wsId };
}
export async function joinWorkspace(code, { workspaceCount = 0, isPro = false, mergeLocal = false } = {}) {
  const { wsId } = await lookupCode(code); const F = st.F; code = normCode(code);
  let w = null; try { w = await F.getDoc(wsRef(wsId)); } catch {}
  let role = w?.exists() ? w.data().members?.[st.uid] : null; let name = w?.exists() ? w.data().name : "";
  if (!role) {
    if (!isPro && workspaceCount >= 1) throw Object.assign(new Error("무료판은 팀 현장 1개까지예요. 하자싹 프로에서 늘릴 수 있어요"), { pro: true });
    try { await withTimeout(F.updateDoc(wsRef(wsId), { [`members.${st.uid}`]: "editor", [`memberInfo.${st.uid}`]: { name: actorName(), email: st.email }, lastJoin: { uid: st.uid, code, at: F.serverTimestamp() } })); }
    catch (e) { if (e.code === "slow") throw e; if (e.code === "permission-denied") throw new Error("참여할 수 없어요. 초대코드가 바뀌었거나 팀 인원이 꽉 찼어요(무료판 3명)"); throw e; }
    w = await F.getDoc(wsRef(wsId)); role = w.data().members[st.uid]; name = w.data().name;
  }
  await F.setDoc(userRef(), { workspaces: { [wsId]: { name, role } }, current: wsId }, { merge: true });
  if (mergeLocal) await copyInto(db.DB_NAME, db.wsDbName(wsId), { includeMeta: false });
  return switchTo({ id: wsId, name, role });
}
/** 팀 현장 열기(전환). mergeLocal: 이 기기 전용 데이터를 그 팀 현장에 합쳐 올림 */
export async function openWorkspace(ws, { mergeLocal = false } = {}) {
  if (mergeLocal) await copyInto(db.LOCAL_DB, db.wsDbName(ws.id), { includeMeta: false });
  if (st.user) await st.F.setDoc(userRef(), { current: ws.id }, { merge: true }).catch(() => {});
  return switchTo(ws);
}
/** 저장소를 바꾸고 새로고침(ws=null → 이 기기 전용) */
export function switchTo(ws) {
  stopListeners();
  LS.set("ws", ws); try { localStorage.setItem("hs:db", ws ? db.wsDbName(ws.id) : db.LOCAL_DB); } catch {}
  setTimeout(() => location.reload(), 50);
  return new Promise(() => {}); // 새로고침 대기
}
/** 다른 저장소의 데이터를 복사해 넣고 outbox에 올림(같은 ID는 최근 수정 우선) */
async function copyInto(fromName, toName, { includeMeta }) {
  if (fromName === toName) return;
  const src = await db.openDbNamed(fromName), dst = await db.openDbNamed(toName);
  const all = (d, s) => new Promise((res, rej) => { const r = d.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const entries = [];
  for (const s of [...db.SYNC_STORES, ...(includeMeta ? ["meta"] : [])]) {
    const rows = (await all(src, s)).filter((v) => s !== "meta" || db.SYNC_META.has(v.key)); if (!rows.length) continue;
    const have = new Map((await all(dst, s)).map((v) => [s === "meta" ? v.key : v.id, v]));
    const tx = dst.transaction([s, "outbox"], "readwrite");
    for (const v of rows) {
      const id = s === "meta" ? v.key : v.id; const cur = have.get(id);
      v._u = v._u || Date.parse(v.updatedAt || v.createdAt || v.at || "") || 1; v._dev = v._dev || db.deviceId();
      if (st.user && (s === "defects" || s === "photos") && !v.createdBy) { v.createdBy = actorName(); v.createdByUid = st.uid; v.createdByAt = v.createdAt || new Date(v._u).toISOString(); }
      if (cur && (cur._u || 0) >= v._u) continue;
      tx.objectStore(s).put(v); tx.objectStore("outbox").put({ k: s + "/" + id, store: s, id, at: v._u, del: false }); entries.push(id);
    }
    await db.done(tx);
  }
  if (fromName !== db.DB_NAME) src.close(); if (toName !== db.DB_NAME) dst.close();
  return entries.length;
}
/** 지금 팀 현장 문서 실시간 감시: 역할 변경·강퇴 반영 */
function watchWorkspace() {
  const F = st.F;
  try { st.wsUnsub?.(); } catch {}
  st.wsUnsub = (F.onSnapshot(wsRef(st.ws.id), (snap) => {
    const d = snap.data(); const role = d?.members?.[st.uid];
    if (!snap.exists() || !role) { st.removed = true; stopListeners(); db.setOutboxEnabled(false); emit(); st.onTeam?.(); return; }
    st.wsDoc = { id: snap.id, ...d };
    if (role !== st.ws.role || d.name !== st.ws.name) { st.ws = { ...st.ws, role, name: d.name }; LS.set("ws", st.ws); db.setReadOnly(role === "viewer"); }
    emit(); st.onTeam?.();
  }, (e) => { if (e.code === "permission-denied") { st.removed = true; stopListeners(); emit(); st.onTeam?.(); } else fail(e); }));
}
export const isOwner = () => st.wsDoc?.ownerUid === st.uid;
export function members() {
  const d = st.wsDoc; if (!d) return [];
  return Object.entries(d.members || {}).map(([uid, role]) => ({ uid, role, me: uid === st.uid, ...(d.memberInfo?.[uid] || {}) }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : String(a.name).localeCompare(String(b.name))));
}
export async function setRole(uid, role) { need(); if (!["editor", "viewer"].includes(role)) throw new Error("역할 오류"); await st.F.updateDoc(wsRef(st.ws.id), { [`members.${uid}`]: role }); }
export async function removeMember(uid) { need(); const F = st.F; await F.updateDoc(wsRef(st.ws.id), { [`members.${uid}`]: F.deleteField(), [`memberInfo.${uid}`]: F.deleteField() }); }
export async function renameWorkspace(name) { need(); await st.F.updateDoc(wsRef(st.ws.id), { name }); }
export async function setMaxMembers(n) { need(); await st.F.updateDoc(wsRef(st.ws.id), { maxMembers: n }); }
/** 초대코드 새로 만들기(옛 코드·링크는 더 이상 안 됨) */
export async function regenerateCode() {
  need(); const F = st.F; const old = st.wsDoc?.inviteCode;
  for (let i = 0; i < 5; i++) { const code = newCode(); const b = F.writeBatch(st.fs);
    b.set(F.doc(st.fs, "inviteCodes", code), { wsId: st.ws.id, by: st.uid, at: F.serverTimestamp() }); b.update(wsRef(st.ws.id), { inviteCode: code });
    if (old) b.delete(F.doc(st.fs, "inviteCodes", old));
    try { await b.commit(); return code; } catch (e) { if (i === 4) throw e; } }
}
/** 팀 나가기(소유자는 불가): 대기 중 변경을 먼저 올리고, 이 기기의 그 팀 저장소를 지운 뒤 이 기기 전용으로 */
export async function leaveWorkspace() {
  need(); const F = st.F; if (isOwner()) throw new Error("소유자는 나갈 수 없어요");
  try { await Promise.race([push(), new Promise((r) => setTimeout(r, 20000))]); } catch {}
  const left = await db.count("outbox").catch(() => 0);
  if (left > 0) throw new Error(`아직 팀에 올라가지 않은 변경 ${left}건이 있어요. 인터넷이 연결된 상태에서 다 올라간 뒤(칩이 ‘동기화됨’) 다시 나가 주세요`);
  const id = st.ws.id;
  await F.updateDoc(wsRef(id), { [`members.${st.uid}`]: F.deleteField(), [`memberInfo.${st.uid}`]: F.deleteField() });
  await F.setDoc(userRef(), { workspaces: { [id]: F.deleteField() }, current: "" }, { merge: true });
  stopListeners(); LS.set(ck("cursors"), {});
  try { localStorage.setItem("hs:db", db.LOCAL_DB); LS.set("ws", null); } catch {}
  try { indexedDB.deleteDatabase(db.wsDbName(id)); } catch {}
  setTimeout(() => location.reload(), 50); return new Promise(() => {});
}
export async function localCounts(name = db.LOCAL_DB) {
  const d = await db.openDbNamed(name); const o = {};
  for (const s of db.SYNC_STORES) o[s] = await new Promise((res) => { const r = d.transaction(s).objectStore(s).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); });
  if (name !== db.DB_NAME) d.close(); return o;
}

/* ---------- 위로(업로드) ---------- */
async function refreshPending() { try { st.pending = await db.count("outbox"); } catch { st.pending = 0; } emit(); }
let _pushT = 0;
function pushSoon(ms = 400) { if (!st.user || !attached() || st.removed) return; clearTimeout(_pushT); _pushT = setTimeout(() => push().catch(fail), ms); }
const ref = (coll, id) => st.F.doc(st.fs, "workspaces", st.ws.id, coll, String(id));
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
const packVal = (v) => JSON.stringify(v, (k, x) => (x instanceof Blob || typeof x === "function" ? undefined : x));
/** 커밋이 오래 안 끝나면(무료 한도 초과·연결 불안정) 상태에 표시. 커밋 자체는 SDK가 계속 재시도하므로 기다린다. */
async function commitWatched(batch) {
  let slow = setTimeout(() => { st.slow = true; emit(); }, PUSH_TIMEOUT);
  try { await batch.commit(); } finally { clearTimeout(slow); if (st.slow) { st.slow = false; emit(); } }
}
async function push() {
  if (st.pushing || !st.user || !attached() || st.removed) return;
  st.pushing = true; st.pushDone = 0; st.pushTotal = await db.count("outbox").catch(() => 0); emit();
  let vnames = null;
  try {
    for (let round = 0; round < 100000; round++) {
      // 현장·업체·설정을 먼저(다른 기기에서 업체 이름이 ‘?’로 보이지 않게), 그다음 하자, 사진·도면은 마지막
      const PRI = { projects: 0, vendors: 0, meta: 0, defects: 1, plans: 2, photos: 3 };
      const all = (await db.getAll("outbox")).sort((a, b) => (PRI[a.store] ?? 1) - (PRI[b.store] ?? 1) || a.at - b.at);
      if (!all.length) break;
      st.pushTotal = Math.max(st.pushTotal, st.pushDone + all.length);
      const F = st.F; const batch = F.writeBatch(st.fs); const used = []; let ops = 0, bytes = 0;
      const buckets = new Map(); // 묶음 문서 id → {store, items:{id: json}}
      // 묶음 대상 값을 한 번에 읽기(건별 get 3만 번 대신)
      const pre = new Map(); { const by = {}; for (const e of all.slice(0, 12000)) if (PACKED.has(e.store) && !e.del) (by[e.store] ||= []).push(e.id);
        for (const [store, ids] of Object.entries(by)) { const vals = await db.getMany(store, ids); ids.forEach((id, k) => pre.set(store + "/" + id, vals[k] || null)); } }
      for (const e of all) {
        if (ops >= 450 || bytes > 6_000_000) break;
        if (PACKED.has(e.store)) {
          const bid = bucketOf(e.store, e.id); let b = buckets.get(bid);
          if (!b) { if (ops >= 450) break; b = { store: e.store, items: {} }; buckets.set(bid, b); ops++; }
          let val;
          if (e.del) val = JSON.stringify({ _del: 1, _u: e.at, _dev: db.deviceId() });
          else {
            const v = pre.has(e.k) ? pre.get(e.k) : await db.get(e.store, e.id); if (!v) { used.push(e); continue; }
            if (e.store === "defects" && v.vendorId && !v.vendorName) { // 업체 이름도 함께(받는 쪽에 업체 기록이 아직 없을 때 표시용)
              if (!vnames) vnames = new Map((await db.getAll("vendors")).map((x) => [x.id, x.name]));
              const nm = vnames.get(v.vendorId); if (nm) v.vendorName = nm;
            }
            val = packVal(v);
          }
          b.items[e.id] = val; bytes += val.length + 40; used.push(e); continue;
        }
        if (e.del) {
          batch.set(ref(e.store, e.id), { _del: true, _u: e.at, _dev: db.deviceId(), _su: F.serverTimestamp() }); ops++;
          for (const [f, size] of Object.entries(e.blobSizes || {})) { const tot = Object.values(e.blobSizes).reduce((a, b) => a + b, 0); if (tot > INLINE_MAX) for (let i = 0; i < Math.ceil(size / CHUNK); i++) { batch.delete(ref("chunks", chunkId(e.store, e.id, f, i))); ops++; } }
        } else {
          const v = await db.get(e.store, e.id);
          if (!v) { used.push(e); continue; } // 그사이 지워짐(삭제 항목이 따로 있음)
          const d = await toDoc(e.store, v);
          if (used.length && bytes + d.bytes > 6_000_000) break;
          batch.set(ref(e.store, e.id), d.data); ops++; bytes += d.bytes;
          for (const c of d.chunks) { batch.set(ref("chunks", c.id), { o: e.store + "/" + e.id, b: c.b, _u: v._u || e.at }); ops++; }
        }
        used.push(e);
      }
      // 묶음 문서: 바뀐 항목 필드만 통째로 교체(mergeFields) → 다른 사람이 같은 묶음의 다른 항목을 고쳐도 덮어쓰지 않음
      for (const [bid, b] of buckets) {
        const data = { s: b.store, _su: F.serverTimestamp(), i: b.items };
        const fields = ["s", "_su", ...Object.keys(b.items).map((id) => new F.FieldPath("i", String(id)))];
        batch.set(ref("b", bid), data, { mergeFields: fields });
      }
      if (ops) await commitWatched(batch); // 오프라인이면 연결될 때까지 대기
      // 커밋 중에 같은 항목이 다시 수정됐으면(at 변경) 남겨 둔다
      const d = await db.openDb(); const tx = d.transaction("outbox", "readwrite"); const os = tx.objectStore("outbox");
      for (const e of used) { const r = os.get(e.k); r.onsuccess = () => { if (r.result && r.result.at === e.at) os.delete(e.k); }; }
      await db.done(tx);
      st.pushDone += used.length;
      await refreshPending();
    }
    st.lastSync = Date.now(); LS.set(ck("last"), st.lastSync);
  } finally { st.pushing = false; st.pushTotal = 0; st.pushDone = 0; if (st.phase === "loading" && !st.pulling) st.phase = "ready"; emit(); }
}

/* ---------- 아래로(실시간 수신) ---------- */
function stopListeners() { stopColl(); try { st.wsUnsub?.(); } catch {} st.wsUnsub = null; }
function stopColl() { st.unsubs.splice(0).forEach((u) => { try { u(); } catch {} }); }
function startListeners() {
  stopColl();
  const F = st.F; const cursors = LS.get(ck("cursors"), {});
  let first = PULL_COLLS.length; st.pulling = 0;
  for (const c of PULL_COLLS) {
    const since = F.Timestamp.fromMillis(Math.max(0, (cursors[c] || 0) - 2000));
    const qy = F.query(F.collection(st.fs, "workspaces", st.ws.id, c), F.where("_su", ">", since));
    let gotFirst = false;
    const un = F.onSnapshot(qy, (snap) => {
      const ch = snap.docChanges().filter((x) => x.type !== "removed" && !x.doc.metadata.hasPendingWrites);
      const done = () => { if (!gotFirst) { gotFirst = true; if (--first === 0 && st.phase === "loading") { st.phase = "ready"; st.lastSync = Date.now(); LS.set(ck("last"), st.lastSync); } } emit(); };
      if (!ch.length) return done();
      st.pulling++; emit();
      if (c === "b") { st.pullTotal = (st.pullTotal || 0) + ch.length; emit(); }
      applyQueue = applyQueue.then(() => (c === "b" ? applyBuckets(ch) : applyRemote(c, ch))).catch(fail).finally(() => { st.pulling--; if (!st.pulling) { st.pullTotal = 0; st.pullDone = 0; } done(); });
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
  const store = coll; const cursors = LS.get(ck("cursors"), {}); let maxSu = cursors[coll] || 0;
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
  cursors[coll] = maxSu; LS.set(ck("cursors"), cursors);
  await refreshPending();
  if (requeue) pushSoon();
  if (touched.size) st.onRemote?.(touched);
}

/** 묶음 문서 반영: 항목마다 최신 수정 우선 비교(applyRemote와 같은 규칙) */
async function applyBuckets(changes) {
  const cursors = LS.get(ck("cursors"), {}); let maxSu = cursors.b || 0;
  const touched = new Set(); let requeue = false;
  for (const ch of changes) {
    const data = ch.doc.data({ serverTimestamps: "estimate" }); const store = data.s;
    const su = data._su?.toMillis?.() || 0; if (su > maxSu) maxSu = su;
    if (!PACKED.has(store)) continue;
    const ids = Object.keys(data.i || {});
    const pends = new Map((await db.getMany("outbox", ids.map((id) => store + "/" + id))).filter(Boolean).map((p) => [p.id, p]));
    const locals = new Map((await db.getMany(store, ids)).map((v, k) => [ids[k], v]));
    const puts = [], dels = [], outDel = [], outPut = [];
    for (const id of ids) {
      let r; try { r = JSON.parse(data.i[id]); } catch { continue; }
      const remote = { _u: r._u || 0, _dev: r._dev || "" };
      const pend = pends.get(id); const local = locals.get(id);
      if (pend && pend.at > remote._u) continue;
      if (local && !pend && newer(local, remote)) { requeue = true; outPut.push({ k: store + "/" + id, store, id, at: local._u, del: false }); continue; }
      if (local && local._u === remote._u && local._dev === remote._dev && !r._del) { if (pend) outDel.push(pend.k); continue; }
      if (r._del) { if (local) dels.push(id); }
      else if (!local || local._u !== remote._u || local._dev !== remote._dev) { if (store === "meta") r.key = id; else r.id = id; puts.push(r); }
      if (pend) outDel.push(pend.k);
    }
    if (puts.length) { await db.rawPutMany(store, puts); touched.add(store); }
    if (dels.length) { await db.rawDelMany(store, dels); touched.add(store); }
    if (outDel.length) await db.rawDelMany("outbox", outDel);
    if (outPut.length) await db.rawPutMany("outbox", outPut);
    st.pullDone = (st.pullDone || 0) + 1; emit();
  }
  cursors.b = maxSu; LS.set(ck("cursors"), cursors);
  await refreshPending();
  if (requeue) pushSoon();
  if (touched.size) st.onRemote?.(touched);
}

/** 수동 ‘지금 동기화’: 대기열 업로드 + 리스너 재연결(놓친 변경 다시 받기) */
export async function syncNow() {
  if (!attached()) throw new Error("팀 현장을 먼저 만들거나 참여해 주세요");
  if (!st.user) { await startAuth(); if (!st.user) throw new Error("다시 로그인해 주세요"); }
  if (st.removed) throw new Error("이 팀 현장의 멤버가 아니에요");
  if (st.phase === "error") st.phase = "loading";
  st.err = ""; stopListeners(); watchWorkspace(); startListeners(); await push();
}
