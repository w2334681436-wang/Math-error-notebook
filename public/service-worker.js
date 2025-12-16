// Service Worker: 暴力更新版

// 这里的版本号 v1 会在每次打包时被 update-sw.js 自动修改为最新时间戳
const CACHE_NAME = 'math-notebook-cache-v1';

// 需要缓存的核心文件
const APP_SHELL_FILES = [
  '/', 
  '/index.html',
  '/manifest.json',
  '/icon.svg',
];

// 1. 安装阶段：强行缓存核心文件，并立即激活
self.addEventListener('install', (event) => {
  console.log('[SW] Installing and caching App Shell...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(APP_SHELL_FILES);
      })
      .then(() => self.skipWaiting()) // 👊 关键：强制跳过等待，立即接管
  );
});

// 2. 激活阶段：清理所有旧版本缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating and cleaning old caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName); // 👊 关键：删除旧缓存
          }
        })
      );
    }).then(() => self.clients.claim()) // 👊 关键：立即控制所有页面
  );
});

// 3. 拦截请求：缓存优先策略，但导航请求(HTML)如果失败则回退
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;

      try {
        const networkResponse = await fetch(event.request);
        
        // 如果是 HTML 导航请求且网络失败，尝试返回缓存的主页（可选）
        if ((!networkResponse || networkResponse.status === 404) && event.request.mode === 'navigate') {
           return caches.match('/index.html');
        }
        
        // 动态缓存新资源
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkResponse.clone());
        return networkResponse;

      } catch (error) {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        // 可以返回一个自定义的离线图片或JSON
      }
    })()
  );
});
