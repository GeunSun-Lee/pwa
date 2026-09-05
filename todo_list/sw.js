// ==========================================================================
// sw.js - Service Worker (Vanilla, Offline-First for Android/Chrome)
// ==========================================================================

/**
 * [중요] 배포 시마다 버전 업데이트 필수 (예: 'kids-todo-v1', 'kids-todo-v2'...)
 * 버전이 바뀌어야 install 이벤트가 다시 발동되어 새 리소스 캐싱함.
 */
const CACHE_NAME = 'kids-todo-v1'; 

// --------------------------------------------------------------------------
// 프리캐시 대상 리소스 (앱 셸)
// --------------------------------------------------------------------------
// 경로: sw.js 위치 기준 상대 경로 (루트 배포 시 './' 기준)
// GitHub Pages 하위 경로 배포 시 (예: /repo-name/) 절대 경로('/repo-name/...')로 수정 필요.
const PRECACHE_ASSETS = [
  './',                 // 네비게이션 폴백용 (index.html 별칭)
  './index.html',       // 메인 HTML
  './style.css',        // 스타일시트
  './app.js',           // 메인 로직
  './db.js',            // DB 래퍼
  './ui.js',            // UI 헬퍼
  './manifest.json',    // PWA 매니페스트
  
  // 아이콘 (manifest.json에 정의된 것 필수 포함)
  './icons/icon-192.png',
  './icons/icon-512.png',
  //'./icons/maskable-512.png',
  
  // 👇 [Patch] 로컬 웹폰트 사용 시 반드시 주석 해제 및 파일 배치 필수
  // 오프라인 환경에서 폰트 깨짐(FOUT/FOIT) 방지
  './fonts/PretendardVariable.woff2',
  './fonts/NanumSquareRound.woff2',
];

// 정적 리소스 판별 정규식 (캐시 전략 분기용)
const STATIC_EXTENSIONS = /\.(?:css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|ico|json|map)$/i;

// ==========================================================================
// 1. Install: 프리캐싱 (앱 셸 저장) & Skip Waiting
// ==========================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching App Shell...');
        
        // addAll은 하나라도 실패하면 전체 실패하므로, 폰트 등 선택적 리소스는 개별 추가 권장
        // 여기서는 핵심 리소스만 addAll로 강제 캐싱
        const coreAssets = PRECACHE_ASSETS.filter(url => !url.includes('/fonts/'));
        
        return cache.addAll(coreAssets.map(url => new Request(url, { credentials: 'same-origin' })))
          .catch(err => {
            console.error('[SW] Core Precaching failed:', err);
            throw err; // 핵심 리소스 실패 시 설치 중단
          });
      })
      .then(() => {
        // 대기 중인 SW 즉시 활성화 (새 버전 배포 시 즉시 적용)
        return self.skipWaiting();
      })
  );
});

// ==========================================================================
// 2. Activate: 구버전 캐시 정리 & 클라이언트 제어권 획득
// ==========================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
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
// 3. Fetch: 요청 가로채기 (전략 적용)
// ==========================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. 비 GET 요청 또는 비 HTTP(S) 스킴 무시 (확장 프로그램, chrome-extension:// 등)
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // 2. 내비게이션 요청 (HTML 문서) - Stale While Revalidate 전략
  // - 캐시된 화면 즉시 표시 (빠른 최초 렌더링)
  // - 백그라운드에서 네트워크로 최신 버전 확인 후 캐시 갱신
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidateStrategy(request));
    return;
  }

  // 3. 정적 리소스 (CSS, JS, 이미지, 폰트, 매니페스트) - Cache First 전략
  // - 파일명에 해시가 없으므로 버전 관리는 SW 버전(CACHE_NAME)으로 함.
  // - 캐시 우선으로 즉각 응답, 없으면 네트워크에서 가져와 캐시 저장.
  if (STATIC_EXTENSIONS.test(url.pathname) || url.pathname.endsWith('/manifest.json')) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // 4. 그 외 (API 호출 등 - 현재 앱엔 없음) - 네트워크만 시도
  // event.respondWith(fetch(request)); // 기본 동작이므로 생략
});

// ==========================================================================
// 전략 구현 함수들
// ==========================================================================

/**
 * Cache First: 캐시 확인 -> 응답 -> 없으면 네트워크 -> 캐시 저장 -> 응답
 * @param {Request} request 
 */
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // 캐시 히트: 즉시 반환
    // 백그라운드 업데이트(Stale-While-Revalidate)는 정적 파일의 경우 파일명 변경 없으면 의미 적음
    // 필요시 주석 해제: updateCacheInBackground(request, cache);
    return cachedResponse;
  }

  // 캐시 미스: 네트워크 요청
  try {
    const networkResponse = await fetch(request);
    // 유효한 응답만 캐시 (opaque response 제외, status 200 OK)
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Network fetch failed (offline?):', request.url, error);
    
    // 오프라인 폴백: 이미지라면 투명 1x1 픽셀 SVG 반환 (레이아웃 깨짐 방지)
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    // 폰트라면 빈 응답 (텍스트는 시스템 폰트로 폴백됨)
    if (request.destination === 'font') {
      return new Response(null, { status: 204 });
    }
    
    throw error; // 그 외는 브라우저 기본 에러 페이지 표시
  }
}

/**
 * Stale While Revalidate: 캐시 즉시 반환 + 백그라운드에서 네트워크로 갱신
 * 내비게이션(HTML) 요청에 최적: 오프라인에서 즉시 화면 뜨고, 온라인 시 최신 버전 준비
 * @param {Request} request 
 */
async function staleWhileRevalidateStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // 네트워크 요청 프로미스 생성 (캐시 여부와 상관없이 실행)
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      // 응답 스트림은 한 번만 읽을 수 있으므로 clone 필수
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch((err) => {
    console.log('[SW] Network request failed (offline):', request.url);
    // 네트워크 실패 시 에러 던지지 않고 캐시된 응답에 맡김 (아래에서 처리)
    return null; 
  });

  // 캐시가 있으면 즉시 반환 (Stale)
  if (cachedResponse) {
    return cachedResponse;
  }

  // 캐시 없으면 네트워크 응답 대기 (Revalidate)
  // fetchPromise가 null이면(오프라인+캐시없음) 폴백 페이지 반환
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // 캐시도 없고 네트워크도 안 되면: 오프라인 폴백 (index.html 반환)
  const fallback = await cache.match('./index.html');
  if (fallback) return fallback;

  return new Response('오프라인 상태입니다. 인터넷 연결을 확인해주세요.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// 선택: 백그라운드 업데이트 헬퍼 (필요시 활성화)
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
    self.registration.update().catch(console.error);
  }
  
  // 앱에서 "즉시 활성화(skipWaiting)" 요청 시 (사용자가 '새로고침' 버튼 눌렀을 때)
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ==========================================================================
// 5. Push/Notification / Background Sync (향후 확장용 플레이스홀더)
// ==========================================================================
// self.addEventListener('push', ...)
// self.addEventListener('notificationclick', ...)
// self.addEventListener('sync', (event) => {
//   if (event.tag === 'sync-tasks') {
//     event.waitUntil(syncTasksToServer());
//   }
// });