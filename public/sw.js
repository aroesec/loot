/**
 * Service worker for Web Push.
 *
 * Deliberately minimal: it receives a push and shows it. No caching, no
 * offline behaviour, no interception of requests — a service worker that
 * caches financial pages would serve someone else's stale balance after a
 * logout, and there is nothing here worth that risk.
 */

/*
 * Present so browsers that require a fetch handler before offering to install
 * the app will do so. It must stay empty: calling `respondWith` here would put
 * this worker in front of every request to a page full of balances, which is
 * exactly what the note above rules out. With no `respondWith`, the request
 * proceeds to the network untouched.
 */
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Loot", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Loot", {
      body: payload.body ?? "",
      icon: "/icon.png",
      badge: "/icon.png",
      // Collapses repeats of the same alert on the device rather than stacking.
      tag: payload.tag ?? payload.title,
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";

  // Focus an existing tab rather than opening a duplicate.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(url) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
