// ==========================================================================
// views/DetailView.js - Book Detail View (Review, Progress, Memos, Actions)
// ==========================================================================

import { state, subscribe } from '../utils/store.js';
import { navigate } from '../utils/router.js';
import { ReadingDB } from '../db.js';
import { formatDate, formatRelativeTime } from '../utils/date.js';
import { showToast, showConfirm, openModal, closeModal } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Constants & Status Config
// -------------------------------------------------------------------------
const STATUS_LABELS = {
  wish: '위시리스트',
  reading: '읽는 중',
  paused: '중단',
  completed: '완독'
};

const STATUS_ORDER = ['wish', 'reading', 'paused', 'completed'];
const STATUS_COLORS = {
  wish: 'var(--color-text-muted)',
  reading: 'var(--color-info)',
  paused: 'var(--color-warning)',
  completed: 'var(--color-success)'
};

// -------------------------------------------------------------------------
// 2. Module State (Internal)
// -------------------------------------------------------------------------
let _cleanupFns = [];
let _dom = {};
let _currentBookId = null;
let _coverObjectUrl = null; // 표지 Blob URL 참조 (청소용)
let _memos = []; // 메모 캐시

// -------------------------------------------------------------------------
// 3. Render Functions
// -------------------------------------------------------------------------

function renderLayout(book) {
  const isCompleted = book.status === 'completed';
  const progress = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
  const coverSrc = _coverObjectUrl || book.externalCoverUrl || `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><rect fill='%23e9ecef' width='100' height='150'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23adb5bd'>표지없음</text></svg>`;

  _dom.container.innerHTML = `
    <header class="page-header" style="margin-bottom: 1rem;">
      <div>
        <h1 class="page-title" style="font-size: 1.25rem;">상세 보기</h1>
        <p class="page-subtitle">${escapeHtml(book.title)} · ${escapeHtml(book.author)}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" data-action="go-back" aria-label="목록으로 돌아가기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
      </div>
    </header>

    <div class="detail-view">
      <!-- Header: Cover + Meta -->
      <div class="detail-header">
        <img class="detail-cover" src="${coverSrc}" alt="${escapeHtml(book.title)} 표지" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 150\"><rect fill=\"%23e9ecef\" width=\"100\" height=\"150\"/></svg>'">
        
        <div class="detail-header__info">
          <div>
            <h2 class="detail-title">${escapeHtml(book.title)}</h2>
            <p class="detail-author">${escapeHtml(book.author) || '저자 미상'}</p>
            
            <div class="detail-meta">
              ${book.publisher ? `<span class="detail-meta__item">📖 ${escapeHtml(book.publisher)}</span>` : ''}
              ${book.publishDate ? `<span class="detail-meta__item">📅 ${formatDate(book.publishDate, 'YYYY년 M월')}</span>` : ''}
              ${book.isbn ? `<span class="detail-meta__item">🔢 ISBN ${formatIsbn(book.isbn)}</span>` : ''}
              ${book.totalPages ? `<span class="detail-meta__item">📄 ${book.totalPages.toLocaleString()}쪽</span>` : ''}
              ${book.startedAt ? `<span class="detail-meta__item">▶️ 시작 ${formatDate(book.startedAt, 'MM/DD')}</span>` : ''}
              ${book.completedAt ? `<span class="detail-meta__item" style="color: var(--color-success);">✅ 완독 ${formatDate(book.completedAt, 'MM/DD')}</span>` : ''}
            </div>
            
            <div class="detail-tags" aria-label="태그">
              ${(book.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="text-muted" style="font-size:0.75rem;">태그 없음</span>'}
            </div>
          </div>

          <div class="detail-actions">
            <!-- Progress Bar (Reading) -->
            ${book.status === 'reading' && book.totalPages > 0 ? `
              <div class="detail-progress" style="margin-bottom: 1rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem; font-size:0.8125rem;">
                  <span>진도율</span>
                  <span id="progress-text"><strong>${book.currentPage}</strong> / ${book.totalPages}쪽 (${progress}%)</span>
                </div>
                <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="독서 진도율">
                  <div class="progress-bar__fill" id="progress-fill" style="width: ${progress}%"></div>
                </div>
                <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                  <input type="number" id="page-input" class="form-input" value="${book.currentPage}" min="0" max="${book.totalPages}" step="1" style="width: 80px;" aria-label="현재 페이지">
                  <button class="btn btn-sm btn-primary" id="btn-update-page" data-id="${book.id}">적용</button>
                </div>
              </div>
            ` : ''}

            <!-- Status Actions -->
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
              ${STATUS_ORDER.map(s => `
                <button class="btn btn-sm ${book.status === s ? 'btn-primary' : 'btn-secondary'}" 
                        data-action="toggle-status" 
                        data-id="${book.id}" 
                        data-value="${s}"
                        style="background-color: ${book.status === s ? STATUS_COLORS[s] : 'var(--color-bg-tertiary)'}; border-color: ${book.status === s ? STATUS_COLORS[s] : 'var(--color-border)'}; color: ${book.status === s ? 'white' : 'inherit'};">
                  ${STATUS_LABELS[s]}
                </button>
              `).join('')}
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.5rem; width:100%;">
              <button class="btn btn-secondary" data-action="open-edit" data-id="${book.id}" style="flex:1;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:0.25rem;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                수정
              </button>
              <button class="btn btn-sm btn-danger" data-action="delete-book" data-id="${book.id}" style="flex:1;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:0.25rem;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                삭제
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Content: Review + Memos -->
      <div class="detail-content">
        <!-- Review Panel -->
        <section class="detail-panel" aria-labelledby="review-heading">
          <header class="detail-panel__title">
            <h3 id="review-heading">한줄 평 / 서평</h3>
            ${book.rating > 0 ? `<span class="book-card__rating" aria-label="평점 ${book.rating}/5">${renderStars(book.rating)}</span>` : ''}
          </header>
          <div class="detail-panel__content detail-review" id="review-content">
            ${book.review ? `<div class="markdown-body">${book.review}</div>` : '<p class="text-muted" style="text-align:center; padding:2rem;">작성된 리뷰가 없습니다.</p>'}
          </div>
        </section>

        <!-- Memos Panel -->
        <aside class="detail-panel" style="max-height: 70vh; overflow-y:auto;" aria-labelledby="memos-heading">
          <header class="detail-panel__title" style="display:flex; align-items:center; justify-content:space-between;">
            <h3 id="memos-heading">독서 메모 <span class="text-muted" style="font-weight:400; font-size:0.8rem;">(${_memos.length})</span></h3>
            <button class="btn btn-sm btn-primary" id="btn-add-memo" data-book-id="${book.id}" aria-label="메모 추가">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </header>
          <div class="detail-memo-list" id="memo-list" role="list" aria-label="독서 메모 목록">
            ${_memos.length === 0 
              ? '<p class="text-muted" style="text-align:center; padding:2rem; font-size:0.875rem;">기록된 메모가 없습니다.<br><small>인상 깊은 구절, 생각을 남겨보세요.</small></p>'
              : _memos.map(memo => renderMemoItem(memo)).join('')
            }
          </div>
        </aside>
      </div>
    </div>
  `;

  cacheDomElements(book);
  bindEvents(book);
  renderMarkdownReview(book.review || '');
}

function cacheDomElements(book) {
  _dom = {
    container: document.getElementById('app'),
    reviewContent: document.getElementById('review-content'),
    memoList: document.getElementById('memo-list'),
    memoCount: document.querySelector('#memos-heading .text-muted'),
    pageInput: document.getElementById('page-input'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    btnUpdatePage: document.getElementById('btn-update-page'),
    btnAddMemo: document.getElementById('btn-add-memo')
  };
}

function renderMemoItem(memo) {
  return `
    <article class="detail-memo" role="listitem" data-memo-id="${memo.id}">
      ${memo.page ? `<div class="detail-memo__page">p.${memo.page}</div>` : ''}
      <div class="detail-memo__text">${escapeHtml(memo.text)}</div>
      <div class="detail-memo__date">
        ${formatRelativeTime(memo.createdAt)}
        <button type="button" class="btn btn-ghost btn-xs" data-action="delete-memo" data-id="${memo.id}" style="margin-left:0.5rem; padding:0.125rem; line-height:1;" aria-label="메모 삭제">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </article>
  `;
}

function renderStars(val) {
  const v = parseFloat(val) || 0;
  const full = Math.floor(v);
  const half = v % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function formatIsbn(isbn) {
  if (!isbn) return '';
  const clean = isbn.replace(/[-\s]/g, '');
  if (clean.length === 13) return `${clean.slice(0,3)}-${clean.slice(3,4)}-${clean.slice(4,9)}-${clean.slice(9,12)}-${clean.slice(12)}`;
  return isbn;
}

// -------------------------------------------------------------------------
// 4. Markdown Rendering
// -------------------------------------------------------------------------

async function renderMarkdownReview(text) {
  if (!_dom.reviewContent) return;
  if (!text) {
    _dom.reviewContent.innerHTML = '<p class="text-muted" style="text-align:center; padding:2rem;">작성된 리뷰가 없습니다.</p>';
    return;
  }
  try {
    const { marked } = await import('marked');
    _dom.reviewContent.innerHTML = `<div class="markdown-body">${marked.parse(text, { async: false, breaks: true, gfm: true, sanitize: true })}</div>`;
  } catch (e) {
    console.error('[DetailView] Markdown render failed:', e);
    _dom.reviewContent.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
  }
}

// -------------------------------------------------------------------------
// 5. Event Handlers
// -------------------------------------------------------------------------

function bindEvents(book) {
  // 페이지 수 업데이트
  _dom.btnUpdatePage?.addEventListener('click', handleUpdatePage);
  _dom.pageInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUpdatePage(); });

  // 메모 추가
  _dom.btnAddMemo?.addEventListener('click', () => openMemoModal(book.id));

  // 메모 삭제 (위임)
  _dom.memoList?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete-memo"]');
    if (btn) handleDeleteMemo(btn.dataset.id);
  });

  // 전역 액션(상태변경, 수정, 삭제)은 app.js의 위임에서 처리되지만,
  // 여기서는 페이지 업데이트 등 뷰 전용 로직만 바인딩.
  // 단, 상태 변경 후 UI 즉시 반영을 위해 커스텀 이벤트 리스닝 또는 상태 구독 활용.
  
  // 상태 변경 감지 (Proxy 구독)
  _cleanupFns.push(subscribe('currentBook', (updatedBook) => {
    if (updatedBook && updatedBook.id === book.id) {
      // 진도율 UI 업데이트
      updateProgressUI(updatedBook);
    }
  }));
}

async function handleUpdatePage() {
  const newPage = parseInt(_dom.pageInput?.value, 10);
  const bookId = _dom.btnUpdatePage?.dataset.id;
  if (!bookId || isNaN(newPage)) return;

  const book = await ReadingDB.getBook(bookId);
  if (!book) return;
  if (newPage < 0 || newPage > book.totalPages) {
    showToast(`페이지는 0 ~ ${book.totalPages} 사이여야 합니다.`, 'warning');
    return;
  }

  try {
    book.currentPage = newPage;
    book.updatedAt = new Date().toISOString();
    // 완독 페이지 도달 시 상태 변경 제안
    if (newPage >= book.totalPages && book.status !== 'completed') {
      const confirmComplete = await showConfirm('마지막 페이지까지 읽으셨네요! 완독으로 상태를 변경할까요?', '완독 처리');
      if (confirmComplete) {
        book.status = 'completed';
        book.completedAt = new Date().toISOString().split('T')[0];
      }
    }
    await ReadingDB.putBook(book);
    showToast('진도율이 업데이트되었습니다.', 'success');
    // 상태 변경 시 앱 레벨에서 리렌더링 되거나, 여기선 로컬 UI만 갱신
    updateProgressUI(book);
  } catch (err) {
    showToast('업데이트 실패: ' + err.message, 'error');
  }
}

function updateProgressUI(book) {
  const progress = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
  if (_dom.progressFill) _dom.progressFill.style.width = `${progress}%`;
  if (_dom.progressText) _dom.progressText.innerHTML = `<strong>${book.currentPage}</strong> / ${book.totalPages}쪽 (${progress}%)`;
  if (_dom.pageInput) _dom.pageInput.value = book.currentPage;
}

async function handleDeleteMemo(memoId) {
  if (!await showConfirm('이 메모를 삭제하시겠습니까?', '복구할 수 없습니다.')) return;
  
  try {
    await ReadingDB.deleteMemo(parseInt(memoId, 10));
    showToast('메모가 삭제되었습니다.', 'success');
    // 로컬 캐시 및 UI 업데이트
    _memos = _memos.filter(m => m.id !== parseInt(memoId, 10));
    renderMemosList();
  } catch (err) {
    showToast('삭제 실패: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------------------
// 6. Memo Modal Management
// -------------------------------------------------------------------------

function openMemoModal(bookId) {
  let pageInput, textInput;
  
  openModal({
    title: '독서 메모 추가',
    content: `
      <div style="display:flex; flex-direction:column; gap:1rem;">
        <div class="form-group">
          <label for="memo-page" class="form-label">페이지 (선택)</label>
          <input type="number" id="memo-page" class="form-input" placeholder="예: 42" min="0" step="1">
        </div>
        <div class="form-group">
          <label for="memo-text" class="form-label">내용 <span class="text-danger">*</span></label>
          <textarea id="memo-text" class="form-textarea" placeholder="인상 깊은 구절, 생각, 메모 등을 적어보세요." rows="5" required></textarea>
        </div>
      </div>
    `,
    footer: {
      secondary: { text: '취소', handler: () => false },
      primary: { text: '저장', variant: 'primary', handler: async (closeFn) => {
        const page = pageInput?.value ? parseInt(pageInput.value, 10) : null;
        const text = textInput?.value?.trim();
        if (!text) { showToast('내용을 입력해주세요.', 'warning'); return false; }
        
        try {
          await ReadingDB.addMemo({ bookId, page, text });
          showToast('메모가 저장되었습니다.', 'success');
          closeFn(true); // 모달 닫기
          // 리스트 즉시 갱신
          loadMemos(bookId);
        } catch (err) {
          showToast('저장 실패: ' + err.message, 'error');
        }
        return false; // 핸들러에서 직접 닫음 처리
      }}
    },
    size: 'md',
    onOpen: (modalEl) => {
      pageInput = modalEl.querySelector('#memo-page');
      textInput = modalEl.querySelector('#memo-text');
      textInput?.focus();
    }
  });
}

async function loadMemos(bookId) {
  try {
    _memos = await ReadingDB.getMemosByBook(bookId, 100); // 최신 100개
    renderMemosList();
  } catch (err) {
    console.error('[DetailView] Load memos failed:', err);
  }
}

function renderMemosList() {
  if (!_dom.memoList) return;
  if (_memos.length === 0) {
    _dom.memoList.innerHTML = '<p class="text-muted" style="text-align:center; padding:2rem; font-size:0.875rem;">기록된 메모가 없습니다.<br><small>인상 깊은 구절, 생각을 남겨보세요.</small></p>';
  } else {
    _dom.memoList.innerHTML = _memos.map(renderMemoItem).join('');
  }
  if (_dom.memoCount) _dom.memoCount.textContent = `(${_memos.length})`;
}

// -------------------------------------------------------------------------
// 6. Data Loading
// -------------------------------------------------------------------------

async function loadBookDetail(id) {
  state.loading = true;
  _currentBookId = id;

  try {
    // 병렬 로딩: 책 기본정보, 표지 Blob URL, 메모 리스트
    const [book, coverUrl, memos] = await Promise.all([
      ReadingDB.getBook(id),
      ReadingDB.getCoverUrl(id),
      ReadingDB.getMemosByBook(id, 50)
    ]);

    if (!book) throw new Error('도서를 찾을 수 없습니다.');

    _coverObjectUrl = coverUrl; // 청소를 위해 참조 보관
    _memos = memos || [];

    renderLayout(book);
    
  } catch (err) {
    console.error('[DetailView] Load failed:', err);
    showToast('도서 정보를 불러오는데 실패했습니다.', 'error');
    navigate('/');
  } finally {
    state.loading = false;
  }
}

// -------------------------------------------------------------------------
// 7. Public Init Function
// -------------------------------------------------------------------------

/**
 * 상세 뷰 초기화
 * @param {Object} ctx
 * @returns {Function} cleanup
 */
export async function init({ params, state, navigate, db, showToast, showConfirm }) {
  console.log('[DetailView] Initializing...', params);
  
  if (!params.id) {
    showToast('잘못된 접근입니다.', 'error');
    navigate('/');
    return () => {};
  }

  await loadBookDetail(params.id);

  // 클린업 함수
  return () => {
    console.log('[DetailView] Cleaning up...');
    if (_coverObjectUrl) {
      URL.revokeObjectURL(_coverObjectUrl);
      _coverObjectUrl = null;
    }
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
  };
}

// -------------------------------------------------------------------------
// 8. Helpers
// -------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__DETAIL_VIEW__ = { init };
}