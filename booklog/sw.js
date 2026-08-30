// ==========================================================================
// sw.js - Service Worker for Reading Log (Offline First)
// ==========================================================================

/**
 * 캐시 이름 버전 관리: 배포 시마다 버전/해시 변경 필수 (예: v1.0.0, v1.0.1, v20260830-1)
 * GitHub Actions 등 CI/CD에서 빌드 타임에 주입하는 것을 권장.
 */
const CACHE_VERSION = 'v1.0.0'; // 🚀 배포 전 반드시 변경하세요!
const CACHE_NAME = `reading-log-${CACHE_VERSION}`;
const PRECACHE_NAME = `${CACHE_NAME}-precache`;

// 프리캐시할 핵심 정적 자산 목록 (빌드 시 자동 생성 권장)
const PRECACHE_URLS = [
  './',              // 루트 (index.html 폴백용)
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  './utils/router.js',
  './utils/store.js',
  './utils/ui-helpers.js',
  './utils/date.js',
  './views/ListView.js',
  './views/FormView.js',
  './views/DetailView.js',
  './views/StatsView.js',
  './views/SettingsView.js',
  // 아이콘은 용량 고려하여 선택적 포함 (필수 아이콘만)
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 캐시하지 않을 패턴 (API 호출 등 - 현재 앱은 순수 정적이므로 해당 없음)
const EXCLUDE_PATTERNS = [
  /^chrome-extension:/,
  /^data:/,
  /^blob:/
];

// -------------------------------------------------------------------------
// 1. Install Event: 정적 자산 프리캐싱
// -------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('[SW] Install event:', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching static assets...');
        // addAll은 하나라도 실패하면 전체 실패하므로 개별 try-catch 권장
        return Promise.allSettled(
          PRECACHE_URLS.map((url) => 
            cache.add(url).catch((err) => {
              console.warn(`[SW] Precaching failed for ${url}:`, err);
              // 실패해도 치명적이지 않음 (런타임 시 캐싱됨)
            })
          )
        );
      })
      .then(() => {
        // 새 SW 즉시 활성화 (기존 탭 새로고침 없이 적용)
        return self.skipWaiting();
      })
  );
});

// -------------------------------------------------------------------------
// 2. Activate Event: 구버전 캐시 정리
// -------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event:', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        const validCaches = [CACHE_NAME, PRECACHE_NAME];
        return Promise.all(
          cacheNames
            .filter((name) => !validCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // 모든 클라이언트(탭) 즉시 제어권 획득
        return self.clients.claim();
      })
  );
});

// -------------------------------------------------------------------------
// 3. Fetch Event: 요청 가로채기 및 응답 전략
// -------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. 제외 패턴 (확장, 데이터 URI 등)
  if (EXCLUDE_PATTERNS.some(p => p.test(request.url))) return;

  // 2. HTTP 메서드 제한 (GET, HEAD만 캐싱)
  if (request.method !== 'GET' && request.method !== 'HEAD') return;

  // 3. 네비게이션 요청 (HTML 페이지 진입) - Stale-While-Revalidate + Offline Fallback
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 4. 정적 자산 (JS, CSS, 이미지, 폰트, 매니페스트) - Cache First
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 5. 그 외 (CDN 라이브러리 등) - Network First (안전장치)
  event.respondWith(networkFirst(request));
});

// -------------------------------------------------------------------------
// 전략 구현 헬퍼 함수들
// -------------------------------------------------------------------------

/** 정적 자산 여부 판단 */
function isStaticAsset(request) {
  const url = new URL(request.url);
  // 동일 오리진 리소스 + 확장자 체크
  return url.origin === location.origin && 
         /\.(js|css|png|jpg|jpeg|svg|gif|webp|ico|woff2?|json|map)$/i.test(url.pathname);
}

/** Cache First: 캐시 우선, 없으면 네트워크 -> 캐시 저장 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    // 백그라운드에서 업데이트 시도 (Stale-While-Revalidate 효과)
    fetchAndCache(request, cache).catch(() => {});
    return cached;
  }
  
  return fetchAndCache(request, cache);
}

/** Network First: 네트워크 우선, 실패 시 캐시 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err; // 둘 다 실패 시 에러 전파
  }
}

/** 네비게이션: 네트워크 우선(최신 HTML), 실패 시 캐시된 index.html (SPA 폴백) */
async function handleNavigation(request) {
  const cache = await caches.open(PRECACHE_NAME);
  
  try {
    // 네트워크에서 최신 HTML 시도
    const response = await fetch(request);
    if (response.ok) {
      // 새 버전 HTML 캐시 갱신
      cache.put('./index.html', response.clone()); // 루트 별칭 저장
      cache.put(request.url, response.clone());    // 실제 URL도 저장
    }
    return response;
  } catch (err) {
    // 오프라인/네트워크 실패: 캐시된 index.html 반환 (SPA 라우터가 해시 기반 라우팅 처리)
    const cached = await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    
    // 최후 수단: 기본 오프라인 페이지 (여긴 안 옴)
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

/** 공통: 네트워크 요청 후 캐시 저장 */
async function fetchAndCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      // 응답 스트림은 한 번만 읽을 수 있으므로 clone 필요
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 네트워크 실패 시 에러 던짐 (상위에서 캐시 폴백 처리)
    throw err;
  }
}

// -------------------------------------------------------------------------
// 4. Message Event: 클라이언트와의 통신 (강제 업데이트 등)
// -------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

// -------------------------------------------------------------------------
// 5. Periodic Sync / Push (선택적 - 향후 확장용 자리)
// -------------------------------------------------------------------------
// self.addEventListener('periodicsync', ...);
// self.addEventListener('push', ...);

/** 개발용 로그 */
console.log('[SW] Service Worker loaded:', CACHE_VERSION);