const CACHE_NAME = "riflehud-remote-v15";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./app.js?v=0.15", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_FILES.map(async (url) => {
      try {
        await cache.add(url);
      } catch (error) {
        // One missing file must not leave the whole controller uncached.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" ||
      new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    const update = fetch(event.request).then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put("./index.html", response.clone());
      }
      return response;
    }).catch(() => null);
    event.waitUntil(update.then(() => undefined));
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match("./index.html");
      if (cached) return cached;
      const response = await update;
      if (response) return response;
      return new Response("Open RifleHUD Remote once while online, then reopen this same address.", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
      });
    })());
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const update = fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || update;
    })
  );
});
