/** 1.5.0 협력업체(vendor) — 팀 멤버(members)와 따로. 규칙: firebase/firestore.rules ‘1.5.0 협력업체’
 *  관리자(owner·editor): 업체 초대(현장 1개·업체 1곳·기한·1회용) · 해제 · 재발급, 업체 몫 목록(vq)·조치 전 사진(vp) 게시,
 *                       업체 조치 보고(vendorReports) 받기 → ‘확인 대기’, [승인]=확인완료 · [재작업]=사유 필수 재접수, 이력 남김.
 *  업체: ?vjoin=CODE 링크로 참여 → 자기 업체 하자만 보고 ‘조치 완료’(사진 ≤3·메모)를 올림. 하자 본문·현장 설정은 못 고침. */
import * as Sync from "./sync.js";

const LSX = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("hs:" + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("hs:" + k, JSON.stringify(v)); } catch {} } };
export const VCODE_LEN = 10;
export const INVITE_DAYS = [3, 7, 14, 30];
export const MAX_REPORT_PHOTOS = 3;
const QUEUE_BYTES = 600_000;
export const vjoinLink = (code) => `https://dldnrwls0128-blip.github.io/hajassak/?vjoin=${code}`;
export const normVCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, VCODE_LEN);
export function newVCode(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) { const abc = Sync.CODE_CHARS; return Array.from(rand(VCODE_LEN), (b) => abc[b % abc.length]).join(""); }
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : t ? Date.parse(t) : 0);

/* ---------- 순수 로직(단위 테스트) ---------- */
/** 초대 상태: active(사용 전) · used(업체가 씀) · revoked(해제) · expired(기한 지남) */
export function inviteState(inv, now = Date.now()) {
  if (!inv) return "missing";
  if (inv.revoked) return "revoked";
  if (inv.usedBy) return "used";
  if (ms(inv.exp) <= now) return "expired";
  return "active";
}
export const INVITE_KO = { active: "참여 전", used: "참여 중", revoked: "해제됨", expired: "기한 지남", missing: "없음" };
/** 업체에게 보낼 하자 목록: 그 현장·그 업체 몫, 확인완료 제외. 본문은 짧게(현장 설정·다른 업체 정보 없음) */
export function queueItems(defects, { vendorId, projectId }, { locText = (d) => d.loc || "", tradeText = (d) => d.trade || "", beforeIds = () => [] } = {}) {
  return (defects || []).filter((d) => d.projectId === projectId && d.vendorId === vendorId && d.status !== "확인완료" && !d._del)
    .map((d) => ({ id: d.id, loc: String(locText(d) || "").slice(0, 80), trade: String(tradeText(d) || "").slice(0, 60), type: String(d.type || "").slice(0, 40), content: String(d.content || "").slice(0, 300), status: d.status, due: d.due || "", rework: d.status === "재접수" ? String(d.reworkReason || "").slice(0, 300) : "", wait: d.status === "조치완료", ph: beforeIds(d).slice(0, 2) }))
    .sort((a, b) => (a.rework ? 0 : 1) - (b.rework ? 0 : 1) || String(a.loc).localeCompare(String(b.loc), "ko", { numeric: true }));
}
/** 목록을 문서 크기 한도 안으로 나눔 */
export function chunkItems(items, max = QUEUE_BYTES) {
  const out = []; let cur = [], size = 2;
  for (const it of items) { const s = JSON.stringify(it).length * 3 + 1; if (cur.length && size + s > max) { out.push(cur); cur = []; size = 2; } cur.push(it); size += s; }
  if (cur.length || !out.length) out.push(cur);
  return out;
}
/** 업체 화면에서 보일 상태: 재작업 · 확인 대기 · 승인됨 · 조치 필요 */
export function vendorView(items, reports) {
  const last = new Map();
  for (const r of [...(reports || [])].sort((a, b) => ms(a.at) - ms(b.at))) last.set(r.defectId, r);
  return (items || []).map((it) => {
    const r = last.get(it.id);
    let st = "todo";
    if (r?.state === "pending") st = "wait";
    /* 승인된 뒤에도 목록에 있으면 관리자가 다시 연 하자 → 조치 필요 */
    else if (it.rework || r?.state === "rework") st = "rework";
    else if (it.wait) st = "wait";
    return { ...it, st, reason: it.rework || (r?.state === "rework" ? r.reason || "" : ""), report: r || null };
  });
}
export const VSTATE_KO = { todo: "조치 필요", wait: "확인 대기", rework: "재작업", done: "승인됨" };
/** 관리자 결정 검증: 재작업은 사유 필수 */
export function checkDecision(action, reason) {
  if (!["approve", "rework"].includes(action)) throw new Error("알 수 없는 처리");
  if (action === "rework" && !String(reason || "").trim()) throw new Error("재작업 사유를 적어 주세요");
  if (String(reason || "").length > 300) throw new Error("사유는 300자까지예요");
  return { state: action === "approve" ? "approved" : "rework", reason: action === "rework" ? String(reason).trim() : "" };
}
/** 업체 인원은 팀 인원(무료 10명)에 세지 않음 — 업체 1곳당 사용 중인 계정 1개(초대 1회용) */
export function seatSummary(members, vendorMembers) { return { team: Object.keys(members || {}).length, vendors: (vendorMembers || []).length, counted: Object.keys(members || {}).length }; }

/* ---------- Firestore 경로 ---------- */
const S = () => Sync.state;
const wsCol = (wsId, c) => S().F.collection(S().fs, "workspaces", wsId, c);
const wsDoc = (wsId, c, id) => S().F.doc(S().fs, "workspaces", wsId, c, id);
const isMgr = () => Sync.attached() && Sync.signedIn() && ["owner", "editor"].includes(Sync.state.ws?.role);
export const managerOn = isMgr;

/* ---------- 관리자: 초대 ---------- */
export async function createInvite({ vendorId, vendorName, projectId, projectName, days = 7 }) {
  if (!isMgr()) throw new Error("팀 현장의 소유자·편집 멤버만 업체를 초대할 수 있어요");
  if (!vendorId) throw new Error("업체를 골라 주세요");
  const F = S().F; const wsId = Sync.state.ws.id; const code = newVCode();
  const exp = F.Timestamp.fromMillis(Date.now() + Math.min(30, Math.max(1, days)) * 86400000);
  const b = F.writeBatch(S().fs);
  b.set(wsDoc(wsId, "vendorInvites", code), { wsId, wsName: Sync.state.ws.name || "", projectId, projectName: projectName || "", vendorId, vendorName: vendorName || "", by: S().uid, at: F.serverTimestamp(), exp, revoked: false });
  b.set(F.doc(S().fs, "vendorCodes", code), { wsId, by: S().uid, at: F.serverTimestamp() });
  await b.commit();
  return { code, link: vjoinLink(code), exp: exp.toMillis() };
}
export async function listInvites() {
  if (!isMgr()) return [];
  const F = S().F; const s = await F.getDocs(wsCol(Sync.state.ws.id, "vendorInvites"));
  return s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => ms(b.at) - ms(a.at));
}
export async function listVendorMembers() {
  if (!Sync.attached() || !Sync.signedIn()) return [];
  const F = S().F; const s = await F.getDocs(wsCol(Sync.state.ws.id, "vendorMembers"));
  return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
/** 해제: 초대를 막고, 그 초대로 들어온 업체 계정을 내보냄 */
export async function revokeInvite(code) {
  if (!isMgr()) throw new Error("권한이 없어요");
  const F = S().F; const wsId = Sync.state.ws.id;
  const snap = await F.getDoc(wsDoc(wsId, "vendorInvites", code)); if (!snap.exists()) return;
  const inv = snap.data();
  const b = F.writeBatch(S().fs);
  if (!inv.revoked) b.update(wsDoc(wsId, "vendorInvites", code), { revoked: true, revokedBy: S().uid, revokedAt: F.serverTimestamp() });
  if (inv.usedBy) b.delete(wsDoc(wsId, "vendorMembers", inv.usedBy));
  b.delete(F.doc(S().fs, "vendorCodes", code));
  await b.commit();
}
/** 재발급: 예전 초대 해제 + 같은 업체·현장으로 새 코드 */
export async function reissueInvite(code, days = 7) {
  const F = S().F; const snap = await F.getDoc(wsDoc(Sync.state.ws.id, "vendorInvites", code)); if (!snap.exists()) throw new Error("초대를 찾지 못했어요");
  const inv = snap.data(); await revokeInvite(code);
  return createInvite({ vendorId: inv.vendorId, vendorName: inv.vendorName, projectId: inv.projectId, projectName: inv.projectName, days });
}

/* ---------- 관리자: 보고 받기·결정·목록 게시 ---------- */
const MG = { unsub: null, unsubVM: null, ws: "", pending: [], bindings: [], hooks: null, pubT: 0, pubHash: new Map(), pubPh: new Map(), ingested: new Set() };
export const pendingReports = () => MG.pending;
export const pendingCount = () => MG.pending.length;
export function startManager(hooks) {
  MG.hooks = hooks;
  const ok = isMgr();
  if (!ok || MG.ws !== Sync.state.ws?.id) { stopManager(); }
  if (!ok || MG.unsub) return;
  const F = S().F; const wsId = Sync.state.ws.id; MG.ws = wsId;
  MG.unsub = F.onSnapshot(F.query(wsCol(wsId, "vendorReports"), F.where("state", "==", "pending")), (snap) => {
    MG.pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.at) - ms(b.at));
    reingest();
    hooks.onChange?.();
  }, (e) => console.warn("[vendor] reports", e));
  MG.unsubVM = F.onSnapshot(wsCol(wsId, "vendorMembers"), (snap) => {
    MG.bindings = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    schedulePublish(300); hooks.onChange?.();
  }, (e) => console.warn("[vendor] members", e));
}
/** 대기 보고를 하자 상태(조치완료·확인 대기)에 반영 — 하자가 아직 안 받아졌으면 다음에 다시 */
export function reingest() {
  for (const r of MG.pending) if (!MG.ingested.has(r.id)) { MG.ingested.add(r.id); Promise.resolve(MG.hooks?.ingest?.(r)).then((ok) => { if (!ok) MG.ingested.delete(r.id); }, () => MG.ingested.delete(r.id)); }
}
export function stopManager() { try { MG.unsub?.(); MG.unsubVM?.(); } catch {} MG.unsub = MG.unsubVM = null; MG.pending = []; MG.bindings = []; MG.ws = ""; }
export const vendorBindings = () => MG.bindings;
export function schedulePublish(delay = 1500) { clearTimeout(MG.pubT); MG.pubT = setTimeout(() => publishAll().catch((e) => console.warn("[vendor] publish", e)), delay); }
/** 업체마다 목록(vq)·조치 전 사진(vp) 게시 — 바뀐 것만 씀 */
export async function publishAll() {
  if (!isMgr() || !MG.hooks) return 0;
  const F = S().F; const wsId = Sync.state.ws.id; let writes = 0;
  const seen = new Set();
  for (const bd of MG.bindings) {
    const key = `${bd.vendorId}_${bd.projectId}`; if (seen.has(key)) continue; seen.add(key);
    const bmap = (await MG.hooks.beforeMap?.(bd)) || new Map();
    const items = queueItems(MG.hooks.defects(), bd, { ...MG.hooks, beforeIds: (d) => bmap.get(d.id) || [] });
    const chunks = chunkItems(items); const hash = JSON.stringify(chunks);
    const prevN = MG.pubHash.get(key)?.n ?? 4;
    if (MG.pubHash.get(key)?.h !== hash) {
      const b = F.writeBatch(S().fs);
      chunks.forEach((c, i) => b.set(wsDoc(wsId, "vq", `${key}~${i}`), { vendorId: bd.vendorId, projectId: bd.projectId, i, n: chunks.length, items: JSON.stringify(c), at: F.serverTimestamp() }));
      for (let i = chunks.length; i < Math.max(prevN, chunks.length); i++) b.delete(wsDoc(wsId, "vq", `${key}~${i}`));
      await b.commit(); writes += chunks.length; MG.pubHash.set(key, { h: hash, n: chunks.length });
    }
    const done = MG.pubPh.get(key) || new Set(); MG.pubPh.set(key, done);
    for (const it of items) for (const pid of it.ph) {
      if (done.has(pid)) continue;
      const blob = await MG.hooks.photoBlob(pid); if (!blob) continue;
      const bytes = F.Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));
      await F.setDoc(wsDoc(wsId, "vp", pid), { vendorId: bd.vendorId, projectId: bd.projectId, defectId: it.id, b: bytes, t: blob.type || "image/jpeg" });
      done.add(pid); writes++;
    }
  }
  return writes;
}
/** 승인·재작업(owner·editor). 보고 문서는 그대로 남아 이력이 됨 */
export async function decide(report, action, reason = "") {
  if (!isMgr()) throw new Error("소유자·편집 멤버만 승인·재작업할 수 있어요");
  const dec = checkDecision(action, reason); const F = S().F;
  await F.updateDoc(wsDoc(Sync.state.ws.id, "vendorReports", report.id), { state: dec.state, decidedBy: S().uid, decidedByName: Sync.actorName(), decidedAt: F.serverTimestamp(), ...(dec.reason ? { reason: dec.reason } : {}) });
  MG.pending = MG.pending.filter((r) => r.id !== report.id);
  return dec;
}
export const reportPhotoBlobs = (r) => (r.photos || []).map((p) => new Blob([p.b?.toUint8Array ? p.b.toUint8Array() : p.b], { type: p.t || "image/jpeg" }));

/* ---------- 업체 쪽 ---------- */
export const vendorSession = () => LSX.get("vws", null);
export const pendingVJoin = () => LSX.get("pendingVJoin", "");
export const setPendingVJoin = (c) => LSX.set("pendingVJoin", c || "");
export async function lookupVendorCode(code) {
  const st = await Sync.fbReady(); const F = st.F; code = normVCode(code);
  if (code.length !== VCODE_LEN) throw new Error("업체 초대코드는 10자리예요");
  const c = await F.getDoc(F.doc(st.fs, "vendorCodes", code));
  if (!c.exists()) throw new Error("없거나 해제된 업체 초대예요. 관리자에게 새 링크를 받아 주세요");
  const inv = await F.getDoc(F.doc(st.fs, "workspaces", c.data().wsId, "vendorInvites", code));
  if (!inv.exists()) throw new Error("없는 업체 초대예요");
  return { code, ...inv.data() };
}
export async function joinVendor(code) {
  const st = await Sync.fbReady(); if (!st.user) throw new Error("먼저 구글로 로그인해 주세요");
  const F = st.F; const inv = await lookupVendorCode(code); const s = inviteState(inv);
  if (s === "revoked") throw new Error("해제된 초대예요. 관리자에게 새 링크를 받아 주세요");
  if (s === "expired") throw new Error("기한이 지난 초대예요. 관리자에게 재발급을 부탁해 주세요");
  if (s === "used" && inv.usedBy !== st.uid) throw new Error("이미 다른 계정이 쓴 초대예요(1회용). 관리자에게 새 링크를 받아 주세요");
  const b = F.writeBatch(st.fs);
  if (!inv.usedBy) b.update(F.doc(st.fs, "workspaces", inv.wsId, "vendorInvites", inv.code), { usedBy: st.uid, usedAt: F.serverTimestamp() });
  b.set(F.doc(st.fs, "workspaces", inv.wsId, "vendorMembers", st.uid), { code: inv.code, vendorId: inv.vendorId, projectId: inv.projectId, vendorName: inv.vendorName || "", projectName: inv.projectName || "", wsName: inv.wsName || "", name: Sync.actorName(), email: st.email || "", at: F.serverTimestamp() });
  try { await b.commit(); } catch (e) { if (e.code === "permission-denied") throw new Error("참여할 수 없어요(팀 멤버 계정이거나 초대가 바뀌었어요). 다른 구글 계정으로 로그인하거나 새 링크를 받아 주세요"); throw e; }
  const ses = { wsId: inv.wsId, wsName: inv.wsName || "", vendorId: inv.vendorId, vendorName: inv.vendorName || "", projectId: inv.projectId, projectName: inv.projectName || "", code: inv.code, uid: st.uid };
  LSX.set("vws", ses); setPendingVJoin(""); return ses;
}
const VS = { unsubs: [], items: [], reports: [], err: "", ready: false };
export const vendorState = () => VS;
export async function startVendor(onChange) {
  stopVendor(); const ses = vendorSession(); if (!ses) return;
  const st = await Sync.fbReady(); if (!st.user) { VS.err = "login"; onChange?.(); return; }
  const F = st.F; const col = (c) => F.query(F.collection(st.fs, "workspaces", ses.wsId, c), F.where("vendorId", "==", ses.vendorId), F.where("projectId", "==", ses.projectId));
  const gone = (e) => { VS.err = e.code === "permission-denied" ? "revoked" : (e.message || String(e)); onChange?.(); };
  VS.unsubs.push(F.onSnapshot(col("vq"), (s) => { VS.items = s.docs.sort((a, b) => (a.data().i || 0) - (b.data().i || 0)).flatMap((d) => { try { return JSON.parse(d.data().items || "[]"); } catch { return []; } }); VS.ready = true; VS.err = ""; onChange?.(); }, gone));
  VS.unsubs.push(F.onSnapshot(col("vendorReports"), (s) => { VS.reports = s.docs.map((d) => ({ id: d.id, ...d.data() })); onChange?.(); }, gone));
}
export function stopVendor() { VS.unsubs.splice(0).forEach((u) => { try { u(); } catch {} }); }
export async function beforePhoto(pid) {
  const ses = vendorSession(); const st = Sync.state; const F = st.F;
  const s = await F.getDoc(F.doc(st.fs, "workspaces", ses.wsId, "vp", pid)); if (!s.exists()) return null;
  return new Blob([s.data().b.toUint8Array()], { type: s.data().t || "image/jpeg" });
}
/** 조치 완료 보고: 사진(≤3장, 이미 줄인 Blob)·메모 */
export async function submitReport(defectId, blobs, memo) {
  const ses = vendorSession(); if (!ses) throw new Error("협력업체로 참여한 현장이 없어요");
  const st = await Sync.fbReady(); const F = st.F;
  if (!blobs.length) throw new Error("조치 후 사진을 한 장 이상 올려 주세요");
  if (blobs.length > MAX_REPORT_PHOTOS) throw new Error(`사진은 ${MAX_REPORT_PHOTOS}장까지예요`);
  const total = blobs.reduce((a, b) => a + b.size, 0); if (total > 900_000) throw new Error("사진 용량이 커요. 장수를 줄여 주세요");
  const photos = []; for (const b of blobs) photos.push({ b: F.Bytes.fromUint8Array(new Uint8Array(await b.arrayBuffer())), t: b.type || "image/jpeg" });
  const ref = F.doc(F.collection(st.fs, "workspaces", ses.wsId, "vendorReports"));
  await F.setDoc(ref, { vendorId: ses.vendorId, projectId: ses.projectId, defectId, by: st.uid, byName: Sync.actorName(), memo: String(memo || "").slice(0, 1000), photos, at: F.serverTimestamp(), state: "pending" });
  return ref.id;
}
export async function leaveVendor() {
  const ses = vendorSession(); stopVendor();
  if (ses) { try { const st = await Sync.fbReady(); await st.F.deleteDoc(st.F.doc(st.fs, "workspaces", ses.wsId, "vendorMembers", st.uid)); } catch (e) { console.warn(e); } }
  LSX.set("vws", null);
}
