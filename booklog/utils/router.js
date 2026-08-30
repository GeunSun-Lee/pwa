// ==========================================================================
// utils/router.js - Hash Based Router (Fixed: export router)
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

const router = (() => {
  let _callback = null;
  let _isListening = false;
  let _currentHash = '';

  function _onHashChange() {
    const newHash = window.location.hash;
    if (newHash === _currentHash) return;
    _currentHash = newHash;
    
    if (_callback) {
      Promise.resolve().then(() => _callback(newHash));
    }
  }

  function _onPopState() {
    _onHashChange();
  }

  return {
    start(callback) {
      if (_isListening) return;
      _callback = callback;
      _isListening = true;
      _currentHash = window.location.hash;

      window.addEventListener('hashchange', _onHashChange);
      window.addEventListener('popstate', _onPopState);

      setTimeout(() => _onHashChange(), 0);
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

  // hashchange 이벤트 강제 트리거 (router 내부 가드 있음)
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
  window.__ROUTER__ = { navigate, parseHash, matchRoute, getCurrentRoute, router }; // router도 추가
}

// ✅ 핵심 수정: router 객체 named export 추가
export { router };