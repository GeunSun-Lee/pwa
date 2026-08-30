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
    // Map<path, Set<callback>>
    this._subs = new Map();
  }

  /** 경로 정규화: 빈 문자열 -> 'root' */
  _norm(path) {
    return path || 'root';
  }

  /** 경로가 변경된 경로의 하위 경로인지 확인 (예: 'filter' 변경 시 'filter.status' 구독자 호출) */
  _isChildPath(parent, child) {
    return child === parent || child.startsWith(parent + '.');
  }

  /**
   * 구독 등록
   * @param {string} path - 구독할 경로 (예: 'books', 'filter.status', 'loading')
   * @param {Function} callback - 변경 시 호출될 함수 (newValue, oldValue, fullPath)
   * @returns {Function} 구독 해제 함수
   */
  subscribe(path, callback) {
    const normPath = this._norm(path);
    if (!this._subs.has(normPath)) this._subs.set(normPath, new Set());
    this._subs.get(normPath).add(callback);

    // 즉시 현재 값으로 한 번 호출 (초기 동기화용) - 옵션으로 뺄 수도 있음
    // callback(getPath(state, normPath), undefined, normPath); 

    return () => this.unsubscribe(normPath, callback);
  }

  /**
   * 구독 해제
   */
  unsubscribe(path, callback) {
    const normPath = this._norm(path);
    const set = this._subs.get(normPath);
    if (set) {
      set.delete(callback);
      if (set.size === 0) this._subs.delete(normPath);
    }
  }

  /**
   * 변경 알림 전파
   * 변경된 경로와 일치하거나, 변경된 경로의 자식 경로를 구독한 콜백 모두 호출
   * @param {string} changedPath - 실제 변경된 경로 (예: 'filter.status')
   * @param {*} newValue
   * @param {*} oldValue
   */
  notify(changedPath, newValue, oldValue) {
    const normChanged = this._norm(changedPath);
    
    this._subs.forEach((callbacks, subPath) => {
      // 구독 경로가 변경 경로와 같거나, 변경 경로의 부모인 경우 알림
      // 예: 변경='filter.status', 구독='filter' -> 알림 O
      // 예: 변경='filter', 구독='filter.status' -> 알림 O (부모 변경 시 자식도 영향)
      if (this._isChildPath(subPath, normChanged) || this._isChildPath(normChanged, subPath)) {
        // 구독 경로에 해당하는 최신 값 계산
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
// 초기 상태 정의 (app.js 요구사항 반영)
// -------------------------------------------------------------------------
const initialState = {
  // 데이터
  books: [],                 // ListView 표시용 책 배열
  pagination: { total: 0, limit: 20, offset: 0 },
  
  // 필터/정렬/뷰 상태
  filter: { 
    status: 'all',           // 'all' | 'reading' | 'completed' | 'paused' | 'wish'
    sort: 'completedAt',     // 'createdAt' | 'title' | 'author' | 'rating' | 'completedAt'
    order: 'desc',           // 'asc' | 'desc'
    tag: '',                 // 태그 필터
    q: ''                    // 검색어
  },
  viewMode: 'grid',          // 'grid' | 'list'
  
  // 상세/편집 뷰용 단일 데이터
  currentBook: null,         // BookEntity | null
  
  // 라우팅/레이아웃 상태
  currentView: 'list',       // 'list' | 'add' | 'detail' | 'edit' | 'stats' | 'settings'
  
  // UI 상태
  theme: '',                 // ''() | 'light' | 'dark'
  loading: false,            // 데이터 로딩 중
  saving: false,             // 저장/삭제 중
  
  // 모달/토스트 상태 (ui-helpers에서 직접 관리하므로 여기선 선택적)
  modal: null,               // { type: 'confirm'|'form', props: {} } | null
};

// -------------------------------------------------------------------------
// Proxy 핸들러 생성 (트랩 정의)
// -------------------------------------------------------------------------
const handler = {
  set(target, prop, value, receiver) {
    const oldValue = target[prop];
    
    // 값이 실제로 변경된 경우에만 처리 (참조 동일하면 무시)
    // 객체/배열의 경우 내부 내용 변경은 별도 트리거 필요 (아래 wrapMethods 참고)
    if (oldValue === value) return true;

    // 설정 수행
    const result = Reflect.set(target, prop, value, receiver);
    
    // 변경 알림 (경로: prop)
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
// 반응형 상태 객체 생성
// -------------------------------------------------------------------------
const state = new Proxy(initialState, handler);

// -------------------------------------------------------------------------
// 배열/객체 메서드 래핑 유틸 (깊은 변경 감지용)
// 사용 예: state.books = [...state.books, newBook] (권장)
// state.books.push(newBook) 도 동작하게 하려면 배열 자체를 프록시로 감싸야 함.
// 여기서는 단순성을 위해 "불변성 패턴(새 배열/객체 할당)"을 권장하고,
// 부득이하게 push/splice 쓰는 경우를 위해 wrapArray 헬퍼 제공.
// -------------------------------------------------------------------------

/**
 * 배열을 감싸서 변형 메서드 호출 시 자동으로 상태 업데이트 트리거
 * @param {string} path - 상태 내 배열 경로 (예: 'books')
 * @returns {Proxy<Array>} 프록시 배열
 */
function createReactiveArray(path) {
  const arrayProxyHandler = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      // 변형 메서드 래핑
      if (['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
        return function(...args) {
          const oldLen = target.length;
          const result = target[prop](...args);
          // 길이 변경되었거나 splice 등으로 내용 변경 시 알림
          if (target.length !== oldLen || prop === 'splice' || prop === 'sort' || prop === 'reverse') {
            // 상위 상태 객체의 해당 경로에 '새 배열 참조'를 할당하여 set 트랩 발동
            // 주의: state[path] = target 하면 무한 루프 가능성. 
            // 여기서는 subscriberManager.notify 직접 호출로 우회.
            subscriberManager.notify(path, [...target], [...target]); // 새 복사본 전달
          }
          return result;
        };
      }
      return value;
    }
  };

  // 초기 배열 가져오기 (프록시 생성 시점)
  const initialArray = getPath(state, path) || [];
  return new Proxy(initialArray, arrayProxyHandler);
}

// -------------------------------------------------------------------------
// Public API Export
// -------------------------------------------------------------------------

/**
 * 전역 반응형 상태 객체 (Proxy)
 * @type {Object & typeof initialState}
 */
export const state = state;

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
    // Proxy 대상 객체 직접 조작 후 알림
    const oldValue = state[key];
    state[key] = initialState[key];
    // set 트랩이 자동으로 notify 호출함
  });
  // 중첩 객체 초기화 (filter 등)
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
  // setPath는 내부 객체 직접 조작이므로 수동 알림
  subscriberManager.notify(path, value, getPath(state, path)); // 구현상 oldValue 정확히 알기 어려우나 근사치
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
 * 배열 상태에 대한 반응형 프록시 반환 (push/splice 등 변형 메서드 사용 시)
 * 주의: 반환된 프록시는 state.books 와 별도 참조이므로, 
 * state.books = reactiveBooks 처럼 재할당하지 말고 메서드만 사용해야 함.
 * 권장: 불변 패턴 사용 (state.books = [...state.books, newBook])
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