// ==========================================================================
// utils/ui-helpers.js - Toast, Confirm, Modal Helpers
// ==========================================================================

// -------------------------------------------------------------------------
// 1. DOM References & Constants
// -------------------------------------------------------------------------
const TOAST_CONTAINER_ID = 'toast-container';
const MODAL_ROOT_ID = 'modal-root';

/** @type {HTMLElement} */
let toastContainer = null;
/** @type {HTMLElement} */
let modalRoot = null;

/** 초기화: DOM 요소 캐싱 */
function ensureContainers() {
  if (!toastContainer) {
    toastContainer = document.getElementById(TOAST_CONTAINER_ID);
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = TOAST_CONTAINER_ID;
      toastContainer.className = 'toast-container';
      toastContainer.setAttribute('aria-live', 'polite');
      toastContainer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(toastContainer);
    }
  }
  if (!modalRoot) {
    modalRoot = document.getElementById(MODAL_ROOT_ID);
    if (!modalRoot) {
      modalRoot = document.createElement('div');
      modalRoot.id = MODAL_ROOT_ID;
      modalRoot.className = 'modal-root';
      modalRoot.setAttribute('inert', '');
      document.body.appendChild(modalRoot);
    }
  }
}

// -------------------------------------------------------------------------
// 2. Toast (알림 메시지)
// -------------------------------------------------------------------------

/**
 * 토스트 메시지 표시
 * @param {string} message - 표시할 메시지
 * @param {'success'|'error'|'info'|'warning'} [type='info'] - 타입 (스타일 분기)
 * @param {number} [duration=3000] - 자동 닫힘 시간(ms), 0 또는 false면 수동 닫기만
 * @returns {HTMLElement} 생성된 토스트 요소 (수동 제어용)
 */
export function showToast(message, type = 'info', duration = 3000) {
  ensureContainers();
  
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  
  // 아이콘 SVG (인라인, 타입별)
  const icons = {
    success: `<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error: `<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    warning: `<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    info: `<svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  };

  toast.innerHTML = `
    ${icons[type] || icons.info}
    <div class="toast__message">${message}</div>
    <button class="toast__close" aria-label="닫기">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  `;

  // 닫기 버튼 이벤트
  const closeBtn = toast.querySelector('.toast__close');
  closeBtn.addEventListener('click', () => removeToast(toast));

  // 컨테이너에 추가 (맨 위에 쌓이도록 prepend)
  toastContainer.prepend(toast);

  // 강제 리플로우 후 'show' 클래스로 진입 애니메이션 트리거
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 자동 제거 타이머
  let timer = null;
  if (duration && duration > 0) {
    timer = setTimeout(() => removeToast(toast), duration);
  }

  // 마우스 호버 시 타이머 일시정지 (UX 향상)
  toast.addEventListener('mouseenter', () => timer && clearTimeout(timer));
  toast.addEventListener('mouseleave', () => {
    if (duration && duration > 0) timer = setTimeout(() => removeToast(toast), 1000);
  });

  return toast;
}

/** 토스트 요소 제거 (애니메이션 후 DOM 삭제) */
function removeToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  // CSS animation: slideOut 0.3s
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  // 폴백: 애니메이션 미지원 브라우저 대비
  setTimeout(() => toast.remove(), 350);
}

// -------------------------------------------------------------------------
// 3. Modal (범용 모달 시스템)
// -------------------------------------------------------------------------

/** 현재 열린 모달 인스턴스 추적 (스택 구조로 중첩 지원 가능하나 여기선 싱글톤) */
let currentModal = null;
/** 포커스 트랩용 이전 활성 요소 */
let previouslyFocusedElement = null;

/**
 * 모달 열기
 * @param {Object} options
 * @param {string} options.title - 모달 타이틀
 * @param {string|HTMLElement} options.content - 본문 내용 (HTML 문자열 또는 DOM 노드)
 * @param {Object} [options.footer] - 푸터 액션 { primary: { text, handler, variant }, secondary: { text, handler } }
 * @param {'sm'|'md'|'lg'|'xl'|'full'} [options.size='md'] - 크기
 * @param {boolean} [options.closeOnBackdrop=true] - 백드롭 클릭 시 닫기
 * @param {boolean} [options.closeOnEsc=true] - ESC 키 시 닫기
 * @param {Function} [options.onClose] - 닫힐 때 콜백
 * @param {Function} [options.onOpen] - 열릴 때 콜백 (포커스 설정 등)
 * @returns {Promise<HTMLElement>} 모달 요소 (닫히면 resolve)
 */
export function openModal({
  title = '',
  content = '',
  footer = null,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  onClose = null,
  onOpen = null
}) {
  ensureContainers();
  
  return new Promise((resolve) => {
    // 1. 모달 엘리먼트 생성
    const modalEl = document.createElement('div');
    modalEl.className = `modal modal--${size}`;
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', `modal-title-${Date.now()}`);
    
    const titleId = modalEl.getAttribute('aria-labelledby');
    
    // 푸터 버튼 HTML 생성
    let footerHtml = '';
    if (footer) {
      const primary = footer.primary ? `<button class="btn btn-${footer.primary.variant || 'primary'}" data-action="modal-primary">${footer.primary.text}</button>` : '';
      const secondary = footer.secondary ? `<button class="btn btn-secondary" data-action="modal-secondary">${footer.secondary.text}</button>` : '';
      footerHtml = `<div class="modal__footer">${secondary}${primary}</div>`;
    }

    modalEl.innerHTML = `
      <div class="modal__header">
        <h3 id="${titleId}" class="modal__title">${title}</h3>
        <button class="modal__close" data-action="modal-close" aria-label="모달 닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal__body">${typeof content === 'string' ? content : ''}</div>
      ${footerHtml}
    `;

    // content가 DOM 노드면 본문에 추가
    if (content instanceof Node) {
      const bodyEl = modalEl.querySelector('.modal__body');
      bodyEl.innerHTML = '';
      bodyEl.appendChild(content);
    }

    // 2. 백드롭 생성
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.appendChild(modalEl);
    
    // 3. 모달 루트에 추가
    modalRoot.appendChild(backdrop);
    modalRoot.removeAttribute('inert'); // 접근성: 모달 열리면 inert 해제
    document.body.style.overflow = 'hidden'; // 배경 스크롤 잠금

    // 4. 포커스 관리
    previouslyFocusedElement = document.activeElement;
    const focusableElements = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    // 5. 이벤트 핸들러 정의
    const closeModal = (result) => {
      // 애니메이션 아웃
      backdrop.classList.remove('open');
      modalEl.classList.remove('open');
      
      const cleanup = () => {
        backdrop.remove();
        modalRoot.setAttribute('inert', '');
        document.body.style.overflow = '';
        currentModal = null;
        
        // 포커스 복원
        if (previouslyFocusedElement) previouslyFocusedElement.focus();
        previouslyFocusedElement = null;
        
        if (onClose) onClose(result);
        resolve(result);
      };

      // transitionend 대기 후 정리
      backdrop.addEventListener('transitionend', cleanup, { once: true });
      // 폴백
      setTimeout(cleanup, 350);
    };

    // 백드롭 클릭
    if (closeOnBackdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal(false);
      });
    }

    // 버튼 액션 위임
    modalEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      const action = btn.dataset.action;
      if (action === 'modal-close' || action === 'modal-secondary') {
        closeModal(false);
      } else if (action === 'modal-primary') {
        // primary 핸들러가 Promise 반환 시 기다렸다 닫기
        const handler = footer?.primary?.handler;
        if (handler) {
          const result = handler(closeModal);
          if (result instanceof Promise) {
            result.then((shouldClose) => { if (shouldClose !== false) closeModal(true); });
          } else if (result !== false) {
            closeModal(true);
          }
        } else {
          closeModal(true);
        }
      }
    });

    // ESC 키
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && closeOnEsc) {
        closeModal(false);
      }
      // 포커스 트랩 (Tab 키)
      if (e.key === 'Tab' && focusableElements.length > 0) {
        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault(); lastFocusable.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault(); firstFocusable.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // 6. 열기 애니메이션 트리거
    currentModal = { close: closeModal, element: modalEl };
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      modalEl.classList.add('open');
      // 포커스 이동
      if (firstFocusable) firstFocusable.focus();
      if (onOpen) onOpen(modalEl);
    });
  });
}

/**
 * 현재 열린 모달 강제 닫기
 * @param {*} result - 반환값
 */
export function closeModal(result = null) {
  if (currentModal) {
    currentModal.close(result);
  }
}

/**
 * 확인 다이얼로그 (Promise 기반)
 * @param {string} message - 본문 메시지
 * @param {string} [title='확인'] - 타이틀
 * @param {Object} [options] - 추가 옵션
 * @returns {Promise<boolean>} 확인 시 true, 취소 시 false
 */
export function showConfirm(message, title = '확인', options = {}) {
  return openModal({
    title,
    content: `<p class="confirm__message">${message}</p>`,
    footer: {
      secondary: { text: options.cancelText || '취소', handler: () => false },
      primary: { text: options.confirmText || '확인', variant: options.danger ? 'danger' : 'primary', handler: () => true }
    },
    size: 'sm',
    closeOnBackdrop: false,
    closeOnEsc: true,
    ...options
  });
}

/**
 * 알림 다이얼로그 (확인 버튼만)
 * @param {string} message 
 * @param {string} [title='알림']
 * @returns {Promise<void>}
 */
export function showAlert(message, title = '알림') {
  return openModal({
    title,
    content: `<p class="confirm__message">${message}</p>`,
    footer: {
      primary: { text: '확인', handler: () => true }
    },
    size: 'sm'
  });
}

// -------------------------------------------------------------------------
// 4. Loading Overlay (전역 로딩 표시 - 선택적)
// -------------------------------------------------------------------------
let loadingOverlay = null;
let loadingCount = 0;

export function showLoading(message = '처리 중...') {
  ensureContainers();
  loadingCount++;
  if (loadingOverlay) {
    loadingOverlay.querySelector('.loading__text').textContent = message;
    return;
  }
  
  loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  loadingOverlay.innerHTML = `
    <div class="loading__spinner"></div>
    <p class="loading__text">${message}</p>
  `;
  document.body.appendChild(loadingOverlay);
  requestAnimationFrame(() => loadingOverlay.classList.add('show'));
}

export function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0 && loadingOverlay) {
    loadingOverlay.classList.remove('show');
    loadingOverlay.addEventListener('transitionend', () => loadingOverlay.remove(), { once: true });
    setTimeout(() => loadingOverlay?.remove(), 350);
    loadingOverlay = null;
  }
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__UI__ = { showToast, showConfirm, showAlert, openModal, closeModal, showLoading, hideLoading };
}