// ==========================================================================
// utils/router.js - Hash Based Router
// ==========================================================================

/**
 * 현재 해시에서 경로(path)와 쿼리 파라미터를 파싱합니다.
 * @param {string} [hash=window.location.hash] - 파싱할 해시 문자열 (기본값: 현재 위치)
 * @returns {{ path: string, search: string, params: Object<string, string> }}
 * 
 * @example
 * // #/detail/abc-123?tab=review
 * parseHash() 
 * // => { path: '/detail/abc-123', search: 'tab=review', params: { id: 'abc-123' } }
 */
export function parseHash(hash = window.location.hash) {
  // 1. '#' 제거 및 공백 트림
  const cleanHash = hash.replace(/^#/, '').trim();
  
  // 2. 경로(path)와 쿼리스트링(search) 분리
  const [pathname = '/', search = ''] = cleanHash.split('?');
  
  // 3. 경로 정규화 (빈 문자열이면 '/')
  const path = pathname || '/';

  // 4. 쿼리 파라미터 파싱 (URLSearchParams 활용)
  const queryParams = new URLSearchParams(search);
  const params = {};
  for (const [key, value] of queryParams.entries()) {
    params[key] = value;
  }

  return { path, search, params };
}

/**
 * 주어진 경로 패턴과 실제 경로를 매칭하고 동적 파라미터(:id)를 추출합니다.
 * @param {string} pattern - 라우트 패턴 (예: '/detail/:id')
 * @param {string} path - 실제 경로 (예: '/detail/abc-123')
 * @returns {Object<string, string> | null} 매칭 시 파라미터 객체, 실패 시 null
 */
function matchRoute(pattern, path) {
  // 패턴을 정규식으로 변환: '/detail/:id' -> '^/detail/([^/]+)$'
  const regexPattern = pattern
    .replace(/\//g, '\\/')           // 슬래시 이스케이프
    .replace(/:([^/]+)/g, '([^/]+)'); // :param -> 캡처 그룹
  
  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);
  
  if (!match) return null;

  // 패턴에서 파라미터 이름 추출 (':id' -> 'id')
  const paramNames = (pattern.match(/:([^/]+)/g) || []).map(p => p.slice(1));
  
  // 매칭된 값과 이름 매핑
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
  let _callback = null; // 라우트 변경 시 호출될 콜백 (renderView 등)
  let _isListening = false;
  let _currentHash = '';

  /**
   * 해시 변경 감지 및 콜백 실행
   */
  function _onHashChange() {
    const newHash = window.location.hash;
    // 동일 해시 반복 실행 방지 (브라우저별 동작 차이 보정)
    if (newHash === _currentHash) return;
    _currentHash = newHash;
    
    if (_callback) {
      // 비동기 렌더링 허용을 위해 Promise.resolve 래핑
      Promise.resolve().then(() => _callback(newHash));
    }
  }

  /**
   * 팝스테이트(브라우저 뒤로가기/앞으로가기) 감지
   * hashchange 이벤트가 발생하므로 별도 로직 불필요하지만,
   * 명시적으로 상태 복원이 필요할 경우 대비.
   */
  function _onPopState() {
    // hashchange가 자동으로 발생하므로 여기선 로그만 남기거나 상태 동기화 용도
    _onHashChange();
  }

  return {
    /**
     * 라우터 리스닝 시작
     * @param {Function} callback - 해시 변경 시 호출될 함수 (인자: newHash string)
     */
    start(callback) {
      if (_isListening) return;
      
      _callback = callback;
      _isListening = true;
      _currentHash = window.location.hash;

      // 1. 해시 변경 이벤트 리스너 등록
      window.addEventListener('hashchange', _onHashChange);
      
      // 2. 히스토리 상태 변경 감지 (pushState/replaceState 직접 호출 시 hashchange 미발생할 수 있음)
      window.addEventListener('popstate', _onPopState);

      // 3. 초기 라우팅 실행 (현재 해시 기준)
      // setTimeout으로 현재 콜스택 종료 후 실행 보장 (초기화 순서 안전)
      setTimeout(() => _onHashChange(), 0);
    },

    /**
     * 라우터 리스닝 중지 (SPA 언마운트 시 사용)
     */
    stop() {
      if (!_isListening) return;
      window.removeEventListener('hashchange', _onHashChange);
      window.removeEventListener('popstate', _onPopState);
      _callback = null;
      _isListening = false;
    },

    /**
     * 현재 해시 반환
     */
    getCurrentHash() {
      return window.location.hash;
    },

    /**
     * 현재 경로 패턴 매칭 테스트용 (디버깅)
     */
    match(pattern) {
      const { path } = parseHash();
      return matchRoute(pattern, path);
    }
  };
})();

/**
 * 프로그래매틱 네비게이션 (페이지 이동)
 * @param {string} to - 대상 경로 (예: '/detail/abc', '/list?status=reading')
 * @param {Object} [options]
 * @param {boolean} [options.replace=false] - true 시 history.replaceState (히스토리 교체), false 시 pushState
 * @param {boolean} [options.scrollToTop=true] - 이동 후 스크롤 최상단 이동 여부
 */
export function navigate(to, { replace = false, scrollToTop = true } = {}) {
  // 1. 해시 형식 보정: '/'로 시작하지 않으면 추가
  const hash = to.startsWith('/') ? `#${to}` : `#/${to}`;
  
  // 2. 현재 해시와 동일하면 무시 (단, replace=true면 강제 실행)
  if (!replace && window.location.hash === hash) return;

  // 3. History API로 상태 변경 (hashchange 이벤트 발생 유도)
  if (replace) {
    history.replaceState(null, '', hash);
  } else {
    history.pushState(null, '', hash);
  }

  // 4. 스크롤 이동 (다음 틱에 실행되어 렌더링 후 적용되도록)
  if (scrollToTop) {
    // requestAnimationFrame으로 렌더링 완료 후 스크롤 보장 시도
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      // 모바일 주소창 숨김 유도
      document.body.style.height = '100%'; 
      setTimeout(() => { document.body.style.height = ''; }, 100);
    });
  }

  // 5. 수동 해시 변경 시 hashchange 이벤트가 동기/비동기로 발생하지 않을 수 있으므로 수동 트리거
  // router 내부 _onHashChange는 중복 가드(_currentHash)가 있으므로 안전하게 호출 가능
  // 단, router.start()가 호출된 이후여야 함.
  // 전역 router 객체에 접근하여 강제 트리거 (또는 커스텀 이벤트 디스패치)
  window.dispatchEvent(new HashChangeEvent('hashchange', {
    oldURL: window.location.href.replace(window.location.hash, ''),
    newURL: window.location.href
  }));
}

/**
 * 현재 라우트 정보를 파싱하여 반환 (컴포넌트에서 사용)
 * @returns {{ path: string, search: string, params: Object, query: Object }}
 * 
 * @example
 * // URL: #/detail/abc-123?tab=review
 * getCurrentRoute()
 * // => { 
 * //   path: '/detail/abc-123', 
 * //   search: 'tab=review', 
 * //   params: { id: 'abc-123' }, // 라우트 패턴 매칭 필요하므로 여기선 query만 파싱
 * //   query: { tab: 'review' } 
 * // }
 */
export function getCurrentRoute() {
  const { path, search, params: query } = parseHash();
  return { path, search, query };
}

/**
 * 주어진 라우트 패턴에 현재 경로가 매칭되는지 확인하고 파라미터 반환
 * @param {string} pattern - 예: '/detail/:id'
 * @returns {Object | null}
 */
export function matchCurrentRoute(pattern) {
  const { path } = parseHash();
  return matchRoute(pattern, path);
}

// 개발 편의: 전역 노출 (콘솔에서 router.navigate('/add') 테스트 가능)
if (typeof window !== 'undefined') {
  window.__ROUTER__ = { navigate, parseHash, matchRoute, getCurrentRoute };
}