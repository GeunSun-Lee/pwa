// sw.js
const CACHE_NAME = 'math-practice-v3'; // 버전 업데이트 시 변경
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  // 아이콘들은 install 단계에서 캐싱됨
];

// 1. 설치: 앱 셸(App Shell) 미리 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching App Shell');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting(); // 즉시 활성화
});

// 2. 활성화: 오래된 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim(); // 즉시 제어권 획득
});

// 3. 요청 가로채기 (Fetch Strategy)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) 네비게이션 요청 (HTML) -> Network First (최신 HTML 유지) + Offline Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 성공 시 캐시 업데이트
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, resClone));
          return response;
        })
        .catch(() => caches.match('./index.html')) // 오프라인 시 index.html 반환
    );
    return;
  }

  // 2) 정적 리소스 (CSS, JS, CSS, Images, Manifest) -> Cache First (속도 우선)
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'manifest'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          // 유효한 응답만 캐시 갱신
          if (response.ok) {
            const resClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, resClone));
          }
          return response;
        }).catch(() => cached); // 네트워크 실패 시 캐시 반환

        return cached || networkFetch;
      })
    );
    return;
  }

  // 3) 기타 (API 호출 등) -> Network Only (우린 로컬 DB만 쓰지만 혹시 모를 대비)
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// 4. 백그라운드 동기화 (선택: 나중에 데이터 서버 연동 시 사용)
// self.addEventListener('sync', (event) => { ... });

// 5. 푸시 알림 (선택)
// self.addEventListener('push', (event) => { ... });