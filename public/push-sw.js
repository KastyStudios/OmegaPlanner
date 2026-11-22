/* Loaded into the app's service worker: shows reminders pushed by the OmegaPlanner Worker, even
   when the app is closed, and opens the app when one is tapped. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'OmegaPlanner', {
      body: data.body,
      // Same tag as the app's own reminder, so an open app and a push show it once.
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if ('focus' in w) return w.focus();
      return self.clients.openWindow(url);
    }),
  );
});
