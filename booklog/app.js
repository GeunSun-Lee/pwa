// ==========================================================================
// app.js - Reading Log Main Entry Point (Final Production Version)
// ==========================================================================

// -------------------------------------------------------------------------
// 1. Imports
// -------------------------------------------------------------------------
import { ReadingDB } from './db.js';
import { router, navigate, parseHash } from './utils/router.js';
import { state, subscribe, resetState } from './utils/store.js';
import { showToast, showConfirm, closeModal } from './utils/ui-helpers.js';
import { formatDate, formatRelativeTime } from './utils/date.js';

// Views: init만 import (render는 각 뷰 내부에서 처리)
import { init as initListView } from './views/ListView.js';
import { init as initFormView } from './views/FormView.js';
import { init as initDetailView } from './views/DetailView.js';
import { init as initStatsView } from './views/StatsView.js';
import { init as initSettingsView } from './views/SettingsView.js';

// -------------------------------------------------------------------------
// 2. Global Constants & Route Config
// -------------------------------------------------------------------------
const APP_CONTAINER = document.getElementById('app');
const MODAL_ROOT = document.getElementById('modal-root');
const TOAST_CONTAINER = document.getElementById('toast-container');

const ROUTES = {
  '/': { init: initListView, title: '내 서재', layout: 'main' },
  '/add': { init: initFormView, title: '도서 등록', layout: 'form' },
  '/edit/:id': { init: initFormView, title: '도서 수정', layout: 'form' },
  '/detail/:id': { init: initDetailView, title: '상세 보기', layout: 'detail' },
  '/stats': { init: initStatsView, title: '독서 통계', layout: 'main' },
  '/settings': { init: initSettingsView, title: '설정', layout: 'main' },
};

// -------------------------------------------------------------------------
// 3. Utility: Fatal Error UI Renderer (Blank Screen & Private Mode 방지)
// -------------------------------------------------------------------------
function renderFatalError(title, message, stack = '') {
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:2rem; text-align:center; background:var(--color-bg-primary, #f8f9fa); color:var(--color-text-primary, #212529); font-family:var(--font-sans,-ui); line-height:1.6;">
        <h1 style="color: #dc3545; margin-bottom:1rem;">🚨 ${title}</h1>
        <div style="max-width:600px; margin-bottom:1.5rem;">${message}</div>
        ${stack ? `<details style="text-align:left; background:#fff; color:#dc3545; padding:1rem; border-radius:8px; overflow:auto; max-height:300px; font-size:0.75rem; width:100%; max-width:600px; box-shadow:0 2px 8px rgba(0,0,0,0.1); border:1px solid #f5c6cb;"><summary style="cursor:pointer; margin-bottom:0.5rem;">🔍 기술적 세부 정보 (스택 트레이스)</summary><pre style="margin:0;">${escapeHtml(stack)}</pre></details>` : ''}
        <button onclick="window.location.reload()" class="btn btn-primary" style="margin-top:1.5rem; padding:0.75rem 1.5rem; font-size:1rem; background:var(--color-brand, #2d6a4f); color:white; border:none; border-radius:8px; cursor:pointer;">🔄 페이지 새로고침</button>
        <p style="margin-top:1.5rem; font-size:0.85rem; color:var(--color-text-muted, #6c757d); max-width:500px;">이 화면이 계속 나타난다면 <strong>시크릿/프라이빗 모드</strong>이거나 브라우저 설정(<strong>쿠키/사이트 데이터 차단</strong>)으로 인해 IndexedDB가 차단되었을 수 있습니다. <br><strong>일반 모드에서 접속</strong>하거나 브라우저 설정에서 이 사이트의 데이터 저장을 허용해 주세요.</p>
      </div>
    `;
  }
  console.error(`[FATAL] ${title}:`, message, stack);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// -------------------------------------------------------------------------
// 4. Router Helpers
// -------------------------------------------------------------------------
function matchRoute(hash) {
  const cleanHash = hash.replace(/^#/, '') || '/';
  const [pathname] = cleanHash.split('?');
  const path = pathname || '/';
  
  for (const [pattern, route] of Object.entries(ROUTES)) {
    const regexPattern = pattern
      .replace(/\//g, '\\/')
      .replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    const match = path.match(regex);
    
    if (match) {
      const keys = (pattern.match(/:([^/]+)/g) || []).map(k => k.slice(1));
      const params = keys.reduce((acc, key, i) => ({ ...acc, [key]: match[i + 1] }), {});
      return { route, params, path };
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// 5. View Rendering Orchestrator (Timeout & Fallback 적용)
// -------------------------------------------------------------------------
async function renderView() {
  const hash = window.location.hash;
  const matched = matchRoute(hash);
  
  if (!matched) {
    navigate('/');
    return;
  }

  const { route, params, path } = matched;
  
  state.loading = true;
  state.currentView = path.split('/')[1] || 'list';
  document.title = `${route.title} | 내 독서록`;
  
  if (APP_CONTAINER) {
    APP_CONTAINER.dataset.route = state.currentView;
    APP_CONTAINER.dataset.layout = route.layout || 'main';
  }

  // 로딩 인디케이터 즉시 갱신
  if (APP_CONTAINER && state.currentView !== 'detail') {
     APP_CONTAINER.innerHTML = `
      <div class="empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:50vh; padding:2rem; text-align:center;">
        <div class="loading__spinner" style="width:40px; height:40px; border-width:4px; margin-bottom:1rem;"></div>
        <p id="view-load-status" style="color:var(--color-text-muted); font-size:0.95rem;">${route.title} 화면 로드 중...</p>
      </div>`;
  }

  try {
    // 🛡 10초 타임아웃 가드 (뷰 초기화 전체)
    const initPromise = route.init({ 
      params, 
      state, 
      navigate, 
      db: ReadingDB, 
      showToast, 
      showConfirm, 
      closeModal 
    });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('VIEW_INIT_TIMEOUT: 뷰 초기화 10초 초과 (데이터 로딩 지연)')), 10000)
    );

    await Promise.race([initPromise, timeoutPromise]);
    
  } catch (err) {
    console.error(`[Router] View init failed for ${path}:`, err);
    
    // 타임아웃 에러 시 친절한 메시지
    const isTimeout = err.message.includes('TIMEOUT');
    const msg = isTimeout 
      ? '화면 로드 시간이 초과되었습니다. 데이터가 많거나 DB가 일시적으로 느립니다.' 
      : `화면 로드 오류: ${err.message}`;
    
    showToast(msg, 'error');
    
    if (APP_CONTAINER) {
      APP_CONTAINER.innerHTML = `
        <div class="empty-state" style="max-width:500px;margin:4rem auto;text-align:center;padding:2rem;">
          <div class="empty-state__icon">⏱️</div>
          <h3 class="empty-state__title">${isTimeout ? '로드 시간 초과' : '화면 로드 실패'}</h3>
          <p class="empty-state__desc">${err.message}</p>
          <div style="margin-top:1rem; display:flex; gap:0.5rem; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="window.location.reload()">🔄 새로고침</button>
            <button class="btn btn-secondary" onclick="renderView()">🔁 재시도</button>
            <button class="btn btn-ghost" onclick="navigate('/')">🏠 홈으로</button>
          </div>
        </div>`;
    }
  } finally {
    state.loading = false;
  }
}

// -------------------------------------------------------------------------
// 6. Global Event Delegation (data-action 처리)
// -------------------------------------------------------------------------
function setupGlobalEventDelegation() {
  document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    const value = target.dataset.value;

    // 저장 중 중복 클릭 방지
    if (state.saving && ['delete-book', 'toggle-status'].includes(action)) return;

    try {
      switch (action) {
        // 네비게이션
        case 'navigate':
          e.preventDefault();
          navigate(target.dataset.href || target.getAttribute('href'));
          break;
        case 'go-back':
          history.back();
          break;

        // 도서 액션
        case 'delete-book':
          if (await showConfirm('정말로 이 도서를 삭제하시겠습니까?', '삭제된 데이터는 복구할 수 없습니다.')) {
            state.saving = true;
            await ReadingDB.delBook(id);
            showToast('도서가 삭제되었습니다.', 'success');
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
            renderView();
          }
          break;

        case 'open-detail':
          navigate(`/detail/${id}`);
          break;
        case 'open-edit':
          navigate(`/edit/${id}`);
          break;

        // 모달/UI
        case 'open-modal':
          document.dispatchEvent(new CustomEvent('app:open-modal', { 
            detail: { type: target.dataset.modalType, bookId: id, trigger: target } 
          }));
          break;
        case 'close-modal':
          closeModal();
          break;

        // 테마
        case 'toggle-theme':
          setTheme(state.theme === 'dark' ? 'light' : 'dark');
          break;

        // 데이터 관리
        case 'export-data':
          handleExport();
          break;
        case 'import-data':
          document.getElementById('import-file-input')?.click();
          break;
      }
    } catch (err) {
      console.error(`[Event] Action '${action}' failed:`, err);
      showToast(`오류: ${err.message}`, 'error');
    } finally {
      if (['delete-book', 'toggle-status'].includes(action)) {
        state.saving = false;
      }
    }
  });

  // 파일 입력 (Import)
  document.body.addEventListener('change', async (e) => {
    if (e.target.matches('#import-file-input')) {
      const file = e.target.files[0];
      if (file) {
        await handleImport(file);
        e.target.value = ''; // 동일 파일 재선택 가능
      }
    }
  });

  // 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.querySelector('.app-header__search-input')?.focus();
    }
  });
}

// -------------------------------------------------------------------------
// 7. Theme Management
// -------------------------------------------------------------------------
function setTheme(theme) {
  const html = document.documentElement;
  const resolvedTheme = theme === '' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  html.dataset.theme = resolvedTheme;
  state.theme = theme; // 사용자 선택 저장 ('', 'light', 'dark')
  ReadingDB.setSetting('theme', theme).catch(console.error);
}

async function loadInitialTheme() {
  try {
    const saved = await ReadingDB.getSetting('theme');
    setTheme(saved || '');
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (state.theme === '') setTheme('');
    });
  } catch (e) { 
    console.warn('Theme load failed, using default', e); 
  }
}

// -------------------------------------------------------------------------
// 8. Data Export / Import Handlers
// -------------------------------------------------------------------------
async function handleExport() {
  state.saving = true;
  showToast('백업 파일을 생성 중입니다...', 'info', 0); // 0 = 수동 닫힘
  
  try {
    const data = await ReadingDB.exportAll();
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

async function handleImport(file) {
  if (!confirm('현재 데이터를 덮어쓰고 가져오시겠습니까? 기존 데이터는 모두 삭제됩니다.')) return;
  
  state.saving = true;
  showToast('데이터를 복원 중입니다...', 'info', 0);
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.books || !Array.isArray(data.books)) throw new Error('유효하지 않은 백업 파일 형식입니다. (books 배열 없음)');
    
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

// -------------------------------------------------------------------------
// 9. Helpers
// -------------------------------------------------------------------------
function getStatusLabel(status) {
  const labels = { reading: '읽는 중', completed: '완독', paused: '중단', wish: '위시리스트' };
  return labels[status] || status;
}

// -------------------------------------------------------------------------
// 10. Application Bootstrap (Bulletproof)
// -------------------------------------------------------------------------
async function initApp() {
  console.log('[App] 🚀 Starting initialization...');
  
  // 0. 즉시 로딩 UI 표시
  if (APP_CONTAINER) {
    APP_CONTAINER.innerHTML = `
      <div class="empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; padding:2rem; text-align:center;">
        <div class="loading__spinner" style="width:40px; height:40px; border-width:4px; margin-bottom:1rem;"></div>
        <p id="init-status" style="color:var(--color-text-muted); font-size:0.95rem;">데이터베이스 초기화 중...</p>
      </div>`;
  }

  // 상태 업데이트 헬퍼
  const updateStatus = (msg) => {
    const el = document.getElementById('init-status');
    if (el) el.textContent = msg;
    console.log('[App Status]', msg);
  };

  try {
    // 1. IndexedDB 연결 (10초 타임아웃 + Promise.race)
    updateStatus('IndexedDB 연결 시도 중... (최대 10초 소요)');
    console.log('[App] 📦 Connecting to IndexedDB...');
    
    const dbReadyPromise = ReadingDB.ready();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT: IndexedDB 연결이 10초 내에 완료되지 않았습니다. 브라우저 설정(시크릿 모드, 쿠키 차단, 사파리 추적방지 등)을 확인해주세요.')), 10000)
    );
    
    await Promise.race([dbReadyPromise, timeoutPromise]);
    
    updateStatus('데이터베이스 연결 완료. 테마 로드 중...');
    console.log('[App] ✅ IndexedDB Ready');

    // 2. 테마 복원
    await loadInitialTheme();
    updateStatus('테마 적용 완료. 이벤트 바인딩 중...');
    console.log('[App] 🎨 Theme Loaded');

    // 3. 전역 이벤트 바인딩
    setupGlobalEventDelegation();
    updateStatus('이벤트 바인딩 완료. 라우터 시작...');
    console.log('[App] 👂 Events Bound');

    // 4. 라우터 시작
    router.start(renderView);
    console.log('[App] 🛣 Router Started');

    // 5. 전역 디버그 객체 노출
    window.__APP__ = { 
      state, 
      navigate, 
      db: ReadingDB, 
      toast: showToast, 
      confirm: showConfirm 
    };
    console.log('[App] ✅ App Ready');

  } catch (err) {
    // 💥 치명적 에러: 사용자 친화적 안내 화면
    console.error('[App] ❌ Initialization Failed:', err);
    
    let title = '초기화 실패';
    let message = `오류: ${err.message}`;
    let guide = '';
    
    const isTimeout = err.message.includes('TIMEOUT') || err.message.includes('시간 초과');
    const isBlocked = err.message.includes('SecurityError') || err.message.includes('차단') || err.message.includes('blocked') || err.message.includes('NotAllowedError') || err.message.includes('InvalidStateError') || err.message.includes('AbortError');

    if (isTimeout || isBlocked) {
      title = isTimeout ? '데이터베이스 연결 시간 초과' : '데이터베이스 접근 차단됨';
      message = isTimeout 
        ? 'IndexedDB 연결이 10초 내에 완료되지 않았습니다.' 
        : '브라우저 보안 정책(시크릿 모드, 쿠키 차단, 사파리 추적방지 등)으로 IndexedDB 사용이 차단되었습니다.';
      
      guide = `
        <h3 style="margin-top:1.5rem; margin-bottom:0.5rem; text-align:left;">🔧 해결 방법</h3>
        <ul style="text-align:left; max-width:500px; margin:0 auto 1rem; line-height:1.9; padding-left:1.2rem;">
          <li><strong>시크릿/프라이빗 모드</strong>에서 접속 중이라면 <strong>일반 모드</strong>로 접속해 보세요.</li>
          <li><strong>Safari (iOS/macOS)</strong>: 설정 > 사파리 > <strong>"사이트 간 추적 방지" 해제</strong>, <strong>"모든 쿠키 차단" 해제</strong></li>
          <li><strong>Chrome/Edge</strong>: 설정 > 쿠키 및 사이트 데이터 > <strong>"모든 쿠키 허용"</strong> 또는 이 사이트([주소창 자물쇠 아이콘] > 쿠키 허용) 허용</li>
          <li><strong>Firefox</strong>: 주소창 왼쪽 방패 아이콘 클릭 > <strong>"이 사이트에 대해 추적 방지 끄기"</strong></li>
          <li>브라우저 <strong>쿠키/사이트 데이터 삭제</strong> 후 다시 시도</li>
          <li>그래도 안 되면 <strong>다른 브라우저(Chrome, Firefox, Edge 최신 버전)</strong>에서 접속 시도</li>
        </ul>
      `;
    } else {
      guide = '<p style="margin-top:1rem;">알 수 없는 오류입니다. 브라우저를 재시작하거나 개발자에게 문의하세요.</p>';
    }

    renderFatalError(title, message + guide, err.stack);
  }
}

// 즉시 실행
initApp();