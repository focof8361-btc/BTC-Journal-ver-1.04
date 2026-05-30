// ============================================================
//  BTC Trading Journal Pro — Service Worker
//  Cache strategy:
//    • App shell (HTML, icon)  → Cache-First
//    • CDN assets (Tailwind, TradingView) → Cache-First (stale-while-revalidate)
//    • Price APIs & WebSocket  → Network-Only (never cache live data)
// ============================================================

const APP_CACHE  = 'btc-journal-v1';
const CDN_CACHE  = 'btc-cdn-v1';
const ALL_CACHES = [APP_CACHE, CDN_CACHE];

// ── Files to pre-cache on install ───────────────────────────
const APP_SHELL = [
  './',
  './index.html',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
];

// ── Domains whose responses should NEVER be cached ──────────
const NO_CACHE_DOMAINS = [
  'binance.com',
  'coinbase.com',
  'coingecko.com',
  'kraken.com',
  'alternative.me',   // Fear & Greed API
  's3.tradingview.com',  // TradingView live widgets (dynamic)
];

// ── CDN domains to cache aggressively ───────────────────────
const CDN_DOMAINS = [
  'cdn.tailwindcss.com',
];


// ════════════════════════════════════════════════════════════
//  INSTALL — pre-cache app shell
// ════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


// ════════════════════════════════════════════════════════════
//  ACTIVATE — delete old caches
// ════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => !ALL_CACHES.includes(k))
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});


// ════════════════════════════════════════════════════════════
//  FETCH — routing logic
// ════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Skip WebSocket upgrades
  if (req.url.startsWith('wss://') || req.url.startsWith('ws://')) return;

  const url = new URL(req.url);

  // ── 1. Price / live-data APIs → Network-Only ──────────────
  const isLiveData = NO_CACHE_DOMAINS.some(d => url.hostname.includes(d));
  if (isLiveData) {
    event.respondWith(fetch(req));
    return;
  }

  // ── 2. CDN assets → Cache-First, refresh in background ────
  const isCDN = CDN_DOMAINS.some(d => url.hostname.includes(d));
  if (isCDN) {
    event.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const fetchPromise = fetch(req).then(res => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => null);
          // Return cached immediately; update cache in background
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── 3. App shell & local assets → Cache-First, network fallback ──
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          // Only cache valid same-origin or CORS responses
          if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
            caches.open(APP_CACHE).then(cache => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback: return the cached index for navigation requests
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});


// ════════════════════════════════════════════════════════════
//  MESSAGE — allow manual cache-clear from app
//  Usage: navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' })
// ════════════════════════════════════════════════════════════
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
