/**
 * app.js - Main Application Controller (Android Only, Fully Patched)
 * 초등 TODO 앱: 상태 관리, 이벤트 바인딩, 비즈니스 로직 통합
 * @module app
 */

import { db } from './db.js';
import * as UI from './ui.js';

// ==========================================================================
// 1. 전역 상태 (Module Scope Singleton)
// ==========================================================================
const State = {
  tasks: [],           // Task[] (order 정렬됨)
  showDone: true,      // 완료된 일 표시 여부
  isOnline: navigator.onLine,
  
  // Form State
  formMode: 'add',     // 'add' | 'edit'
  editingTaskId: null,
  currentCategory: '🎒',
  currentImageBlob: null,   // File/Blob 원본 (DB 저장용)
  currentImageUrl: null,    // Object URL (미리보기용)
  currentVoiceBlob: null,   // 음성 메모 (미구현 시 null)
  
  // Voice Recognition (Standard API Only)
  recognition: null,
  isListening: false,
  
  // Drag & Drop State
  dragItem: null,      // 드래그 중인 LI 요소
  dragStartY: 0,
  dragStartIndex: 0,
  scrollInterval: null,
  
  // PWA
  deferredPrompt: null,
};

// ==========================================================================
// 2. 초기화 (Entry Point) - 순서 중요!
// ==========================================================================
async function init() {
  console.log('[App] Initializing... (Android Mode)');
  
  // [핵심 패치] 0. DOM 캐싱 강제 실행 (이벤트 바인딩 전 필수)
  // ui.js의 자동 실행 코드 제거로 인해 반드시 먼저 호출해야 함.
  UI.initializeDOM();
  
  // 1. UI 이벤트 바인딩 (이제 dom.fab 확실히 존재함)
  bindAllEvents();
  
  // 2. 딥링크/바로가기 처리 (초기 라우팅 - 렌더링 전 실행)
  handleDeepLink();
  
  // 3. 음성 인식 초기화 (이제 UI.$('#btn-voice') 정상 동작 보장)
  initSpeechRecognition();
  
  // 4. PWA 설치 이벤트 리스닝
  initPwaInstall();
  
  // 5. Service Worker 업데이트 감시
  initSwUpdateListener();
  
  // 6. 온라인/오프라인 감시
  initNetworkListener();
  
  // 7. 초기 데이터 로드 및 렌더링
  await loadTasks();
  
  console.log('[App] Ready!');
}

// DOMContentLoaded 보장 (모듈 스크립트는 defer 동작하므로 보통 준비됨)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

// ==========================================================================
// 3. 데이터 로드 & 렌더링
// ==========================================================================
async function loadTasks() {
  try {
    State.tasks = await db.getAll(); // order ASC 정렬되어 옴
    render();
  } catch (e) {
    console.error('[App] Load failed:', e);
    UI.showToast('데이터를 불러오지 못했어요 😢', 'error');
    render(); // 빈 상태라도 UI는 그려줌
  }
}

function render() {
  UI.renderTaskList(State.tasks, State.showDone);
  // 툴바 버튼 상태 동기화
  const btnToggle = UI.$('#btn-toggle-done');
  if (btnToggle) {
    btnToggle.setAttribute('aria-pressed', State.showDone);
    btnToggle.textContent = State.showDone ? '📂' : '📁';
  }
}

// ==========================================================================
// 4. 이벤트 바인딩 통합
// ==========================================================================
function bindAllEvents() {
  // Header
  UI.bindHeaderEvents({
    onToggleDone: toggleShowDone,
  });
  
  // FAB
  UI.bindFabEvent(() => openForm('add'));
  
  // Dialog (Form)
  UI.bindDialogEvents({
    onSave: handleSave,
    onDelete: handleDeleteConfirm,
    onClose: closeForm,
    onCategoryChange: (cat) => { 
	  State.currentCategory = cat; 
	  UI.setActiveCategory(cat); // [추가] UI 시각적 갱신 호출
	},
    onVoiceClick: toggleVoice,
    onCameraClick: handleFileSelect,
    onImageClear: clearImage,
    onTitleInput: () => UI.validateForm(),
  });
  
  // List (Delegation)
  UI.bindListEvents({
    onToggle: handleToggleDone,
    onDragStart: handleDragStart,
    onMenuClick: showContextMenu,
  });
  
  // 터치 드래그 바인딩 (모바일/안드로이드 대응 - Pointer Events)
  bindTouchDrag();
  
  // 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openForm('add'); }
  });
}

// ==========================================================================
// 5. 딥링크/바로가기 처리 (Manifest Shortcuts 지원)
// ==========================================================================
function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const filter = params.get('filter');
  
  // URL 정리 (히스토리에서 쿼리 제거하여 재실행 시 중복 방지)
  if (action || filter) {
    history.replaceState(null, '', './');
  }
  
  // 렌더링 완료 후 모달 열기 위해 약간의 딜레이
  if (action === 'add') {
    setTimeout(() => UI.openTaskDialog('add'), 300);
  } else if (filter === 'done') {
    State.showDone = true;
    // render()는 loadTasks 이후 호출되므로 여기선 상태만 변경
  }
}

// ==========================================================================
// 6. CRUD 핵심 로직
// ==========================================================================

// --- CREATE / UPDATE ---
async function handleSave() {
  // [Patch] 안전한 DOM 접근: UI.$는 내부적으로 cacheDom 호출하므로 null 안전
  const titleInput = UI.$('#task-title');
  if (!titleInput) {
    console.error('[App] Title input element not found');
    UI.vibrateError();
    return;
  }
  
  const title = titleInput.value.trim();
  if (!title) return UI.vibrateError();
  
  const payload = {
    title,
    category: State.currentCategory,
    isDone: false,
    imageBlob: State.currentImageBlob,
    imageType: State.currentImageBlob?.type || null,
  };
  
  UI.vibrateSuccess();
  
  try {
    if (State.formMode === 'edit' && State.editingTaskId) {
      // UPDATE
      await db.update(State.editingTaskId, payload);
      const updated = await db.get(State.editingTaskId);
      if (!updated) throw new Error('Updated task not found');
      
      // 이미지 URL 재생성 (기존 URL 해제됨)
      const imgUrl = updated.imageBlob ? URL.createObjectURL(updated.imageBlob) : null;
      UI.updateTaskElement(updated, imgUrl);
      UI.showToast('수정되었어요 ✨', 'success');
    } else {
      // CREATE
      const newId = await db.add(payload);
      
      // [Patch] 낙관적 UI 검증: DB에서 다시 읽어와 실제 저장 확인
      const newTask = await db.get(newId);
      if (!newTask) throw new Error('Created task not found after insert');
      
      const imgUrl = newTask.imageBlob ? URL.createObjectURL(newTask.imageBlob) : null;
      UI.prependTask(newTask, imgUrl);
      
      // [핵심 수정] State 배열에 추가해야 handleToggleDone 등에서 찾음
      State.tasks.unshift(newTask); 
      
      // 컨페티 중앙 발사
      UI.playConfetti(window.innerWidth / 2, window.innerHeight / 2);
      UI.showToast('추가되었어요! 🎉', 'success');
    }
    closeForm();
  } catch (e) {
    console.error('[App] Save failed:', e);
    UI.showToast('저장 실패: ' + e.message, 'error');
    UI.vibrateError();
  }
}

// --- READ (Toggle Done) ---
async function handleToggleDone(id, newDoneState) {
  const task = State.tasks.find(t => t.id === id);
  if (!task) {
    // State에 없으면(이론상 불가능) 체크박스만 되돌림
    const checkbox = UI.$(`[data-id="${id}"] .task-checkbox`);
    if (checkbox) checkbox.checked = !newDoneState;
    return;
  }
  
  // 옵티미스틱 UI: State 즉시 업데이트 (UI는 이미 브라우저가 바꿔놨음)
  task.isDone = newDoneState;
  // UI.updateTaskElement 호출 시 클래스(.done) 등 부가 효과만 적용
  const imgUrl = task.imageBlob ? URL.createObjectURL(task.imageBlob) : null;
  UI.updateTaskElement(task, imgUrl); // .done 클래스 토글, aria 등 갱신
  UI.vibrate(task.isDone ? [30, 20, 30] : [50]);
  
  // 완료 시 컨페티
  if (task.isDone) {
    const checkboxEl = UI.$(`[data-id="${id}"] .task-checkbox`);
    if (checkboxEl) {
      const rect = checkboxEl.getBoundingClientRect();
      UI.playConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
    }
  }
  
  try {
    await db.update(id, { isDone: newDoneState });
  } catch (e) {
    // [핵심] DB 실패 시: State 롤백 + 체크박스 시각적 롤백 + UI 클래스 롤백
    task.isDone = !newDoneState;
    const checkboxEl = UI.$(`[data-id="${id}"] .task-checkbox`);
    if (checkboxEl) checkboxEl.checked = !newDoneState; // 체크박스 강제 되돌리기
    UI.updateTaskElement(task, imgUrl); // .done 클래스 제거 등
    UI.showToast('상태 변경 실패', 'error');
    UI.vibrateError();
  }
}

// --- DELETE ---
function handleDeleteConfirm() {
  if (!State.editingTaskId) return;
  
  const id = State.editingTaskId;
  const task = State.tasks.find(t => t.id === id);
  if (!task) return;
  
  // 1. UI에서 즉시 제거 (애니메이션)
  UI.removeTaskElement(id).then(() => {
    // 2. DB 삭제
    db.delete(id).catch(e => {
      console.error('[App] Delete failed:', e);
      UI.showToast('삭제 실패 - 새로고침 필요', 'error');
      loadTasks(); // 실패 시 전체 리로드로 동기화 맞춤
    });
  });
  
  // 3. 토스트 알림 (Undo 패턴 미구현 시 단순 알림)
  UI.showToast('삭제되었어요 🗑️', 'success', 5000);
  UI.vibrateDelete();
  
  closeForm();
}

// --- REORDER (Drag & Drop 완료 후) ---
async function commitReorder(newIds) {
  const updates = newIds.map((id, idx) => ({ id, order: idx + 1 }));
  try {
    await db.reorder(updates);
    // [Patch] State.tasks 배열 순서 동기화 (필터 토글 시 안전)
    State.tasks.sort((a, b) => a.order - b.order);
    // DOM은 UI.reorderTaskElements에서 이미 맞춰짐. render() 불필요.
  } catch (e) {
    console.error('[App] Reorder failed:', e);
    UI.showToast('순서 저장 실패', 'error');
    loadTasks(); // 실패 시 전체 다시 로드하여 동기화
  }
}

// ==========================================================================
// 7. 폼(다이얼로그) 제어
// ==========================================================================
function openForm(mode, task = null) {
  State.formMode = mode;
  State.editingTaskId = task?.id || null;
  State.currentCategory = task?.category || '🎒';
  State.currentImageBlob = task?.imageBlob || null;
  State.currentImageUrl = task?.imageBlob ? URL.createObjectURL(task.imageBlob) : null;
  
  // 음성 인식 중이면 중단
  if (State.isListening) stopVoice();
  
  UI.openTaskDialog(mode, task);
  
  // 프리뷰 이미지 있으면 표시 (UI.openTaskDialog 내부에서 초기화 후 호출되므로 안전)
  if (State.currentImageUrl) {
    const preview = UI.$('#image-preview');
    if (preview) {
      let img = preview.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '첨부된 사진';
        preview.prepend(img);
      }
      img.src = State.currentImageUrl;
      preview.classList.remove('hidden');
    }
  }
}

function closeForm() {
  // Object URL 해제 (메모리 누수 방지)
  if (State.currentImageUrl) {
    URL.revokeObjectURL(State.currentImageUrl);
  }
  State.currentImageBlob = null;
  State.currentImageUrl = null;
  State.currentVoiceBlob = null;
  State.editingTaskId = null;
  State.formMode = 'add';
  
  UI.closeTaskDialog();
}

// ==========================================================================
// 8. 폼 필드 핸들러 (이미지, 음성, 카테고리)
// ==========================================================================

// --- 이미지 처리 (리사이즈 + 압축) ---
async function handleFileSelect(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    UI.showToast('이미지 파일만 가능해요', 'error');
    return;
  }
  
  UI.showToast('사진 처리 중... ⏳', 'default', 2000);
  
  try {
    const resizedBlob = await resizeImage(file, 800, 0.7);
    State.currentImageBlob = resizedBlob;
    State.currentImageUrl = URL.createObjectURL(resizedBlob);
    
    // UI 즉시 반영
    const preview = UI.$('#image-preview');
    if (preview) {
      let img = preview.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '첨부된 사진';
        preview.prepend(img);
      }
      img.src = State.currentImageUrl;
      preview.classList.remove('hidden');
    }
    
    UI.showToast('사진 추가됨! 📷', 'success');
    UI.vibrateSuccess();
  } catch (e) {
    console.error('[App] Image resize failed:', e);
    UI.showToast('사진 처리 실패', 'error');
    // [Patch] 에러 시 상태 정리 (이전 이미지 잔상 방지)
    clearImage();
  }
}

function clearImage() {
  if (State.currentImageUrl) URL.revokeObjectURL(State.currentImageUrl);
  State.currentImageBlob = null;
  State.currentImageUrl = null;
  // UI 프리뷰 숨김은 UI.image-cleared 이벤트 또는 직접 호출로 처리
  const preview = UI.$('#image-preview');
  if (preview) preview.classList.add('hidden');
  UI.vibrate([20]);
}

/** 이미지 리사이즈 헬퍼 (Canvas) */
function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      
      if (width > height) {
        if (width > maxDim) { height *= maxDim / width; width = maxDim; }
      } else {
        if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(resolve, file.type, quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// --- 음성 인식 (Standard SpeechRecognition Only) ---
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('[App] SpeechRecognition 미지원 브라우저');
    const btnVoice = UI.$('#btn-voice');
    if (btnVoice) btnVoice.style.display = 'none';
    return;
  }
  
  State.recognition = new SpeechRecognition();
  State.recognition.lang = 'ko-KR';
  State.recognition.interimResults = true;
  State.recognition.continuous = false;
  
  State.recognition.onstart = () => {
    State.isListening = true;
    UI.setVoiceListening(true);
    UI.vibrate([30]);
  };
  
  State.recognition.onresult = (e) => {
    const input = UI.$('#task-title');
    if (!input) return;
    
    let finalTranscript = '';
    let interimTranscript = '';
    
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += transcript;
      else interimTranscript += transcript;
    }
    
    // 기존 값 유지하며 추가 (수정 모드 고려: 플레이스홀더성 텍스트 제거 로직 단순화)
    const baseText = State.editingTaskId ? input.value : '';
    input.value = baseText + finalTranscript + interimTranscript;
    UI.validateForm();
  };
  
  State.recognition.onerror = (e) => {
    console.error('[Speech] Error:', e.error);
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      UI.showToast(`음성 인식 오류: ${e.error}`, 'error');
    }
  };
  
  State.recognition.onend = () => {
    State.isListening = false;
    UI.setVoiceListening(false);
  };
}

function toggleVoice() {
  if (!State.recognition) return;
  if (State.isListening) stopVoice();
  else startVoice();
}

function startVoice() {
  try {
    State.recognition.start();
  } catch (e) {
    if (e.name !== 'InvalidStateError') console.error(e);
  }
}

function stopVoice() {
  try {
    State.recognition.stop();
  } catch (e) { /* 무시 */ }
}

// ==========================================================================
// 9. 드래그 앤 드롭 (Pointer Events - 터치/마우스 통합)
// ==========================================================================

function bindTouchDrag() {
  const list = UI.$('#task-list');
  if (!list) return;
  
  list.addEventListener('pointerdown', onDragPointerDown, { passive: false });
  document.addEventListener('pointermove', onDragPointerMove, { passive: false });
  document.addEventListener('pointerup', onDragPointerUp);
  document.addEventListener('pointercancel', onDragPointerUp);
}

function onDragPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  
  const item = handle.closest('.task-item');
  if (!item) return;
  
  e.preventDefault();
  item.setPointerCapture(e.pointerId);
  
  State.dragItem = item;
  State.dragStartY = e.clientY;
  State.dragStartIndex = [...list.children].indexOf(item);
  
  item.classList.add('dragging');
  UI.vibrate([20]);
}

function onDragPointerMove(e) {
  if (!State.dragItem) return;
  e.preventDefault();
  
  const deltaY = e.clientY - State.dragStartY;
  State.dragItem.style.transform = `translateY(${deltaY}px)`;
  State.dragItem.style.zIndex = 100;
  State.dragItem.style.boxShadow = 'var(--shadow-card)';
  
  autoScroll(e.clientY);
  checkReorder(e.clientY);
}

function onDragPointerUp(e) {
  if (!State.dragItem) return;
  
  try { State.dragItem.releasePointerCapture(e.pointerId); } catch(_) {}
  
  State.dragItem.style.transform = '';
  State.dragItem.style.zIndex = '';
  State.dragItem.style.boxShadow = '';
  State.dragItem.classList.remove('dragging');
  
  clearInterval(State.scrollInterval);
  State.scrollInterval = null;
  
  const list = UI.$('#task-list');
  if (list) {
    const newIds = [...list.children].map(li => Number(li.dataset.id));
    commitReorder(newIds);
  }
  
  State.dragItem = null;
  State.dragStartIndex = -1;
}

function autoScroll(clientY) {
  const list = UI.$('#task-list');
  if (!list) return;
  
  const rect = list.getBoundingClientRect();
  const threshold = 60;
  const speed = 15;
  
  clearInterval(State.scrollInterval);
  
  if (clientY < rect.top + threshold) {
    State.scrollInterval = setInterval(() => list.scrollTop -= speed, 16);
  } else if (clientY > rect.bottom - threshold) {
    State.scrollInterval = setInterval(() => list.scrollTop += speed, 16);
  }
}

function checkReorder(clientY) {
  const list = UI.$('#task-list');
  if (!list) return;
  
  const items = [...list.children].filter(li => li !== State.dragItem);
  
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    
    if (clientY < centerY) {
      if (item.previousElementSibling !== State.dragItem) {
        list.insertBefore(State.dragItem, item);
        UI.vibrate([10]);
      }
      break;
    } else if (item === items[items.length - 1]) {
      if (item.nextElementSibling !== State.dragItem) {
        list.insertBefore(State.dragItem, item.nextElementSibling);
        UI.vibrate([10]);
      }
    }
  }
}

// 데스크톱용 네이티브 Drag API 폴백
function handleDragStart(e, item) {
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', item.dataset.id);
}

// ==========================================================================
// 10. UI 액션 핸들러 (헤더, 메뉴 등)
// ==========================================================================

function toggleShowDone() {
  State.showDone = !State.showDone;
  render();
  UI.showToast(State.showDone ? '끝난 일 보기 📂' : '끝난 일 숨기기 📁', 'default', 1500);
}

function showContextMenu(taskId, buttonEl) {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = `
    position: fixed; background: var(--color-card); border-radius: var(--radius-md);
    box-shadow: var(--shadow-card); padding: var(--space-xs); z-index: 200;
    border: 1px solid var(--color-border); min-width: 140px;
  `;
  
  const rect = buttonEl.getBoundingClientRect();
  const menuWidth = 160;
  let left = rect.left - menuWidth + buttonEl.offsetWidth;
  if (left < 10) left = 10;
  if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
  
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${left}px`;
  
  const actions = [
    { label: '✏️ 수정', action: () => editTask(taskId) },
    { label: '🗑️ 삭제', action: () => deleteTaskDirect(taskId), danger: true },
  ];
  
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.setAttribute('role', 'menuitem');
    btn.style.cssText = `
      width: 100%; padding: var(--space-sm) var(--space-md); border: none; background: none;
      text-align: left; font: inherit; font-size: var(--font-size-base); cursor: pointer;
      border-radius: var(--radius-sm); color: ${a.danger ? 'var(--color-danger)' : 'var(--color-text)'};
    `;
    btn.onmouseenter = () => btn.style.background = 'var(--color-border)';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    btn.onclick = () => { a.action(); document.body.removeChild(menu); };
    menu.appendChild(btn);
  });
  
  document.body.appendChild(menu);
  
  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function editTask(id) {
  const task = State.tasks.find(t => t.id === id);
  if (task) openForm('edit', task);
}

async function deleteTaskDirect(id) {
  const task = State.tasks.find(t => t.id === id);
  if (!task) return;
  
  await UI.removeTaskElement(id);
  try {
    await db.delete(id);
    UI.showToast('삭제되었어요 🗑️', 'success');
    UI.vibrateDelete();
  } catch (e) {
    loadTasks();
    UI.showToast('삭제 실패', 'error');
  }
}

// ==========================================================================
// 11. PWA 설치 프롬프트 (안드로이드 WebAPK/TWA 호환)
// ==========================================================================
function initPwaInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    State.deferredPrompt = e;
    setTimeout(() => {
      UI.showToast('🏠 홈 화면에 추가하면 앱처럼 쓸 수 있어요!', 'success', 8000);
    }, 5000);
  });
  
  window.addEventListener('appinstalled', () => {
    State.deferredPrompt = null;
    UI.showToast('설치 완료! 🎉', 'success');
  });
}

export async function promptInstall() {
  if (State.deferredPrompt) {
    State.deferredPrompt.prompt();
    const { outcome } = await State.deferredPrompt.userChoice;
    if (outcome === 'accepted') UI.showToast('설치 진행 중...', 'success');
    State.deferredPrompt = null;
  } else {
    UI.showToast('이미 설치되었거나 지원되지 않아요', 'default');
  }
}

// ==========================================================================
// 12. Service Worker 업데이트 감지
// ==========================================================================
function initSwUpdateListener() {
  if (!('serviceWorker' in navigator)) return;
  
  let refreshing = false;
  
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  
  setInterval(() => navigator.serviceWorker.ready.then(reg => reg.update()), 1000 * 60 * 30);
  
  navigator.serviceWorker.ready.then(reg => {
    if (reg.waiting) showUpdateToast(reg.waiting);
    
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(newWorker);
          }
        });
      }
    });
  });
}

function showUpdateToast(worker) {
  UI.showToast('🎉 새 버전이 준비되었어요!', 'success', 0);
  
  const container = UI.$('.toast-container');
  const toast = container?.lastElementChild;
  if (toast && !toast.querySelector('.update-btn')) {
    const btn = document.createElement('button');
    btn.className = 'update-btn';
    btn.textContent = '지금 적용';
    btn.style.marginLeft = 'var(--space-md)';
    btn.style.padding = 'var(--space-xs) var(--space-sm)';
    btn.style.borderRadius = 'var(--radius-sm)';
    btn.style.border = '1px solid currentColor';
    btn.style.background = 'transparent';
    btn.style.color = 'inherit';
    btn.style.font = 'inherit';
    btn.onclick = () => {
      worker.postMessage('SKIP_WAITING');
      btn.disabled = true;
      btn.textContent = '적용 중...';
    };
    toast.appendChild(btn);
  }
}

// ==========================================================================
// 13. 네트워크 상태 감시
// ==========================================================================
function initNetworkListener() {
  const updateOnlineStatus = () => {
    const wasOffline = !State.isOnline;
    State.isOnline = navigator.onLine;
    UI.showOfflineBanner(!State.isOnline);
    
    if (wasOffline && State.isOnline) {
      UI.showToast('🌐 온라인으로 돌아왔어요!', 'success');
    }
  };
  
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  
  UI.showOfflineBanner(!State.isOnline);
}

// ==========================================================================
// 14. 개발 편의: 전역 디버깅 네임스페이스
// ==========================================================================
if (typeof window !== 'undefined' && window.__DEV__) {
  window.App = {
    state: State,
    db,
    UI,
    loadTasks,
    render,
    promptInstall,
  };
}