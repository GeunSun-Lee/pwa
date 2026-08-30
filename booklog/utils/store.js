// ==========================================================================
// utils/store.js - Reactive Global State (Proxy Based)
// ==========================================================================

/**
 * 깊은 경로 문자열로 객체 값 접근/설정 헬퍼
 * @param {Object} obj - 대상 객체
 * @param {string} path - 점 표기법 경로 (예: 'filter.status')
 * @param {*} [value] - 설정 시 값
 * @returns {*} 값 (get) 또는 undefined (set)
 */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  if (target && lastKey) target[lastKey] = value;
}

/**
 * 구독자 관리 클래스
 * 경로별 콜백 셋을 관리하며, 경로 계층 구조를 고려해 알림 전파
 */
class SubscriberManager {
  constructor() {
    this._subs = new Map();
  }

  _norm(path) {
    return path || 'root';
  }

  _isChildPath(parent, child) {
    return child === parent || child.startsWith(parent + '.');
  }

  subscribe(path, callback) {
    const normPath = this._norm(path);
    if (!this._subs.has(normPath)) this._subs.set(normPath, new Set());
    this._subs.get(normPath).add(callback);
    return () => this.unsubscribe(normPath, callback);
  }

  unsubscribe(path, callback) {
    const normPath = this._norm(path);
    const set = this._subs.get(normPath);
    if (set) {
      set.delete(callback);
      if (set.size === 0) this._subs.delete(normPath);
    }
  }

  notify(changedPath, newValue, oldValue) {
    const normChanged = this._norm(changedPath);
    this._subs.forEach((callbacks, subPath) => {
      if (this._isChildPath(subPath, normChanged) || this._isChildPath(normChanged, subPath)) {
        const value = getPath(state, subPath);
        callbacks.forEach(cb => {
          try {
            cb(value, oldValue, subPath);
          } catch (e) {
            console.error(`[Store] Subscriber error (${subPath}):`, e);
          }
        });
      }
    });
  }
}

const subscriberManager = new SubscriberManager();

// -------------------------------------------------------------------------
// 초기 상태 정의
// -------------------------------------------------------------------------
const initialState = {
  books: [],
  pagination: { total: 0, limit: 20, offset: 0 },
  filter: { 
    status: 'all',
    sort: 'completedAt',
    order: 'desc',
    tag: '',
    q: ''
  },
  viewMode: 'grid',
  currentBook: null,
  currentView: 'list',
  theme: '',
  loading: false,
  saving: false,
  modal: null,
};

// -------------------------------------------------------------------------
// Proxy 핸들러 생성
// -------------------------------------------------------------------------
const handler = {
  set(target, prop, value, receiver) {
    const oldValue = target[prop];
    if (oldValue === value) return true;
    const result = Reflect.set(target, prop, value, receiver);
    subscriberManager.notify(prop, value, oldValue);
    return result;
  },
  deleteProperty(target, prop) {
    const oldValue = target[prop];
    const result = Reflect.deleteProperty(target, prop);
    subscriberManager.notify(prop, undefined, oldValue);
    return result;
  }
};

// -------------------------------------------------------------------------
// 반응형 상태 객체 생성 (단일 선언)
// -------------------------------------------------------------------------
const state = new Proxy(initialState, handler);

// -------------------------------------------------------------------------
// 배열 메서드 래핑 유틸 (깊은 변경 감지용)
// -------------------------------------------------------------------------
function createReactiveArray(path) {
  const arrayProxyHandler = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
        return function(...args) {
          const oldLen = target.length;
          const result = target[prop](...args);
          if (target.length !== oldLen || prop === 'splice' || prop === 'sort' || prop === 'reverse') {
            subscriberManager.notify(path, [...target], [...target]);
          }
          return result;
        };
      }
      return value;
    }
  };
  const initialArray = getPath(state, path) || [];
  return new Proxy(initialArray, arrayProxyHandler);
}

// -------------------------------------------------------------------------
// Public API Export (수정된 부분: export { state } 사용)
// -------------------------------------------------------------------------

/**
 * 전역 반응형 상태 객체 (Proxy)
 * @type {Object & typeof initialState}
 */
export { state }; // ✅ 수정된 부분: 이미 선언된 const state를 재선언 없이 내보냄

/**
 * 상태 변경 구독
 * @param {string} path - 구독할 경로 (예: 'books', 'filter.status', 'loading')
 * @param {Function} callback - (newValue, oldValue, path) => void
 * @returns {Function} 구독 해제 함수
 */
export function subscribe(path, callback) {
  return subscriberManager.subscribe(path, callback);
}

/**
 * 상태 초기화 (앱 리셋 시)
 */
export function resetState() {
  Object.keys(initialState).forEach(key => {
    const oldValue = state[key];
    state[key] = initialState[key];
  });
  state.filter = { ...initialState.filter };
  state.pagination = { ...initialState.pagination };
}

/**
 * 깊은 경로 값 설정 (알림 자동 발생)
 * @param {string} path - 예: 'filter.status'
 * @param {*} value
 */
export function setPathValue(path, value) {
  setPath(state, path, value);
  subscriberManager.notify(path, value, getPath(state, path));
}

/**
 * 깊은 경로 값 가져오기
 * @param {string} path
 * @returns {*}
 */
export function getPathValue(path) {
  return getPath(state, path);
}

/**
 * 배열 상태에 대한 반응형 프록시 반환
 * @param {string} path - 예: 'books'
 * @returns {Proxy<Array>}
 */
export function getReactiveArray(path) {
  return createReactiveArray(path);
}

// 개발 편의: 전역 노출
if (typeof window !== 'undefined') {
  window.__STATE__ = state;
  window.__STORE_API__ = { subscribe, resetState, setPathValue, getPathValue };
}