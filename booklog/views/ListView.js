// ==========================================================================
// views/ListView.js - Book List View (Grid/List, Infinite Scroll, Filters)
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
const SKELETON_COUNT = 6; // 초기 로딩 스켈레톤 개수

// 상태 라벨 매핑
const STATUS_LABELS = {
  all: '전체',
  reading: '읽는 중',
  completed: '완독',
  paused: '중단',
  wish: '위시리스트'
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
let _cleanupFns = []; // 언마운트 시 정리할 함수들
let _observer = null; // IntersectionObserver 인스턴스
let _lastQueryId = 0; // 요청 경합 방지용 ID
let _isLoadingMore = false;

// -------------------------------------------------------------------------
// 3. DOM References (Lazy Initialization)
// -------------------------------------------------------------------------
let _dom = {};

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

/** 메인 레이아웃 렌더링 (필터바 + 그리드 + 센티넬) */
function renderLayout() {
  const { filter, viewMode } = state;
  const tags = getUniqueTags(state.books); // 현재 로드된 책 기준 태그 (전체 태그는 별도 API 필요 시 확장)

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

    <!-- Filter Bar -->
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

    <!-- Books Grid/List Container -->
    <div class="books-container" role="list" aria-label="도서 목록">
      <div class="books-grid ${viewMode === 'list' ? 'view-list' : ''}" id="books-grid" role="feed">
        <!-- Book Cards injected here -->
      </div>
      <!-- Infinite Scroll Sentinel -->
      <div id="scroll-sentinel" class="scroll-sentinel" aria-hidden="true">
        <div class="skeleton skeleton-card" style="height: 100px; border: none; background: none; box-shadow: none;">
          <div class="skeleton-card__body" style="display:flex; justify-content:center; align-items:center; height:100%;">
            <div class="loading__spinner" style="width:24px; height:24px; border-width:2px;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State (Hidden by default) -->
    <div class="empty-state" id="empty-state" style="display: none; max-width: 500px; margin: 4rem auto;">
      <div class="empty-state__icon">📚</div>
      <h3 class="empty-state__title">등록된 도서가 없습니다</h3>
      <p class="empty-state__desc">첫 번째 독서록을 남겨보세요. ISBN 검색으로 쉽게 등록할 수 있습니다.</p>
      <button class="btn btn-primary mt-4" data-action="navigate" data-href="/add">도서 추가하기</button>
    </div>
  `;

  // DOM 캐시 업데이트
  _dom.grid = document.getElementById('books-grid');
  _dom.sentinel = document.getElementById('scroll-sentinel');
  _dom.emptyState = document.getElementById('empty-state');
}

/** 책 카드 HTML 생성 (Grid/List 공용) */
function createBookCardHTML(book, viewMode) {
  const coverUrl = book.externalCoverUrl 
    ? book.externalCoverUrl 
    : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><rect fill='%23e9ecef' width='100' height='150'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23adb5bd'>표지없음</text></svg>`;
  
  // IndexedDB에 저장된 Blob URL은 비동기로 생성해야 하므로, 여기선 외부 URL 또는 플레이스홀더 사용
  // 상세 뷰에서 Blob URL 로드. 리스트에서는 성능상 외부 URL 또는 CSS 배경색 활용 권장.
  // TODO: 썸네일용 작은 Blob 별도 저장 전략 고려. 여기선 externalCoverUrl 우선 사용.

  const progress = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
  const statusClass = `book-card__status--${book.status}`;
  const statusLabel = STATUS_LABELS[book.status] || book.status;

  return `
    <article class="book-card" role="listitem" data-book-id="${book.id}" style="--progress: ${progress}%;">
      <div class="book-card__cover-wrapper">
        <img class="book-card__cover" 
             src="${coverUrl}" 
             alt="${book.title} 표지" 
             loading="lazy"
             onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 150\"><rect fill=\"%23e9ecef\" width=\"100\" height=\"150\"/></svg>'">
        <span class="book-card__status ${statusClass}">${statusLabel}</span>
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
        <button class="btn btn-sm btn-ghost" data-action="open-detail" data-id="${book.id}" aria-label="${book.title} 상세 보기">상세</button>
        <button class="btn btn-sm btn-ghost" data-action="open-edit" data-id="${book.id}" aria-label="${book.title} 수정">수정</button>
        <button class="btn btn-sm btn-ghost" data-action="toggle-status" data-id="${book.id}" data-value="${getNextStatus(book.status)}" aria-label="상태 변경: ${getNextStatusLabel(book.status)}">${getNextStatusLabel(book.status)}</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-action="delete-book" data-id="${book.id}" aria-label="${book.title} 삭제">삭제</button>
      </div>
    </article>
  `;
}

/** 그리드/리스트 아이템 렌더링 */
function renderBooks(books, append = false) {
  if (!_dom.grid) return;
  
  const html = books.map(book => createBookCardHTML(book, state.viewMode)).join('');
  
  if (append) {
    _dom.grid.insertAdjacentHTML('beforeend', html);
  } else {
    _dom.grid.innerHTML = html;
  }

  // 빈 상태 토글
  const hasBooks = (state.pagination.total || 0) > 0;
  _dom.grid.style.display = hasBooks ? '' : 'none';
  if (_dom.emptyState) _dom.emptyState.style.display = hasBooks ? 'none' : 'block';
  
  // 센티넬 표시/숨김 (더 로드할 게 있으면 보임)
  const hasMore = (state.pagination.offset + state.pagination.limit) < state.pagination.total;
  _dom.sentinel.style.display = hasMore ? 'block' : 'none';
}

/** 스켈레톤 플레이스홀더 렌더링 */
function renderSkeletons(count = SKELETON_COUNT) {
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
// 5. Data Loading Logic
// -------------------------------------------------------------------------

/** IndexedDB 쿼리 옵션 구성 */
function buildQueryOptions() {
  const { filter, pagination } = state;
  let indexName = 'by_createdAt';
  let range = null;

  // 상태 필터링
  if (filter.status !== 'all') {
    indexName = 'by_status';
    range = IDBKeyRange.only(filter.status);
  }
  // 태그 필터링 (multiEntry 인덱스 활용)
  else if (filter.tag) {
    indexName = 'by_tag';
    range = IDBKeyRange.only(filter.tag);
  }
  // 검색어 있는 경우: 클라이언트 사이드 필터링 또는 제목/저자 인덱스 prefix 검색
  // 여기서는 간단히 전체 조회 후 클라이언트 필터링 (데이터 많으면 서버사이드/별도 검색 인덱스 필요)
  // MVP: 제목/저자 인덱스로 prefix 검색 시도
  else if (filter.q) {
    // 검색어는 클라이언트 필터링으로 처리 (queryBooks에서 전체 가져와서 필터링)
    // 성능상 문제가 되면 추후 FlexSearch 등 도입
  }

  // 정렬 방향
  const direction = filter.order === 'desc' ? 'prev' : 'next';
  // 정렬 필드에 맞는 인덱스 선택 (단일 인덱스 정렬만 지원하므로, 상태/태그 필터 없을 때만 정렬 인덱스 사용)
  if (filter.status === 'all' && !filter.tag) {
    indexName = `by_${filter.sort}`; // by_completedAt, by_title 등
  }

  return {
    index: indexName,
    range,
    direction,
    limit: pagination.limit,
    offset: pagination.offset
  };
}

/** 책 데이터 로드 (초기/추가) */
async function loadBooks(append = false) {
  if (_isLoadingMore) return;
  _isLoadingMore = true;
  
  const queryId = ++_lastQueryId; // 최신 요청만 처리하기 위한 ID
  
  if (!append) {
    state.loading = true;
    renderSkeletons();
  } else {
    _dom.sentinel.querySelector('.skeleton-card')?.classList.add('show'); // 로딩 표시
  }

  try {
    const options = buildQueryOptions();
    let books = await ReadingDB.queryBooks(options);
    
    // 요청이 구식이면 무시
    if (queryId !== _lastQueryId) return;

    // 검색어 클라이언트 필터링
    if (state.filter.q) {
      const q = state.filter.q.toLowerCase();
      books = books.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.author.toLowerCase().includes(q) ||
        b.tags.some(t => t.toLowerCase().includes(q)) ||
        (b.review && b.review.toLowerCase().includes(q))
      );
    }

    // 총 개수 조회 (필터링 후 개수 반영을 위해 별도 카운트 또는 추정)
    // 정확한 총 개수를 위해 countBooks 호출 (필터 조건 동일하게)
    // 검색어 있는 경우 정확한 카운트 어려우므로 일단 로드된 개수로 처리하거나 별도 카운트 로직 필요
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
    _dom.sentinel.querySelector('.skeleton-card')?.classList.remove('show');
  }
}

function renderEmptyError() {
  if (!_dom.grid) return;
  _dom.grid.innerHTML = '';
  _dom.sentinel.style.display = 'none';
  if (_dom.emptyState) {
    _dom.emptyState.querySelector('.empty-state__title').textContent = '오류 발생';
    _dom.emptyState.querySelector('.empty-state__desc').textContent = '데이터를 불러올 수 없습니다. 새로고침을 시도해주세요.';
    _dom.emptyState.style.display = 'block';
  }
}

// -------------------------------------------------------------------------
// 6. Event Handlers
// -------------------------------------------------------------------------

function handleFilterChange(key, value) {
  // 상태 초기화
  state.filter[key] = value;
  state.pagination.offset = 0;
  state.books = []; // 즉시 비워서 스켈레톤 유도
  loadBooks(false);
}

function handleViewModeChange(mode) {
  state.viewMode = mode;
  // 뷰 모드 변경 시 클래스만 토글 (리렌더링 불필요)
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

/** 무한 스크롤 센티넬 감시 */
function setupInfiniteScroll() {
  if (_observer) _observer.disconnect();
  
  _observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !_isLoadingMore && !state.loading) {
      const hasMore = (state.pagination.offset) < state.pagination.total;
      if (hasMore) loadBooks(true);
    }
  }, { 
    rootMargin: '200px', // 미리 로드
    threshold: 0.1 
  });

  if (_dom.sentinel) _observer.observe(_dom.sentinel);
}

/** 이벤트 위임 바인딩 (앱 레벨 위임과 중복되지 않게 여기서도 처리 가능하나, 앱 레벨에서 처리 권장)
 * 여기서는 뷰 내부 전용 이벤트(필터 변경, 뷰 토글)만 바인딩하고, 
 * 북 카드 액션(삭제, 상세, 상태변경)은 app.js의 전역 위임(data-action)에서 처리함.
 */
function bindViewEvents() {
  // 필터바 이벤트 (버튼 그룹, 셀렉트)
  _dom.container.addEventListener('click', onFilterBarClick);
  _dom.container.addEventListener('change', onFilterBarChange);
  
  // 헤더 검색 입력 (존재 시)
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
// 7. State Subscriptions (Reactive Updates)
// -------------------------------------------------------------------------

function setupSubscriptions() {
  // 필터/페이지네이션 변경 시 레이아웃/리스트 갱신
  // Proxy는 깊은 변경을 감지하므로 'filter' 경로 구독 시 하위 속성 변경도 감지됨
  _cleanupFns.push(subscribe('filter', () => {
    // 필터 변경 시 loadBooks에서 처리하므로 여기선 UI 동기화만
    syncFilterUI();
  }));

  // 뷰 모드 변경 시 클래스 토글
  _cleanupFns.push(subscribe('viewMode', (mode) => {
    if (_dom.grid) _dom.grid.classList.toggle('view-list', mode === 'list');
  }));

  // 로딩 상태 UI 동기화
  _cleanupFns.push(subscribe('loading', (loading) => {
    // renderSkeletons 또는 버튼 비활성화 등 처리
  }));
}

/** 필터바 UI 강제 동기화 (상태 변경 후) */
function syncFilterUI() {
  if (!_dom.container) return;
  const { filter } = state;
  
  // 상태 탭
  _dom.container.querySelectorAll('[data-action="set-filter"][data-key="status"]').forEach(btn => {
    btn.toggleAttribute('aria-pressed', btn.dataset.value === filter.status);
  });
  // 정렬 셀렉트
  const sortSel = _dom.container.querySelector('[data-action="set-filter"][data-key="sort"]');
  if (sortSel) sortSel.value = filter.sort;
  // 정렬 방향 버튼
  const orderBtn = _dom.container.querySelector('[data-action="set-filter"][data-key="order"]');
  if (orderBtn) {
    orderBtn.setAttribute('aria-pressed', filter.order === 'desc');
    orderBtn.innerHTML = filter.order === 'desc' 
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 18 12 9 21 18"></polyline></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 12 15 21 6"></polyline></svg>';
  }
  // 태그 셀렉트
  const tagSel = _dom.container.querySelector('[data-action="set-filter"][data-key="tag"]');
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
// 9. Public Init Function (Router Entry Point)
// -------------------------------------------------------------------------

/**
 * 리스트 뷰 초기화
 * @param {Object} ctx - 앱 컨텍스트
 * @returns {Function} cleanup 함수
 */
export async function init({ params, state, navigate, db, showToast, showConfirm }) {
  console.log('[ListView] Initializing...');
  
  // 1. 레이아웃 렌더링
  renderLayout();
  cacheDomElements();
  
  // 2. 이벤트 바인딩
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