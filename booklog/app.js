// ==========================================================================
// app.js - Application Entry Point
// ==========================================================================
import { ReadingDB } from './db.js';
import { router, navigate, parseHash } from './utils/router.js';
import { state, subscribe, resetState } from './utils/store.js';
import { showToast, showConfirm, closeModal } from './utils/ui-helpers.js';
import { formatDate, formatRelativeTime } from './utils/date.js';

// View Components (Lazy loaded or direct import)
// 직접 임포트 방식 사용 (번들러 없이 HTTP/2 멀티플렉싱 활용)
import { render as renderListView, init as initListView } from './views/ListView.js';
import { render as renderFormView, init as initFormView } from './views/FormView.js';
import { render as renderDetailView, init as initDetailView } from './views/DetailView.js';
import { render as renderStatsView, init as initStatsView } from './views/StatsView.js';
import { render as renderSettingsView, init as initSettingsView } from './views/SettingsView.js';

// ==========================================================================
// 1. Global Constants & Configuration
// ==========================================================================
const APP_CONTAINER = document.getElementById('app');
const MODAL_ROOT = document.getElementById('modal-root');
const TOAST_CONTAINER = document.getElementById('toast-container');

// Route Map: path pattern -> { renderFn, initFn, title, requiresAuth? }
const ROUTES = {
  '/': { 
    render: renderListView, 
    init: initListView, 
    title: '내 서재', 
    layout: 'main' 
  },
  '/add': { 
    render: renderFormView, 
    init: initFormView, 
    title: '도서 등록', 
    layout: 'form' 
  },
  '/edit/:id': { 
    render: renderFormView, 
    init: initFormView, 
    title: '도서 수정', 
    layout: 'form' 
  },
  '/detail/:id': { 
    render: renderDetailView, 
    init: initDetailView, 
    title: '상세 보기', 
    layout: 'detail' 
  },
  '/stats': { 
    render: renderStatsView, 
    init: initStatsView, 
    title: '독서 통계', 
    layout: 'main' 
  },
  '/settings': { 
    render: renderSettingsView, 
    init: initSettingsView, 
    title: '설정', 
    layout: 'main' 
  },
};

// ==========================================================================
// 2. Global State Initialization (Reactive Proxy in store.js)
// ==========================================================================
// state 구조:
// {
//   books: [],           // 현재 뷰에 표시될 책 목록 (ListView용)
//   pagination: { total: 0, limit: 20, offset: 0 },
//   filter: { status: 'all', sort: 'completedAt', order: 'desc', tag: '', q: '' },
//   viewMode: 'grid',    // 'grid' | 'list'
//   currentBook: null,   // Detail/Edit 뷰용 단일 책 객체
//   currentView: 'list', // 라우트 매칭용
//   theme: '',     // 'light' | 'dark' | ''
//   loading: false,
//   saving: false,
//   modal: null,         // { component: 'ComponentName', props: {} } 또는 null
//   toasts: []           // 토스트 큐 (ui-helpers에서 관리하므로 상태엔 선택적)
// }

// ==========================================================================
// 3. Core Application Logic
// ==========================================================================

/**
 * 라우트 매칭 및 파라미터 추출
 * @param {string} hash - window.location.hash (예: '#/detail/abc-123')
 * @returns {{ route: Object, params: Object, path: string } | null}
 */
function matchRoute(hash) {
  const cleanHash = hash.replace(/^#/, '') || '/';
  const [pathname, search] = cleanHash.split('?');
  
  for (const [pattern, route] of Object.entries(ROUTES)) {
    const regexPattern = pattern
      .replace(/:[^/]+/g, '([^/]+)') // :id -> ([^/]+)
      .replace(/\//g, '\\/');
    const regex = new RegExp(`^${regexPattern}$`);
    const match = pathname.match(regex);
    
    if (match) {
      const keys = (pattern.match(/:([^/]+)/g) || []).map(k => k.slice(1));
      const params = keys.reduce((acc, key, i) => ({ ...acc, [key]: match[i + 1] }), {});
      return { route, params, path: pathname, search };
    }
  }
  return null;
}

/**
 * 뷰 렌더링 메인 함수
 */
async function renderView() {
  const hash = window.location.hash;
  const matched = matchRoute(hash);
  
  // 1. 라우트 미매칭 시 홈으로 리다이렉트
  if (!matched) {
    navigate('/');
    return;
  }

  const { route, params, path } = matched;
  
  // 2. 전역 상태 업데이트 (로딩 시작)
  state.loading = true;
  state.currentView = path.split('/')[1] || 'list';
  document.title = `${route.title} | 내 독서록`;
  APP_CONTAINER.dataset.route = state.currentView;
  APP_CONTAINER.dataset.layout = route.layout || 'main';

  try {
    // 3. 뷰별 초기화 로직 실행 (데이터 로딩 등)
    // init 함수는 비동기로 데이터를 불러오고 state를 업데이트한 뒤 내부적으로 render()를 호출하거나
    // 여기에서 공통 render()를 호출하도록 설계.
    // 여기서는 init이 모든 것을 처리한다고 가정 (데이터 로딩 + 렌더링)
    await route.init({ params, state, navigate, db: ReadingDB, showToast, showConfirm, closeModal });
  } catch (error) {
    console.error(`[Router] View init failed for ${path}:`, error);
    showToast(`화면 로드 중 오류 발생: ${error.message}`, 'error');
    // 에러 폴백 UI 렌더링
    APP_CONTAINER.innerHTML = `
      <div class="empty-state" style="max-width: 500px; margin: 4rem auto;">
        <div class="empty-state__icon">⚠️</div>
        <h3 class="empty-state__title">페이지를 불러올 수 없습니다</h3>
        <p class="empty-state__desc">${error.message}</p>
        <button class="btn btn-primary mt-4" onclick="window.location.reload()">새로고침</button>
      </div>
    `;
  } finally {
    state.loading = false;
  }
}

/**
 * 전역 이벤트 위임 핸들러 (Event Delegation)
 * data-action 속성을 가진 요소의 클릭을 가로챔
 */
function setupGlobalEventDelegation() {
  document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id; // 책 ID 등
    const value = target.dataset.value; // 상태 값 등

    // 로딩 중 중복 클릭 방지
    if (state.saving && ['delete', 'update-status', 'save-book'].includes(action)) return;

    try {
      switch (action) {
        // --- 네비게이션 ---
        case 'navigate':
          e.preventDefault();
          navigate(target.dataset.href || target.getAttribute('href'));
          break;

        case 'go-back':
          history.back();
          break;

        // --- 북 액션 (List/Detail 공통) ---
        case 'delete-book':
          if (await showConfirm('정말로 이 도서를 삭제하시겠습니까?', '삭제된 데이터는 복구할 수 없습니다.')) {
            state.saving = true;
            await ReadingDB.delBook(id);
            showToast('도서가 삭제되었습니다.', 'success');
            // 현재 뷰가 리스트라면 상태 갱신 트리거 (ListView에서 구독 중)
            // 간단히 현재 라우트 재실행
            renderView(); 
          }
          break;

        case 'toggle-status':
          state.saving = true;
          const book = await ReadingDB.getBook(id);
          if (book) {
            const newStatus = value || (book.status === 'completed' ? 'reading' : 'completed');
            book.status = newStatus;
            book.updatedAt = new Date().toISOString();
            if (newStatus === 'completed' && !book.completedAt) book.completedAt = book.updatedAt;
            if (newStatus !== 'completed') book.completedAt = null;
            await ReadingDB.putBook(book);
            showToast(`상태가 변경되었습니다: ${getStatusLabel(newStatus)}`, 'success');
            renderView(); // 리스트/디테일 갱신
          }
          break;

        case 'open-detail':
          navigate(`/detail/${id}`);
          break;

        case 'open-edit':
          navigate(`/edit/${id}`);
          break;

        // --- 모달/UI 제어 ---
        case 'open-modal':
          // 동적 임포트 또는 전역 모달 레지스트리 활용
          // 여기서는 간단히 커스텀 이벤트로 View에 위임
          document.dispatchEvent(new CustomEvent('app:open-modal', { 
            detail: { type: target.dataset.modalType, bookId: id, trigger: target } 
          }));
          break;

        case 'close-modal':
          closeModal();
          break;

        // --- 테마 ---
        case 'toggle-theme':
          const newTheme = state.theme === 'dark' ? 'light' : 'dark';
          setTheme(newTheme);
          break;

        // --- 데이터 관리 ---
        case 'export-data':
          handleExport();
          break;
        
        case 'import-data':
          document.getElementById('import-file-input')?.click();
          break;

        default:
          console.warn(`[Event] Unknown action: ${action}`);
      }
    } catch (err) {
      console.error(`[Event] Action '${action}' failed:`, err);
      showToast(`오류: ${err.message}`, 'error');
    } finally {
      if (['delete-book', 'toggle-status', 'save-book'].includes(action)) {
        state.saving = false;
      }
    }
  });

  // 파일 입력 변경 감지 (Import)
  document.body.addEventListener('change', async (e) => {
    if (e.target.matches('#import-file-input')) {
      const file = e.target.files[0];
      if (file) {
        await handleImport(file);
        e.target.value = ''; // 동일 파일 재선택 가능하게 리셋
      }
    }
  });

  // 키보드 단축키 (Esc: 모달 닫기)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    // Ctrl/Cmd + K: 검색 포커스 (선택적)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.querySelector('.app-header__search-input')?.focus();
    }
  });
}

/**
 * 테마 적용 및 저장
 */
function setTheme(theme) {
  const html = document.documentElement;
  const resolvedTheme = theme === '' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  html.dataset.theme = resolvedTheme;
  state.theme = theme; // 사용자 선택값 저장(system/dark/light)
  ReadingDB.setSetting('theme', theme).catch(console.error);
}

/**
 * 초기 테마 로드
 */
async function loadInitialTheme() {
  const saved = await ReadingDB.getSetting('theme');
  const theme = saved || '';
  setTheme(theme);
  
  // 시스템 테마 변경 감지 (사용자가 '' 선택 시에만 반응)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === '') {
      setTheme('');
    }
  });
}

/**
 * 데이터 내보내기 (JSON + Blob 이미지 Base64 변환 포함)
 */
async function handleExport() {
  state.saving = true;
  showToast('백업 파일을 생성 중입니다...', 'info', 0); // 0 = 안 사라짐
  
  try {
    const data = await ReadingDB.exportAll();
    // Blob -> Base64 변환은 DB.exportAll 내부에서 처리됨
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading-log-backup-${formatDate(new Date(), 'YYYYMMDD')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('백업이 완료되었습니다.', 'success');
    await ReadingDB.setSetting('lastBackup', new Date().toISOString());
  } catch (err) {
    console.error('Export failed:', err);
    showToast(`백업 실패: ${err.message}`, 'error');
  } finally {
    state.saving = false;
  }
}

/**
 * 데이터 가져오기
 */
async function handleImport(file) {
  if (!confirm('현재 데이터를 덮어쓰고 가져오시겠습니까? 기존 데이터는 모두 삭제됩니다.')) return;
  
  state.saving = true;
  showToast('데이터를 복원 중입니다...', 'info', 0);
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    // 기본 검증
    if (!data.books || !Array.isArray(data.books)) throw new Error('유효하지 않은 백업 파일 형식입니다.');
    
    await ReadingDB.importAll(data);
    showToast('데이터 복원이 완료되었습니다. 페이지를 새로고침합니다.', 'success');
    
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    console.error('Import failed:', err);
    showToast(`복원 실패: ${err.message}`, 'error');
  } finally {
    state.saving = false;
  }
}

// ==========================================================================
// 4. Initialization Sequence
// ==========================================================================
async function initApp() {
  console.log('[App] Initializing...');
  
  try {
    // 1. DB 연결 및 스키마 초기화
    await ReadingDB.ready();
    console.log('[App] IndexedDB Ready');

    // 2. 테마 복원
    await loadInitialTheme();

    // 3. 전역 이벤트 리스너 등록
    setupGlobalEventDelegation();

    // 4. 라우터 시작 (hashchange 리스닝 및 초기 렌더링)
    router.start(renderView); // router.js 에서 hashchange 감지 후 renderView 호출
    
    // 5. 전역 헬퍼 노출 (디버깅/콘솔용)
    window.__APP__ = { 
      state, 
      navigate, 
      db: ReadingDB, 
      toast: showToast, 
      confirm: showConfirm 
    };

    console.log('[App] Ready');
  } catch (err) {
    console.error('[App] Fatal Initialization Error:', err);
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem;text-align:center;background:var(--color-bg-primary);color:var(--color-text-primary);font-family:var(--font-sans);">
        <div>
          <h1>🚨 치명적 오류</h1>
          <p>애플리케이션을 초기화할 수 없습니다.</p>
          <pre style="margin-top:1rem;text-align:left;background:#fff;padding:1rem;border-radius:8px;color:#dc3545;max-height:300px;overflow:auto;">${err.stack || err.message}</pre>
          <button class="btn btn-primary mt-4" onclick="window.location.reload()">다시 시도</button>
        </div>
      </div>
    `;
  }
}

// DOMContentLoaded 시점보다 module script가 늦게 실행되므로 바로 실행
initApp();

// ==========================================================================
// 5. Utility Helpers (Local)
// ==========================================================================
function getStatusLabel(status) {
  const labels = { reading: '읽는 중', completed: '완독', paused: '중단', wish: '위시리스트' };
  return labels[status] || status;
}

// 개발 환경에서 HMR(Hot Module Replacement) 등 대응 시 cleanup 로직 추가 가능
// import.meta.hot?.accept?.(() => { ... });