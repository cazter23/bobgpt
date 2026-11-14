// BobGPT's service worker. It does one thing: keeps a copy of the app's own files, so the installed app's
// window still opens when the little server that hands out those files isn't running.
//
// It never touches anything that isn't the app's own files. Requests to LM Studio (a different address) and
// anything that isn't a plain GET go straight to the network, and no chat or message is ever stored here.
// (Chats live in the browser's localStorage and IndexedDB, as before.)

const CACHE = 'bobgpt-v1';
const MAX_FILES = 150; // the oldest copies go first, so rebuilding the app many times doesn't pile up files

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function remember(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(old);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // The page itself: ask the server first, so a rebuilt app arrives at once; use the saved copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) event.waitUntil(remember('/index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // The app's code, styles and fonts have a fingerprint in their name, so a saved copy is never out of date.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (saved) =>
          saved ||
          fetch(request).then((response) => {
            if (response.ok) event.waitUntil(remember(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
