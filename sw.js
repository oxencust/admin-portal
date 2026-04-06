// Service Worker — 衡點行政管理系統 PWA
// 最小化 SW：僅用於滿足 PWA 安裝條件 + 基本快取策略

const CACHE_NAME = 'hengdian-admin-v1';

// 安裝：快取基本殼層
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 啟動：清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 請求攔截：Network First（API 優先走網路，靜態資源才用快取）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只處理 GET 請求（Cache API 不支援 POST）
  if (event.request.method !== 'GET') return;

  // API 呼叫不快取
  if (url.pathname.includes('/functions/') || url.hostname.includes('supabase')) {
    return;
  }

  // 靜態資源：Network First + fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
