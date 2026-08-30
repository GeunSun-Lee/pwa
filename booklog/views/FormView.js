// ==========================================================================
// views/FormView.js - Book Form View (Fixed: Initialization Order Bug)
// ==========================================================================

import { state, subscribe } from '../utils/store.js';
import { navigate } from '../utils/router.js';
import { ReadingDB } from '../db.js';
import { formatDate, todayString, parseDateInput } from '../utils/date.js';
import { showToast, showConfirm, closeModal } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Constants & Configuration
// -------------------------------------------------------------------------
const STATUS_OPTIONS = [
  { value: 'wish', label: '위시리스트' },
  { value: 'reading', label: '읽는 중' },
  { value: 'completed', label: '완독' },
  { value: 'paused', label: '중단' }
];

const MAX_TAGS = 10;
const ISBN_API_GOOGLE = 'https://www.googleapis.com/books/v1/volumes?q=isbn:';
const ISBN_API_OPEN_LIBRARY = 'https://openlibrary.org/api/books?bibkeys=ISBN:&format=json&jscmd=data';

// -------------------------------------------------------------------------
// 2. Module State (Internal)
// -------------------------------------------------------------------------
let _cleanupFns = [];
let _dom = {};
let _currentBookId = null;
let _coverFile = null;
let _coverObjectUrl = null;
let _isSubmitting = false;

// -------------------------------------------------------------------------
// 3. ISBN Metadata Fetching
// -------------------------------------------------------------------------

async function fetchBookMetadata(isbn) {
  const cleanIsbn = isbn.replace(/[-\s]/g, '');
  if (cleanIsbn.length !== 13) return null;

  try {
    const res = await fetch(`${ISBN_API_GOOGLE}${cleanIsbn}`);
    if (res.ok) {
      const data = await res.json();
      if (data.totalItems > 0 && data.items[0].volumeInfo) {
        return transformGoogleBookData(data.items[0].volumeInfo);
      }
    }
  } catch (e) { console.warn('[ISBN] Google Books API failed:', e); }

  try {
    const res = await fetch(`${ISBN_API_OPEN_LIBRARY}${cleanIsbn}`);
    if (res.ok) {
      const data = await res.json();
      const key = `ISBN:${cleanIsbn}`;
      if (data[key]) return transformOpenLibraryData(data[key]);
    }
  } catch (e) { console.warn('[ISBN] Open Library API failed:', e); }

  return null;
}

function transformGoogleBookData(vi) {
  return {
    title: vi.title || '',
    author: vi.authors?.join(', ') || '',
    publisher: vi.publisher || '',
    publishDate: vi.publishedDate ? normalizeDate(vi.publishedDate) : '',
    totalPages: vi.pageCount || 0,
    externalCoverUrl: vi.imageLinks?.thumbnail?.replace('http:', 'https:') || '',
    description: vi.description || ''
  };
}

function transformOpenLibraryData(ol) {
  return {
    title: ol.title || '',
    author: ol.authors?.map(a => a.name).join(', ') || '',
    publisher: ol.publishers?.[0] || '',
    publishDate: ol.publish_date ? normalizeDate(ol.publish_date) : '',
    totalPages: ol.number_of_pages || 0,
    externalCoverUrl: ol.cover?.large || ol.cover?.medium || ol.cover?.small || '',
    description: ol.description?.value || ol.description || ''
  };
}

function normalizeDate(str) {
  const parts = str.split('-').map(Number);
  if (parts.length === 1) return `${parts[0]}-01-01`;
  if (parts.length === 2) return `${parts[0]}-${String(parts[1]).padStart(2,'0')}-01`;
  return `${parts[0]}-${String(parts[1]).padStart(2,'0')}-${String(parts[2] || 1).padStart(2,'0')}`;
}

// -------------------------------------------------------------------------
// 4. DOM Caching (Must be called FIRST in init)
// -------------------------------------------------------------------------
function cacheDomElements() {
  _dom = {
    container: document.getElementById('app'),
    form: null,
    isbnInput: null,
    titleInput: null,
    fetchBtn: null,
    coverInput: null,
    coverPreview: null,
    tagWrapper: null,
    tagInput: null,
    tagsHidden: null,
    reviewTextarea: null,
    reviewPreview: null,
    statusSelect: null,
    completedAtInput: null,
    ratingInput: null,
    ratingDisplay: null,
    tabs: null,
    panels: null
  };
}

// -------------------------------------------------------------------------
// 5. Render Functions
// -------------------------------------------------------------------------

function renderForm(book = {}) {
  if (!_dom.container) return; // 안전 가드

  const isEdit = !!_currentBookId;
  const coverPreview = _coverObjectUrl 
    ? _coverObjectUrl 
    : (book.externalCoverUrl || `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><rect fill='%23e9ecef' width='100' height='150'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23adb5bd'>표지없음</text></svg>`);

  _dom.container.innerHTML = `
    <header class="page-header">
      <div>
        <h1 class="page-title">${isEdit ? '도서 수정' : '도서 등록'}</h1>
        <p class="page-subtitle">ISBN 자동 조회로 빠르게 등록하세요.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-action="go-back">취소</button>
        <button class="btn btn-primary" data-action="submit-form" ${_isSubmitting ? 'disabled' : ''}>
          ${_isSubmitting ? '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;margin-right:0.5rem;"></span>저장 중...' : '저장하기'}
        </button>
      </div>
    </header>

    <form id="book-form" class="form-view" novalidate>
      <input type="hidden" name="id" value="${book.id || ''}">
      <input type="hidden" name="createdAt" value="${book.createdAt || ''}">
      <input type="hidden" name="coverFile" value="">

      <fieldset class="form-section">
        <legend class="form-section__title">기본 정보</legend>
        
        <div class="form-row">
          <div class="form-group">
            <label for="isbn" class="form-label">ISBN-13 <span class="text-danger">*</span></label>
            <div style="display:flex; gap:0.5rem;">
              <input type="text" id="isbn" name="isbn" class="form-input" placeholder="97889xxxxxxxxx" value="${escapeHtml(book.isbn || '')}" maxlength="13" pattern="[0-9]{13}" aria-describedby="isbn-help" required>
              <button type="button" class="btn btn-secondary" id="btn-fetch-isbn" style="height: 42px; flex-shrink:0;" aria-label="ISBN으로 정보 자동 조회">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </button>
            </div>
            <small id="isbn-help" class="text-muted">13자리 숫자만 입력하세요. 하이픈은 자동 제거됩니다.</small>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="title" class="form-label">제목 <span class="text-danger">*</span></label>
            <input type="text" id="title" name="title" class="form-input" placeholder="도서 제목" value="${escapeHtml(book.title || '')}" required aria-describedby="title-error">
            <small id="title-error" class="text-danger" style="display:none;">제목은 필수 입력 항목입니다.</small>
          </div>
          <div class="form-group">
            <label for="author" class="form-label">저자</label>
            <input type="text" id="author" name="author" class="form-input" placeholder="저자명" value="${escapeHtml(book.author || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="publisher" class="form-label">출판사</label>
            <input type="text" id="publisher" name="publisher" class="form-input" placeholder="출판사명" value="${escapeHtml(book.publisher || '')}">
          </div>
          <div class="form-group">
            <label for="publishDate" class="form-label">출판일</label>
            <input type="date" id="publishDate" name="publishDate" class="form-input" value="${book.publishDate || ''}" max="${todayString()}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="totalPages" class="form-label">총 페이지 수</label>
            <input type="number" id="totalPages" name="totalPages" class="form-input" placeholder="예: 352" value="${book.totalPages || ''}" min="0" step="1">
          </div>
          <div class="form-group">
            <label for="currentPage" class="form-label">현재 페이지</label>
            <input type="number" id="currentPage" name="currentPage" class="form-input" placeholder="읽은 페이지" value="${book.currentPage || 0}" min="0" step="1">
          </div>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend class="form-section__title">표지 이미지</legend>
        <div class="cover-upload">
          <div class="cover-upload__preview" id="cover-preview" style="background-image: url('${coverPreview}'); background-size: cover; background-position: center;">
            ${_coverFile ? `<button type="button" class="cover-upload__remove" aria-label="이미지 삭제" title="삭제"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
          </div>
          <label class="btn btn-secondary cover-upload__label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:0.5rem;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${_coverFile ? '이미지 변경' : '이미지 선택'}
            <input type="file" class="cover-upload__input" id="cover-input" accept="image/*" aria-label="표지 이미지 파일 선택">
          </label>
          <p class="cover-upload__hint">JPG, PNG, WebP 권장 (최대 5MB). 선택 시 원본 파일이 로컬 DB에 저장됩니다.</p>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend class="form-section__title">독서 상태 & 평가</legend>
        
        <div class="form-row">
          <div class="form-group">
            <label for="status" class="form-label">읽기 상태</label>
            <select id="status" name="status" class="form-select">
              ${STATUS_OPTIONS.map(o => `<option value="${o.value}" ${book.status === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="rating" class="form-label">내 평점</label>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <input type="number" id="rating" name="rating" class="form-input" style="width:70px;" value="${book.rating || 0}" min="0" max="5" step="0.5" placeholder="0.0 ~ 5.0">
              <span class="text-muted" id="rating-display">${renderStars(book.rating || 0)}</span>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="startedAt" class="form-label">독서 시작일</label>
            <input type="date" id="startedAt" name="startedAt" class="form-input" value="${book.startedAt ? formatDate(book.startedAt, 'YYYY-MM-DD') : ''}" max="${todayString()}">
          </div>
          <div class="form-group">
            <label for="completedAt" class="form-label">완독일</label>
            <input type="date" id="completedAt" name="completedAt" class="form-input" value="${book.completedAt ? formatDate(book.completedAt, 'YYYY-MM-DD') : ''}" max="${todayString()}" ${book.status !== 'completed' ? 'disabled' : ''}>
          </div>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend class="form-section__title">태그</legend>
        <div class="tag-input-wrapper" id="tag-wrapper" role="listbox" aria-label="태그 목록">
          ${(book.tags || []).map(tag => `
            <span class="tag tag-removable" role="option" data-tag="${escapeHtml(tag)}">
              ${escapeHtml(tag)}
              <button type="button" class="tag__remove" aria-label="${escapeHtml(tag)} 태그 삭제">&times;</button>
            </span>
          `).join('')}
          <input type="text" class="tag-input" id="tag-input" placeholder="태그 입력 후 엔터 또는 콤마(,)로 추가" aria-label="새 태그 입력" autocomplete="off">
        </div>
        <input type="hidden" name="tags" id="tags-hidden" value="${(book.tags || []).join(',')}">
        <p class="cover-upload__hint">최대 ${MAX_TAGS}개까지 추가 가능. 쉼표(,) 또는 엔터로 구분.</p>
      </fieldset>

      <fieldset class="form-section">
        <legend class="form-section__title">한줄 평 / 서평 <span style="font-weight:400; font-size:0.8rem; color:var(--color-text-muted);">(Markdown 지원)</span></legend>
        <div class="review-editor">
          <div class="review-tabs" role="tablist" aria-label="에디터 모드">
            <button type="button" role="tab" aria-selected="true" aria-controls="panel-write" data-tab="write" class="review-tab active">작성</button>
            <button type="button" role="tab" aria-selected="false" aria-controls="panel-preview" data-tab="preview" class="review-tab">미리보기</button>
          </div>
          <div class="tab-panels">
            <div role="tabpanel" id="panel-write" class="tab-panel active">
              <textarea id="review" name="review" class="form-textarea" placeholder="마크다운 문법으로 작성하세요. (예: **굵게**, *기울임*, \`코드\`, [링크](url))" rows="8">${escapeHtml(book.review || '')}</textarea>
            </div>
            <div role="tabpanel" id="panel-preview" class="tab-panel" style="display:none;">
              <div id="review-preview" class="detail-panel__content" style="min-height: 120px; background: var(--color-bg-tertiary); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);"></div>
            </div>
          </div>
        </div>
      </fieldset>

      <div class="form-actions" style="position: sticky; bottom: 0; background: var(--color-bg-primary); border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 1.5rem; z-index: 10;">
        <button type="button" class="btn btn-secondary btn-block" data-action="go-back" style="max-width: 200px; margin-right: auto;">취소</button>
        <button type="submit" class="btn btn-primary btn-block" ${_isSubmitting ? 'disabled' : ''} style="max-width: 200px;">
          ${_isSubmitting ? '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;margin-right:0.5rem;"></span>저장 중...' : '저장 완료'}
        </button>
      </div>
    </form>
  `;

  cacheFormDomElements();
  bindFormEvents();
  updateTagInputState();
  updateRatingDisplay();
  renderMarkdownPreview();
  syncFormUI(); // 완독일 입력 활성화 상태 동기화
}

function cacheFormDomElements() {
  _dom.form = document.getElementById('book-form');
  _dom.isbnInput = document.getElementById('isbn');
  _dom.titleInput = document.getElementById('title');
  _dom.fetchBtn = document.getElementById('btn-fetch-isbn');
  _dom.coverInput = document.getElementById('cover-input');
  _dom.coverPreview = document.getElementById('cover-preview');
  _dom.tagWrapper = document.getElementById('tag-wrapper');
  _dom.tagInput = document.getElementById('tag-input');
  _dom.tagsHidden = document.getElementById('tags-hidden');
  _dom.reviewTextarea = document.getElementById('review');
  _dom.reviewPreview = document.getElementById('review-preview');
  _dom.statusSelect = document.getElementById('status');
  _dom.completedAtInput = document.getElementById('completedAt');
  _dom.ratingInput = document.getElementById('rating');
  _dom.ratingDisplay = document.getElementById('rating-display');
  _dom.tabs = document.querySelectorAll('.review-tab');
  _dom.panels = document.querySelectorAll('.tab-panel');
}

// -------------------------------------------------------------------------
// 6. Event Binding & Handlers
// -------------------------------------------------------------------------

function bindFormEvents() {
  if (!_dom.form) return;
  
  _dom.form.addEventListener('submit', handleSubmit);
  _cleanupFns.push(() => _dom.form.removeEventListener('submit', handleSubmit));

  _dom.fetchBtn?.addEventListener('click', handleFetchIsbn);
  _cleanupFns.push(() => _dom.fetchBtn?.removeEventListener('click', handleFetchIsbn));
  _dom.isbnInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleFetchIsbn(); });

  _dom.coverInput?.addEventListener('change', handleCoverChange);
  _cleanupFns.push(() => _dom.coverInput?.removeEventListener('change', handleCoverChange));
  _dom.coverPreview?.addEventListener('click', (e) => {
    if (e.target.closest('.cover-upload__remove')) handleCoverRemove();
  });

  _dom.tagInput?.addEventListener('keydown', handleTagKeydown);
  _dom.tagInput?.addEventListener('blur', handleTagBlur);
  _dom.tagWrapper?.addEventListener('click', (e) => {
    if (e.target.matches('.tag__remove')) handleTagRemove(e.target.closest('.tag').dataset.tag);
  });
  _cleanupFns.push(() => {
    _dom.tagInput?.removeEventListener('keydown', handleTagKeydown);
    _dom.tagInput?.removeEventListener('blur', handleTagBlur);
  });

  _dom.tabs?.forEach(tab => {
    tab.addEventListener('click', () => switchReviewTab(tab.dataset.tab));
  });

  let previewTimer;
  _dom.reviewTextarea?.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderMarkdownPreview, 150);
  });
  _cleanupFns.push(() => clearTimeout(previewTimer));

  _dom.ratingInput?.addEventListener('input', updateRatingDisplay);

  _dom.statusSelect?.addEventListener('change', () => {
    if (_dom.completedAtInput) _dom.completedAtInput.disabled = _dom.statusSelect.value !== 'completed';
    if (_dom.statusSelect.value === 'completed' && !_dom.completedAtInput.value) {
      _dom.completedAtInput.value = todayString();
    }
  });

  _dom.form.querySelector('[data-action="go-back"]')?.addEventListener('click', () => navigate('/'));
}

// -------------------------------------------------------------------------
// 7. Core Logic Handlers
// -------------------------------------------------------------------------

async function handleFetchIsbn() {
  const isbn = _dom.isbnInput.value.replace(/[-\s]/g, '');
  if (!isbn || isbn.length !== 13) {
    showToast('ISBN 13자리를 정확히 입력해주세요.', 'warning');
    _dom.isbnInput.focus();
    return;
  }

  _dom.fetchBtn.disabled = true;
  _dom.fetchBtn.innerHTML = '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;"></span>';
  
  try {
    const data = await fetchBookMetadata(isbn);
    if (data) {
      applyMetadataToForm(data);
      showToast('도서 정보를 자동으로 불러왔습니다.', 'success');
    } else {
      showToast('해당 ISBN의 도서 정보를 찾을 수 없습니다.', 'error');
    }
  } catch (err) {
    console.error('[FormView] ISBN fetch error:', err);
    showToast('정보 조회 중 오류가 발생했습니다.', 'error');
  } finally {
    _dom.fetchBtn.disabled = false;
    _dom.fetchBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  }
}

function applyMetadataToForm(data) {
  const fields = ['title', 'author', 'publisher', 'publishDate', 'totalPages'];
  fields.forEach(key => {
    const input = _dom.form.querySelector(`[name="${key}"]`);
    if (input && data[key]) input.value = data[key];
  });

  if (data.externalCoverUrl) {
    _dom.form.dataset.externalCoverUrl = data.externalCoverUrl;
    if (!_coverFile && _dom.coverPreview) {
      _dom.coverPreview.style.backgroundImage = `url('${data.externalCoverUrl}')`;
    }
  }

  if (data.description && _dom.reviewTextarea) {
    const desc = `\n\n---\n*자동 조회된 설명:*\n${data.description}`;
    if (!_dom.reviewTextarea.value.includes(data.description.substring(0, 50))) {
      _dom.reviewTextarea.value += desc;
      renderMarkdownPreview();
    }
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  if (_isSubmitting) return;

  if (!_validateForm()) return;

  _isSubmitting = true;
  _updateSubmitButtonState();

  try {
    const formData = new FormData(_dom.form);
    const bookData = Object.fromEntries(formData.entries());

    const book = {
      id: bookData.id || crypto.randomUUID(),
      title: bookData.title.trim(),
      author: bookData.author.trim(),
      publisher: bookData.publisher.trim(),
      publishDate: bookData.publishDate || '',
      isbn: bookData.isbn.replace(/[-\s]/g, ''),
      totalPages: parseInt(bookData.totalPages) || 0,
      currentPage: parseInt(bookData.currentPage) || 0,
      tags: bookData.tags ? bookData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: bookData.status,
      rating: parseFloat(bookData.rating) || 0,
      review: bookData.review || '',
      startedAt: bookData.startedAt || null,
      completedAt: (bookData.status === 'completed' && bookData.completedAt) ? bookData.completedAt : null,
      updatedAt: new Date().toISOString(),
      createdAt: bookData.createdAt || new Date().toISOString(),
      externalCoverUrl: _dom.form.dataset.externalCoverUrl || ''
    };

    if (book.status === 'completed' && !book.completedAt) {
      book.completedAt = new Date().toISOString().split('T')[0];
    }
    if (book.status !== 'completed') {
      book.completedAt = null;
    }

    await ReadingDB.putBook(book);
    if (_coverFile) {
      await ReadingDB.saveCover(book.id, _coverFile);
    }

    showToast(`도서가 ${_currentBookId ? '수정' : '등록'}되었습니다.`, 'success');
    navigate('/');

  } catch (err) {
    console.error('[FormView] Save failed:', err);
    showToast(`저장 실패: ${err.message}`, 'error');
  } finally {
    _isSubmitting = false;
    _updateSubmitButtonState();
  }
}

function _validateForm() {
  let isValid = true;
  const title = _dom.titleInput.value.trim();
  
  if (!title) {
    _dom.titleInput.setAttribute('aria-invalid', 'true');
    document.getElementById('title-error').style.display = 'block';
    _dom.titleInput.focus();
    isValid = false;
  } else {
    _dom.titleInput.removeAttribute('aria-invalid');
    document.getElementById('title-error').style.display = 'none';
  }

  const isbn = _dom.isbnInput.value.replace(/[-\s]/g, '');
  if (isbn && isbn.length !== 13) {
    showToast('ISBN은 13자리 숫자여야 합니다.', 'warning');
    _dom.isbnInput.focus();
    return false;
  }

  return isValid;
}

function _updateSubmitButtonState() {
  const btns = _dom.container?.querySelectorAll('[data-action="submit-form"], [type="submit"]');
  btns?.forEach(btn => {
    btn.disabled = _isSubmitting;
    btn.innerHTML = _isSubmitting 
      ? '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;margin-right:0.5rem;"></span>저장 중...' 
      : '저장 완료';
  });
}

// -------------------------------------------------------------------------
// 8. Cover Image Handlers
// -------------------------------------------------------------------------

function handleCoverChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('이미지 파일만 업로드 가능합니다.', 'warning');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('파일 크기는 5MB 이하여야 합니다.', 'warning');
    return;
  }

  _coverFile = file;
  
  if (_coverObjectUrl) URL.revokeObjectURL(_coverObjectUrl);
  
  _coverObjectUrl = URL.createObjectURL(file);
  _dom.coverPreview.style.backgroundImage = `url('${_coverObjectUrl}')`;
  _dom.coverPreview.style.backgroundSize = 'cover';
  _dom.coverPreview.style.backgroundPosition = 'center';
  
  if (!_dom.coverPreview.querySelector('.cover-upload__remove')) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cover-upload__remove';
    removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    removeBtn.setAttribute('aria-label', '이미지 삭제');
    _dom.coverPreview.appendChild(removeBtn);
  }

  delete _dom.form.dataset.externalCoverUrl;
}

function handleCoverRemove() {
  if (_coverObjectUrl) {
    URL.revokeObjectURL(_coverObjectUrl);
    _coverObjectUrl = null;
  }
  _coverFile = null;
  _dom.coverInput.value = '';
  
  const externalUrl = _dom.form.dataset.externalCoverUrl;
  const fallback = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><rect fill='%23e9ecef' width='100' height='150'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23adb5bd'>표지없음</text></svg>`;
  _dom.coverPreview.style.backgroundImage = `url('${externalUrl || fallback}')`;
  _dom.coverPreview.style.backgroundSize = 'cover';
  
  const removeBtn = _dom.coverPreview.querySelector('.cover-upload__remove');
  if (removeBtn) removeBtn.remove();
}

// -------------------------------------------------------------------------
// 9. Tag Input Handlers
// -------------------------------------------------------------------------

function handleTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value);
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value) {
    const tags = getCurrentTags();
    if (tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }
}

function handleTagBlur(e) {
  if (e.target.value.trim()) addTag(e.target.value);
  e.target.value = '';
}

function addTag(value) {
  const tag = value.trim().replace(/,/g, '');
  if (!tag) return;
  
  const tags = getCurrentTags();
  if (tags.includes(tag)) {
    showToast('이미 추가된 태그입니다.', 'info');
    return;
  }
  if (tags.length >= MAX_TAGS) {
    showToast(`태그는 최대 ${MAX_TAGS}개까지 추가 가능합니다.`, 'warning');
    return;
  }

  tags.push(tag);
  updateTagsHiddenInput(tags);
  renderTagChips(tags);
  updateTagInputState();
}

function removeTag(tagToRemove) {
  const tags = getCurrentTags().filter(t => t !== tagToRemove);
  updateTagsHiddenInput(tags);
  renderTagChips(tags);
  updateTagInputState();
}

function getCurrentTags() {
  return _dom.tagsHidden.value ? _dom.tagsHidden.value.split(',').filter(Boolean) : [];
}

function updateTagsHiddenInput(tags) {
  _dom.tagsHidden.value = tags.join(',');
}

function renderTagChips(tags) {
  const input = _dom.tagInput;
  _dom.tagWrapper.innerHTML = '';
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag tag-removable';
    chip.dataset.tag = tag;
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" class="tag__remove" aria-label="${escapeHtml(tag)} 태그 삭제">&times;</button>`;
    _dom.tagWrapper.appendChild(chip);
  });
  _dom.tagWrapper.appendChild(input);
  input.focus();
}

function updateTagInputState() {
  const tags = getCurrentTags();
  _dom.tagInput.style.display = tags.length >= MAX_TAGS ? 'none' : 'inline-block';
  _dom.tagInput.disabled = tags.length >= MAX_TAGS;
}

// -------------------------------------------------------------------------
// 10. Markdown Preview
// -------------------------------------------------------------------------

function switchReviewTab(tab) {
  _dom.tabs?.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', t.dataset.tab === tab);
  });
  _dom.panels?.forEach(p => {
    p.style.display = p.id === `panel-${tab}` ? 'block' : 'none';
  });
  if (tab === 'preview') renderMarkdownPreview();
}

async function renderMarkdownPreview() {
  if (!_dom.reviewPreview) return;
  const text = _dom.reviewTextarea?.value || '';
  try {
    const { marked } = await import('marked');
    _dom.reviewPreview.innerHTML = `<div class="markdown-body">${marked.parse(text, { async: false, breaks: true, gfm: true, sanitize: true })}</div>`;
  } catch (e) {
    console.error('[FormView] Markdown render failed:', e);
    _dom.reviewPreview.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
  }
}

// -------------------------------------------------------------------------
// 11. Rating Stars Display
// -------------------------------------------------------------------------

function updateRatingDisplay() {
  const val = parseFloat(_dom.ratingInput?.value) || 0;
  const full = Math.floor(val);
  const half = val % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  if (_dom.ratingDisplay) _dom.ratingDisplay.textContent = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function renderStars(val) {
  const v = parseFloat(val) || 0;
  const full = Math.floor(v);
  const half = v % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

// -------------------------------------------------------------------------
// 12. Edit Mode Data Loading
// -------------------------------------------------------------------------

async function loadBookForEdit(id) {
  _currentBookId = id;
  state.loading = true;
  
  try {
    const book = await ReadingDB.getBook(id);
    if (!book) throw new Error('도서를 찾을 수 없습니다.');

    let coverUrl = book.externalCoverUrl;
    const blob = await ReadingDB.getCoverBlob(id);
    if (blob) {
      coverUrl = URL.createObjectURL(blob);
      _coverObjectUrl = coverUrl;
    }

    renderForm({ ...book, externalCoverUrl: coverUrl });
    _dom.completedAtInput.disabled = book.status !== 'completed';

  } catch (err) {
    console.error('[FormView] Load for edit failed:', err);
    showToast('도서 정보를 불러오는데 실패했습니다.', 'error');
    navigate('/');
  } finally {
    state.loading = false;
  }
}

// -------------------------------------------------------------------------
// 13. UI Sync Helpers
// -------------------------------------------------------------------------

function syncFormUI() {
  if (_dom.statusSelect && _dom.completedAtInput) {
    _dom.completedAtInput.disabled = _dom.statusSelect.value !== 'completed';
    if (_dom.statusSelect.value === 'completed' && !_dom.completedAtInput.value) {
      _dom.completedAtInput.value = todayString();
    }
  }
}

// -------------------------------------------------------------------------
// 14. Public Init Function (Fixed Order)
// -------------------------------------------------------------------------

export async function init({ params, state, navigate, db, showToast, showConfirm }) {
  console.log('[FormView] Initializing...', params);
  
  // 1. DOM 캐싱 최우선 실행 (renderForm에서 _dom.container 사용하므로)
  cacheDomElements();
  
  // 2. 수정 모드 판별 및 데이터 로드 또는 신규 폼 렌더링
  if (params.id) {
    await loadBookForEdit(params.id);
  } else {
    // 신규 등록: 빈 폼 렌더링
    renderForm({ 
      status: 'wish', 
      rating: 0, 
      currentPage: 0,
      tags: [],
      createdAt: new Date().toISOString()
    });
  }

  // 3. 클린업 함수 반환
  return () => {
    console.log('[FormView] Cleaning up...');
    if (_coverObjectUrl) URL.revokeObjectURL(_coverObjectUrl);
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
  };
}

// -------------------------------------------------------------------------
// 15. Helpers
// -------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__FORM_VIEW__ = { init };
}