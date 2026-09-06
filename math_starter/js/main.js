// ==========================================
// js/main.js - App Entry Point & State Controller (Final Fixed v2)
// Fix: bootstrap에서 showMenuView() 호출 누락 수정 (화면 안 뜨던 버그)
// ==========================================

import { initDB, SettingsDB, HistoryDB, StatsDB, DBUtil } from './db.js';
import { 
  generateProblem, 
  generateProblemSet, 
  checkAnswer, 
  calculateAccuracy,
  getChallengeConfig,
  getRecommendedPracticeCount,
  shouldLevelUp,
  formatExpression, 
  DIFFICULTY_SPECS
} from './logic.js';
import { 
  showView, 
  renderMenu, 
  renderGame, 
  renderResult, 
  showToast, 
  openModal, 
  togglePanel, 
  createPanelHTML,
  renderSettingsPanel,
  renderStatsPanel,
  playSound, 
  vibrate, 
  announce 
} from './ui.js';

// ------------------------------------------------------------------
// 1. 전역 상태
// ------------------------------------------------------------------
const State = {
  settings: null,
  session: {
    mode: null, type: 'mixed', difficulty: 1, problems: [], currentIndex: 0,
    answers: [], startTime: 0, problemStartTime: 0, timerInterval: null,
    elapsedSec: 0, isAnswering: false, currentInput: '',
  },
  uiController: null,
  elements: {},
  _pendingMenuAction: null
};

// ------------------------------------------------------------------
// 2. 초기화 및 부팅 시퀀스
// ------------------------------------------------------------------
async function bootstrap() {
  try {
    // 1. DB 초기화
    const dbReady = await initDB();
    if (!dbReady) {
      throw new Error('데이터베이스(IndexedDB) 초기화에 실패했습니다.\n시크릿/개인정보 보호 모드를 해제하거나 브라우저 설정을 확인해주세요.');
    }

    // 2. 설정 로드 및 적용
    State.settings = await SettingsDB.get();
    applySettings(State.settings);

    // 3. DOM 캐싱 및 이벤트 바인딩
    cacheElements();
    bindGlobalEvents();
    listenForSWUpdate();
    
    // 4. 라우팅 이벤트 등록
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handlePopState);
    
    // 5. 🛠 핵심 수정: 최초 진입 시 메뉴 렌더링 함수 명시적 호출
    // handleHashChange() 대신 showMenuView()를 호출해야 renderMenu()가 실행됩니다.
    showMenuView();
    
    console.log('[App] 부팅 완료');
    
  } catch (err) {
    console.error('[App] 치명적 오류:', err);
    throw err; // index.html catch 블록으로 전파
  }
}

// ------------------------------------------------------------------
// 3. 설정 적용
// ------------------------------------------------------------------
function applySettings(settings) {
  const unlockAudio = () => {
    playSound('click', settings); 
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
}

// ------------------------------------------------------------------
// 4. DOM 캐싱 및 글로벌 이벤트
// ------------------------------------------------------------------
function cacheElements() {
  State.elements = {
    btnSettings: document.getElementById('btn-settings'),
    btnStats: document.getElementById('btn-stats'),
    overlayContainer: document.getElementById('overlay-container'),
    app: document.getElementById('app')
  };
}

function bindGlobalEvents() {
  const { btnSettings, btnStats, overlayContainer } = State.elements;
  btnSettings?.addEventListener('click', () => openSettingsPanel());
  btnStats?.addEventListener('click', () => openStatsPanel());
  overlayContainer?.addEventListener('click', (e) => { if (e.target === overlayContainer) closeAllPanels(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAllPanels(); const b = document.querySelector('.modal-backdrop'); if (b) b.click(); } });
  window.addEventListener('db:versionchange', () => showToast('데이터 구조가 업데이트되었습니다. 새로고침 해주세요.', 5000));
}

// ------------------------------------------------------------------
// 5. 라우팅 시스템
// ------------------------------------------------------------------
function navigate(view, replace = false) {
  const url = `#${view}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  handleHashChange();
}

function handlePopState() { handleHashChange(); }

function handleHashChange() {
  const hash = location.hash.slice(1); 
  const [route, ...params] = hash.split('?');
  
  // 게임 중 이탈 방지
  if (State.session.mode && route !== 'game' && route !== 'result') {
    if (!confirm('진행 중인 게임이 있습니다. 정말 나가시겠습니까?')) {
      history.replaceState(null, '', '#game');
      return;
    }
    cleanupGameSession();
  }

  switch (route) {
    case 'menu':
      // 메뉴 라우팅 진입 시: 이미 렌더링된 메뉴 뷰만 표시
      showView('menu');
      break;
    case 'game':
      if (!State.session.mode) showView('menu');
      break;
    case 'result':
      break;
    case 'settings':
      openSettingsPanel();
      history.replaceState(null, '', '#menu');
      break;
    case 'stats':
      openStatsPanel();
      history.replaceState(null, '', '#menu');
      break;
    case 'mode=practice':
    case 'mode=challenge':
      const mode = route.split('=')[1];
      State._pendingMenuAction = { mode };
      showView('menu'); // 메뉴 뷰 표시 후 pending 액션 처리
      break;
    default:
      // 빈 해시('') 또는 알 수 없는 라우트 -> 메뉴로 리다이렉트 (히스토리 교체)
      navigate('menu', true);
      break;
  }
}

// ------------------------------------------------------------------
// 6. 메뉴 화면 렌더링 (최초 1회 호출됨)
// ------------------------------------------------------------------
function showMenuView() {
  cleanupGameSession();
  State.session = { 
    ...State.session, mode: null, problems: [], currentIndex: 0, answers: [],
    problemStartTime: 0, elapsedSec: 0, timerInterval: null, isAnswering: false, currentInput: ''
  };
  
  // 1. 메뉴 HTML 렌더링 (view-menu 채우기)
  renderMenu({
    difficulty: State.settings.difficulty,
    onModeSelect: (mode) => { },
    onDifficultyChange: (level) => changeDifficulty(level),
    onStart: startGame
  });
  
  // 2. PWA Shortcut 예약 액션 처리
  if (State._pendingMenuAction) {
    const { mode } = State._pendingMenuAction;
    State._pendingMenuAction = null;
    requestAnimationFrame(() => {
      const startBtn = document.getElementById('btn-start');
      const modeCard = document.querySelector(`.mode-card[data-mode="${mode}"]`);
      if (modeCard) modeCard.click();
      if (startBtn) startBtn.click();
    });
  }
  
  // 3. 라우팅 동기화 (히스토리 푸시 -> hashchange -> handleHashChange('menu') -> showView('menu'))
  navigate('menu', false);
}

async function changeDifficulty(level) {
  State.settings.difficulty = level;
  State.settings = await SettingsDB.put(State.settings);
  
  document.querySelectorAll('.difficulty-btn').forEach(b => {
    const isSelected = b.dataset.level == level;
    b.setAttribute('aria-checked', isSelected);
    // 💡 키보드 포커스 이동을 위해 tabindex 동기화
    b.setAttribute('tabindex', isSelected ? '0' : '-1'); 
  });
}

// ------------------------------------------------------------------
// 7. 게임 세션 로직 (이하 기존 로직 동일)
// ------------------------------------------------------------------
async function startGame(mode) {
  State.session.mode = mode;
  State.session.difficulty = State.settings.difficulty;
  State.session.type = State.settings.questionType || 'mixed';
  
  const count = mode === 'challenge' 
    ? getChallengeConfig(State.session.difficulty).questionCount 
    : getRecommendedPracticeCount(State.session.difficulty);
  
  State.session.problems = generateProblemSet(count, State.session.difficulty, State.session.type);
  State.session.currentIndex = 0;
  State.session.answers = [];
  State.session.startTime = Date.now();
  State.session.elapsedSec = 0;
  State.session.isAnswering = false;
  State.session.currentInput = '';

  const firstProblem = State.session.problems[0];
  State.session.problemStartTime = Date.now();
  
  State.uiController = renderGame({
    problem: firstProblem,
    progress: { current: 1, total: count },
    stats: { correct: 0 },
    settings: State.settings,
    onKeypadInput: handleKeypadInput,
    onBack: () => navigate('menu')
  });

  navigate('game', true);
  showView('game');

  if (mode === 'challenge') startChallengeTimer();
  else startPracticeTimer();
}

function handleKeypadInput(key) {
  if (State.session.isAnswering) return;
  const { currentInput } = State.session;
  if (key === '⌫') State.session.currentInput = currentInput.slice(0, -1);
  else if (key === '✓') { handleSubmitAnswer(); return; }
  else if (/^\d$/.test(key) && currentInput.length < 3) State.session.currentInput += key;
  
  const problem = State.session.problems[State.session.currentIndex];
  State.uiController.updateProblemDisplay(problem, State.session.currentInput || null);
}

async function handleSubmitAnswer() {
  if (State.session.isAnswering) return;
  const input = State.session.currentInput;
  if (input === '') { showToast('답을 입력해주세요'); return; }

  State.session.isAnswering = true;
  State.uiController.setKeypadEnabled(false);
  
  const problem = State.session.problems[State.session.currentIndex];
  const Answer = parseInt(input, 10); 
  const result = checkAnswer(problem, Answer);
  
  const timeSpent = Math.floor((Date.now() - State.session.problemStartTime) / 1000);

  State.session.answers.push({
    problem: { ...problem },
    Answer, // 변수명 일치 (Answer)
    isCorrect: result.correct,
    timeSpent
  });

  State.uiController.showFeedback(result.correct, problem.answer);
  playSound(result.correct ? 'correct' : 'wrong', State.settings);
  vibrate(result.correct ? [50] : [100, 50, 100], State.settings);
  announce(result.correct ? '정답입니다' : `오답입니다. 정답은 ${problem.answer}입니다`, 'assertive');

  State.uiController.updateProblemDisplay(problem, Answer);

  setTimeout(() => proceedToNext(), 1200);
}

function proceedToNext() {
  State.session.currentIndex++;
  State.session.currentInput = '';
  State.session.isAnswering = false;
  
  if (State.session.currentIndex >= State.session.problems.length) {
    endGame();
    return;
  }

  // 🛠 수정 1: 도전 모드 타이머 리셋 및 재시작
  if (State.session.mode === 'challenge') {
    stopTimer();
    startChallengeTimer();
  }

  // 다음 문제 시작 시간 기록
  State.session.problemStartTime = Date.now();

  const nextProblem = State.session.problems[State.session.currentIndex];
  const correctCount = State.session.answers.filter(a => a.isCorrect).length;
  
  State.uiController.updateProblemDisplay(nextProblem, null);
  State.uiController.setKeypadEnabled(true);
  
  // 🛠 수정 2: 진행바 업데이트 - firstChild 대신 querySelector('span') 사용
  const fill = document.querySelector('.progress-fill');
  const textEl = document.querySelector('.progress-text');
  
  if (fill) fill.style.width = `${((State.session.currentIndex + 1) / State.session.problems.length) * 100}%`;
  
  // 🛠 핵심 수정: firstChild(텍스트 노드) 대신 첫 번째 span 요소 선택
  const problemTextSpan = textEl?.querySelector('span:first-child'); // 또는 textEl.children[0]
  if (problemTextSpan) {
    problemTextSpan.textContent = `문제 ${State.session.currentIndex + 1} / ${State.session.problems.length}`;
  }
}

async function endGame() {
  console.log('[Game] endGame 진입');
  
  stopTimer();
  
  if (State.uiController) {
    State.uiController.setKeypadEnabled(false);
  }
  
  const answers = State.session.answers;
  const correct = answers.filter(a => a.isCorrect).length;
  const total = answers.length;
  const accuracy = calculateAccuracy(correct, total);
  const durationSec = Math.floor((Date.now() - State.session.startTime) / 1000);
  
  // 🛠 수정: a.userAnswer -> a.Answer (저장된 키 이름과 일치시킴)
  const wrongDetails = answers.filter(a => !a.isCorrect).map(a => ({
    // formatExpression에도 a.Answer 전달
    question: formatExpression(a.problem, false, a.Answer), 
   Answer: a.Answer,      // 🛠 키 통일: a.Answer 사용
    correctAnswer: a.problem.answer
  }));

  const finishedMode = State.session.mode;

  const resultData = {
    mode: finishedMode,
    type: State.session.type,
    difficulty: State.session.difficulty,
    correct,
    total,
    accuracy,
    durationSec,
    wrongDetails,
    answers: answers.map(a => ({
      q: formatExpression(a.problem, false, a.Answer), // 🛠 여기수 a.Answer
      a: a.problem.answer,
      ua: a.Answer,      // 🛠 여기도 a.Answer
      c: a.isCorrect,
      t: a.timeSpent
    }))
  };

  // 1. DB 저장 (백그라운드 처리)
  HistoryDB.add({
    mode: finishedMode, type: State.session.type, difficulty: State.session.difficulty,
    totalQuestions: total, correctCount: correct,
    wrongQuestions: resultData.answers.filter(x => !x.c).map(x => ({ q: x.q, a: x.a, ua: x.ua })),
    durationSec
  }).catch(e => { console.error('[Game] History 저장 실패:', e); showToast('기록 저장 실패'); });
  
  StatsDB.incrementDaily({
    [finishedMode === 'challenge' ? 'testCount' : 'practiceCount']: 1,
    totalCorrect: correct, totalQuestions: total, totalTimeSec: durationSec
  }).catch(e => console.error('[Game] Stats 저장 실패:', e));

  // 2. 화면 전환 선행
  try {
    navigate('result', true);
    showView('result');
    console.log('[Game] 화면 전환 완료');
  } catch (e) {
    console.error('[Game] 화면 전환 실패:', e);
  }

  // 3. 결과 화면 렌더링
  try {
    renderResult({
      result: resultData,
      onReplay: () => startGame(finishedMode),
      onHome: () => navigate('menu'),
      onViewWrong: () => {}
    });
    console.log('[Game] 결과 화면 렌더링 완료');
  } catch (e) {
    console.error('[Game] 렌더링 에러:', e);
    if (viewResult) viewResult.innerHTML = `<div style="padding:2rem; color:var(--color-error);">결과 표시 오류: ${e.message}</div>`;
  }

  // 4. 세션 정리
  State.session.mode = null;
  State.uiController = null;
}

// ------------------------------------------------------------------
// 8. 타이머 관리
// ------------------------------------------------------------------
function startChallengeTimer() {
  const config = getChallengeConfig(State.session.difficulty);
  let timeLeft = config.timeLimitPerQuestion;
  State.uiController.updateTimer(timeLeft, config.timeLimitPerQuestion);
  State.session.timerInterval = setInterval(() => {
    timeLeft--;
    State.uiController.updateTimer(timeLeft, config.timeLimitPerQuestion);
    if (timeLeft <= 0 && !State.session.isAnswering) { State.session.currentInput = ''; handleSubmitAnswer(); }
  }, 1000);
}

function startPracticeTimer() {
  State.session.timerInterval = setInterval(() => { State.session.elapsedSec++; State.uiController.updateTimer(State.session.elapsedSec, 0); }, 1000);
}

function stopTimer() { if (State.session.timerInterval) { clearInterval(State.session.timerInterval); State.session.timerInterval = null; } }
function cleanupGameSession() { stopTimer(); State.session.isAnswering = false; State.uiController = null; }

// ------------------------------------------------------------------
// 9. 패널 관리
// ------------------------------------------------------------------
function closeAllPanels() { document.querySelectorAll('.panel[open]').forEach(p => { p.removeAttribute('open'); document.body.style.overflow = ''; }); }

async function openSettingsPanel() {
  const existing = document.getElementById('panel-settings');
  if (existing?.hasAttribute('open')) { togglePanel('panel-settings', false); return; }
  const html = createPanelHTML('panel-settings', '설정', renderSettingsPanel(State.settings), null);
  State.elements.overlayContainer.insertAdjacentHTML('beforeend', html);
  const panel = document.getElementById('panel-settings');
  panel.querySelectorAll('.toggle').forEach(toggle => { toggle.addEventListener('click', async () => { const key = toggle.dataset.setting; const newVal = toggle.getAttribute('aria-checked') !== 'true'; toggle.setAttribute('aria-checked', newVal); toggle.setAttribute('aria-label', `${key === 'soundOn' ? '효과음' : '진동'} ${newVal ? '켬' : '끔'}`); State.settings[key] = newVal; await SettingsDB.update({ [key]: newVal }); playSound('click', State.settings); }); });
  panel.querySelector('#btn-nuke-db')?.addEventListener('click', async () => { const confirmed = await openModal({ title: '데이터 초기화', content: '<p>모든 학습 기록과 설정이 삭제됩니다. 복구할 수 없습니다.</p><p>정말 진행하시겠습니까?</p>', buttons: [{ text: '취소', class: 'btn-secondary' }, { text: '삭제', class: 'btn-primary' }] }); if (confirmed === 1) { await DBUtil.nuke(); showToast('데이터가 초기화되었습니다. 앱을 다시 시작합니다.'); setTimeout(() => location.reload(), 1000); } });
  panel.querySelector('[data-panel-close]')?.addEventListener('click', () => togglePanel('panel-settings', false));
  togglePanel('panel-settings', true);
}

async function openStatsPanel() {
  const existing = document.getElementById('panel-stats');
  if (existing?.hasAttribute('open')) { togglePanel('panel-stats', false); return; }
  const [history, dailyStats] = await Promise.all([HistoryDB.getRecent(50), StatsDB.getRecentDays(30)]);
  const statsSummary = calculateStatsSummary(history);
  const html = createPanelHTML('panel-stats', '학습 통계', renderStatsPanel(statsSummary, dailyStats), null);
  State.elements.overlayContainer.insertAdjacentHTML('beforeend', html);
  const panel = document.getElementById('panel-stats');
  panel.querySelector('[data-panel-close]')?.addEventListener('click', () => togglePanel('panel-stats', false));
  panel.querySelector('#btn-export-data')?.addEventListener('click', async () => { const allHistory = await HistoryDB.getRecent(10000); const allStats = await StatsDB.getRecentDays(365); const settings = await SettingsDB.get(); exportJSON({ history: allHistory, stats: allStats, settings, exportedAt: new Date().toISOString() }); });
  togglePanel('panel-stats', true);
}

function calculateStatsSummary(history) {
  const totalSolved = history.reduce((s, h) => s + h.totalQuestions, 0);
  const totalCorrect = history.reduce((s, h) => s + h.correctCount, 0);
  const practiceCount = history.filter(h => h.mode === 'practice').length;
  const testCount = history.filter(h => h.mode === 'challenge').length;
  let bestStreak = 0, current = 0;
  [...history].reverse().forEach(h => { if (h.correctCount === h.totalQuestions && h.totalQuestions > 0) current++; else current = 0; if (current > bestStreak) bestStreak = current; });
  return { totalSolved, totalCorrect, practiceCount, testCount, bestStreak };
}

function exportJSON(data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `kids-math-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); showToast('데이터가 다운로드되었습니다.'); }

// ------------------------------------------------------------------
// 10. SW 업데이트 알림
// ------------------------------------------------------------------
function listenForSWUpdate() { window.addEventListener('sw:update', (e) => showUpdateToast(e.detail)); }
function showUpdateToast(reg) { const toast = document.createElement('div'); toast.className = 'toast'; toast.style.maxWidth = '90%'; toast.innerHTML = `새 버전이 있습니다. <button class="btn-primary" style="margin-left:8px; padding:2px 8px; font-size:0.8rem;" id="sw-refresh">새로고침</button>`; State.elements.overlayContainer.appendChild(toast); toast.querySelector('#sw-refresh').addEventListener('click', () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); window.location.reload(); }); setTimeout(() => toast.remove(), 10000); }

// ------------------------------------------------------------------
// 11. 전역 에러 핸들링 & 시작
// ------------------------------------------------------------------
window.addEventListener('error', (e) => console.error('[Global Error]', e.error));
window.addEventListener('unhandledrejection', (e) => { console.error('[Unhandled Rejection]', e.reason); e.preventDefault(); });

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', bootstrap); } else { bootstrap(); }

if (typeof window !== 'undefined') { window.__KIDS_MATH_APP__ = { State, startGame, showMenuView, openSettingsPanel, openStatsPanel, navigate }; }