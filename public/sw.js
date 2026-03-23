// Service Worker for SDO Sipalay Leave Management System
const CACHE_NAME = 'leave-form-v10';

// Core assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/style.css',
  '/modal-alert.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/css/mobile.css'
];

// Install — cache core assets (bypass HTTP cache to ensure fresh copies)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Fetch with cache:'reload' to bypass HTTP cache for precaching
        const requests = PRECACHE_URLS.map(url =>
          fetch(url, { cache: 'reload' }).then(resp => cache.put(url, resp))
        );
        return Promise.all(requests);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate — clean ALL old caches and claim clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first, always bypass HTTP cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and API requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    // cache: 'no-store' bypasses browser's HTTP cache — always goes to server
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        // Cache successful responses in SW cache (for offline fallback only)
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Serve from cache when offline
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return new Response(offlinePage(), {
              headers: { 'Content-Type': 'text/html' }
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

function offlinePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - Leave Management System</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #003366 0%, #004080 50%, #0059b3 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .offline-card {
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(12px);
      border-radius: 20px;
      padding: 50px 40px;
      text-align: center;
      max-width: 420px;
      width: 100%;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .offline-icon { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 22px; margin-bottom: 10px; }
    p { opacity: 0.85; margin-bottom: 25px; font-size: 14px; line-height: 1.6; }
    .retry-btn {
      background: #fff;
      color: #003366;
      border: none;
      padding: 14px 36px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .retry-btn:active { transform: scale(0.96); }
  </style>
</head>
<body>
  <div class="offline-card">
    <div class="offline-icon">📡</div>
    <h1>You're Offline</h1>
    <p>The Leave Management System requires an internet connection. Please check your connection and try again.</p>
    <button class="retry-btn" onclick="location.reload()">Retry Connection</button>
  </div>
</body>
</html>`;
}
