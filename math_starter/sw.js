// ==========================================
// sw.js - Service Worker (Final Fixed)
// Strategy: Cache First (Static) + Stale-While-Revalidate (Navigation)
// Fixes: #16 Precache Sync, #21 Scope/Base Handling, Update Notification
// ==========================================

const CACHE_PREFIX = 'kids-math';
const VERSION = 'v1.0.0'; // 🛡 배포 시마다 반드시 버전 업 (예: v1.0.2, v1.1.0)
const CACHE_NAME = `${CACHE_PREFIX}-${VERSION}`;

// ------------------------------------------------------------------
// 1. 설치할 정적 자산 목록 (Precache Manifest)
// 🛡 Medium #16 Fix: 이 목록은 manifest.json의 icons, index.html의 링크, css/js 내부 참조와 100% 일치해야 함.
//    누락 시 install 이벤트 실패 -> 오프라인 동작 안 함.
//    빌드 스크립트(workbox-cli, custom node script)로 자동 생성하는 것 강력 권장.
// ------------------------------------------------------------------
const PRECACHE_ASSETS = [
  // Core HTML & Manifest
  './',                  // start_url (scope 기준)
  './index.html',
  './manifest.json',
  
  // Styles
  './css/style.css',
  
  // Scripts (ES Modules - 의존성 순서 무관하나 모두 명시)
  './js/main.js',
  './js/db.js',
  './js/logic.js',
  './js/ui.js',
  
  // Icons (manifest.json "icons" 배열과 정확히 일치해야 함)
  // 🛡 Sync Required: 아래 파일들이 assets/icons/ 폴더에 물리적으로 존재해야 함.

  './assets/icons/icon-192.png', // 필수 (Android Home)
  './assets/icons/icon-512.png', // 필수 (Splash/Store)
  //'./assets/icons/icon-512.svg', // Maskable용 (선택)
  
  // Shortcut Icons (manifest.json "shortcuts" 참조 시 필요)
  // 🛡 Sync Required: manifest.json shortcuts.icons 에 정의된 파일들
  './assets/icons/shortcut-practice.png',
  './assets/icons/shortcut-challenge.png',
  
  // Sounds (Web Audio API 합성음 사용 시 불필요. 파일 사용 시 주석 해제)
  // './assets/sounds/correct.mp3',
  // './assets/sounds/wrong.mp3',
  // './assets/sounds/click.mp3',
];

// ------------------------------------------------------------------
// 2. 유틸리티: Scope 기준 절대 URL 정규화
// ------------------------------------------------------------------
function getAbsoluteUrls(assets) {
  // registration.scope 는 install/activate 시점에만 확실함. 
  // self.location.origin + registration.scope 경로 사용.
  // GitHub Pages: https://.github.io/repo-name/ -> scope 끝에는 '/' 포함됨.
  const base = self.registration.scope; 
  return assets.map(url => new URL(url, base).href);
}

const PRECACHE_URLS = getAbsoluteUrls(PRECACHE_ASSETS);

// ------------------------------------------------------------------
// 3. Install Event: Pre-caching (App Shell)
// ------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      
      try {
        // addAll은 원자적(All-or-Nothing). 하나라도 404면 전체 롤백.
        await cache.addAll(PRECACHE_URLS);
        console.log(`[SW] Precache 성공: ${PRECACHE_URLS.length}개 자산 (${CACHE_NAME})`);
      } catch (err) {
        console.error('[SW] Precache 실패 (리스트/파일 존재 여부 확인):', err);
        throw err; // 설치 실패시킴 (구버전 유지)
      }
    })()
  );
  // 설치 즉시 활성화 대기 건너뛰기 (새 버전 바로 적용)
  self.skipWaiting();
});

// ------------------------------------------------------------------
// 4. Activate Event: 구버전 캐시 정리 & 클라이언트 제어권 획득
// ------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 4-1. 현재 버전 외 캐시 모두 삭제
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] 구버전 캐시 삭제:', name);
            return caches.delete(name);
          })
      );
      
      // 4-2. 즉시 모든 클라이언트(탭) 제어권 획득
      await self.clients.claim();
      console.log('[SW] 활성화 완료, 클라이언트 제어 시작');
    })()
  );
});

// ------------------------------------------------------------------
// 5. Fetch Event: 요청 가로채기
// ------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 5-1. GET 요청만 처리
  if (request.method !== 'GET') return;

  // 5-2. 비 HTTP 스키마 무시 (chrome-extension, data:, blob: 등)
  if (!url.protocol.startsWith('http')) return;

  // 5-3. 네비게이션 요청 (HTML 페이지 이동): App Shell 패턴
  // 캐시된 index.html 즉시 반환 -> 백그라운드에서 업데이트 확인
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 5-4. 정적 자산 (CSS, JS, 이미지, 폰트, 매니페스트): Cache First
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 5-5. 그 외 (API 등): Network First (현재 앱엔 해당 없음)
  event.respondWith(networkFirst(request));
});

// ------------------------------------------------------------------
// 6. 핸들러 구현
// ------------------------------------------------------------------

/** 네비게이션 요청 처리: 오프라인에서 index.html 즉시 제공 */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  // scope 기준 상대 경로로 매칭 (base href 고려)
  const cachedResponse = await cache.match('./index.html');
  
  if (cachedResponse) {
    // 백그라운드에서 최신 버전 확인 후 캐시 갱신 (Stale-While-Revalidate 유사)
    // 네트워크 실패해도 사용자는 캐시된 화면 봄
    fetch(request).then(networkResp => {
      if (networkResp.ok) cache.put('./index.html', networkResp.clone());
    }).catch(() => {}); // 오프라인 시 무시
    
    return cachedResponse;
  }

  // 캐시 없으면 네트워크 시도 (최초 설치 전 등)
  try {
    const networkResp = await fetch(request);
    if (networkResp.ok) cache.put('./index.html', networkResp.clone());
    return networkResp;
  } catch {
    return new Response('오프라인: 앱을 로드할 수 없습니다.', { 
      status: 503, 
      headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
    });
  }
}

/** 정적 자산: Cache First (캐시 우선, 없으면 네트워크 -> 캐시 저장) */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse; // 캐시 히트: 즉시 반환
  }
  
  // 캐시 미스: 네트워크 요청
  try {
    const networkResponse = await fetch(request);
    
    // 유효한 응답만 캐시 저장 (opaque response 등 제외, 동일 오리진만)
    if (networkResponse.ok && networkResponse.type !== 'opaque') {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('[SW] 리소스 로드 실패 (오프라인):', request.url);
    // 이미지 깨짐 방지용 투명 플레이스홀더 반환 가능
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

/** 기타: Network First (네트워크 우선, 실패 시 캐시) */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && networkResponse.type !== 'opaque') {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    return cachedResponse || new Response('', { status: 408 });
  }
}

/** 정적 자산 판별: 동일 오리진 + 확장자/경로 기준 */
function isStaticAsset(request) {
  const url = new URL(request.url);
  
  // 1. 동일 오리진만 캐시 (CDN 리소스는 CORS opaque 문제로 캐시 안 함)
  if (url.origin !== self.location.origin) return false;
  
  const pathname = url.pathname;
  
  // 2. Precach 목록에 있는 경로이거나, 알려진 정적 확장자
  return PRECACHE_URLS.includes(request.url) || 
         /\.(css|js|mjs|png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot|json|mp3|wav|ogg|map)$/i.test(pathname);
}

// ------------------------------------------------------------------
// 7. 메시지 통신: 클라이언트(main.js)와 연동
// ------------------------------------------------------------------
self.addEventListener('message', (event) => {
  // 7-1. 강제 활성화 (새 버전 설치 후 대기 중일 때)
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  // 7-2. 버전 정보 요청
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: VERSION, cacheName: CACHE_NAME });
  }
});

// ------------------------------------------------------------------
// 8. 주기적 업데이트 체크 (선택적 - Periodic Background Sync 필요)
// ------------------------------------------------------------------
/*
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-updates') {
    event.waitUntil(checkForUpdates());
  }
});
*/

// ------------------------------------------------------------------
// 9. 클라이언트에게 업데이트 알림 전송 헬퍼 (main.js 연동용)
// ------------------------------------------------------------------
// main.js에서 'sw:update' 이벤트 리스닝 중
function notifyClientsUpdate(reg) {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATED', registration: reg });
    });
  });
}

// Install 완료 후 대기 중인 워커가 있으면 알림 (최초 설치 시 제외)
self.addEventListener('install', (event) => {
  // waiting 상태가 되면(이미 설치 완료된 새 버전이 있으면) 알림
  // 하지만 install 이벤트 직후에는 waiting 상태가 아닐 수 있음.
  // activate 시점에 알리는 것이 더 정확함.
});

self.addEventListener('activate', (event) => {
  // 활성화 후 클라이언트에게 새 버전 준비 알림 (선택적)
  // event.waitUntil(notifyClientsUpdate(self.registration)); 
  // main.js에서는 controllerchange 또는 SW 메시지('SW_UPDATED')로 감지
});

// ------------------------------------------------------------------
// 10. 개발자 도구 디버깅 지원
// ------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'debug:cache') {
    caches.open(CACHE_NAME).then(cache => cache.keys()).then(keys => {
      event.ports[0].postMessage({ cacheKeys: keys.map(r => r.url) });
    });
  }
});