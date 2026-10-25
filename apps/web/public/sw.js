const CACHE_NAME = "codex-ultra-pwa-__BUILD_ID__";
const APP_SHELL = ["/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  const isNavigation =
    request.mode === "navigate" ||
    request.destination === "document" ||
    (request.headers.get("accept") ?? "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8"><title>Codex UI offline</title><body>Codex UI is offline. Reconnect and refresh.</body>',
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          )
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error()))
  );
});
