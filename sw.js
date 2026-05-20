// PillCare SW v3 — snooze via persistent storage + periodic sync

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

// ── Helper: show a pill notification ──────────────────
async function showPillNotif(name, dose, time, isSnooze) {
  return self.registration.showNotification(
    (isSnooze ? '⏰ Snooze: ' : '💊 Time for ') + name,
    {
      body: dose
        ? dose + '  •  ' + (isSnooze ? 'Snoozed reminder — take it now!' : 'Scheduled: ' + time)
        : (isSnooze ? 'Snoozed reminder — take it now!' : 'Scheduled: ' + time),
      icon: 'https://em-content.zobj.net/source/google/350/pill_1f48a.png',
      vibrate: [200, 100, 200, 100, 300],
      requireInteraction: true,
      tag: 'pill-' + name + '-' + (isSnooze ? 'snooze' : time),
      actions: [
        { action: 'taken', title: '✅ Taken' },
        { action: 'snooze', title: '⏰ Snooze 5 min' }
      ],
      data: { name, dose, time }
    }
  );
}

// ── notificationclick ──────────────────────────────────
self.addEventListener('notificationclick', event => {
  const { action, notification } = event;
  const data = notification.data || {};
  notification.close();

  if (action === 'snooze') {
    // Store snooze fire-time in IndexedDB so page's setInterval can trigger it
    // even if SW dies. We also try a direct postMessage to the page.
    const fireAt = Date.now() + 5 * 60 * 1000; // 5 min from now

    event.waitUntil(
      (async () => {
        // 1. Tell any open page to store the snooze
        const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of allClients) {
          c.postMessage({ type: 'STORE_SNOOZE', name: data.name, dose: data.dose, time: data.time, fireAt });
        }

        // 2. Also store in SW-side via a tiny IDB helper so SW can fire it on PING
        await storeSnooze({ name: data.name, dose: data.dose, time: data.time, fireAt });
      })()
    );
    return; // no window open
  }

  if (action === 'taken') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const c of list) c.postMessage({ type: 'MARK_TAKEN', name: data.name, time: data.time });
      })
    );
    return;
  }

  // body tap → focus/open app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// ── Message from page ──────────────────────────────────
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'PILL_ALARM') {
    showPillNotif(msg.name, msg.dose, msg.time, false);
  }

  // Page pings SW every 30s — SW checks if any snoozed pill is due
  if (msg.type === 'PING') {
    event.waitUntil(checkSnoozed());
  }
});

// ── IndexedDB helpers (SW-side snooze store) ──────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('pillcare_sw', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('snoozes', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function storeSnooze(data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('snoozes', 'readwrite');
    tx.objectStore('snoozes').add(data);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

async function checkSnoozed() {
  const db = await openDB();
  const now = Date.now();
  return new Promise((res, rej) => {
    const tx    = db.transaction('snoozes', 'readwrite');
    const store = tx.objectStore('snoozes');
    const req   = store.getAll();
    req.onsuccess = async e => {
      const all = e.target.result || [];
      for (const item of all) {
        if (now >= item.fireAt) {
          await showPillNotif(item.name, item.dose, item.time, true);
          store.delete(item.id); // remove after firing
        }
      }
      res();
    };
    req.onerror = e => rej(e.target.error);
  });
}
