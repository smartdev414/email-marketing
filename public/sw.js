// Service worker for desktop notifications (Web Push). The background sender
// pushes { title, body, url, tag }; clicking the popup opens that page.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Mail Spire", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Mail Spire", {
      body: data.body || "",
      tag: data.tag,
      icon: "/favicon.ico",
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse an open tab of the app when there is one.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
