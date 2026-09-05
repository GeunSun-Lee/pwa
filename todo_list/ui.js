/**
 * ui.js - UI Rendering & Interaction Helpers (Android Only)
 * 초등 TODO 앱 전용: 큰 터치 타겟, 이모지, 접근성, 애니메이션
 * 표준 DOM API, Pointer Events, 표준 CSSOM 사용
 * @module ui
 */

// ==========================================================================
// 1. DOM 참조 캐싱 (초기화 시 1회 실행 - 외부에서 initializeDOM()으로 호출)
// ==========================================================================
let dom = {};

function cacheDom() {
  dom = {
    // Layout
    taskList: document.getElementById('task-list'),
    emptyState: document.getElementById('empty-state'),
    todayDate: document.getElementById('today-date'),
    btnToggleDone: document.getElementById('btn-toggle-done'),
    fab: document.getElementById('btn-add-task'),
    
    // Dialog (Task Form)
    dialog: document.getElementById('task-dialog'),
    form: document.getElementById('task-form'),
    dialogTitle: document.getElementById('dialog-title'),
    btnCloseDialog: document.getElementById('btn-close-dialog'),
    categoryBtns: document.querySelectorAll('.category-btn'),
    taskTitleInput: document.getElementById('task-title'),
    btnVoice: document.getElementById('btn-voice'),
    imagePreview: document.getElementById('image-preview'),
    btnRemoveImg: document.querySelector('#image-preview .remove-img'),
    btnCamera: document.getElementById('btn-camera'),
    inputCamera: document.getElementById('input-camera'),
    btnDeleteTask: document.getElementById('btn-delete-task'),
    btnSaveTask: document.getElementById('btn-save-task'),
    hiddenTaskId: document.getElementById('task-id'),
    hiddenCategory: document.getElementById('task-category'),
    
    // Toast Container (동적 생성)
    toastContainer: null,
  };
  
  // 날짜 초기화
  if (dom.todayDate) setTodayDate();
}

/** 오늘 날짜 문자열 세팅 (예: "9월 5일 금요일 🌤️") */
function setTodayDate() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const week = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  const weather = ['☀️', '🌤️', '☁️', '🌧️', '❄️', '🌈'][Math.floor(Math.random() * 6)];
  dom.todayDate.textContent = `${month}월 ${day}일 ${week}요일 ${weather}`;
}

// ==========================================================================
// 2. 핵심 렌더링 함수
// ==========================================================================

/**
 * 할 일 목록 전체 렌더링
 * @param {Task[]} tasks - DB에서 order 순으로 정렬된 배열
 * @param {boolean} showDone - 완료된 일 표시 여부
 */
export function renderTaskList(tasks, showDone = true) {
  if (!dom.taskList) cacheDom(); // 안전장치 (initializeDOM 호출 누락 대비)
  
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;

  tasks.forEach(task => {
    if (!showDone && task.isDone) return;
    
    const el = createTaskElement(task);
    fragment.appendChild(el);
    visibleCount++;
  });

  dom.taskList.innerHTML = '';
  dom.taskList.appendChild(fragment);
  toggleEmptyState(visibleCount === 0);
}

/**
 * 단일 Task DOM 요소 생성 (팩토리 함수)
 * @param {Task} task 
 * @returns {HTMLLIElement}
 */
function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = `task-item ${task.isDone ? 'done' : ''}`;
  li.dataset.id = task.id;
  li.dataset.order = task.order;
  li.role = 'listitem';
  li.setAttribute('aria-label', `${task.title}, ${task.category} 카테고리, ${task.isDone ? '완료됨' : '미완료'}`);

  // 1. 체크박스 (CSS에서 appearance: none으로 스타일링)
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.isDone;
  checkbox.setAttribute('aria-label', task.isDone ? '완료 취소' : '완료하기');
  checkbox.tabIndex = 0;

  // 2. 콘텐츠 영역
  const contentDiv = document.createElement('div');
  contentDiv.className = 'task-content';
  
  const headerDiv = document.createElement('div');
  headerDiv.className = 'task-header';
  
  const catSpan = document.createElement('span');
  catSpan.className = 'task-category';
  catSpan.dataset.cat = task.category;
  catSpan.textContent = task.category;
  catSpan.setAttribute('aria-label', `카테고리 ${getCategoryName(task.category)}`);
  
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = task.title;
  
  headerDiv.append(catSpan, titleSpan);
  contentDiv.appendChild(headerDiv);

  // 3. 이미지 (있다면)
  if (task.imageBlob) {
    const img = document.createElement('img');
    img.className = 'task-image';
    img.src = task.imageBlob; // Object URL (app.js에서 생성해 넘겨줌)
    img.alt = '첨부 사진';
    img.loading = 'lazy';
    contentDiv.appendChild(img);
  }

  // 4. 액션 버튼 영역 (드래그 핸들 + 메뉴)
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'task-actions';
  actionsDiv.style.display = 'flex';
  actionsDiv.style.gap = 'var(--space-xs)';

  // 드래그 핸들 (기본 숨김, .drag-mode 시 표시)
  const dragBtn = document.createElement('button');
  dragBtn.type = 'button';
  dragBtn.className = 'drag-handle btn-icon';
  dragBtn.innerHTML = '⋮⋮';
  dragBtn.setAttribute('aria-label', '순서 바꾸기 (길게 눌러 이동)');
  dragBtn.tabIndex = -1;

  // 메뉴 버튼
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'task-menu-btn btn-icon';
  menuBtn.innerHTML = '⋯';
  menuBtn.setAttribute('aria-label', '메뉴');
  menuBtn.setAttribute('aria-haspopup', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');

  actionsDiv.append(dragBtn, menuBtn);
  li.append(checkbox, contentDiv, actionsDiv);

  return li;
}

function getCategoryName(emoji) {
  const map = { '🎒': '가방', '📚': '숙제', '🎨': '준비물', '🏃': '체육', '📝': '기타' };
  return map[emoji] || '분류';
}

function toggleEmptyState(isEmpty) {
  if (dom.emptyState) dom.emptyState.classList.toggle('hidden', !isEmpty);
  if (dom.taskList) dom.taskList.style.display = isEmpty ? 'none' : 'flex';
}

// ==========================================================================
// 3. 모달(다이얼로그) 제어
// ==========================================================================

export function openTaskDialog(mode = 'add', task = null) {
  if (!dom.dialog) cacheDom(); // 안전장치
  resetForm();

  if (mode === 'edit' && task) {
    dom.dialogTitle.textContent = '할 일 수정';
    dom.hiddenTaskId.value = task.id;
    dom.taskTitleInput.value = task.title;
    dom.hiddenCategory.value = task.category;
    setActiveCategory(task.category);
    
    if (task.imageBlob) showImagePreview(task.imageBlob);
    dom.btnDeleteTask.classList.remove('hidden');
  } else {
    dom.dialogTitle.textContent = '새 할 일';
    dom.hiddenTaskId.value = '';
    dom.hiddenCategory.value = '🎒';
    setActiveCategory('🎒');
    dom.btnDeleteTask.classList.add('hidden');
  }
  
  validateForm();
  dom.dialog.showModal();
  // 포커스 이동 (접근성)
  setTimeout(() => dom.taskTitleInput.focus({ preventScroll: true }), 50);
}

export function closeTaskDialog() {
  if (!dom.dialog) return;
  dom.dialog.classList.add('closing');
  setTimeout(() => {
    dom.dialog.close();
    dom.dialog.classList.remove('closing');
    resetForm();
  }, 250); // CSS animation: slideDown 250ms 와 맞춤
}

function resetForm() {
  dom.form.reset();
  dom.hiddenCategory.value = '🎒';
  setActiveCategory('🎒');
  hideImagePreview();
  dom.btnDeleteTask.classList.add('hidden');
  dom.btnSaveTask.disabled = true;
  dom.btnVoice.classList.remove('listening');
  dom.btnVoice.setAttribute('aria-label', '음성으로 입력');
}

// [수정] export 추가로 app.js에서 UI.setActiveCategory 호출 가능하게 함
export function setActiveCategory(cat) {
  dom.categoryBtns.forEach(btn => {
    const isActive = btn.dataset.cat === cat;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
  if (dom.hiddenCategory) dom.hiddenCategory.value = cat;
}

function showImagePreview(blobUrl) {
  if (!dom.imagePreview) return;
  let img = dom.imagePreview.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = '첨부된 사진 미리보기';
    dom.imagePreview.prepend(img);
  }
  img.src = blobUrl;
  dom.imagePreview.classList.remove('hidden');
}

function hideImagePreview() {
  if (!dom.imagePreview) return;
  const img = dom.imagePreview.querySelector('img');
  if (img) {
    URL.revokeObjectURL(img.src); // 메모리 누수 방지 필수!
    img.src = '';
  }
  dom.imagePreview.classList.add('hidden');
}

// ==========================================================================
// 4. 폼 유효성 검사 & 상호작용 헬퍼
// ==========================================================================

export function validateForm() {
  const hasTitle = dom.taskTitleInput.value.trim().length > 0;
  dom.btnSaveTask.disabled = !hasTitle;
}

export function setVoiceListening(isListening) {
  dom.btnVoice.classList.toggle('listening', isListening);
  dom.btnVoice.setAttribute('aria-label', isListening ? '듣는 중... 다시 눌러 중단' : '음성으로 입력');
  dom.taskTitleInput.placeholder = isListening ? '🎤 말하고 있어요...' : '말하거나 적어보세요';
}

export function setDeleteButtonVisible(visible) {
  dom.btnDeleteTask.classList.toggle('hidden', !visible);
}

// ==========================================================================
// 5. 리스트 단일 아이템 조작 (성능 최적화)
// ==========================================================================

export function prependTask(task, blobUrl) {
  toggleEmptyState(false);
  dom.taskList.style.display = 'flex';
  const el = createTaskElement({ ...task, imageBlob: blobUrl });
  el.style.animation = 'none';
  requestAnimationFrame(() => {
    el.style.animation = 'slideInUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  });
  dom.taskList.prepend(el);
}

export function updateTaskElement(task, blobUrl) {
  const li = dom.taskList.querySelector(`[data-id="${task.id}"]`);
  if (!li) return;
  
  li.classList.toggle('done', task.isDone);
  
  const checkbox = li.querySelector('.task-checkbox');
  if (checkbox) checkbox.checked = task.isDone;
  
  const titleEl = li.querySelector('.task-title');
  if (titleEl) titleEl.textContent = task.title;
  
  const catEl = li.querySelector('.task-category');
  if (catEl && catEl.dataset.cat !== task.category) {
    catEl.dataset.cat = task.category;
    catEl.textContent = task.category;
  }
  
  const existingImg = li.querySelector('.task-image');
  if (blobUrl) {
    if (existingImg) existingImg.src = blobUrl;
    else {
      const img = document.createElement('img');
      img.className = 'task-image';
      img.src = blobUrl;
      img.alt = '첨부 사진';
      img.loading = 'lazy';
      li.querySelector('.task-content').appendChild(img);
    }
  } else if (existingImg) {
    URL.revokeObjectURL(existingImg.src);
    existingImg.remove();
  }
  
  li.setAttribute('aria-label', `${task.title}, ${task.category} 카테고리, ${task.isDone ? '완료됨' : '미완료'}`);
}

export function removeTaskElement(taskId) {
  const li = dom.taskList.querySelector(`[data-id="${taskId}"]`);
  if (!li) return Promise.resolve();
  
  return new Promise(resolve => {
    li.classList.add('swipe-delete');
    li.addEventListener('animationend', () => {
      li.remove();
      if (dom.taskList.children.length === 0) toggleEmptyState(true);
      resolve();
    }, { once: true });
  });
}

export function setDragMode(enabled) {
  if (!dom.taskList) return;
  dom.taskList.classList.toggle('drag-mode', enabled);
  dom.taskList.querySelectorAll('.drag-handle').forEach(btn => {
    btn.tabIndex = enabled ? 0 : -1;
  });
}

export function reorderTaskElements(taskIds) {
  if (!dom.taskList) return;
  const fragment = document.createDocumentFragment();
  taskIds.forEach(id => {
    const li = dom.taskList.querySelector(`[data-id="${id}"]`);
    if (li) fragment.appendChild(li);
  });
  dom.taskList.appendChild(fragment);
  [...dom.taskList.children].forEach((li, idx) => li.dataset.order = idx + 1);
}

// ==========================================================================
// 6. 토스트/알림 시스템
// ==========================================================================

function getToastContainer() {
  if (dom.toastContainer) return dom.toastContainer;
  const container = document.createElement('div');
  container.className = 'toast-container';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-label', '알림');
  document.body.appendChild(container);
  dom.toastContainer = container;
  return container;
}

export function showToast(message, type = 'default', duration = 3000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `<span>${message}</span><button type="button" aria-label="닫기">✕</button>`;
  
  toast.querySelector('button').onclick = () => removeToast(toast);
  
  container.appendChild(toast);
  
  // 진입 애니메이션 강제 트리거
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  // 자동 제거 타이머
  const timeoutId = setTimeout(() => {
    removeToast(toast);
  }, duration);
  
  // 수동 닫기 버튼을 위한 remove 함수 분리
  function removeToast(el) {
    clearTimeout(timeoutId);
    // 퇴장 애니메이션: 페이드 아웃 + 약간 위로 이동
    el.style.opacity = '0';
    el.style.transform = 'translateY(-20px)';
    // 트랜지션 종료 후 DOM에서 제거
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }
}

// ==========================================================================
// 7. 피드백 이펙트 (컨페티, 진동 - 표준 API)
// ==========================================================================

export function playConfetti(x, y) {
  const colors = ['#ff8a7a', '#7dd3a0', '#ffd166', '#a8d0e6', '#f8bbd0'];
  const count = 12;
  
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.textContent = ['✨', '⭐', '🌈', '💖', '🎉'][Math.floor(Math.random() * 5)];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = colors[Math.floor(Math.random() * colors.length)];
    el.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    el.style.setProperty('--tx', `${(Math.random() - 0.5) * 200}px`);
    el.style.setProperty('--ty', `${Math.random() * 150 + 50}px`);
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

export function vibrate(pattern = [50]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export function vibrateDelete() { vibrate([80, 50, 80]); }
export function vibrateSuccess() { vibrate([30, 20, 30]); }
export function vibrateError() { vibrate([100, 50, 100, 50, 100]); }

// ==========================================================================
// 8. 오프라인 배너 제어
// ==========================================================================

let offlineBanner = null;

export function showOfflineBanner(show) {
  if (show) {
    if (!offlineBanner) {
      offlineBanner = document.createElement('div');
      offlineBanner.className = 'offline-banner show';
      offlineBanner.innerHTML = '📴 오프라인 모드입니다. 변경 사항은 기기에 저장되며, 온라인 시 동기화됩니다.';
      document.body.prepend(offlineBanner);
    } else {
      offlineBanner.classList.add('show');
    }
  } else if (offlineBanner) {
    offlineBanner.classList.remove('show');
  }
}

// ==========================================================================
// 9. 이벤트 바인딩 헬퍼 (app.js에서 호출)
// ==========================================================================

export function bindHeaderEvents(handlers) {
  if (!dom.btnToggleDone) cacheDom();
  dom.btnToggleDone.addEventListener('click', handlers.onToggleDone);
}

export function bindFabEvent(onClick) {
  if (!dom.fab) cacheDom();
  dom.fab.addEventListener('click', onClick);
}

export function bindDialogEvents(handlers) {
  if (!dom.dialog) cacheDom();
  const { onSave, onDelete, onClose, onCategoryChange, onVoiceClick, onCameraClick, onImageClear, onTitleInput } = handlers;
  
  dom.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dom.btnSaveTask.disabled) onSave();
  });
  
  dom.btnCloseDialog.addEventListener('click', onClose);
  dom.dialog.addEventListener('click', (e) => {
    if (e.target === dom.dialog) onClose();
  });
  
  dom.categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => onCategoryChange(btn.dataset.cat));
  });
  
  dom.btnVoice.addEventListener('click', onVoiceClick);
  
  dom.btnCamera.addEventListener('click', () => dom.inputCamera.click());
  dom.inputCamera.addEventListener('change', (e) => onCameraClick(e.target.files[0]));
  
  // 이미지 삭제 이벤트 (동적 위임)
  if (dom.btnRemoveImg) {
    dom.btnRemoveImg.onclick = (e) => {
      e.stopPropagation();
      hideImagePreview();
      dom.imagePreview.dispatchEvent(new CustomEvent('image-cleared', { bubbles: true }));
    };
  }
  
  dom.btnDeleteTask.addEventListener('click', onDelete);
  dom.taskTitleInput.addEventListener('input', onTitleInput);
}

export function bindListEvents(handlers) {
  if (!dom.taskList) cacheDom();
  const { onToggle, onDragStart, onMenuClick } = handlers;
  
  dom.taskList.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = Number(li.dataset.id);
    
    // [핵심 수정] 체크박스 클릭: preventDefault 제거, 네이티브 토글 허용 후 상태 읽어서 전달
    if (e.target.matches('.task-checkbox')) {
      const checkbox = e.target;
      // preventDefault() 제거: 브라우저 기본 토글 동작 허용
      const newDoneState = checkbox.checked; // 브라우저가 이미 토글시킨 상태 읽기
      onToggle(id, newDoneState);
      return;
    }
    
    if (e.target.matches('.task-menu-btn')) {
      e.stopPropagation();
      onMenuClick(id, e.target);
      return;
    }
    
    if (e.target.closest('.task-content')) {
      // 수정 모드 진입 로직은 app.js에서 처리 (필요 시 주석 해제)
    }
  });
  
  // 데스크톱용 네이티브 Drag API (Pointer Events로 대부분 커버되나 폴백용)
  dom.taskList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.task-item');
    if (li) onDragStart(e, li);
  });
}

// ==========================================================================
// 10. 유틸리티
// ==========================================================================

export function $(selector) {
  if (!dom.taskList) cacheDom();
  return document.querySelector(selector);
}

export function trapFocus(element) {
  const focusable = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  element.addEventListener('keydown', handler);
  return () => element.removeEventListener('keydown', handler);
}

// ==========================================================================
// 11. 외부 초기화 진입점 (app.js에서 명시적 호출용)
// ==========================================================================

/**
 * DOM 캐싱 강제 실행
 * app.js의 init() 최상단에서 UI.initializeDOM()으로 호출해야 함.
 */
export function initializeDOM() {
  cacheDom();
}

// ==========================================================================
// 12. 개발 편의: 전역 디버깅 네임스페이스
// ==========================================================================
if (typeof window !== 'undefined' && window.__DEV__) {
  window.UI = { 
    renderTaskList, openTaskDialog, closeTaskDialog, showToast, 
    playConfetti, vibrate, setDragMode, validateForm, setVoiceListening,
    initializeDOM,
    setActiveCategory // 디버깅용 노출
  };
}