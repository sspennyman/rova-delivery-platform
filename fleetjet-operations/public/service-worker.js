const CACHE_NAME = "rivo-operations-v104";
const APP_SHELL = [
  "/order-window.js?v=103",
  "/appearance.js?v=103",
  "/appearance.css?v=104",
  "/assets/rivo-pinwheel.svg?v=103",
  "/fonts/vend-sans-regular.ttf",
  "/fonts/vend-sans-semibold.ttf",
  "/design-system.css?v=103",
  "/",
  "/index.html",
  "/styles.css?v=103",
  "/app.js?v=103",
  "/order-fulfillment.js?v=103",
  "/assignment-alerts.js?v=103",
  "/mileage.js?v=103",
  "/trip-maps.js?v=103",
  "/mileage.css?v=103",
  "/workspace.css?v=103",
  "/canonical-host.js?v=103",
  "/assets/rova-mark.svg",
  "/assets/rivo-logo.png",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/events") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("push",event=>{
  let data={};
  try {data=event.data?.json() || {};} catch {}
  event.waitUntil(self.registration.showNotification(String(data.title || "Rivo orders"),{
    body:String(data.body || "Your assigned orders have changed. Open Rivo to see your route."),
    icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",tag:String(data.tag || "rivo-assignment"),
    data:{url:"/#today"}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL("/#today",self.location.origin).href;
    const tabs=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const tab=tabs.find(client=>new URL(client.url).origin === self.location.origin);
    if (tab) {await tab.navigate(target);await tab.focus();}
    else await self.clients.openWindow(target);
  })());
});
