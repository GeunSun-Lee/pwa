// ============================================================
// Study Planner - Service Worker (Vanilla, No Workbox)
// Features: App Shell Precaching, Stale-While-Revalidate, 
//           Network-First Navigation, Offline Fallback, Auto Update
// ============================================================

const CACHE_NAME = 'study-planner-v1'; // 배포 시 버전 업데이트 필수 (예: v2, v3...)
const PRECACHE_ASSETS = [
  './',                 // index.html (루트)
  './index.html',       // 명시적 추가
  './style.css',
  './script.js',
  './manifest.json',
  // 아이콘은 manifest에 있으므로 install 시 자동 캐싱 안 함 (fetch 시 캐싱)
  // 단, 핵심 아이콘 2개는 미리 캐싱 권장
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 캐시 전략 설정
const STRATEGIES = {
  // 정적 리소스 (CSS, JS, 이미지, 폰트): Stale-While-Revalidate
  // -> 캐시 있으면 바로 주고, 백그라운드에서 업데이트
  STATIC: 'stale-while-revalidate',
  // 네비게이션 (HTML): Network First
  // -> 온라인일 땐 최신 HTML, 오프라인일 땐 캐시된 HTML(index.html)
  NAVIGATION: 'network-first',
  // API/데이터성 요청 (이 앱엔 없지만 확장성 위해): Network Only
  API: 'network-only'
};

// ------------------------------------------------------------
// 1. Install: App Shell 프리캐싱
// ------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching App Shell');
        // addAll은 하나라도 실패하면 전체 실패하므로, 개별 catch로 안전하게 처리
        const cachePromises = PRECACHE_ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn(`[SW] Precaching failed for ${url}:`, err);
          });
        });
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting()) // 대기 중인 SW 즉시 활성화
  );
});

// ------------------------------------------------------------
// 2. Activate: 구버전 캐시 정리
// ------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // 즉시 현재 클라이언트 제어
  );
});

// ------------------------------------------------------------
// 3. Fetch: 요청 가로채기 및 전략 적용
// ------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Chrome Extension, 비 http/https 스킴 무시
  if (!url.protocol.startsWith('http')) return;

  // 2) 네비게이션 요청 (HTML 페이지 이동)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstStrategy(request, CACHE_NAME));
    return;
  }

  // 3) 정적 리소스 (CSS, JS, PNG, SVG, WOFF, JSON 등)
  // 확장자 기반 판별
  const isStaticAsset = ['style.css', 'script.js', 'manifest.json'].some(f => url.pathname.endsWith(f)) ||
                        /\.(?:css|js|png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|json|map)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAME));
    return;
  }

  // 4) 그 외 (API 호출 등): Network Only (캐시 안 함)
  // 이 앱은 API가 없으므로 기본 네트워크 동작 위임
  // event.respondWith(fetch(request)); // 굳이 작성 안 해도 됨 (기본 동작)
});

// ------------------------------------------------------------
// 전략 구현 함수들
// ------------------------------------------------------------

/** Network First: 네트워크 시도 -> 실패 시 캐시 -> 최종 fallback: index.html */
async function networkFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // 1. 네트워크 요청
    const networkResponse = await fetch(request);
    
    // 2. 성공 시 캐시 갱신 (index.html만 캐시하여 오프라인 진입점 확보)
    if (networkResponse.ok) {
      // 클론 필요 (body stream은 한 번만 읽힘)
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // 3. 네트워크 실패 (오프라인) -> 캐시에서 조회
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    // 4. 캐시도 없으면 -> index.html 반환 (SPA 라우팅/오프라인 폴백)
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;

    // 5. index.html도 없으면 에러 응답
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/** Stale-While-Revalidate: 캐시 즉시 반환 + 백그라운드 업데이트 */
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // 백그라운드 업데이트 프로미스 (await 안 함 -> 바로 응답 위해)
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => {
    // 네트워크 실패 시 무시 (캐시된 것 썼으니까)
    console.log('[SW] Background update failed (offline?)', request.url);
  });

  // 캐시된 게 있으면 즉시 반환, 없으면 네트워크 대기
  return cachedResponse || fetchPromise;
}

// ------------------------------------------------------------
// 4. 메시지 처리 (클라이언트에서 skipWaiting 호출 시)
// ------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ------------------------------------------------------------
// 5. Push 알림 (선택 사항 - 추후 알림 기능 추가 시)
// ------------------------------------------------------------
/*
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: '알림', body: '내용' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: './icons/icon-192.png' }));
});
*/

console.log('[SW] Loaded:', CACHE_NAME);
