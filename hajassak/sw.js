/* hajassak-v1.2.0 (build-deploy.sh가 version.js에서 찍음) */
/* 하자싹 서비스 워커 — 앱 셸 캐시(오프라인). 사용자 데이터는 IndexedDB(+선택 시 Firebase 동기화)에 있고 SW는 캐시하지 않음. Firebase 요청(다른 도메인)은 가로채지 않음 */
importScripts("./version.js"); // 버전 유일 출처
const VERSION = self.HAJASSAK_VERSION || "0";
const CACHE = "hajassak-v" + VERSION;
const PRECACHE = ["./", "./index.html", "./version.js", "./manifest.webmanifest", "./css/app.css",
  "./js/app.js", "./js/ui.js", "./js/db.js", "./js/model.js", "./js/photo.js", "./js/share.js", "./js/pro.js", "./js/speech.js",
  "./js/backup.js", "./js/sync.js", "./js/importer.js", "./js/import-worker.js", "./js/exporter.js", "./js/sample.js", "./js/pdfplan.js", "./js/help.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png",
  "./vendor/jszip/jszip.min.js", "./vendor/xlsx/xlsx.mjs", "./vendor/firebase/firebase-app.js", "./vendor/firebase/firebase-auth.js", "./vendor/firebase/firebase-firestore.js", "./privacy.html"];
// 1.1.0 도면 PDF 읽기(pdf.js): 버전 고정 캐시에 한 번만 받아 두고 앱 업데이트 때 다시 받지 않음(시작 속도·데이터 절약). cmaps·글꼴은 쓸 때 저장
const PDFJS_CACHE = "hajassak-pdfjs-4.10.38";
const PDFJS_CORE = ["./vendor/pdfjs/pdf.min.mjs", "./vendor/pdfjs/pdf.worker.min.mjs", ...["Adobe-Korea1-UCS2", "Adobe-Korea1-2", "UniKS-UCS2-H", "UniKS-UTF16-H", "KSCms-UHC-H", "KSC-EUC-H"].map((n) => `./vendor/pdfjs/cmaps/${n}.bcmap`)];
// 설치: HTTP 캐시를 거치지 않고 새로 받아 저장. 첫 설치이거나 업데이트 안내가 없는 옛 버전(≤1.0.2)에서 올라올 때만 바로 활성화,
// 그 외에는 대기 → 앱이 ‘새 버전이 있어요 — 새로고침’ 안내 → 사용자가 누르면 SKIP_WAITING
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })));
    try { const pc = await caches.open(PDFJS_CACHE); for (const u of PDFJS_CORE) if (!(await pc.match(u))) await pc.add(u); } catch { /* 나중에 쓸 때 받음 */ }
    const keys = await caches.keys();
    const legacy = keys.some((k) => /^hajassak-v1\.0\.[0-2]$/.test(k));
    if (!self.registration.active || legacy) await self.skipWaiting();
  })());
});
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data?.type === "VERSION") e.ports[0]?.postMessage(VERSION);
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE && k !== PDFJS_CACHE) await caches.delete(k); await self.clients.claim(); })());
});
// 캐시 우선 + 백그라운드 갱신(약전계에서도 즉시 열림). 새 버전은 다음 실행 때 반영.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/vendor/pdfjs/")) {
    event.respondWith((async () => {
      const pc = await caches.open(PDFJS_CACHE); const hit = await pc.match(req, { ignoreSearch: true }); if (hit) return hit;
      try { const res = await fetch(req); if (res && res.ok && res.type === "basic") pc.put(req, res.clone()); return res; } catch { return new Response("offline", { status: 503 }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res && res.ok && res.type === "basic") cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { event.waitUntil(net); return cached; }
    const res = await net; if (res) return res;
    if (req.mode === "navigate") { const fb = await cache.match("./index.html"); if (fb) return fb; }
    return new Response("offline", { status: 503 });
  })());
});
