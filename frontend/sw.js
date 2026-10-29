// Offline support: network first, so you always get fresh data and code when online; the last copy when not.
// Caches the app shell and every GET the app made (scenarios, guides, the tech tree, the last household snapshot).
const CACHE = "prometheus-v1";
const SHELL = [
  "./", "index.html", "simple.css", "manifest.webmanifest", "assets/emblem.svg",
  "js/api.js", "js/ui.js", "js/face.js",
  "js/simple/main.js", "js/simple/app.js", "js/simple/canvas.js", "js/simple/chat.js", "js/simple/flame.js",
  "js/simple/modes.js", "js/simple/pencils.js", "js/simple/sos.js", "js/simple/print.js",
  "js/simple/cards/index.js", "js/simple/cards/common.js", "js/simple/cards/prepare.js",
  "js/simple/cards/survive.js", "js/simple/cards/rebuild.js", "js/simple/cards/vault.js",
  "api/scenarios", "api/scenarios/blackout", "api/scenarios/supply_disruption", "api/scenarios/isolation",
  "api/knowledge", "api/techtree", "api/sources",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match(new URL(req.url).pathname.endsWith("/") ? "./" : req.url)))
    .then((res) => res || new Response(JSON.stringify({ detail: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } })));
});
