// Service worker: offline play (vs AI / pass & play) and challenge notifications.
const CACHE = "the-15-game-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages: network first (always fresh when online), cached copy when offline.
// Hashed build assets: cache first (their names change whenever their content does).
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => { caches.open(CACHE).then(c => c.put("/", res.clone())); return res; })
        .catch(() => caches.match("/")),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(hit => hit ?? fetch(req).then(res => {
      if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    })),
  );
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title ?? "The 15-Game", {
    body: data.body ?? "You've been challenged.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag,
    renotify: true,
    vibrate: [60, 40, 60],
    data: { url: data.url ?? "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find(w => new URL(w.url).origin === location.origin);
    if (open) {
      await open.focus();
      return open.navigate(url).catch(() => self.clients.openWindow(url));
    }
    return self.clients.openWindow(url);
  })());
});
