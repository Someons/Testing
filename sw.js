// PillCare SW v5 — interval-based multi-dose, snooze fixes

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

async function showPillNotif(name, dose, time, isSnooze) {
  // Unique tag for snooze — never deduplicated by browser
  const tag = isSnooze
    ? 'pill-snooze-' + name + '-' + Date.now()
    : 'pill-' + name + '-' + time;

  return self.registration.showNotification(
    (isSnooze ? '⏰ Snooze: ' : '💊 Time for ') + name,
    {
      body: dose
        ? dose + '  •  ' + (isSnooze ? 'Snoozed — take it now!' : 'Scheduled: ' + time)
        : (isSnooze ? 'Snoozed — take it now!' : 'Scheduled: ' + time),
      icon: 'https://em-content.zobj.net/source/google/350/pill_1f48a.png',
      vibrate: [200, 100, 200, 100, 300],
      requireInteraction: true,
      tag,
      actions: [
        { action: 'taken', title: '✅ Taken' },
        { action: 'snooze', title: '⏰ Snooze 5 min' }
      ],
      data: { name, dose, time, isSnooze }
    }
  );
}

self.addEventListener('notificationclick', event => {
  const { action, notification } = event;
  const data = notification.data || {};
  notification.close();

  if (action === 'snooze') {
    const fireAt = Date.now() + 5 * 60 * 1000;
    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of allClients) {
        c.postMessage({ type: 'STORE_SNOOZE', name: data.name, dose: data.dose, time: data.time, fireAt });
      }
      await storeSnooze({ name: data.name, dose: data.dose, time: data.time, fireAt });
    })());
    return;
  }

  if (action === 'taken') {
    event.waitUntil((async () => {
      await clearSnoozesForPill(data.name);
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of allClients) {
        c.postMessage({ type: 'MARK_TAKEN', name: data.name, time: data.time });
        c.postMessage({ type: 'CLEAR_SNOOZE', name: data.name });
      }
    })());
    return;
  }

  // Body tap → focus or open app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'PILL_ALARM') showPillNotif(msg.name, msg.dose, msg.time, false);
  if (msg.type === 'PING') event.waitUntil(checkSnoozed());
});

// ── IndexedDB helpers ──────────────────────────────────
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

async function clearSnoozesForPill(pillName) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('snoozes', 'readwrite');
    const store = tx.objectStore('snoozes');
    const req   = store.getAll();
    req.onsuccess = e => {
      const all = e.target.result || [];
      for (const item of all) {
        // Match base pill name (handles "Vitamin D (dose 1/3)" etc.)
        if (item.name === pillName || item.name.startsWith(pillName)) {
          store.delete(item.id);
        }
      }
      res();
    };
    req.onerror = e => rej(e.target.error);
  });
}

async function checkSnoozed() {
  const db  = await openDB();
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
          store.delete(item.id);
        }
      }
      res();
    };
    req.onerror = e => rej(e.target.error);
  });
}
