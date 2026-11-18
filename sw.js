// Service worker: ใช้งานออฟไลน์ + แจ้งเตือนเบื้องหลัง
const VERSION = 'bikelog-v1.1.0';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== VERSION && k !== 'bikelog-data' && k !== 'bikelog-fonts' && k !== 'bikelog-lib').map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // ฟอนต์จาก Google: cache-first
  if (url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
    e.respondWith(caches.open('bikelog-fonts').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); c.put(req, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }
  // ไลบรารี supabase-js จาก jsDelivr: cache-first เพื่อเปิดแอพได้ตอนออฟไลน์
  if (url.host === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('bikelog-lib').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // ไฟล์แอพ: network-first (ได้เวอร์ชันใหม่เมื่อออนไลน์) แล้ว fallback เป็น cache
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
  }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('index.html'))));
});

// แจ้งเตือนเบื้องหลัง (Chrome Android, เมื่อติดตั้งเป็นแอพแล้ว)
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const days = s => { const [y, m, d] = s.split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); };

async function checkDue() {
  const c = await caches.open('bikelog-data');
  const res = await c.match(new URL('due.json', self.registration.scope).href);
  if (!res) return;
  const s = await res.json();
  const out = [];
  s.km.forEach(x => { if (x.left <= 0) out.push(`${x.name}: เกิน ${(-x.left).toLocaleString()} กม.`); else if (x.left <= s.warnKm) out.push(`${x.name}: อีก ${x.left.toLocaleString()} กม.`); });
  s.dated.forEach(x => { const d = days(x.due); if (d <= s.warnDays) out.push(`${x.name}: ${d <= 0 ? 'ถึงรอบแล้ว' : 'อีก ' + d + ' วัน'}`); });
  s.docs.forEach(x => { const d = days(x.due); if (d <= s.docDays) out.push(`${x.name}: ${d < 0 ? 'หมดอายุแล้ว' : d === 0 ? 'หมดอายุวันนี้' : 'อีก ' + d + ' วัน'}`); });
  const uniq = [...new Set(out)];
  if (!uniq.length) return;
  // กันแจ้งซ้ำในวันเดียวกัน
  const today = iso(new Date());
  const last = await c.match('notified-on');
  if (last && (await last.text()) === today) return;
  await c.put('notified-on', new Response(today));
  return self.registration.showNotification(`มี ${uniq.length} รายการต้องดูแล`, {
    body: uniq.slice(0, 5).map(x => '• ' + x).join('\n'), icon: 'icon-192.png', badge: 'badge-96.png', tag: 'due'
  });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'due-check') e.waitUntil(checkDue()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const w of list) if ('focus' in w) return w.focus();
    return clients.openWindow('./');
  }));
});
