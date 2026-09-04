// ==========================================================================
// sw.js - Service Worker (Vanilla, Offline-First for GitHub Pages)
// ==========================================================================

const CACHE_NAME = 'kids-todo-v1'; // 배포 시 버전 업데이트 필수 (예: v2, v3...)
// 캐시할 핵심 리소스 목록 (앱 셸)
// 주의: 경로는 sw.js 위치 기준 상대 경로 (루트 배포 시 '/', 하위 경로 배포 시 '/repo-name/')
// GitHub Pages 루트 배포 가정: scope '/'
const PRECACHE_ASSETS = [
  './',              // index.html (내비게이션 폴백용)
  './index.html',    // 명시적 캐싱
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  // 아이콘 (manifest.json에 정의된 것들 모두 포함 권장)
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  // 폰트 (로컬 호스팅 시 필수 - 오프라인에서 폰트 깨짐 방지)
  // './fonts/PretendardVariable.woff2', 
  // './fonts/NanumSquareRound.woff2',
];

// 캐시할 확장자 패턴 (정적 리소스 판별용)
const STATIC_EXTENSIONS = /\.(?:css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|ico|json|map)$/i;

// ==========================================================================
// 1. Install: 프리캐싱 (앱 셸 저장)
// ==========================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching App Shell...');
        // addAll: 하나라도 실패하면 전체 실패 (원자적)
        // 개별적으로 try-catch 원하면 add 사용
        return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { credentials: 'same-origin' })))
          .catch(err => {
            console.error('[SW] Precaching failed:', err);
            // 폰트 파일 등 선택적 리소스 실패 시 무시하고 싶으면 여기서 처리
            // 하지만 핵심 리소스(index.html, js, css) 실패 시 설치 중단시키는 게 안전
            throw err;
          });
      })
      .then(() => {
        // 설치 즉시 활성화 대기 건너뛰기 (새 SW 바로 활성화)
        return self.skipWaiting();
      })
  );
});

// ==========================================================================
// 2. Activate: 구버전 캐시 정리 + 클라이언트 제어권 획득
// ==========================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME) // 현재 버전 아닌 것들
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // 모든 열린 클라이언트(탭) 즉시 제어
        return self.clients.claim();
      })
  );
});

// ==========================================================================
// 3. Fetch: 요청 가로채기 (캐시 전략 적용)
// ==========================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. 비 GET 요청(POST 등) 또는 크롬 익스텐션 등 스킴 제외
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // 2. 내비게이션 요청 (HTML 문서 요청) - Network First
  // 사용자가 주소창 치고 들어오거나 새로고침(F5) 시 최신 HTML 확인
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // 3. 정적 리소스 (CSS, JS, 이미지, 폰트, 매니페스트) - Cache First
  // 해시가 파일명에 없으므로(버전 관리 안 함), Cache First가 속도 면에서 유리.
  // 단, SW 버전(CACHE_NAME)이 바뀌면 install 단계에서 새 파일로 갱신됨.
  if (STATIC_EXTENSIONS.test(url.pathname) || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // 4. 그 외 (API 호출 등 - 현재 앱엔 없음) - Network Only (기본 동작)
  // event.respondWith(fetch(request)); // 기본 동작이므로 생략
});

// ==========================================================================
// 전략 구현 함수들
// ==========================================================================

/**
 * Cache First: 캐시 확인 -> 있으면 응답 -> 없으면 네트워크 -> 캐시 저장 -> 응답
 * @param {Request} request 
 */
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // 캐시 히트: 백그라운드에서 업데이트 체크 (Stale-While-Revalidate 흉내)
    // 하지만 정적 파일명은 고정이라 의미 적음. 필요시 주석 해제.
    // updateCacheInBackground(request, cache);
    return cachedResponse;
  }

  // 캐시 미스: 네트워크 요청
  try {
    const networkResponse = await fetch(request);
    // 유효한 응답만 캐시 (opaque response 제외, status 200)
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Network fetch failed (offline?):', request.url, error);
    // 오프라인 폴백: 이미지라면 투명 플레이스홀더, HTML이라면 오프라인 페이지 등
    // 여기서는 에러 던져 브라우저 기본 오프라인 페이지(공룡) 뜨게 하거나 커스텀 처리
    throw error;
  }
}

/**
 * Network First: 네트워크 시도 -> 성공 시 캐시 갱신 -> 실패 시 캐시 폴백
 * @param {Request} request 
 */
async function networkFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const networkResponse = await fetch(request);
    
    // 성공 시 캐시 업데이트 (최신 HTML 유지)
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 캐시도 없음: 오프라인 폴백 HTML 반환 (미리 캐시해둔 index.html)
    // GitHub Pages SPA 라우팅 아님 -> index.html이 곧 폴백
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    
    // 최후 수단
    return new Response('오프라인 상태입니다. 인터넷 연결을 확인해주세요.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// 선택: 백그라운드 업데이트 (Stale-While-Revalidate 구현 시 사용)
// async function updateCacheInBackground(request, cache) {
//   try {
//     const res = await fetch(request);
//     if (res.ok) cache.put(request, res);
//   } catch (e) { /* 무시 */ }
// }

// ==========================================================================
// 4. 메시지 통신 (앱에서 SW 제어용)
// ==========================================================================
self.addEventListener('message', (event) => {
  const data = event.data;
  
  // 앱에서 "새 버전 확인" 요청 시
  if (data === 'CHECK_UPDATE') {
    // 등록 시 업데이트 체크 트리거
    self.registration.update().catch(console.error);
  }
  
  // 앱에서 "즉시 활성화(skipWaiting)" 요청 시 (사용자가 '새로고침' 버튼 눌렀을 때)
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ==========================================================================
// 5. Push/Notification (선택 - 향후 알림 기능 대비)
// ==========================================================================
// self.addEventListener('push', ...)
// self.addEventListener('notificationclick', ...)

// ==========================================================================
// 6. 동기화 (Background Sync - 선택, IndexedDB 동기화 시 사용)
// ==========================================================================
// self.addEventListener('sync', (event) => {
//   if (event.tag === 'sync-tasks') {
//     event.waitUntil(syncTasksToServer());
//   }
// });