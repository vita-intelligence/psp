// Minimal service worker — its only job is to satisfy Chrome's
// installability criteria (presence of a SW with a fetch handler)
// so Android / Chrome / Edge fire the "Install app" prompt.
//
// No caching by choice: PSP is a realtime workspace (Phoenix
// WebSocket for scan / pickup / cleaning flows) and stale HTML or
// stale API responses would corrupt two-phase workflows. If offline
// support is added later, gate it behind a version bump so old
// service workers don't linger with stale caches.
//
// `skipWaiting` + `clients.claim` mean a redeploy activates the new
// SW immediately across every open tab, so a bug in the SW itself
// can be fixed by shipping a new one and having users refresh.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass through to the network. The empty handler is deliberate —
  // Chromium checks for a `fetch` listener as part of the install
  // heuristic even though it does nothing.
});
