// ==========================================================================
// utils/router.js - Hash Based Router (Fixed: Initial Render Bug)
// ==========================================================================

/**
 * 현재 해시에서 경로(path)와 쿼리 파라미터를 파싱합니다.
 * @param {string} [hash=window.location.hash] - 파싱할 해시 문자열 (기본값: 현재 위치)
 * @returns {{ path: string, search: string, params: Object<string, string> }}
 */
export function parseHash(hash = window.location.hash) {
  const cleanHash = hash.replace(/^#/, '').trim();
  const [pathname = '/', search = ''] = cleanHash.split('?');
  const path = pathname || '/';
  
  const queryParams = new URLSearchParams(search);
  const params = {};
  for (const [key, value] of queryParams.entries()) {
    params[key] = value;
  }

  return { path, search, params };
}

function matchRoute(pattern, path) {
  const regexPattern = pattern
    .replace(/\//g, '\\/')
    .replace(/:([^/]+)/g, '([^/]+)');
  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);
  
  if (!match) return null;

  const paramNames = (pattern.match(/:([^/]+)/g) || []).map(p => p.slice(1));
  const params = {};
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });
  
  return params;
}

/**
 * 라우터 인스턴스 생성 및 제어
 */
const router = (() => {
  let _callback = null;
  let _isListening = false;
  let _currentHash = null; // 💡 수정: 초기값 null로 변경 (빈 문자열 ""과 구분)

  /**
   * 해시 변경 감지 및 콜백 실행
   */
  function _onHashChange() {
    const newHash = window.location.hash;
    
    // 💡 수정: 최초 실행 시 _currentHash가 null이므로 무조건 실행되도록 보장
    // 이후부터는 동일 해시 반복 방지
    if (newHash === _currentHash) return;
    
    _currentHash = newHash;
    
    if (_callback) {
      // 마이크로태스크 큐에 넣어 현재 콜스택 종료 후 실행 보장
      queueMicrotask(() => _callback(newHash));
    }
  }

  /**
   * 팝스테이트(브라우저 뒤로가기/앞으로가기) 감지
   */
  function _onPopState() {
    _onHashChange();
  }

  return {
    /**
     * 라우터 리스닝 시작
     * @param {Function} callback - 해시 변경 시 호출될 함수
     */
    start(callback) {
      if (_isListening) return;
      
      _callback = callback;
      _isListening = true;
      _currentHash = null; // 💡 수정: 시작 시 null로 리셋 (최초 강제 실행 보장)

      // 1. 해시 변경 이벤트 리스너 등록
      window.addEventListener('hashchange', _onHashChange);
      
      // 2. 히스토리 상태 변경 감지
      window.addEventListener('popstate', _onPopState);

      // 3. 초기 라우팅 즉시 실행 (setTimeout 0 대신 queueMicrotask로 동기적에 가깝게 실행)
      //    _currentHash가 null이므로 _onHashChange 내부에서 renderView 무조건 호출됨
      queueMicrotask(() => _onHashChange());
    },

    stop() {
      if (!_isListening) return;
      window.removeEventListener('hashchange', _onHashChange);
      window.removeEventListener('popstate', _onPopState);
      _callback = null;
      _isListening = false;
    },

    getCurrentHash() {
      return window.location.hash;
    },

    match(pattern) {
      const { path } = parseHash();
      return matchRoute(pattern, path);
    }
  };
})();

/**
 * 프로그래매틱 네비게이션
 * @param {string} to - 대상 경로 (예: '/detail/abc', '/list?status=reading')
 * @param {Object} [options]
 * @param {boolean} [options.replace=false] - true 시 history.replaceState
 * @param {boolean} [options.scrollToTop=true] - 이동 후 스크롤 최상단 이동
 */
export function navigate(to, { replace = false, scrollToTop = true } = {}) {
  const hash = to.startsWith('/') ? `#${to}` : `#/${to}`;
  
  if (!replace && window.location.hash === hash) return;

  if (replace) {
    history.replaceState(null, '', hash);
  } else {
    history.pushState(null, '', hash);
  }

  if (scrollToTop) {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.body.style.height = '100%';
      setTimeout(() => { document.body.style.height = ''; }, 100);
    });
  }

  // navigate 호출 시 해시가 변경되면 hashchange 이벤트가 자동 발생하므로
  // 별도 dispatchEvent 불필요 (브라우저 기본 동작 신뢰)
  // 단, hashchange 이벤트가 안 뜨는 구형 브라우저 대비 수동 트리거 유지
  window.dispatchEvent(new HashChangeEvent('hashchange', {
    oldURL: window.location.href.replace(window.location.hash, ''),
    newURL: window.location.href
  }));
}

export function getCurrentRoute() {
  const { path, search, params: query } = parseHash();
  return { path, search, query };
}

export function matchCurrentRoute(pattern) {
  const { path } = parseHash();
  return matchRoute(pattern, path);
}

// 개발 편의: 전역 노출
if (typeof window !== 'undefined') {
  window.__ROUTER__ = { navigate, parseHash, matchRoute, getCurrentRoute, router: router };
}

// 💡 핵심 수정: router 객체 named export
export { router };