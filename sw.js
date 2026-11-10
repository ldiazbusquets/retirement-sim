/* Retirement Simulator service worker: lets the installed app open and run offline.
   Everything the simulator needs (page, engine, data) is saved on install, because the
   simulation itself runs entirely in the browser. BUILD_ID is replaced with the commit SHA
   by the deploy workflow, so each deploy gets a fresh cache and old ones are deleted. */
'use strict';
const BUILD_ID = '__BUILD_ID__';
const CACHE = `retsim-${BUILD_ID}`;
const SHELL = ['./', './styles.css', './sim.js', './app.js', './manifest.webmanifest', './favicon.svg', './icon-192.png', './data/sp500_annual_returns.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('retsim-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Network first (so a new deploy shows up right away), saved copy when offline. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh.ok || fresh.type === 'opaque') cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const saved = await cache.match(request, { ignoreSearch: true });
      if (saved) return saved;
      if (request.mode === 'navigate') return (await cache.match('./')) || Response.error();
      return Response.error();
    }
  })());
});
