/* ============================================================
   sw.js — 책읽기 친구 Service Worker
   GitHub Pages (Static Hosting) 전용
   ============================================================ */

// ---- 1. 설정 ----
const CACHE_VERSION = 'v1.0.3';              // 🔼 배포 시마다 버전 올리기
const CACHE_NAME = `reading-log-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = '/offline.html';    // 선택: 별도 오프라인 페이지 있을 때

// 정적 프리캐시 대상 (빌드 시 자동 생성 권장, 여기선 수동 열거)
const PRECACHE_URLS = [
  './',               // index.html (베이스 경로 포함)
  './index.html',
  './style.css',
  './app.js',
  // './manifest.json',  // 인라인 매니페스트 쓰면 불필요
  // 아이콘/이미지 등 추가 가능
];

// CDN 도메인 화이트리스트 (오프라인 캐싱 허용)
const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com'
];

// ---- 2. 유틸: 베이스 경로 자동 감지 ----
/**
 * GitHub Pages 프로젝트 사이트: https://.github.io/repo/ → scope=/repo/
 * 유저/조직 사이트: https://.github.io/ → scope=/
 * Service Worker 스코프는 등록 시 결정되지만, fetch 이벤트에서 request.url 기준 상대 경로 계산 필요
 */
function getBasePath() {
  // self.registration.scope 예: "https://.github.io/repo/"
  const scope = self.registration.scope;
  const origin = self.location.origin;
  // scope에서 origin 다음 경로 추출
  const base = scope.slice(origin.length).replace(/\/+$/, ''); // "/repo" 또는 ""
  return base; // 선행 슬래시 포함, 후행 슬래시 없음
}
const BASE_PATH = getBasePath(); // 예: "/reading-log" 또는 ""

function normalizeUrl(url) {
  const u = new URL(url, self.location.href);
  // 동일 오리진이면 베이스 경로 제거하여 캐시 키 통일
  if (u.origin === self.location.origin) {
    const path = u.pathname;
    if (BASE_PATH && path.startsWith(BASE_PATH)) {
      u.pathname = path.slice(BASE_PATH.length) || '/';
    }
  }
  return u.href;
}

function isSameOrigin(url) {
  return new URL(url, self.location.href).origin === self.location.origin;
}

function isCdnOrigin(url) {
  return CDN_ORIGINS.some(o => url.startsWith(o));
}

function isPrecacheCandidate(url) {
  return PRECACHE_URLS.some(p => normalizeUrl(url) === normalizeUrl(p));
}

// ---- 3. Install: 프리캐시 ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // 상대 경로로 변환해 저장 (베이스 경로 제거)
        const urls = PRECACHE_URLS.map(u => normalizeUrl(u));
        return cache.addAll(urls).catch((err) => {
          console.warn('[SW] Precaching failed:', err);
          // 개별 실패 무시하고 성공한 것만 캐시
          return Promise.allSettled(
            urls.map(u => cache.add(u).catch(() => {}))
          );
        });
      })
      .then(() => self.skipWaiting()) // 즉시 활성화
  );
});

// ---- 4. Activate: 구 캐시 정리 & 클라이언트 제어 ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // 열린 탭 즉시 제어
  );
});

// ---- 5. Fetch: 라우팅 & 캐시 전략 ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // GET만 처리
  if (request.method !== 'GET') return;

  // 크롬 확장 등 스킵
  if (url.startsWith('chrome-extension://')) return;

  const normalized = normalizeUrl(url);
  const sameOrigin = isSameOrigin(url);
  const cdnOrigin = isCdnOrigin(url);
  const isNavigate = request.mode === 'navigate';
  const isPrecache = sameOrigin && isPrecacheCandidate(url);

  // --------------------------------------------------------
  // A. 네비게이션(HTML) → Network First
  // --------------------------------------------------------
  if (isNavigate || (sameOrigin && normalized.endsWith('.html'))) {
    event.respondWith(networkFirstThenCache(request, normalized));
    return;
  }

  // --------------------------------------------------------
  // B. 프리캐시 정적 에셋 (CSS/JS/이미지) → Cache First + SWR
  // --------------------------------------------------------
  if (isPrecache || (sameOrigin && (normalized.endsWith('.css') || normalized.endsWith('.js') || normalized.match(/\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/)))) {
    event.respondWith(cacheFirstThenRefresh(request, normalized));
    return;
  }

  // --------------------------------------------------------
  // C. CDN 리소스 (폰트, 아이콘, Chart.js) → Stale-While-Revalidate
  // --------------------------------------------------------
  if (cdnOrigin) {
    event.respondWith(staleWhileRevalidate(request, normalized));
    return;
  }

  // --------------------------------------------------------
  // D. 그 외 동일 오리진 → Network First (안전)
  // --------------------------------------------------------
  if (sameOrigin) {
    event.respondWith(networkFirstThenCache(request, normalized));
    return;
  }

  // --------------------------------------------------------
  // E. 기타 크로스 오리진 → 네트워크만 (캐시 안 함)
  // --------------------------------------------------------
  // event.respondWith(fetch(request).catch(() => Response.error())); // 기본 동작
});

// ---- 6. 캐시 전략 구현 ----

/** Network First → Cache Fallback */
async function networkFirstThenCache(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    // 오프라인 폴백 (선택)
    if (OFFLINE_FALLBACK) {
      const fallback = await cache.match(normalizeUrl(OFFLINE_FALLBACK));
      if (fallback) return fallback;
    }
    // 최종 폴백: 간단한 오프라인 응답
    return new Response('오프라인 상태입니다. 네트워크 연결을 확인하세요.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** Cache First → Background Refresh (Stale-While-Revalidate) */
async function cacheFirstThenRefresh(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);

  // 백그라운드 업데이트 (stale-while-revalidate)
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  }).catch(() => {});

  // 캐시 있으면 즉시 반환, 없으면 네트워크 대기
  return cached || fetchPromise;
}

/** Stale-While-Revalidate (CDN용: opaque response 허용) */
async function staleWhileRevalidate(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);

  const fetchPromise = fetch(request).then((response) => {
    // opaque response(상태 0)도 캐시 저장 가능 (no-cors)
    if (response.type === 'opaque' || response.ok) {
      cache.put(cacheKey, response.clone());
    }
    return response;
  }).catch(() => {});

  return cached || fetchPromise;
}

// ---- 7. 메시지 채널: 클라이언트와 통신 (업데이트 알림 등) ----
self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type, payload } = event.data;

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_VERSION });
      break;
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
  }
});

// ---- 8. 푸시/백그라운드 싱크 (미구현 — 향후 확장) ----
// self.addEventListener('push', ...);
// self.addEventListener('sync', ...);

// ---- 9. 콘솔 로그 (디버깅용) ----
console.log(`[SW] ${CACHE_NAME} activated. Scope: ${self.registration.scope}`);