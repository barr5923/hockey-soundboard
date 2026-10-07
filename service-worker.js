const CACHE_NAME = 'hockey-soundboard-shell-v56';
const APP_SHELL = [
  './index.html',
  './how-to.html',
  './styles.css?v=71',
  './app.js?v=103',
  './integration-controls.js?v=2',
  './apple-music.js?v=4',
  './auth.js?v=29',
  './roster.js?v=11',
  './score-sheet.js?v=1',
  './game-rules.js?v=1',
  './manifest.webmanifest',
  './seattle-thunderbirds-logo.svg',
  './sounds/among-us-drip-theme.mp3',
  './sounds/among-us-role-reveal.mp3',
  './sounds/anime-wow.mp3',
  './sounds/Are_you_ready.mp3',
  './sounds/Are_you_ready.wav',
  './sounds/awww.wav',
  './sounds/bruh.mp3',
  './sounds/charge.mp3',
  './sounds/goalhorn.mp3',
  './sounds/kids-cheering-yayyyy.mp3',
  './sounds/roblox-oof.mp3',
  './sounds/spongebob-fail.mp3',
  './sounds/TBirds_Goal_Horn.mp3',
  './sounds/Default_Horn.wav',
  './sounds/Foghorn.wav',
  './sounds/Classic_Horn.wav',
  './sounds/wayne-glensky.mp3',
  './sounds/whistle.mp3',
  './sounds/WooHoo.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('hockey-soundboard-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || new URL(request.url).pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => (await caches.match('./index.html')) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
