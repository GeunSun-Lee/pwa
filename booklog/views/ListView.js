// ==========================================================================
// views/ListView.js - Book List View (Fixed: Initialization Order Bug)
// ==========================================================================

import { state, subscribe } from '../utils/store.js';
import { navigate } from '../utils/router.js';
import { ReadingDB } from '../db.js';
import { formatDate, formatRelativeTime } from '../utils/date.js';
import { showToast, showConfirm } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Constants & Templates
// -------------------------------------------------------------------------
const ITEMS_PER_PAGE = 20;
const SKELETON_COUNT = 6;

const STATUS_LABELS = {
  all: '전체', reading: '읽는 중', completed: '완독', paused: '중단', wish: '위시리스트'
};

const SORT_OPTIONS = [
  { value: 'completedAt', label: '완독일 순' },
  { value: 'createdAt', label: '등록일 순' },
  { value: 'title', label: '제목 순' },
  { value: 'author', label: '저자 순' },
  { value: 'rating', label: '평점 순' }
];

// -------------------------------------------------------------------------
// 2. Module State (Internal)
// -------------------------------------------------------------------------
let _cleanupFns = [];
let _dom = {};
let _observer = null;
let _lastQueryId = 0;
let _isLoadingMore = false;

// -------------------------------------------------------------------------
// 3. DOM Caching (Must be called FIRST in init)
// -------------------------------------------------------------------------
function cacheDomElements() {
  _dom = {
    container: document.getElementById('app'),
    grid: null,
    sentinel: null,
    filterBar: null,
    searchInput: null,
    statusTabs: null,
    sortSelect: null,
    viewBtns: null,
    tagFilter: null,
    emptyState: null
  };
}

// -------------------------------------------------------------------------
// 4. Render Functions
// -------------------------------------------------------------------------

function renderLayout() {
  // _dom.container는 cacheDomElements에서 이미 할당됨
  if (!_dom.container) return; // 안전 가드

  const { filter, viewMode } = state;
  const tags = getUniqueTags(state.books);

  _dom.container.innerHTML = `
    <header class="page-header">
      <div>
        <h1 class="page-title">내 서재</h1>
        <p class="page-subtitle">총 <strong>${state.pagination.total}</strong>권 • ${filter.status !== 'all' ? STATUS_LABELS[filter.status] : '모든 상태'}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" data-action="navigate" data-href="/add">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:0.25rem;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          도서 추가
        </button>
      </div>
    </header>

    <div class="filter-bar" role="search" aria-label="도서 필터 및 정렬">
      <div class="filter-bar__group" style="flex: 0 0 auto;">
        <span class="filter-bar__label">상태</span>
        <div class="filter-bar__btn-group" role="tablist" aria-label="읽기 상태 필터">
          ${Object.entries(STATUS_LABELS).map(([key, label]) => `
            <button class="filter-bar__btn ${filter.status === key ? '[aria-pressed="true"]' : ''}" 
                    role="tab" 
                    aria-selected="${filter.status === key}" 
                    data-action="set-filter" 
                    data-key="status" 
                    data-value="${key}">
              ${label}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="filter-bar__group" style="flex: 0 0 auto;">
        <span class="filter-bar__label">정렬</span>
        <select class="filter-bar__select" data-action="set-filter" data-key="sort" aria-label="정렬 기준">
          ${SORT_OPTIONS.map(opt => `<option value="${opt.value}" ${filter.sort === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
        </select>
        <button class="filter-bar__btn ${filter.order === 'desc' ? '[aria-pressed="true"]' : ''}" 
                role="button" 
                aria-pressed="${filter.order === 'desc'}" 
                data-action="set-filter" 
                data-key="order" 
                data-value="${filter.order === 'desc' ? 'asc' : 'desc'}"
                aria-label="정렬 방향: ${filter.order === 'desc' ? '내림차순' : '오름차순'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;">
            ${filter.order === 'desc' 
              ? '<polyline points="3 18 12 9 21 18"></polyline>' 
              : '<polyline points="3 6 12 15 21 6"></polyline>'}
          </svg>
        </button>
      </div>

      <div class="filter-bar__group" style="flex: 1; min-width: 150px; max-width: 200px;">
        <span class="filter-bar__label">태그</span>
        <select class="filter-bar__select" data-action="set-filter" data-key="tag" aria-label="태그 필터">
          <option value="">전체 태그</option>
          ${tags.map(tag => `<option value="${tag}" ${filter.tag === tag ? 'selected' : ''}>${tag}</option>`).join('')}
        </select>
      </div>

      <div class="filter-bar__group" style="flex: 0 0 auto;">
        <div class="filter-bar__btn-group" role="group" aria-label="뷰 모드">
          <button class="filter-bar__btn ${viewMode === 'grid' ? '[aria-pressed="true"]' : ''}" 
                  role="button" aria-pressed="${viewMode === 'grid'}" 
                  data-action="set-view-mode" data-value="grid" aria-label="그리드 뷰">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>
          </button>
          <button class="filter-bar__btn ${viewMode === 'list' ? '[aria-pressed="true"]' : ''}" 
                  role="button" aria-pressed="${viewMode === 'list'}" 
                  data-action="set-view-mode" data-value="list" aria-label="리스트 뷰">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
        </div>
      </div>
    </div>

    <div class="books-container" role="list" aria-label="도서 목록">
      <div class="books-grid ${state.viewMode === 'list' ? 'view-list' : ''}" id="books-grid" role="feed"></div>
      <div id="scroll-sentinel" class="scroll-sentinel" aria-hidden="true">
        <div class="skeleton skeleton-card" style="height: 100px; border: none; background: none; box-shadow: none;">
          <div class="skeleton-card__body" style="display:flex; justify-content:center; align-items:center; height:100%;">
            <div class="loading__spinner" style="width:24px; height:24px; border-width:2px;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="empty-state" id="empty-state" style="display: none; max-width: 500px; margin: 4rem auto;">
      <div class="empty-state__icon">📚</div>
      <h3 class="empty-state__title">등록된 도서가 없습니다</h3>
      <p class="empty-state__desc">첫 번째 독서록을 남겨보세요. ISBN 검색으로 쉽게 등록할 수 있습니다.</p>
      <button class="btn btn-primary mt-4" data-action="navigate" data-href="/add">도서 추가하기</button>
    </div>
  `;

  // 렌더링 후 자식 요소 캐시 업데이트
  _dom.grid = document.getElementById('books-grid');
  _dom.sentinel = document.getElementById('scroll-sentinel');
  _dom.emptyState = document.getElementById('empty-state');
  _dom.filterBar = _dom.container.querySelector('.filter-bar'); // 필터바 이벤트용
}

// -------------------------------------------------------------------------
// 5. Book Card Rendering
// -------------------------------------------------------------------------

function createBookCardHTML(book, viewMode) {
  const coverUrl = book.externalCoverUrl 
    ? book.externalCoverUrl 
    : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><rect fill='%23e9ecef' width='100' height='150'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23adb5bd'>표지없음</text></svg>`;
  
  const progress = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
  const statusClass = `book-card__status--${book.status}`;
  const statusLabel = STATUS_LABELS[book.status] || book.status;

  return `
    <article class="book-card" role="listitem" data-book-id="${book.id}" style="--progress: ${progress}%;">
      <div class="book-card__cover-wrapper">
        <img class="book-card__cover" 
             src="${coverUrl}" 
             alt="${escapeHtml(book.title)} 표지" 
             loading="lazy"
             onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 150\"><rect fill=\"%23e9ecef\" width=\"100\" height=\"150\"/></svg>'">
        <span class="book-card__status ${statusClass}">${STATUS_LABELS[book.status] || book.status}</span>
        ${book.status === 'reading' && progress > 0 ? `<div class="book-card__progress" style="width: ${progress}%"></div>` : ''}
      </div>
      <div class="book-card__body">
        <h3 class="book-card__title">${escapeHtml(book.title)}</h3>
        <p class="book-card__author">${escapeHtml(book.author)}</p>
        <div class="book-card__meta">
          <span class="book-card__rating" aria-label="평점 ${book.rating}/5">${'★'.repeat(Math.round(book.rating))}${'☆'.repeat(5 - Math.round(book.rating))}</span>
          <span class="book-card__pages">${book.currentPage > 0 ? `${book.currentPage}/${book.totalPages}p` : `${book.totalPages}p`}</span>
          ${book.status === 'completed' && book.completedAt ? `<span>완독: ${formatDate(book.completedAt, 'MM/DD')}</span>` : ''}
        </div>
        <div class="book-card__tags" aria-label="태그">
          ${book.tags.slice(0, 4).map(tag => `<span class="tag book-card__tag">${escapeHtml(tag)}</span>`).join('')}
          ${book.tags.length > 4 ? `<span class="tag book-card__tag">+${book.tags.length - 4}</span>` : ''}
        </div>
      </div>
      <div class="book-card__actions" style="display:flex; gap:0.25rem; padding:0.75rem; border-top:1px solid var(--color-border); flex-wrap:wrap;">
        <button class="btn btn-sm btn-ghost" data-action="open-detail" data-id="${book.id}" aria-label="${escapeHtml(book.title)} 상세 보기">상세</button>
        <button class="btn btn-sm btn-ghost" data-action="open-edit" data-id="${book.id}" aria-label="${escapeHtml(book.title)} 수정">수정</button>
        <button class="btn btn-sm btn-ghost" data-action="toggle-status" data-id="${book.id}" data-value="${getNextStatus(book.status)}" aria-label="상태 변경: ${getNextStatusLabel(book.status)}">${getNextStatusLabel(book.status)}</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-action="delete-book" data-id="${book.id}" aria-label="${escapeHtml(book.title)} 삭제">삭제</button>
      </div>
    </article>
  `;
}

function renderBooks(books, append = false) {
  if (!_dom.grid) return;
  
  const html = books.map(book => createBookCardHTML(book, state.viewMode)).join('');
  
  if (append) {
    _dom.grid.insertAdjacentHTML('beforeend', html);
  } else {
    _dom.grid.innerHTML = html;
  }

  const hasBooks = (state.pagination.total || 0) > 0;
  _dom.grid.style.display = hasBooks ? '' : 'none';
  if (_dom.emptyState) _dom.emptyState.style.display = hasBooks ? 'none' : 'block';
  
  const hasMore = (state.pagination.offset + state.pagination.limit) < state.pagination.total;
  _dom.sentinel.style.display = hasMore ? 'block' : 'none';
}

function renderSkeletons(count = 6) {
  if (!_dom.grid) return;
  const skeleton = `
    <div class="skeleton skeleton-card" role="listitem" aria-busy="true">
      <div class="skeleton-card__cover"></div>
      <div class="skeleton-card__body">
        <div class="skeleton-card__line"></div>
        <div class="skeleton-card__line short"></div>
        <div class="skeleton-card__line medium"></div>
      </div>
    </div>
  `;
  _dom.grid.innerHTML = skeleton.repeat(count);
  _dom.sentinel.style.display = 'none';
  if (_dom.emptyState) _dom.emptyState.style.display = 'none';
}

// -------------------------------------------------------------------------
// 6. Data Loading Logic
// -------------------------------------------------------------------------

function buildQueryOptions() {
  const { filter, pagination } = state;
  let indexName = 'by_createdAt';
  let range = null;

  if (filter.status !== 'all') {
    indexName = 'by_status';
    range = IDBKeyRange.only(filter.status);
  } else if (filter.tag) {
    indexName = 'by_tag';
    range = IDBKeyRange.only(filter.tag);
  }

  const direction = filter.order === 'desc' ? 'prev' : 'next';
  if (filter.status === 'all' && !filter.tag) {
    indexName = `by_${filter.sort}`;
  }

  return {
    index: indexName,
    range,
    direction,
    limit: pagination.limit,
    offset: pagination.offset
  };
}

async function loadBooks(append = false) {
  if (_isLoadingMore) return;
  _isLoadingMore = true;
  
  const queryId = ++_lastQueryId;
  
  if (!append) {
    state.loading = true;
    renderSkeletons();
  } else {
    if (_dom.sentinel) _dom.sentinel.querySelector('.skeleton-card')?.classList.add('show');
  }

  try {
    const options = buildQueryOptions();
    let books = await ReadingDB.queryBooks(options);
    
    if (queryId !== _lastQueryId) return;

    if (state.filter.q) {
      const q = state.filter.q.toLowerCase();
      books = books.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.author.toLowerCase().includes(q) ||
        b.tags.some(t => t.toLowerCase().includes(q)) ||
        (b.review && b.review.toLowerCase().includes(q))
      );
    }

    const total = await ReadingDB.countBooks({ 
      index: options.index, 
      range: options.range 
    });
    
    if (queryId !== _lastQueryId) return;

    state.pagination.total = total;
    
    if (append) {
      state.books = [...state.books, ...books];
      state.pagination.offset += books.length;
    } else {
      state.books = books;
      state.pagination.offset = books.length;
    }

  } catch (err) {
    console.error('[ListView] Load books failed:', err);
    showToast('도서 목록을 불러오는데 실패했습니다.', 'error');
    if (!append) renderEmptyError();
  } finally {
    _isLoadingMore = false;
    state.loading = false;
    if (_dom.sentinel) _dom.sentinel.querySelector('.skeleton-card')?.classList.remove('show');
  }
}

function renderEmptyError() {
  if (!_dom.grid) return;
  _dom.grid.innerHTML = '';
  if (_dom.sentinel) _dom.sentinel.style.display = 'none';
  if (_dom.emptyState) {
    _dom.emptyState.querySelector('.empty-state__title').textContent = '오류 발생';
    _dom.emptyState.querySelector('.empty-state__desc').textContent = '데이터를 불러올 수 없습니다. 새로고침을 시도해주세요.';
    _dom.emptyState.style.display = 'block';
  }
}

// -------------------------------------------------------------------------
// 7. Event Handlers
// -------------------------------------------------------------------------

function handleFilterChange(key, value) {
  state.filter[key] = value;
  state.pagination.offset = 0;
  state.books = [];
  loadBooks(false);
}

function handleViewModeChange(mode) {
  state.viewMode = mode;
  if (_dom.grid) {
    _dom.grid.classList.toggle('view-list', mode === 'list');
  }
}

function handleSearchDebounced(e) {
  const value = e.target.value.trim();
  clearTimeout(_dom._searchTimer);
  _dom._searchTimer = setTimeout(() => {
    state.filter.q = value;
    state.pagination.offset = 0;
    state.books = [];
    loadBooks(false);
  }, 300);
}

function setupInfiniteScroll() {
  if (_observer) _observer.disconnect();
  
  _observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !_isLoadingMore && !state.loading) {
      const hasMore = (state.pagination.offset) < state.pagination.total;
      if (hasMore) loadBooks(true);
    }
  }, { 
    rootMargin: '200px',
    threshold: 0.1 
  });

  if (_dom.sentinel) _observer.observe(_dom.sentinel);
}

function bindViewEvents() {
  // 필터바 이벤트 위임
  if (_dom.filterBar) {
    _dom.filterBar.addEventListener('click', onFilterBarClick);
    _dom.filterBar.addEventListener('change', onFilterBarChange);
    _cleanupFns.push(() => {
      _dom.filterBar.removeEventListener('click', onFilterBarClick);
      _dom.filterBar.removeEventListener('change', onFilterBarChange);
    });
  }
  
  // 헤더 검색 입력
  const searchInput = document.querySelector('.app-header__search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchDebounced);
    _cleanupFns.push(() => searchInput.removeEventListener('input', handleSearchDebounced));
  }
}

function onFilterBarClick(e) {
  const btn = e.target.closest('[data-action="set-filter"], [data-action="set-view-mode"]');
  if (!btn) return;
  
  if (btn.dataset.action === 'set-filter') {
    handleFilterChange(btn.dataset.key, btn.dataset.value);
  } else if (btn.dataset.action === 'set-view-mode') {
    handleViewModeChange(btn.dataset.value);
  }
}

function onFilterBarChange(e) {
  const select = e.target.closest('select[data-action="set-filter"]');
  if (select) {
    handleFilterChange(select.dataset.key, select.value);
  }
}

// -------------------------------------------------------------------------
// 8. State Subscriptions
// -------------------------------------------------------------------------

function setupSubscriptions() {
  _cleanupFns.push(subscribe('filter', () => {
    syncFilterUI();
  }));

  _cleanupFns.push(subscribe('viewMode', (mode) => {
    if (_dom.grid) _dom.grid.classList.toggle('view-list', mode === 'list');
  }));

  _cleanupFns.push(subscribe('loading', (loading) => {
    // 로딩 상태 UI 동기화 필요 시 처리
  }));
}

function syncFilterUI() {
  if (!_dom.filterBar) return;
  const { filter } = state;
  
  _dom.filterBar.querySelectorAll('[data-action="set-filter"][data-key="status"]').forEach(btn => {
    btn.toggleAttribute('aria-pressed', btn.dataset.value === filter.status);
  });
  
  const sortSel = _dom.filterBar.querySelector('[data-action="set-filter"][data-key="sort"]');
  if (sortSel) sortSel.value = filter.sort;
  
  const orderBtn = _dom.filterBar.querySelector('[data-action="set-filter"][data-key="order"]');
  if (orderBtn) {
    orderBtn.setAttribute('aria-pressed', filter.order === 'desc');
    orderBtn.innerHTML = filter.order === 'desc' 
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 18 12 9 21 18"></polyline></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 12 15 21 6"></polyline></svg>';
  }
  
  const tagSel = _dom.filterBar.querySelector('[data-action="set-filter"][data-key="tag"]');
  if (tagSel) tagSel.value = filter.tag;
}

// -------------------------------------------------------------------------
// 8. Helpers
// -------------------------------------------------------------------------

function getUniqueTags(books) {
  const set = new Set();
  books.forEach(b => b.tags?.forEach(t => set.add(t)));
  return Array.from(set).sort();
}

function getNextStatus(current) {
  const order = ['wish', 'reading', 'paused', 'completed'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

function getNextStatusLabel(current) {
  const next = getNextStatus(current);
  return STATUS_LABELS[next] || next;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// -------------------------------------------------------------------------
// 9. Public Init Function (Fixed Order)
// -------------------------------------------------------------------------

/**
 * 리스트 뷰 초기화
 * @param {Object} ctx - 앱 컨텍스트
 * @returns {Function} cleanup 함수
 */
export async function init({ params, state, navigate, db, showToast, showConfirm }) {
  console.log('[ListView] Initializing...');
  
  // 1. DOM 캐싱 최우선 실행 (renderLayout에서 _dom.container 사용하므로)
  cacheDomElements();
  
  // 2. 레이아웃 렌더링
  renderLayout();
  
  // 3. 이벤트 바인딩
  bindViewEvents();
  setupInfiniteScroll();
  setupSubscriptions();
  
  // 3. 초기 데이터 로드
  await loadBooks(false);
  
  // 4. 클린업 함수 반환
  return () => {
    console.log('[ListView] Cleaning up...');
    _observer?.disconnect();
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
    clearTimeout(_dom._searchTimer);
  };
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__LIST_VIEW__ = { init, loadBooks };
}