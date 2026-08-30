// ==========================================================================
// app.js - Application Entry Point (Fixed: render import removed)
// ==========================================================================
import { ReadingDB } from './db.js';
import { router, navigate, parseHash } from './utils/router.js';
import { state, subscribe, resetState } from './utils/store.js';
import { showToast, showConfirm, closeModal } from './utils/ui-helpers.js';
import { formatDate, formatRelativeTime } from './utils/date.js';

// View Components: init만 import (render import 완전 제거)
import { init as initListView } from './views/ListView.js';
import { init as initFormView } from './views/FormView.js';
import { init as initDetailView } from './views/DetailView.js';
import { init as initStatsView } from './views/StatsView.js';
import { init as initSettingsView } from './views/SettingsView.js';

// ==========================================================================
// 1. Global Constants & Configuration
// ==========================================================================
const APP_CONTAINER = document.getElementById('app');
const MODAL_ROOT = document.getElementById('modal-root');
const TOAST_CONTAINER = document.getElementById('toast-container');

// Route Map: init만 사용
const ROUTES = {
  '/': { init: initListView, title: '내 서재', layout: 'main' },
  '/add': { init: initFormView, title: '도서 등록', layout: 'form' },
  '/edit/:id': { init: initFormView, title: '도서 수정', layout: 'form' },
  '/detail/:id': { init: initDetailView, title: '상세 보기', layout: 'detail' },
  '/stats': { init: initStatsView, title: '독서 통계', layout: 'main' },
  '/settings': { init: initSettingsView, title: '설정', layout: 'main' },
};

// ==========================================================================
// 2. Global State Initialization
// ==========================================================================
// state 구조는 store.js 참조

// ==========================================================================
// 3. Core Application Logic
// ==========================================================================

function matchRoute(hash) {
  const cleanHash = hash.replace(/^#/, '') || '/';
  const [pathname, search] = cleanHash.split('?');
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
      return { route, params, path: pathname, search };
    }
  }
  return null;
}

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
  APP_CONTAINER.dataset.route = state.currentView;
  APP_CONTAINER.dataset.layout = route.layout || 'main';

  try {
    // init 함수만 호출 (내부에서 렌더링까지 처리)
    await route.init({ 
      params, 
      state, 
      navigate, 
      db: ReadingDB, 
      showToast, 
      showConfirm, 
      closeModal 
    });
  } catch (error) {
    console.error(`[Router] View init failed for ${path}:`, error);
    showToast(`화면 로드 중 오류 발생: ${error.message}`, 'error');
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

function setupGlobalEventDelegation() {
  document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    const value = target.dataset.value;

    if (state.saving && ['delete', 'update-status', 'save-book'].includes(action)) return;

    try {
      switch (action) {
        case 'navigate':
          e.preventDefault();
          navigate(target.dataset.href || target.getAttribute('href'));
          break;
        case 'go-back':
          history.back();
          break;
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
        case 'open-modal':
          document.dispatchEvent(new CustomEvent('app:open-modal', { 
            detail: { type: target.dataset.modalType, bookId: id, trigger: target } 
          }));
          break;
        case 'close-modal':
          closeModal();
          break;
        case 'toggle-theme':
          const newTheme = state.theme === 'dark' ? 'light' : 'dark';
          setTheme(newTheme);
          break;
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

  document.body.addEventListener('change', async (e) => {
    if (e.target.matches('#import-file-input')) {
      const file = e.target.files[0];
      if (file) {
        await handleImport(file);
        e.target.value = '';
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.querySelector('.app-header__search-input')?.focus();
    }
  });
}

function setTheme(theme) {
  const html = document.documentElement;
  const resolvedTheme = theme === '' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  html.dataset.theme = resolvedTheme;
  state.theme = theme;
  ReadingDB.setSetting('theme', theme).catch(console.error);
}

async function loadInitialTheme() {
  const saved = await ReadingDB.getSetting('theme');
  const theme = saved || '';
  setTheme(theme);
  
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === '') {
      setTheme('');
    }
  });
}

async function handleExport() {
  state.saving = true;
  showToast('백업 파일을 생성 중입니다...', 'info', 0);
  
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
    await ReadingDB.ready();
    console.log('[App] IndexedDB Ready');

    await loadInitialTheme();

    setupGlobalEventDelegation();

    router.start(renderView);
    
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

initApp();

function getStatusLabel(status) {
  const labels = { reading: '읽는 중', completed: '완독', paused: '중단', wish: '위시리스트' };
  return labels[status] || status;
}