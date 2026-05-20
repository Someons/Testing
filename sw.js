// PillCare Service Worker v2 — proper snooze without opening tab

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

// ── Snooze store (in-memory, SW stays alive long enough) ──
const snoozeTimers = {};

// ── Single notificationclick handler ──────────────────────
self.addEventListener('notificationclick', event => {
  const action = event.action;           // 'taken' | 'snooze' | '' (body tap)
  const notif  = event.notification;
  const data   = notif.data || {};

  notif.close(); // always close current notification

  if (action === 'snooze') {
    // ✅ Schedule a new notification after 5 min — NO tab open
    event.waitUntil(
      new Promise(resolve => {
        const delay = 5 * 60 * 1000; // 5 minutes
        setTimeout(async () => {
          await self.registration.showNotification('⏰ Snooze reminder: ' + data.name, {
            body: (data.dose ? data.dose + '  •  ' : '') + 'Snoozed 5 min ago — take it now!',
            icon: 'https://em-content.zobj.net/source/google/350/pill_1f48a.png',
            vibrate: [300, 100, 300, 100, 300],
            requireInteraction: true,
            tag: 'pill-snooze-' + data.name,
            actions: [
              { action: 'taken', title: '✅ Taken' },
              { action: 'snooze', title: '⏰ +5 min again' }
            ],
            data: data
          });
          resolve();
        }, delay);
      })
    );
    // DO NOT open any window — return here
    return;
  }

  if (action === 'taken') {
    // ✅ Just close — no tab open. Optionally post message to page if open.
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        // If page is already open, tell it to mark pill as taken
        for (const c of list) {
          c.postMessage({ type: 'MARK_TAKEN', name: data.name, time: data.time });
        }
        // Don't open new window — just resolve
      })
    );
    return;
  }

  // Body tap (action === '') → open/focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// ── Message from main page (fire notification) ─────────────
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'PILL_ALARM') {
    const { name, dose, time } = msg;
    self.registration.showNotification('💊 Time for ' + name, {
      body: dose ? dose + '  •  Scheduled: ' + time : 'Scheduled: ' + time,
      icon: 'https://em-content.zobj.net/source/google/350/pill_1f48a.png',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      tag: 'pill-' + name + '-' + time,
      actions: [
        { action: 'taken', title: '✅ Taken' },
        { action: 'snooze', title: '⏰ Snooze 5 min' }
      ],
      data: { name, dose, time }
    });
  }
});
