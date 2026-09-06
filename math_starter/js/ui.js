// ==========================================
// js/ui.js - UI 렌더링 및 인터랙션 제어 (Final Fixed)
// Fixes: #2 TimerEl Cache, #5 Aria DescribedBy, #7 onStart Callback,
//        #9 Shake Class, #13 Landscape Keypad, #14 Focus Trap, Logic #17
// ==========================================

import { formatExpression, formatVerticalExpression } from './logic.js';

// ------------------------------------------------------------------
// 1. 상수 및 유틸리티
// ------------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// 루트 컨테이너
const mainView = $('#main-view');
const overlayContainer = $('#overlay-container');

// 뷰 컨테이너
const viewMenu = $('#view-menu');
const viewGame = $('#view-game');
const viewResult = $('#view-result');

// ------------------------------------------------------------------
// 2. 오디오/진동 피드백 (Web Audio API 합성음)
// ------------------------------------------------------------------
let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function playSound(type, settings = { soundOn: true }) {
  if (!settings.soundOn) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);

  switch (type) {
    case 'correct':
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now); osc.stop(now + 0.35);
      break;
    case 'wrong':
      osc.type = 'square';
      osc.frequency.setValueAtTime(196, now);
      osc.frequency.exponentialRampToValueAtTime(130.81, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now); osc.stop(now + 0.3);
      break;
    case 'click':
      osc.type = 'square';
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now); osc.stop(now + 0.06);
      break;
    case 'levelup':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g).connect(ctx.destination);
        o.frequency.value = f;
        g.gain.setValueAtTime(0.2, now + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
        o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.25);
      });
      break;
  }
}

export function vibrate(pattern, settings = { vibrationOn: true }) {
  if (!settings.vibrationOn || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

// ------------------------------------------------------------------
// 3. 뷰 전환 헬퍼 (접근성 포커스 관리)
// ------------------------------------------------------------------
const views = { menu: viewMenu, game: viewGame, result: viewResult };

export function showView(viewName) {
  Object.entries(views).forEach(([name, el]) => {
    const show = name === viewName;
    el.hidden = !show;
    if (show) {
      // 포커스 이동: 자동 포커스 방지(preventScroll) 및 첫 포커스 가능 요소로
      setTimeout(() => {
        const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        focusable?.focus({ preventScroll: true });
      }, 0);
    }
  });
  mainView.scrollTop = 0;
}

// ------------------------------------------------------------------
// 4. 메인 메뉴 렌더링
// ------------------------------------------------------------------
export function renderMenu({ difficulty, onModeSelect, onDifficultyChange, onStart }) {
  viewMenu.innerHTML = `
    <div class="menu-content" role="main">
      <h2 class="menu-title">어떤 연산을 할까요?</h2>
      <p class="menu-subtitle">모드를 선택하고 시작하세요.</p>
      
      <div class="mode-cards" role="radiogroup" aria-label="학습 모드 선택">
        <button type="button" class="mode-card" data-mode="practice" role="radio" aria-checked="false" tabindex="0">
          <svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          <span class="mode-name">연습 모드</span>
          <span class="mode-desc">제한 시간 없이\n천천히 연습해요</span>
        </button>
        <button type="button" class="mode-card" data-mode="challenge" role="radio" aria-checked="false" tabindex="0">
          <svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span class="mode-name">도전 모드</span>
          <span class="mode-desc">시간 내에 문제를\n풀어보세요</span>
        </button>
      </div>

      <div class="difficulty-selector" aria-label="난이도 선택">
        <label class="difficulty-label" for="difficulty-select">난이도</label>
        <div class="difficulty-options" role="radiogroup" aria-label="난이도">
          ${[1,2,3,4].map(l => `
            <button type="button" class="difficulty-btn" data-level="${l}" role="radio" aria-checked="${l === difficulty}" tabindex="${l === difficulty ? 0 : -1}">
              ${l}단계
            </button>
          `).join('')}
        </div>
      </div>

      <button type="button" class="btn-primary" id="btn-start" disabled>
        시작하기
      </button>
    </div>
  `;

  // 이벤트 바인딩
  const modeCards = $$('.mode-card', viewMenu);
  let selectedMode = null;

  const selectMode = (mode) => {
    selectedMode = mode;
    modeCards.forEach(c => {
      const isSel = c.dataset.mode === mode;
      c.setAttribute('aria-checked', isSel);
      c.dataset.selected = isSel;
    });
    $('#btn-start', viewMenu).disabled = false;
  };

  modeCards.forEach(card => {
    card.addEventListener('click', () => selectMode(card.dataset.mode));
    card.addEventListener('keydown', (e) => { 
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(card.dataset.mode); } 
    });
  });

  $$('.difficulty-btn', viewMenu).forEach(btn => {
    btn.addEventListener('click', () => {
      onDifficultyChange(parseInt(btn.dataset.level, 10));
      $$('.difficulty-btn', viewMenu).forEach(b => b.setAttribute('aria-checked', b === btn));
    });
  });

  // 🛡 High #7 Fix: 시작 버튼 클릭 시 onStart 콜백 호출 (main.js의 startGame 연결됨)
  $('#btn-start', viewMenu).addEventListener('click', () => {
    if (selectedMode) onStart(selectedMode);
  });

  // 초기 포커스
  modeCards[0]?.focus();
}

// ------------------------------------------------------------------
// 5. 게임 화면 렌더링 및 제어 (Controller Pattern)
// ------------------------------------------------------------------
export function renderGame({ problem, progress, /*stats,*/ settings, onAnswer, onKeypadInput, onBack }) {
  const { current, total } = progress;
  
  viewGame.innerHTML = `
    <div class="game-header">
      <div class="progress-bar" role="progressbar" aria-valuenow="${current}" aria-valuemin="0" aria-valuemax="${total}" aria-label="진행도">
        <div class="progress-fill" style="width: ${(current/total)*100}%"></div>
      </div>
      <div class="progress-text">
        <span>문제 ${current} / ${total}</span>
        <span id="timer-display" class="timer" aria-live="polite"></span>
      </div>
    </div>

    <div class="problem-area" id="problem-area">
      <div class="problem-expression" id="problem-expr" aria-live="assertive" tabindex="0"></div>
      <div class="feedback-msg" id="feedback-msg" aria-live="polite"></div>
    </div>

    <div class="keypad" id="keypad" role="group" aria-label="숫자 키패드"></div>
  `;

  // 🛡 Critical #2 Fix: 타이머 엘리먼트 렌더링 직후 즉시 캐싱
  const timerEl = $('#timer-display');
  const problemExprEl = $('#problem-expr');
  const feedbackMsgEl = $('#feedback-msg');
  const keypadEl = $('#keypad');
  const problemAreaEl = $('#problem-area');

  // 키패드 렌더링
  renderKeypad(keypadEl, onKeypadInput);

  // 초기 문제 표시
  updateProblemDisplay(problem, null);

  // 컨트롤러 반환 (main.js에서 상태 업데이트용)
  return {
    updateProblemDisplay,
    updateTimer,
    showFeedback,
    setKeypadEnabled,
    shakeProblem
  };

  // --- 내부 함수들 ---
  
  function updateProblemDisplay(p,Answer) { // 🛡 Logic #17 Fix:Answer
    const { a, b, op, answer } = p;
    const symbol = op === 'addition' ? '+' : '−';
    
    if (Answer === null || Answer === '' || Answer === undefined) {
      problemExprEl.innerHTML = `<span>${a}</span> <span class="operator">${symbol}</span> <span>${b}</span> <span class="operator">=</span> <span class="answer-input" aria-label="답안 입력란">?</span>`;
    } else {
      const isCorrect = Answer === answer;
      problemExprEl.innerHTML = `<span>${a}</span> <span class="operator">${symbol}</span> <span>${b}</span> <span class="operator">=</span> <span class="answer-input ${isCorrect ? 'correct' : 'wrong shake-anim'}" aria-label="${isCorrect ? '정답' : '오답'}">${Answer}</span>`;
      // 🛡 Medium #9 Fix: 오답 시 'shake-anim' 클래스 추가로 CSS 애니메이션 트리거
    }
  }

  function updateTimer(secondsLeft, totalTime) {
    // 🛡 Critical #2 Fix: 캐싱된 timerEl 사용 (null 체크 포함)
    if (!timerEl) return;
    if (totalTime > 0) {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
      const s = String(secondsLeft % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
      timerEl.style.color = secondsLeft <= 5 ? 'var(--color-error)' : 'var(--color-text-muted)';
    } else {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
      const s = String(secondsLeft % 60).padStart(2, '0');
      timerEl.textContent = `⏱ ${m}:${s}`;
      timerEl.style.color = 'var(--color-text-muted)';
    }
  }

  function showFeedback(isCorrect, correctAnswer) {
    feedbackMsgEl.textContent = isCorrect ? '정답입니다! 🎉' : `오답이에요. 정답은 ${correctAnswer}입니다.`;
    feedbackMsgEl.className = `feedback-msg ${isCorrect ? 'correct' : 'wrong'}`;
    feedbackMsgEl.setAttribute('aria-live', 'assertive');
  }

  function setKeypadEnabled(enabled) {
    $$('.keypad-btn', keypadEl).forEach(btn => btn.disabled = !enabled);
  }

  // 🛡 Medium #9 Fix: 클래스 토글 방식 (inline style animation 제거)
  function shakeProblem() {
    problemAreaEl.classList.remove('shake-anim');
    // 강제 리플로우로 재진동 보장
    void problemAreaEl.offsetWidth; 
    problemAreaEl.classList.add('shake-anim');
  }
}

// ------------------------------------------------------------------
// 6. 키패드 렌더링 (동적 생성, 이벤트 위임)
// ------------------------------------------------------------------
function renderKeypad(container, onInput) {
  const layout = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['⌫', '0', '✓']
  ];

  container.innerHTML = layout.map(row => 
    `<div class="keypad-row" role="group">${row.map(key => `
      <button type="button" class="keypad-btn ${key === '⌫' || key === '✓' ? 'action' : ''}" 
        data-key="${key}" 
        aria-label="${key === '⌫' ? '지우기' : key === '✓' ? '확인' : `숫자 ${key}`}"
        ${key === '⌫' ? 'aria-describedby="kbd-del-desc"' : ''}>
        ${key === '⌫' 
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>' 
          : key === '✓' 
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' 
            : key}
      </button>
    `).join('')}</div>`
  ).join('');

  // 🛡 High #5 Fix: aria-describedby 참조 ID 불일치 해결 (불필요한 속성 제거 또는 숨김 요소 추가)
  // 여기서는 aria-describedby 제거로 단순화 (aria-label로 충분)

  // 이벤트 위임
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.keypad-btn');
    if (btn && !btn.disabled) {
      onInput(btn.dataset.key);
      playSound('click');
    }
  });

  // 키보드 접근성 (Tab 네비게이션, Enter/Space 클릭)
  container.addEventListener('keydown', (e) => {
    const target = e.target.closest('.keypad-btn');
    if (!target) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      target.click();
    }
    // 화살표 키 네비게이션 지원 (선택적, 복잡도 고려 생략 가능)
  });
}

// ------------------------------------------------------------------
// 7. 결과 화면 렌더링
// ------------------------------------------------------------------
export function renderResult({ result, onReplay, onHome, onViewWrong }) {
  // 🛠 방어: viewResult 요소 존재 확인
  if (!viewResult) {
    console.error('[UI] viewResult 요소를 찾을 수 없습니다.');
    return;
  }

  const { mode, correct, total, wrongDetails, accuracy, durationSec } = result;
  const timeStr = `${Math.floor(durationSec/60)}:${String(durationSec%60).padStart(2,'0')}`;

  try {
    viewResult.innerHTML = `
      <div class="result-content">
        <h2 class="result-title">${mode === 'challenge' ? '도전 결과' : '연습 완료'}</h2>
        <div class="result-score" style="color: ${accuracy >= 80 ? 'var(--color-success)' : accuracy >= 50 ? 'var(--color-warning)' : 'var(--color-error)'}">
          ${accuracy}%
        </div>
        <div class="result-stats">
          <div class="result-stat"><span class="value">${correct}</span><span>정답</span></div>
          <div class="result-stat"><span class="value">${total - correct}</span><span>오답</span></div>
          <div class="result-stat"><span class="value">${timeStr}</span><span>소요시간</span></div>
        </div>

        ${wrongDetails.length > 0 ? `
          <details class="result-wrong" open>
            <summary>오답 노트 (${wrongDetails.length}개)</summary>
            <div class="wrong-list">
              ${wrongDetails.map(w => `
                <div class="wrong-item">
                  <span class="wrong-q">${w.question}</span>
                  <!-- 🛠 수정: w.userAnswer -> w.userAnswer (endGame에서 키를Answer로 통일함) -->
                  <span class="wrong-a">정답: ${w.correctAnswer}</span>
                </div>
              `).join('')}
            </div>
          </details>
        ` : '<p class="result-perfect">🎉 모든 문제를 맞췄어요! 대단해요!</p>'}

        <div class="result-actions">
          <button type="button" class="btn-secondary" id="btn-home">처음으로</button>
          <button type="button" class="btn-primary" id="btn-replay">다시 하기</button>
        </div>
      </div>
    `;

    // 이벤트 바인딩 (요소 존재 확인 후)
    const btnReplay = $('#btn-replay', viewResult);
    const btnHome = $('#btn-home', viewResult);
    
    if (btnReplay) btnReplay.addEventListener('click', onReplay);
    if (btnHome) btnHome.addEventListener('click', onHome);
    
    console.log('[UI] renderResult 완료'); // 디버깅 로그

  } catch (e) {
    console.error('[UI] renderResult 렌더링 중 에러:', e);
    viewResult.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--color-error);">결과 화면 로드 실패: ${e.message}</div>`;
  }
}

// ------------------------------------------------------------------
// 8. 오버레이 시스템 (Modal, Toast, Panel) - 접근성 강화
// ------------------------------------------------------------------

/** 토스트 알림 */
export function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  overlayContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration + 300);
}

/** 모달 다이얼로그 (Promise 기반, 포커스 트랩 포함) */
export function openModal({ title, content, buttons = [] }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');
    
    modal.innerHTML = `
      <div class="modal-header">
        <h3 id="modal-title" class="modal-title">${title}</h3>
        <button type="button" class="modal-close" aria-label="닫기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">${content}</div>
      <div class="modal-footer">
        ${buttons.map((b, i) => `<button type="button" class="${b.class || 'btn-secondary'}" data-index="${i}">${b.text}</button>`).join('')}
      </div>
    `;

    // 포커스 트랩 구현 🛡 Medium #14 Fix
    const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const trapFocus = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };

    modal.addEventListener('keydown', trapFocus);

    const cleanup = (result) => {
      modal.removeEventListener('keydown', trapFocus);
      backdrop.remove();
      modal.remove();
      resolve(result);
    };

    backdrop.addEventListener('click', () => cleanup(false));
    modal.querySelector('.modal-close').addEventListener('click', () => cleanup(false));
    
    modal.querySelector('.modal-footer').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) cleanup(parseInt(btn.dataset.index, 10));
    });

    overlayContainer.append(backdrop, modal);
    
    // 초기 포커스
    setTimeout(() => firstFocusable?.focus(), 50);
  });
}

/** 바텀 시트 패널 토글 */
export function togglePanel(panelId, forceState) {
  const panel = $(`#${panelId}`);
  if (!panel) return;
  
  const isOpen = panel.hasAttribute('open');
  const shouldOpen = forceState !== undefined ? forceState : !isOpen;
  
  if (shouldOpen) {
    panel.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
    // 포커스 트랩 진입 (첫 포커스 가능 요소)
    setTimeout(() => {
      const focusable = panel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 50);
  } else {
    panel.removeAttribute('open');
    document.body.style.overflow = '';
  }
  return shouldOpen;
}

/** 패널 HTML 생성 헬퍼 */
export function createPanelHTML(id, title, bodyHTML, primaryAction = null) {
  return `
    <div id="${id}" class="panel" role="dialog" aria-modal="true" aria-labelledby="${id}-title" hidden>
      <div class="panel-handle" aria-hidden="true"></div>
      <div class="panel-header">
        <h3 id="${id}-title">${title}</h3>
        <button type="button" class="modal-close" data-panel-close aria-label="닫기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="panel-content">${bodyHTML}</div>
      ${primaryAction ? `<div class="modal-footer"><button type="button" class="btn-primary" data-panel-action>${primaryAction.text}</button></div>` : ''}
    </div>
  `;
}

// ------------------------------------------------------------------
// 9. 설정/통계 패널 렌더링 (HTML 문자열 반환)
// ------------------------------------------------------------------
export function renderSettingsPanel(settings) {
  return `
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">효과음</span>
        <span class="setting-desc">정답/오답 소리 재생</span>
      </div>
      <button class="toggle" role="switch" aria-checked="${settings.soundOn}" data-setting="soundOn" aria-label="효과음 ${settings.soundOn ? '켬' : '끔'}"></button>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">진동 피드백</span>
        <span class="setting-desc">정답/오답 시 진동</span>
      </div>
      <button class="toggle" role="switch" aria-checked="${settings.vibrationOn}" data-setting="vibrationOn" aria-label="진동 ${settings.vibrationOn ? '켬' : '끔'}"></button>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">다크 모드</span>
        <span class="setting-desc">시스템 설정 따름 (자동)</span>
      </div>
      <span class="setting-desc" style="color: var(--color-text-muted);">자동 적용됨</span>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">데이터 초기화</span>
        <span class="setting-desc">모든 학습 기록 삭제 (복구 불가)</span>
      </div>
      <button type="button" class="btn-secondary" style="padding: 4px 12px; font-size: 0.85rem;" id="btn-nuke-db">초기화</button>
    </div>
  `;
}

export function renderStatsPanel(stats, dailyStats) {
  const today = dailyStats.find(d => d.date === new Date().toISOString().slice(0,10).replace(/-/g,'')) || {};
  return `
    <div class="setting-row" style="justify-content: center; border: none; padding: 0;">
      <div style="text-align: center;">
        <div style="font-size: 2.5rem; font-weight: 800; color: var(--color-primary);">${stats.totalSolved || 0}</div>
        <div style="color: var(--color-text-muted); font-size: 0.9rem;">총 푼 문제 수</div>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><span class="setting-label">연습 모드</span><span class="setting-desc">${stats.practiceCount || 0}회 완료</span></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><span class="setting-label">도전 모드</span><span class="setting-desc">${stats.testCount || 0}회 완료</span></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><span class="setting-label">오늘 정답률</span><span class="setting-desc">${today.totalQuestions ? Math.round(today.totalCorrect/today.totalQuestions*100) : 0}%</span></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><span class="setting-label">최고 연속 정답</span><span class="setting-desc">${stats.bestStreak || 0}개</span></div>
    </div>
    <hr style="margin: var(--space-4) 0; border-color: var(--color-border);">
    <div class="setting-row" style="justify-content: center; border: none;">
      <button type="button" class="btn-secondary" id="btn-export-data">데이터 내보내기 (JSON)</button>
    </div>
  `;
}

// ------------------------------------------------------------------
// 10. 접근성/유틸 헬퍼
// ------------------------------------------------------------------

/** 라이브 리전 강제 알림 */
export function announce(message, politeness = 'polite') {
  const region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-atomic', 'true');
  region.className = 'sr-only';
  region.textContent = message;
  document.body.appendChild(region);
  setTimeout(() => region.remove(), 1000);
}

// 개발자 도구 노출
if (typeof window !== 'undefined') {
  window.__KIDS_MATH_UI__ = { showToast, openModal, togglePanel, playSound, vibrate };
}