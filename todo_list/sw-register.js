// sw-register.js
// Service Worker 등록 로직 (CSP 'script-src self' 준수를 위해 외부 파일로 분리)

if ('serviceWorker' in navigator) {
  // 페이지 로드 완료 후 등록 (성능 위해)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.log('[SW] 등록 성공:', reg.scope);
        // 업데이트 체크 (30분마다 자동으로 app.js에서 돌지만 최초 1회)
        reg.update().catch(err => console.log('[SW] 최초 업데이트 체크 실패:', err));
      })
      .catch(err => console.error('[SW] 등록 실패:', err));
  });

  // 컨트롤러 변경 감지 (새 SW 활성화 시 강제 리로드) - app.js에서도 하지만 여기서도 안전장치
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[SW] 컨트롤러 변경됨, 페이지 새로고침');
    window.location.reload();
  });
} else {
  console.warn('[SW] Service Worker 미지원 브라우저');
}