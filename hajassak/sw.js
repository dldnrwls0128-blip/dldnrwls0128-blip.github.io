/* 하자싹 서비스 워커 — 앱 셸 캐시(오프라인). 사용자 데이터는 IndexedDB에만 있고 캐시하지 않음 */
const CACHE = "hajassak-v1.0.2";
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/app.js", "./js/ui.js", "./js/db.js", "./js/model.js", "./js/photo.js", "./js/share.js", "./js/pro.js", "./js/speech.js",
  "./js/backup.js", "./js/importer.js", "./js/import-worker.js", "./js/exporter.js", "./js/sample.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png",
  "./vendor/jszip/jszip.min.js", "./vendor/xlsx/xlsx.mjs", "./privacy.html"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});
// 캐시 우선 + 백그라운드 갱신(약전계에서도 즉시 열림). 새 버전은 다음 실행 때 반영.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
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
