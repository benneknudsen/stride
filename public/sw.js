// Empty service worker — prevents 404 for /sw.js requests
// (stray requests from previously-registered SWs or browser defaults).
// No caching or fetch handling; it activates and immediately takes control.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
