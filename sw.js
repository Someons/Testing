// PillCare Service Worker — handles real system notifications
const CACHE = 'pillcare-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Called by the main page via postMessage to schedule checks
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SCHEDULE_CHECK') {
    // Acknowledge
    event.source.postMessage({ type: 'SW_READY' });
  }
});

// The core: show notification from service worker (appears in OS notification bar)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// Periodic alarm via SW (triggered by main page setInterval even when page is open)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PILL_ALARM') {
    const { name, dose, time } = event.data;
    self.registration.showNotification('💊 Time for ' + name, {
      body: dose
        ? dose + ' — Scheduled at ' + time
        : 'Scheduled at ' + time + '. Don\'t skip it!',
      icon: 'icon.png',
      badge: 'icon.png',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      tag: 'pill-' + name + '-' + time,
      actions: [
        { action: 'taken', title: '✅ Taken' },
        { action: 'snooze', title: '⏰ Snooze 5 min' }
      ],
      data: { name, dose, time, ts: Date.now() }
    });
  }
});

// Handle notification action buttons
self.addEventListener('notificationclick', event => {
  const { action, notification } = event;
  notification.close();

  if (action === 'snooze') {
    // Re-fire after 5 minutes
    const { name, dose, time } = notification.data;
    event.waitUntil(
      new Promise(resolve => {
        setTimeout(() => {
          self.registration.showNotification('⏰ Reminder: ' + name, {
            body: 'Snoozed reminder — take ' + (dose || 'your pill') + ' now!',
            icon: 'icon.png',
            vibrate: [300, 100, 300],
            requireInteraction: true,
            tag: 'pill-snooze-' + name,
          });
          resolve();
        }, 5 * 60 * 1000); // 5 min
      })
    );
  } else {
    // 'taken' or tap — open app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const c of list) if ('focus' in c) return c.focus();
        if (clients.openWindow) return clients.openWindow('./');
      })
    );
  }
});
