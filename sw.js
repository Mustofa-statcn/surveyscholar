/* SurveyScholar service worker — app shell + library cache, offline-first. */
const CACHE = 'surveyscholar-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // one bad URL must not fail the whole install
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Never touch data going to Google — sync must reach the network or fail loudly.
  if (req.method !== 'GET' || req.url.indexOf('script.google.com') > -1) return;

  // Navigations: serve the cached app immediately, refresh in the background.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(hit =>
        hit || fetch(req).catch(() => caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        fetch(req).then(res => {
          if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE).then(c => c.put(req, res));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
