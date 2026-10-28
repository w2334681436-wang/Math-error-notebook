const CACHE_PREFIX = 'math-notebook-offline-';
const LEGACY_CACHE_PREFIX = 'math-notebook-cache-';
const CACHE_VERSION = '__OFFLINE_VERSION__';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const PRECACHE_FILES = /* __PRECACHE_FILES__ */ [];
const APP_SCOPE = self.registration.scope;
const OFFLINE_DOCUMENT = new URL('index.html', APP_SCOPE).toString();

function toScopedUrl(file) {
  return new URL(String(file).replace(/^\/+/, ''), APP_SCOPE).toString();
}

function canCache(response) {
  return Boolean(response && response.ok && (response.type === 'basic' || response.type === 'default'));
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = PRECACHE_FILES.map(toScopedUrl);
    await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        // 这里只清理旧网页资源缓存；IndexedDB 中的错题、图片、笔记和复习记录完全不受影响。
        .filter(name => name !== CACHE_NAME && (
          name.startsWith(CACHE_PREFIX) || name.startsWith(LEGACY_CACHE_PREFIX)
        ))
        .map(name => caches.delete(name)),
    );
    await self.clients.claim();
    await broadcast({ type: 'MATH_NOTEBOOK_OFFLINE_READY', cacheName: CACHE_NAME });
  })());
});

async function handleNavigation(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedDocument = await cache.match(OFFLINE_DOCUMENT);
  const networkRequest = fetch(request).then(async response => {
    if (canCache(response)) await cache.put(OFFLINE_DOCUMENT, response.clone());
    return response;
  });

  if (cachedDocument) {
    event.waitUntil(networkRequest.catch(() => undefined));
    return cachedDocument;
  }

  try {
    return await networkRequest;
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>错题本</title><style>body{font-family:system-ui;padding:32px;color:#334155}h1{font-size:22px}</style><h1>离线资源尚未准备完成</h1><p>请联网打开一次错题本，等待“离线版已准备完成”提示后再断网使用。</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

async function handleLocalAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false })
    || await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (canCache(response)) await cache.put(request, response.clone());
  return response;
}


// Download bridge: the page generates backup records on demand. The service
// worker streams them directly to the browser download without building a
// multi-hundred-megabyte Blob in page memory.
const backupSessions = new Map();
const BACKUP_PATH = '/__mathbackup_download__/';
self.addEventListener('message', event => {
  if (event.data?.type !== 'BACKUP_DOWNLOAD_REGISTER') return;
  const { id, filename } = event.data;
  const port = event.ports?.[0];
  if (!port || typeof id !== 'string' || !/^[\w-]{6,120}$/.test(id)) return;
  if (backupSessions.size > 4) return;
  backupSessions.set(id, { port, filename: String(filename || 'MathNotebook.mathbackup') });
  port.postMessage({ type: 'registered' });
});

function backupDownloadResponse(token) {
  const session = backupSessions.get(token);
  if (!session) return new Response('备份下载链接已失效，请返回错题本重新导出。', { status: 404 });
  backupSessions.delete(token);
  const port = session.port;
  let ended = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (ended) return;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ended = true;
          controller.error(new Error('备份传输超时'));
          reject(new Error('备份传输超时'));
          port.close();
        }, 90000);
        port.onmessage = event => {
          clearTimeout(timeout);
          const item = event.data || {};
          if (item.type === 'chunk' && item.bytes instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(item.bytes));
            resolve();
          } else if (item.type === 'end') {
            ended = true;
            controller.close();
            resolve();
            port.close();
          } else {
            ended = true;
            controller.error(new Error(item.error || '备份传输失败'));
            reject(new Error(item.error || '备份传输失败'));
            port.close();
          }
        };
        port.postMessage({ type: 'pull' });
      });
    },
    cancel() {
      ended = true;
      port.postMessage({ type: 'cancel' });
      port.close();
    }
  }, { highWaterMark: 0 });
  const filename = session.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.includes(BACKUP_PATH)) {
    const token = decodeURIComponent(url.pathname.split(BACKUP_PATH).pop());
    event.respondWith(backupDownloadResponse(token));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, event));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(handleLocalAsset(request));
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_OFFLINE_STATUS') {
    event.source?.postMessage({
      type: 'MATH_NOTEBOOK_OFFLINE_READY',
      cacheName: CACHE_NAME,
    });
  }
});
