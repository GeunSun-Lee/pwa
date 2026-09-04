/**
 * ui.js - UI Rendering & Interaction Helpers
 * 초등 TODO 앱 전용: 큰 터치 타겟, 이모지, 접근성, 애니메이션
 * @module ui
 */

// ==========================================================================
// 1. DOM 참조 캐싱 (초기화 시 1회 실행)
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
    previewImg: document.querySelector('#image-preview img'), // 동적 생성되므로 나중에 찾을 수도 있음
    btnRemoveImg: document.querySelector('#image-preview .remove-img'),
    btnCamera: document.getElementById('btn-camera'),
    inputCamera: document.getElementById('input-camera'),
    btnDeleteTask: document.getElementById('btn-delete-task'),
    btnSaveTask: document.getElementById('btn-save-task'),
    hiddenTaskId: document.getElementById('task-id'),
    hiddenCategory: document.getElementById('task-category'),
    
    // Toast Container (동적 생성 가능)
    toastContainer: document.querySelector('.toast-container'),
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
  // 날씨 이모지 랜덤 (재미 요소)
  const weather = ['☀️', '🌤️', '☁️', '🌧️', '❄️', '🌈'][Math.floor(Math.random() * 6)];
  dom.todayDate.textContent = `${month}월 ${day}일 ${week}요일 ${weather}`;
}

// ==========================================================================
// 2. 핵심 렌더링 함수
// ==========================================================================

/**
 * 할 일 목록 전체 렌더링 (초기 로드, 정렬 변경 시)
 * @param {Task[]} tasks - DB에서 order 순으로 정렬된 배열
 * @param {boolean} showDone - 완료된 일 표시 여부
 */
export function renderTaskList(tasks, showDone = true) {
  if (!dom.taskList) cacheDom(); // 안전장치
  
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;

  tasks.forEach(task => {
    // 필터링: 완료된 일 숨김 모드라면 isDone=true 제외
    if (!showDone && task.isDone) return;
    
    const el = createTaskElement(task);
    fragment.appendChild(el);
    visibleCount++;
  });

  // 기존 리스트 비우고 새 프래그먼트 추가 (애니메이션 위해 innerHTML 비우기 전 클래스 처리)
  dom.taskList.innerHTML = ''; // 간단함. 리스트 가상화 불필요한 규모.
  dom.taskList.appendChild(fragment);

  // 빈 상태 토글
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

  // 1. 체크박스 (커스텀 스타일용 native checkbox 숨김 처리 - CSS에서 appearance: none)
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.isDone;
  checkbox.setAttribute('aria-label', task.isDone ? '완료 취소' : '완료하기');
  checkbox.tabIndex = 0; // 키보드 포커스 가능

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
    img.src = task.imageBlob; // Object URL (app.js에서 createBlobUrl로 생성해 넘겨줘야 함)
    img.alt = '첨부 사진';
    img.loading = 'lazy';
    contentDiv.appendChild(img);
  }

  // 4. 메뉴/드래그 버튼 영역
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'task-actions';
  actionsDiv.style.display = 'flex';
  actionsDiv.style.gap = 'var(--space-xs)';

  // 드래그 핸들 (기본 숨김, drag-mode 클래스 시 보임)
  const dragBtn = document.createElement('button');
  dragBtn.type = 'button';
  dragBtn.className = 'drag-handle btn-icon';
  dragBtn.innerHTML = '⋮⋮'; // 드래그 아이콘
  dragBtn.setAttribute('aria-label', '순서 바꾸기 (길게 눌러 이동)');
  dragBtn.tabIndex = -1; // 평상시 탭 순서 제외

  // 메뉴 버튼 (삭제 등)
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

/** 카테고리 이모지 -> 한글 이름 매핑 (접근성용) */
function getCategoryName(emoji) {
  const map = { '🎒': '가방', '📚': '숙제', '🎨': '준비물', '🏃': '체육', '📝': '기타' };
  return map[emoji] || '분류';
}

/** 빈 상태 표시/숨김 */
function toggleEmptyState(isEmpty) {
  if (dom.emptyState) dom.emptyState.classList.toggle('hidden', !isEmpty);
  if (dom.taskList) dom.taskList.style.display = isEmpty ? 'none' : 'flex';
}

// ==========================================================================
// 3. 모달(다이얼로그) 제어
// ==========================================================================

/** 모달 열기 (추가/수정 공용) */
export function openTaskDialog(mode = 'add', task = null) {
  if (!dom.dialog) cacheDom();
  resetForm(); // 이전 상태 초기화

  if (mode === 'edit' && task) {
    dom.dialogTitle.textContent = '할 일 수정';
    dom.hiddenTaskId.value = task.id;
    dom.taskTitleInput.value = task.title;
    dom.hiddenCategory.value = task.category;
    setActiveCategory(task.category);
    
    // 이미지 프리뷰
    if (task.imageBlob) showImagePreview(task.imageBlob);
    dom.btnDeleteTask.classList.remove('hidden'); // 삭제 버튼 보이기
  } else {
    dom.dialogTitle.textContent = '새 할 일';
    dom.hiddenTaskId.value = '';
    dom.hiddenCategory.value = '🎒';
    setActiveCategory('🎒');
    dom.btnDeleteTask.classList.add('hidden');
  }
  
  validateForm(); // 저장 버튼 활성화 체크
  dom.dialog.showModal();
  // 포커스 이동 (접근성)
  setTimeout(() => dom.taskTitleInput.focus({ preventScroll: true }), 50);
}

/** 모달 닫기 */
export function closeTaskDialog() {
  if (!dom.dialog) return;
  // 닫기 애니메이션 클래스 추가 후 실제 닫기
  dom.dialog.classList.add('closing');
  // 애니메이션 끝날 때 close() 호출 (CSS transitionend 이벤트 활용 권장)
  // 여기서는 간단히 timeout 처리 (CSS animation: slideDown 250ms)
  setTimeout(() => {
    dom.dialog.close();
    dom.dialog.classList.remove('closing');
    resetForm();
  }, 250);
}

/** 폼 초기화 */
function resetForm() {
  dom.form.reset(); // hidden input 포함 리셋
  dom.hiddenCategory.value = '🎒';
  setActiveCategory('🎒');
  hideImagePreview();
  dom.btnDeleteTask.classList.add('hidden');
  dom.btnSaveTask.disabled = true;
  // 음성 인식 중이었다면 중지 (app.js에서 처리해야 함) -> 이벤트 발생
  dom.btnVoice.classList.remove('listening');
  dom.btnVoice.setAttribute('aria-label', '음성으로 입력');
}

/** 카테고리 버튼 활성화 상태 동기화 */
function setActiveCategory(cat) {
  dom.categoryBtns.forEach(btn => {
    const isActive = btn.dataset.cat === cat;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
  dom.hiddenCategory.value = cat;
}

/** 이미지 프리뷰 표시 */
function showImagePreview(blobUrl) {
  if (!dom.previewImg) {
    // 최초 생성
    const img = document.createElement('img');
    img.alt = '첨부된 사진 미리보기';
    dom.imagePreview.prepend(img); // 버튼 위에 삽입
    dom.previewImg = img;
    // 삭제 버튼 이벤트 바인딩 (최초 1회)
    if (dom.btnRemoveImg) {
      dom.btnRemoveImg.onclick = (e) => {
        e.stopPropagation();
        hideImagePreview();
        // app.js 측 상태도 클리어하도록 커스텀 이벤트 발생
        dom.imagePreview.dispatchEvent(new CustomEvent('image-cleared', { bubbles: true }));
      };
    }
  }
  dom.previewImg.src = blobUrl;
  dom.imagePreview.classList.remove('hidden');
}

/** 이미지 프리뷰 숨김 & Object URL 해제 */
function hideImagePreview() {
  if (dom.previewImg) {
    URL.revokeObjectURL(dom.previewImg.src); // 메모리 누수 방지 필수!
    dom.previewImg.src = '';
  }
  dom.imagePreview.classList.add('hidden');
}

// ==========================================================================
// 4. 폼 유효성 검사 & 상호작용 헬퍼
// ==========================================================================

/** 입력값에 따른 저장 버튼 활성화 */
export function validateForm() {
  const hasTitle = dom.taskTitleInput.value.trim().length > 0;
  dom.btnSaveTask.disabled = !hasTitle;
}

/** 음성 인식 상태 UI 반영 */
export function setVoiceListening(isListening) {
  dom.btnVoice.classList.toggle('listening', isListening);
  dom.btnVoice.setAttribute('aria-label', isListening ? '듣는 중... 다시 눌러 중단' : '음성으로 입력');
  // 시각적 피드백: 인풋 플레이스홀더 변경
  dom.taskTitleInput.placeholder = isListening ? '🎤 말하고 있어요...' : '말하거나 적어보세요';
}

/** 삭제 버튼 활성화 (수정 모드에서만) */
export function setDeleteButtonVisible(visible) {
  dom.btnDeleteTask.classList.toggle('hidden', !visible);
}

// ==========================================================================
// 5. 리스트 단일 아이템 조작 (성능 최적화: 전체 리렌더링 방지)
// ==========================================================================

/** 아이템 추가 (맨 위) */
export function prependTask(task, blobUrl) {
  toggleEmptyState(false);
  dom.taskList.style.display = 'flex';
  const el = createTaskElement({ ...task, imageBlob: blobUrl });
  // 등장 애니메이션
  el.style.animation = 'none';
  requestAnimationFrame(() => {
    el.style.animation = 'slideInUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  });
  dom.taskList.prepend(el);
}

/** 아이템 업데이트 (완료 토글, 제목 수정 등) */
export function updateTaskElement(task, blobUrl) {
  const li = dom.taskList.querySelector(`[data-id="${task.id}"]`);
  if (!li) return; // 필터링으로 안 보일 수 있음
  
  // 완료 상태 클래스 토글
  li.classList.toggle('done', task.isDone);
  
  // 체크박스 동기화
  const checkbox = li.querySelector('.task-checkbox');
  if (checkbox) checkbox.checked = task.isDone;
  
  // 제목 수정
  const titleEl = li.querySelector('.task-title');
  if (titleEl) titleEl.textContent = task.title;
  
  // 카테고리 변경
  const catEl = li.querySelector('.task-category');
  if (catEl && catEl.dataset.cat !== task.category) {
    catEl.dataset.cat = task.category;
    catEl.textContent = task.category;
  }
  
  // 이미지 처리
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
  
  // 접근성 라벨 업데이트
  li.setAttribute('aria-label', `${task.title}, ${task.category} 카테고리, ${task.isDone ? '완료됨' : '미완료'}`);
}

/** 아이템 삭제 애니메이션 후 제거 */
export function removeTaskElement(taskId) {
  const li = dom.taskList.querySelector(`[data-id="${taskId}"]`);
  if (!li) return Promise.resolve();
  
  return new Promise(resolve => {
    li.classList.add('swipe-delete'); // CSS: animation: swipeOut 250ms forwards
    li.addEventListener('animationend', () => {
      li.remove();
      // 남은 아이템 체크
      if (dom.taskList.children.length === 0) toggleEmptyState(true);
      resolve();
    }, { once: true });
  });
}

/** 드래그 정렬 모드 진입/해제 */
export function setDragMode(enabled) {
  dom.taskList.classList.toggle('drag-mode', enabled);
  // 드래그 핸들 포커스 가능하게
  dom.taskList.querySelectorAll('.drag-handle').forEach(btn => {
    btn.tabIndex = enabled ? 0 : -1;
  });
}

/** 정렬 완료 후 DOM 순서 갱신 (데이터 배열 순서대로 재배치) */
export function reorderTaskElements(taskIds) {
  const fragment = document.createDocumentFragment();
  taskIds.forEach(id => {
    const li = dom.taskList.querySelector(`[data-id="${id}"]`);
    if (li) fragment.appendChild(li);
  });
  dom.taskList.appendChild(fragment);
  // order 데이터 속성 갱신
  [...dom.taskList.children].forEach((li, idx) => li.dataset.order = idx + 1);
}

// ==========================================================================
// 6. 토스트/알림 시스템
// ==========================================================================

/** 토스트 컨테이너 확보 (없으면 생성) */
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

/**
 * 토스트 표시
 * @param {string} message 
 * @param {'default'|'success'|'error'} type 
 * @param {number} duration 
 */
export function showToast(message, type = 'default', duration = 3000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? type : ''}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `<span>${message}</span><button type="button" aria-label="닫기">✕</button>`;
  
  toast.querySelector('button').onclick = () => toast.remove();
  
  container.appendChild(toast);
  
  // 강제 리플로우 후 애니메이션 트리거 (CSS: animation: slideUpFade)
  requestAnimationFrame(() => toast.style.opacity = '1');
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

// ==========================================================================
// 7. 완료/삭제 피드백 이펙트 (컨페티, 진동)
// ==========================================================================

/** 완료 시 컨페티 효과 (CSS 기반 경량) */
export function playConfetti(x, y) {
  const colors = ['#ff8a7a', '#7dd3a0', '#ffd166', '#a8d0e6', '#f8bbd0'];
  const count = 12; // 개수 제한 (성능)
  
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

/** 햅틱 피드백 (지원 기기만) */
export function vibrate(pattern = [50]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/** 삭제 시 진동 패턴 */
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
    // 애니메이션 후 제거 원하면 transitionend 처리
  }
}

// ==========================================================================
// 9. 이벤트 바인딩 헬퍼 (app.js에서 호출)
// ==========================================================================

/**
 * 상단 바 이벤트 바인딩
 * @param {Object} handlers 
 * @param {Function} handlers.onToggleDone 
 */
export function bindHeaderEvents(handlers) {
  if (!dom.btnToggleDone) cacheDom();
  dom.btnToggleDone.addEventListener('click', handlers.onToggleDone);
}

/**
 * FAB 이벤트 바인딩
 * @param {Function} onClick 
 */
export function bindFabEvent(onClick) {
  if (!dom.fab) cacheDom();
  dom.fab.addEventListener('click', onClick);
}

/**
 * 다이얼로그(폼) 이벤트 바인딩
 * @param {Object} handlers 
 * @param {Function} handlers.onSave 
 * @param {Function} handlers.onDelete 
 * @param {Function} handlers.onClose 
 * @param {Function} handlers.onCategoryChange 
 * @param {Function} handlers.onVoiceClick 
 * @param {Function} handlers.onCameraClick 
 * @param {Function} handlers.onImageClear 
 * @param {Function} handlers.onTitleInput 
 */
export function bindDialogEvents(handlers) {
  if (!dom.dialog) cacheDom();
  const { onSave, onDelete, onClose, onCategoryChange, onVoiceClick, onCameraClick, onImageClear, onTitleInput } = handlers;
  
  // 제출 (저장)
  dom.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dom.btnSaveTask.disabled) onSave();
  });
  
  // 닫기 버튼 / 백드롭 클릭
  dom.btnCloseDialog.addEventListener('click', onClose);
  dom.dialog.addEventListener('click', (e) => {
    if (e.target === dom.dialog) onClose(); // 백드롭 클릭 시
  });
  // ESC 키 닫기 (native dialog 자동 처리되지만 명시적 방지 로직 필요 시)
  
  // 카테고리 선택
  dom.categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => onCategoryChange(btn.dataset.cat));
  });
  
  // 음성 버튼
  dom.btnVoice.addEventListener('click', onVoiceClick);
  
  // 카메라 버튼 (파일 입력 트리거)
  dom.btnCamera.addEventListener('click', () => dom.inputCamera.click());
  dom.inputCamera.addEventListener('change', (e) => onCameraClick(e.target.files[0]));
  
  // 이미지 삭제 (커스텀 이벤트 위임)
  dom.imagePreview.addEventListener('image-cleared', onImageClear);
  
  // 삭제 버튼
  dom.btnDeleteTask.addEventListener('click', onDelete);
  
  // 입력 시 유효성 검사
  dom.taskTitleInput.addEventListener('input', onTitleInput);
}

/**
 * 리스트 이벤트 위임 (체크박스, 드래그, 메뉴)
 * @param {Object} handlers
 * @param {Function} handlers.onToggle
 * @param {Function} handlers.onDragStart
 * @param {Function} handlers.onMenuClick
 */
export function bindListEvents(handlers) {
  if (!dom.taskList) cacheDom();
  const { onToggle, onDragStart, onMenuClick } = handlers;
  
  dom.taskList.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = Number(li.dataset.id);
    
    // 체크박스 클릭
    if (e.target.matches('.task-checkbox')) {
      e.preventDefault(); // 라벨 클릭 시 중복 방지
      onToggle(id, !li.classList.contains('done'));
      return;
    }
    
    // 메뉴 버튼 클릭 (간단 구현: 바로 삭제 확인 or 컨텍스트 메뉴)
    if (e.target.matches('.task-menu-btn')) {
      e.stopPropagation();
      onMenuClick(id, e.target); // 버튼 엘리먼트 전달 (포지셔닝용)
      return;
    }
    
    // 콘텐츠 영역 클릭 -> 수정 모드 (선택 사항)
    if (e.target.closest('.task-content')) {
      // app.js에서 처리: onEditClick(id)
    }
  });
  
  // 드래그 앤 드롭 (네이티브 Drag API - 모바일 터치 대응 위해 Pointer Events 병행 권장)
  // 여기서는 데스크톱/마우스용 기본 Drag API 바인딩만 예시
  // 모바일 터치 드래그는 app.js에서 Pointer Events로 별도 구현 권장
  dom.taskList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.task-item');
    if (li) onDragStart(e, li);
  });
}

// ==========================================================================
// 10. 유틸리티
// ==========================================================================

/** 안전하게 요소 찾기 (캐시 미스 방지) */
export function $(selector) {
  if (!dom.taskList) cacheDom();
  return document.querySelector(selector);
}

/** 포커스 트랩 (모달 내부 포커스 순환) - 선택적 사용 */
export function trapFocus(element) {
  const focusable = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  
  element.addEventListener('keydown', function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
  return () => element.removeEventListener('keydown', handler);
}

// ==========================================================================
// 11. 초기화 (모듈 로드 시 즉시 실행)
// ==========================================================================
// DOMContentLoaded 이전에 import 될 수 있으므로 안전하게 캐싱만 지연
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cacheDom, { once: true });
} else {
  cacheDom();
}

// 개발 편의: 전역 노출 (콘솔 디버깅용)
if (typeof window !== 'undefined' && window.__DEV__) {
  window.UI = { 
    renderTaskList, openTaskDialog, closeTaskDialog, showToast, 
    playConfetti, vibrate, setDragMode 
  };
}