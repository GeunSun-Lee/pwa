<script>
// ===== 1. Configuration & Constants =====
const CONFIG = {
  DB_NAME: 'MathPracticeDB_v3',
  STORES: { history: 'history', profile: 'profile', settings: 'settings' },
  DB_VERSION: 3,
  TOTAL_QUESTIONS_DEFAULT: 20,
  LEVELS: {
	1: { name: '1단계', max: 10, ops: ['+', '-'], carry: false, desc: '10까지, 받아올림/내림 없음' },
	2: { name: '2단계', max: 20, ops: ['+', '-'], carry: true, desc: '20까지, 받아올림/내림 있음' },
	3: { name: '3단계', max: 99, ops: ['+', '-'], carry: true, desc: '100까지, 두 자리 수' }
  },
  BADGES: [
	{ id: 'first_perfect', name: '첫 100점', desc: '처음으로 100점 달성', icon: '💯' },
	{ id: 'streak_5', name: '5연속 정답', desc: '한 세트에서 5개 연속 정답', icon: '🔥' },
	{ id: 'streak_10', name: '10연속 정답', desc: '한 세트에서 10개 연속 정답', icon: '⚡' },
	{ id: 'speed_demon', name: '속도왕', desc: '평균 3초 이내 정답 (20문제)', icon: '🚀' },
	{ id: 'level1_master', name: '1단계 마스터', desc: '1단계 100점 3회 달성', icon: '🌱' },
	{ id: 'level2_master', name: '2단계 마스터', desc: '2단계 100점 3회 달성', icon: '🌿' },
	{ id: 'level3_master', name: '3단계 마스터', desc: '3단계 100점 3회 달성', icon: '🌳' },
	{ id: 'week_warrior', name: '주간 전사', desc: '7일 연속 출석', icon: '📅' },
	{ id: 'hundred_solver', name: '백문백답', desc: '누적 100문제 풀이', icon: '📝' },
	{ id: 'thousand_solver', name: '천문천답', desc: '누적 1000문제 풀이', icon: '📚' },
	{ id: 'night_owl', name: '올빼미형', desc: '오후 10시 이후 문제 풀이', icon: '🦉' },
	{ id: 'early_bird', name: '아침형 인간', desc: '오전 7시 이전 문제 풀이', icon: '🐦' },
  ],
  CHARACTER_STAGES: [
	{ name: '알', minExp: 0, svg: getEggSVG },
	{ name: '아기 공룡', minExp: 50, svg: getBabyDinoSVG },
	{ name: '청소년 공룡', minExp: 200, svg: getTeenDinoSVG },
	{ name: '성체 공룡', minExp: 500, svg: getAdultDinoSVG },
	{ name: '전설의 용', minExp: 1000, svg: getDragonSVG },
  ],
  PARENT_PIN: '1234' // 실제 서비스 시 별도 설정 화면 필요
};

// ===== 2. Utility Functions =====
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const formatTime = (sec) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
const todayKey = () => new Date().toISOString().split('T')[0];
const nowISO = () => new Date().toISOString();

function showToast(msg, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }

// ===== 3. IndexedDB Wrapper =====
const dbPromise = (() => {
  return new Promise((resolve, reject) => {
	const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
	req.onupgradeneeded = (e) => {
	  const db = e.target.result;
	  if (!db.objectStoreNames.contains(CONFIG.STORES.history)) {
		const h = db.createObjectStore(CONFIG.STORES.history, { keyPath: 'id' });
		h.createIndex('date', 'date', { unique: false });
		h.createIndex('level', 'level', { unique: false });
	  }
	  if (!db.objectStoreNames.contains(CONFIG.STORES.profile)) {
		db.createObjectStore(CONFIG.STORES.profile, { keyPath: 'key' });
	  }
	  if (!db.objectStoreNames.contains(CONFIG.STORES.settings)) {
		db.createObjectStore(CONFIG.STORES.settings, { keyPath: 'key' });
	  }
	};
	req.onsuccess = (e) => resolve(e.target.result);
	req.onerror = (e) => { console.error('DB Open Error', e.target.error); resolve(null); };
	req.onblocked = () => showToast('데이터베이스 업데이트 필요: 다른 탭을 닫아주세요.', 'error');
  });
})();

async function dbGet(store, key) {
  const db = await dbPromise; if (!db) return undefined;
  return new Promise((res, rej) => {
	const req = db.transaction(store).objectStore(store).get(key);
	req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
async function dbPut(store, val) {
  const db = await dbPromise; if (!db) return;
  return new Promise((res, rej) => {
	const req = db.transaction(store, 'readwrite').objectStore(store).put(val);
	req.onsuccess = () => res(); req.onerror = () => rej(req.error);
  });
}
async function dbGetAll(store, indexName, query) {
  const db = await dbPromise; if (!db) return [];
  return new Promise((res, rej) => {
	const tx = db.transaction(store, 'readonly');
	const storeRef = tx.objectStore(store);
	const req = indexName ? storeRef.index(indexName).getAll(query) : storeRef.getAll();
	req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
async function dbDelete(store, key) {
  const db = await dbPromise; if (!db) return;
  return new Promise((res, rej) => {
	const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
	req.onsuccess = () => res(); req.onerror = () => rej(req.error);
  });
}
async function dbClear(store) {
  const db = await dbPromise; if (!db) return;
  return new Promise((res, rej) => {
	const req = db.transaction(store, 'readwrite').objectStore(store).clear();
	req.onsuccess = () => res(); req.onerror = () => rej(req.error);
  });
}

// ===== 4. Audio & Haptics (Phase 1) =====
let audioCtx = null;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playTone(freq, type, dur, vol = 0.1, delay = 0) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, audioCtx.currentTime + delay);
  g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + dur);
  o.start(audioCtx.currentTime + delay); o.stop(audioCtx.currentTime + delay + dur);
}

// 캐시(currentSettings) 직접 참조로 동기 처리
function playSound(type) {
  if (!currentSettings.sound) return;
  initAudio();
  switch(type) {
	case 'correct': playTone(523.25, 'sine', 0.1); playTone(659.25, 'sine', 0.15, 0.08, 0.1); break;
	case 'wrong': playTone(200, 'square', 0.3, 0.15); break;
	case 'click': playTone(800, 'sine', 0.05, 0.05); break;
	case 'levelup': playTone(523, 'sine', 0.1); playTone(659, 'sine', 0.1, 0.1); playTone(784, 'sine', 0.2, 0.2); break;
	case 'badge': playTone(784, 'sine', 0.1); playTone(1046, 'sine', 0.1, 0.1); playTone(1318, 'sine', 0.2, 0.2); break;
  }
}
function vibrate(pattern) {
  if (!currentSettings.vibrate || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

// ===== 5. Settings Management (캐시 기반) =====
const DEFAULT_SETTINGS = { sound: true, vibrate: true, autoNext: true, questionCount: 20, darkMode: false };
let currentSettings = { ...DEFAULT_SETTINGS }; // 메모리 캐시

async function getSettings() { // DB에서 직접 읽기 (초기화용)
  const s = await dbGet(CONFIG.STORES.settings, '');
  return { ...DEFAULT_SETTINGS, ...(s?.value || {}) };
}

// 초기 앱 시작 시 1회만 DB에서 로드
async function loadInitialSettings() {
  const s = await getSettings();
  currentSettings = { ...DEFAULT_SETTINGS, ...(s?.value || {}) };
  applySettings(currentSettings);
}

// 설정 로드: 캐시 → UI 반영 (동기)
function loadSettings() {
  applySettings(currentSettings);
  return Promise.resolve(currentSettings);
}

// 설정 저장: 캐시 갱신 → DB 저장(백그라운드) → UI 반영
async function saveSettings(partial = {}) {
  const next = { ...currentSettings, ...partial };
  currentSettings = next; // 1. 캐시 즉시 갱신
  applySettings(next);    // 2. UI 즉시 반영
  
  // 3. DB 저장 (백그라운드)
  try {
	await dbPut(CONFIG.STORES.settings, { key: '', value: next, updatedAt: nowISO() });
  } catch (e) {
	console.error('설정 저장 실패:', e);
	showToast('설정 저장 실패(오프라인 가능성)', 'error');
  }
  return next;
}

// 설정 적용 (UI 동기화 + 테마 적용)
function applySettings(s) {
  $('#settingSound').checked = s.sound;
  $('#settingVibrate').checked = s.vibrate;
  $('#settingAutoNext').checked = s.autoNext;
  $('#settingCount').value = s.questionCount;
  $('#settingDark').checked = s.darkMode;

  if (s.darkMode !== undefined) {
	document.documentElement.dataset.theme = s.darkMode ? 'dark' : 'light';
  }
  TOTAL_QUESTIONS = s.questionCount;
}

// UI에서 값 읽어 저장 호출 (저장 버튼용)
async function saveSettingsFromUI() {
  const next = {
	sound: $('#settingSound').checked,
	vibrate: $('#settingVibrate').checked,
	autoNext: $('#settingAutoNext').checked,
	questionCount: parseInt($('#settingCount').value),
	darkMode: $('#settingDark').checked
  };
  await saveSettings(next);
  showToast('설정이 저장되었습니다.', 'success');
}

function toggleTheme() {
  const isDark = $('#settingDark').checked;
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  saveSettings({ darkMode: isDark });
}

// ===== 6. State Management =====
let currentLevel = 1;
let questions = [];
let currentIndex = 0;
let correctCount = 0;
let startTime = 0;
let questionStartTime = 0;
let answers = [];
let TOTAL_QUESTIONS = CONFIG.TOTAL_QUESTIONS_DEFAULT;
let detailRecordId = null;
let currentMonth = new Date();
let isParentAuthed = false;

const screens = {
  start: 'screen-start', quiz: 'screen-quiz', result: 'screen-result',
  history: 'screen-history', profile: 'screen-profile', stats: 'screen-stats'
};

// ===== 7. Screen Navigation =====
function showScreen(name) {
  Object.values(screens).forEach(id => {
	const el = $(`#${id}`); if (el) el.classList.toggle('active', id === screens[name]);
  });
  document.body.classList.toggle('is-start-screen', name === 'start');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  switch(name) {
	case 'start': loadStartStats(); break;
	case 'history': renderHistory(); break;
	case 'profile': renderProfile(); break;
	case 'stats': 
	  if (verifyParentPin(true)) { renderStats(); }
	  else { openParentAuth(() => { isParentAuthed = true; renderStats(); }); }
	  break;
  }
  closeAllModals();
}

// ===== 8. Modal Management (Final Stable Version) =====
function openModal(id) {
  console.log('[DEBUG openModal] 요청됨:', id);
  
  const el = $(`#${id}`);
  if (!el) { console.error('[DEBUG openModal] 엘리먼트 없음:', id); return; }

  if (id === 'settings-modal') { loadSettings(); }

  // 1. body 직속으로 강제 이동 (Containing Block 문제 해결)
  document.body.appendChild(el);

  // 2. 오버레이 강제 스타일
  el.style.cssText = `
	display: flex !important;
	opacity: 1 !important;
	visibility: visible !important;
	z-index: 2147483647 !important;
	position: fixed !important;
	inset: 0 !important;
	background: rgba(0, 0, 0, 0.5) !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
	transition: none !important;
	align-items: center !important;
	justify-content: center !important;
	padding: 1rem !important;
	pointer-events: auto !important;
  `;

  // 3. 내부 .modal 박스 강제 스타일
  const modalBox = el.querySelector('.modal');
  if (modalBox) {
	modalBox.style.cssText = `
	  transform: scale(1) translateZ(0) !important;
	  opacity: 1 !important;
	  visibility: visible !important;
	  display: flex !important;
	  flex-direction: column !important;
	  max-height: 85vh !important;
	  width: 100% !important;
	  max-width: 420px !important;
	  background: var(--card, white) !important;
	  border-radius: 24px !important;
	  box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important;
	  overflow: hidden !important;
	  flex-shrink: 0 !important;
	`;

	// 4. 내부 요소들 강제 스타일 (레이아웃 고정)
	const header = modalBox.querySelector('.modal-header');
	const body = modalBox.querySelector('.modal-body');
	const footer = modalBox.querySelector('.modal-footer');

	if (header) header.style.cssText = 'display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 1rem 1.25rem !important; border-bottom: 1px solid var(--border) !important; background: var(--card-hover) !important; flex-shrink: 0 !important;';
	if (footer) footer.style.cssText = 'display: flex !important; justify-content: flex-end !important; gap: 0.5rem !important; padding: 1rem 1.25rem !important; border-top: 1px solid var(--border) !important; background: var(--card-hover) !important; flex-shrink: 0 !important;';
	
	// 🔧 핵심: 바디 스크롤 레이아웃 보장
	if (body) {
	  body.style.cssText = `
		padding: 1.25rem !important; 
		overflow-y: auto !important; 
		flex: 1 1 auto !important; 
		min-height: 0 !important; /* 🔧 필수: 플렉스 자식 스크롤 허용 */
		width: 100% !important; 
		box-sizing: border-box !important;
		overflow-x: hidden !important; /* 가로 스크롤 방지 */
	  `;
	}

	// 모달 내부의 폰트/버튼 등 가독성 보장
	modalBox.querySelectorAll('button, input, select, label').forEach(el => {
	  el.style.opacity = '1';
	  el.style.visibility = 'visible';
	});
  }

  el.classList.add('active');
  
  // 강제 리플로우 (즉시 렌더링 강제)
  el.getBoundingClientRect(); 
  if (modalBox) modalBox.getBoundingClientRect();

  // 포커스 이동
  setTimeout(() => { 
	const focusable = el.querySelector('button, input, select, [tabindex]:not([tabindex="-1"])'); 
	if(focusable) focusable.focus(); 
  }, 50);
  
  el.removeEventListener('keydown', trapFocus);
  el.addEventListener('keydown', trapFocus);
}

function closeModal(id) {
  const el = $(`#${id}`); if (!el) return;
  
  // 강제 스타일 제거
  el.style.cssText = '';
  
  const modalBox = el.querySelector('.modal');
  if (modalBox) {
	modalBox.style.cssText = '';
	modalBox.querySelectorAll('.modal-header, .modal-body, .modal-footer').forEach(child => child.style.cssText = '');
  }
  
  el.classList.remove('active');
  el.removeEventListener('keydown', trapFocus);
}

function closeAllModals() { $$('.modal-overlay.active').forEach(m => closeModal(m.id)); }

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const modal = e.currentTarget.querySelector('.modal');
  const focusable = modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0]; const last = focusable[focusable.length-1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ===== 9. Problem Generation =====
function generateQuestion(level) {
  const cfg = CONFIG.LEVELS[level];
  const op = cfg.ops[rand(0, cfg.ops.length - 1)];
  let a, b, ans;
  if (op === '+') {
	if (level === 1) { a = rand(1, 9); b = rand(1, 9 - a); ans = a + b; }
	else if (level === 2) { a = rand(1, 19); b = rand(1, 20 - a); ans = a + b; }
	else { a = rand(10, 50); b = rand(10, 50); if (a+b>99) b = 99-a; ans = a+b; }
  } else {
	if (level === 1) { ans = rand(1, 9); a = rand(ans, 9); b = a - ans; }
	else if (level === 2) { ans = rand(1, 19); a = rand(ans, 20); b = a - ans; }
	else { a = rand(20, 99); b = rand(10, a-1); ans = a - b; }
  }
  return { a, b, op, ans, text: `${a} ${op} ${b} =`, level };
}

function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=rand(0,i);[arr[i],arr[j]]=[arr[j],arr[i]]} return arr; }

// ===== 10. Game Flow: Start, Quiz, Submit, Finish =====
function startGame(level) {
  currentLevel = level;
  TOTAL_QUESTIONS = currentSettings.questionCount || CONFIG.TOTAL_QUESTIONS_DEFAULT;
  questions = shuffle(Array.from({length: TOTAL_QUESTIONS}, () => generateQuestion(level)));
  currentIndex = 0; correctCount = 0; answers = []; startTime = Date.now();
  showScreen('quiz');
  renderQuestion();
  buildKeypad();
}

function renderQuestion() {
  const q = questions[currentIndex];
  $('#problemExpr').textContent = q.text;
  $('#problemExpr').setAttribute('aria-label', `${q.a} ${q.op === '+' ? '더하기' : '빼기'} ${q.b}`);
  const input = $('#answerInput');
  input.value = ''; input.className = 'answer-input'; input.focus();
  $('#feedback').textContent = '';
  $('#quizCounter').textContent = `${currentIndex + 1} / ${TOTAL_QUESTIONS}`;
  $('#progressFill').style.width = `${(currentIndex / TOTAL_QUESTIONS) * 100}%`;
  $('#progressFill').setAttribute('aria-valuenow', currentIndex);
  questionStartTime = Date.now();
}

function buildKeypad() {
  const pad = $('#keypad'); pad.innerHTML = '';
  const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','✓'];
  keys.forEach(k => {
	const btn = document.createElement('button');
	btn.className = `key${k==='⌫'||k==='✓'?' action':''}${k==='✓'?' enter':''}${k==='0'?' zero':''}`;
	btn.textContent = k; btn.setAttribute('aria-label', k==='⌫'?'지우기':k==='✓'?'확인':k);
	btn.onclick = () => handleKey(k);
	pad.appendChild(btn);
  });
}

let lastKeyTime = 0;
function handleKey(key) {
  const now = Date.now(); if (now - lastKeyTime < 50) return; lastKeyTime = now;
  playSound('click');
  const input = $('#answerInput');
  if (key === '⌫') input.value = input.value.slice(0, -1);
  else if (key === '✓') submitAnswer();
  else if (input.value.length < 3) input.value += key;
}

async function submitAnswer() {
  const input = $('#answerInput');
  const Val = parseInt(input.value, 10);
  const q = questions[currentIndex];
  const isCorrect = Val === q.ans;
  const timeSpent = Math.round((Date.now() - questionStartTime) / 1000);
  const totalTime = Math.round((Date.now() - startTime) / 1000);

  answers.push({ ...q,Ans: isNaN(Val) ? null : Val, correct: isCorrect, time: timeSpent, totalTime });
  if (isCorrect) correctCount++;

  input.classList.add(isCorrect ? 'correct' : 'wrong');
  const fb = $('#feedback');
  fb.textContent = isCorrect ? '정답! 👍' : `오답! 정답은 ${q.ans}예요.`;
  fb.className = 'feedback ' + (isCorrect ? 'correct' : 'wrong');

  playSound(isCorrect ? 'correct' : 'wrong');
  if (!isCorrect) vibrate([50, 20, 50]);

  const delay = isCorrect ? 600 : 1200;
  setTimeout(() => {
	currentIndex++;
	if (currentIndex >= TOTAL_QUESTIONS) finishGame();
	else renderQuestion();
  }, delay);
}

async function finishGame() {
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  const scorePct = Math.round((correctCount / TOTAL_QUESTIONS) * 100);
  const avgTime = totalTime / TOTAL_QUESTIONS;

  const record = {
	id: generateId(), date: nowISO(), level: currentLevel,
	levelName: CONFIG.LEVELS[currentLevel].name,
	correct: correctCount, total: TOTAL_QUESTIONS, score: scorePct,
	time: totalTime, avgTime, details: answers
  };
  await dbPut(CONFIG.STORES.history, record);
  await updateProfileOnFinish(record);
  await checkAttendance();
  checkBadges(record);

  $('#scoreCircle').style.setProperty('--score', scorePct);
  $('#scoreText').textContent = `${scorePct}%`;
  $('#correctCount').textContent = correctCount;
  $('#wrongCount').textContent = TOTAL_QUESTIONS - correctCount;
  $('#timeTaken').textContent = totalTime;
  $('#resultTitle').textContent = scorePct === 100 ? '완벽해요! 🏆' : scorePct >= 80 ? '수고했어요! 🎉' : '조금 더 연습해요! 💪';
  $('#resultSubtitle').textContent = `평균 ${avgTime.toFixed(1)}초 걸렸어요`;

  showScreen('result');
  if (scorePct === 100) launchConfetti(3000);
  else if (scorePct >= 80) launchConfetti(1500);
}

function restartSameLevel() { startGame(currentLevel); }

// ===== 11. Start Screen Stats Loading =====
async function loadStartStats() {
  const records = await dbGetAll(CONFIG.STORES.history);
  for (let lvl = 1; lvl <= 3; lvl++) {
	const lvlRecs = records.filter(r => r.level === lvl);
	const el = $(`#stats-level-${lvl}`);
	const badge = $(`#badge-level-${lvl}`);
	if (!lvlRecs.length) { el.innerHTML = '<span class="level-stat">기록 없음</span>'; badge.textContent = '0%'; continue; }
	const avgScore = Math.round(lvlRecs.reduce((s,r)=>s+r.score,0)/lvlRecs.length);
	const avgTime = Math.round(lvlRecs.reduce((s,r)=>s+r.time,0)/lvlRecs.length);
	el.innerHTML = `<span class="level-stat">정답률 <strong>${avgScore}%</strong></span><span class="level-stat">평균 <strong>${avgTime}s</strong></span>`;
	badge.textContent = `${avgScore}%`;
	badge.className = `badge ${avgScore===100?'badge-success':avgScore>=80?'badge-warning':'badge-error'}`;
  }
  const recent = records[0];
  $('#quickStats').innerHTML = recent ? `최근: ${recent.levelName} • ${recent.correct}/${recent.total} 정답 • ${recent.time}초` : '아직 기록이 없어요. 첫 도전을 시작해보세요!';
}

// ===== 12. History Screen (Phase 2) - Event Delegation =====
async function renderHistory() {
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  const records = await dbGetAll(CONFIG.STORES.history);
  
  if (!records.length) {
	list.innerHTML = '';
	empty.classList.remove('hidden');
	// 리스너 초기화 위해 클론 교체
	list.replaceWith(list.cloneNode(true)); 
	$('#historyList').addEventListener('click', handleHistoryClick);
	return;
  }
  empty.classList.add('hidden');
  
  list.innerHTML = records.map(r => {
	const d = new Date(r.date);
	const dateStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
	const scoreClass = r.score === 100 ? '' : r.score >= 80 ? 'mid' : 'low';
	// data-id 속성에 ID 저장 (onclick 제거)
	return `
	  <article class="history-item" role="listitem" tabindex="0" data-id="${r.id}"
		aria-label="${r.levelName}, ${r.correct}/${r.total} 정답, ${r.score}점, ${formatTime(r.time)}">
		<div class="history-item-main">
		  <div class="history-item-date">${dateStr}</div>
		  <div class="history-item-meta">
			<span class="history-item-badge">${r.levelName}</span>
			<span>${r.correct}/${r.total} 정답</span>
			<span>${formatTime(r.time)}</span>
		  </div>
		</div>
		<div class="history-item-score ${scoreClass}" aria-label="점수 ${r.score}%">${r.score}%</div>
	  </article>
	`;
  }).join('');

  // 이벤트 위임: 리스트에 클릭 리스너 1개만 등록
  const newList = list.cloneNode(true);
  list.replaceWith(newList);
  newList.addEventListener('click', handleHistoryClick);
}

// 이벤트 위임 핸들러
function handleHistoryClick(e) {
  const item = e.target.closest('.history-item');
  if (!item) return;
  const recordId = item.dataset.id;
  if (recordId) openDetailModal(recordId);
  else console.warn('History item has no data-id', item);
}

// ===== 13. Detail Modal (Phase 2) =====
async function openDetailModal(recordId = null) {
  // playSound('click'); // 모달 열기 시 소리 제거 (렌더링 블로킹 방지)
  
  const targetId = recordId || window.lastRecordId;
  if (!targetId) { showToast('상세 기록 ID가 없습니다.', 'error'); return; }

  detailRecordId = targetId;
  
  try {
	const record = await dbGet(CONFIG.STORES.history, targetId);
	if (!record) { showToast('기록을 찾을 수 없습니다.', 'error'); return; }

	const d = new Date(record.date);
	const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
	
	$('#detailScore').textContent = `${record.score}%`;
	$('#detailScore').className = `detail-score ${record.score===100?'':record.score>=80?'mid':'low'}`;
	$('#detailMeta').textContent = `${record.levelName} • ${record.total}문제 • ${formatTime(record.time)} • ${dateStr}`;

	const container = $('#detailProblems');
	container.innerHTML = record.details.map((q, i) => {
	  const isCorrect = q.correct;
	  const Ans = q.Ans !== undefined ? q.Ans : q.userAns; 
	  const displayAns = Ans === null ? '미입력' : Ans;
	  
	  return `
		<div class="detail-problem ${isCorrect ? 'correct' : 'wrong'}" role="listitem">
		  <span class="detail-problem-num">${i+1}.</span>
		  <span class="detail-problem-expr">${q.text}</span>
		  <div class="detail-problem-ans">
			<span class="${isCorrect ? 'correct' : 'wrong'}">내 답: ${displayAns}</span>
			${!isCorrect ? `<span class="correct">정답: ${q.ans}</span>` : ''}
		  </div>
		  <span class="detail-problem-time">${q.time}초</span>
		</div>
	  `;
	}).join('');

	openModal('detail-modal');
	
  } catch (err) {
	console.error('[openDetailModal] Error:', err);
	showToast('상세 보기 로드 실패', 'error');
  }
}

function closeDetailModal() { closeModal('detail-modal'); }

// 오답 다시 풀기 (결과 화면/상세 모달에서 진입)
async function retryWrongFromDetail() {
  if (!detailRecordId) { showToast('상세 보기에서 오답을 선택해주세요.', 'info'); return; }
  
  const record = await dbGet(CONFIG.STORES.history, detailRecordId);
  if (!record) return;
  
  const wrongQuestions = record.details.filter(q => !q.correct);
  if (!wrongQuestions.length) { showToast('틀린 문제가 없습니다! 🎉', 'success'); return; }

  questions = wrongQuestions.map(q => ({ a: q.a, b: q.b, op: q.op, ans: q.ans, text: q.text, level: q.level }));
  for(let i=questions.length-1;i>0;i--){const j=rand(0,i);[questions[i],questions[j]]=[questions[j],questions[i]]}
  
  currentLevel = record.level;
  currentIndex = 0; correctCount = 0; answers = []; startTime = Date.now();
  TOTAL_QUESTIONS = questions.length;
  
  closeDetailModal();
  showScreen('quiz');
  renderQuestion();
  buildKeypad();
  showToast(`${questions.length}개 오답 다시 풀기 시작!`, 'info');
}

function openWrongNote() { retryWrongFromDetail(); }

// ===== 14. Profile, Character, Badges, Attendance (Phase 3) =====

// --- Character SVG Generators ---
function getEggSVG() { return `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="60" rx="35" ry="40" fill="#fff8e1" stroke="#fbc02d" stroke-width="2"/><ellipse cx="50" cy="35" rx="20" ry="5" fill="#fff3c4"/></svg>`; }
function getBabyDinoSVG() { return `<svg viewBox="0 0 100 100"><g transform="translate(50,85) scale(0.7)"><path d="M0 0 Q-20 -30 0 -60 Q20 -30 0 0" fill="#81c784" stroke="#4caf50" stroke-width="2"/><circle cx="-10" cy="-50" r="5" fill="white"/><circle cx="-10" cy="-50" r="2" fill="black"/><circle cx="10" cy="-50" r="5" fill="white"/><circle cx="10" cy="-50" r="2" fill="black"/></g></svg>`; }
function getTeenDinoSVG() { return `<svg viewBox="0 0 100 100"><g transform="translate(50,90) scale(0.9)"><path d="M0 0 Q-30 -40 0 -80 Q30 -40 0 0" fill="#64b5f6" stroke="#2196f3" stroke-width="2"/><ellipse cx="-15" cy="-60" rx="8" ry="6" fill="white"/><circle cx="-15" cy="-60" r="3" fill="black"/><ellipse cx="15" cy="-60" rx="8" ry="6" fill="white"/><circle cx="15" cy="-60" r="3" fill="black"/></g></svg>`; }
function getAdultDinoSVG() { return `<svg viewBox="0 0 100 100"><g transform="translate(50,95) scale(1.1)"><path d="M0 0 Q-40 -50 0 -90 Q40 -50 0 0" fill="#4db6ac" stroke="#009688" stroke-width="3"/><ellipse cx="-18" cy="-65" rx="10" ry="8" fill="white"/><circle cx="-18" cy="-65" r="4" fill="black"/><ellipse cx="18" cy="-65" rx="10" ry="8" fill="white"/><circle cx="18" cy="-65" r="4" fill="black"/><path d="M-30 -20 Q-40 -30 -30 -40" stroke="#009688" stroke-width="4" fill="none" stroke-linecap="round"/></g></svg>`; }
function getDragonSVG() { return `<svg viewBox="0 0 100 100"><g transform="translate(50,95) scale(1.1)"><path d="M0 0 Q-40 -50 0 -90 Q40 -50 0 0" fill="#ce93d8" stroke="#ab47bc" stroke-width="3"/><ellipse cx="-18" cy="-65" rx="10" ry="8" fill="white"/><circle cx="-18" cy="-65" r="4" fill="black"/><ellipse cx="18" cy="-65" rx="10" ry="8" fill="white"/><circle cx="18" cy="-65" r="4" fill="black"/><path d="M-35 -30 Q-50 -50 -30 -70" stroke="#ab47bc" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M35 -30 Q50 -50 30 -70" stroke="#ab47bc" stroke-width="4" fill="none" stroke-linecap="round"/></g></svg>`; }

// --- Profile Rendering ---
async function renderProfile() {
  const profile = await getProfile();
  renderCharacter(profile);
  renderBadges(profile);
  renderAttendance(profile);
}

async function getProfile() {
  let p = await dbGet(CONFIG.STORES.profile, 'main');
  if (!p) {
	p = { key: 'main', exp: 0, level: 0, badges: {}, attendance: {}, lastAttendance: null, stats: { totalSolved: 0, totalCorrect: 0, perfectCount: {}, streakMax: 0, levelPerfectCounts: {1:0,2:0,3:0} } };
	await dbPut(CONFIG.STORES.profile, p);
  }
  return p;
}

function renderCharacter(profile) {
  const stageIdx = Math.min(CONFIG.CHARACTER_STAGES.length - 1, 
	CONFIG.CHARACTER_STAGES.findLastIndex(s => profile.exp >= s.minExp));
  const stage = CONFIG.CHARACTER_STAGES[stageIdx];
  const nextStage = CONFIG.CHARACTER_STAGES[stageIdx + 1];
  
  $('#charContainer').innerHTML = stage.svg();
  $('#charName').textContent = stage.name;
  $('#charLevelText').textContent = `Lv. ${stageIdx + 1} (${profile.exp} EXP)`;
  
  let expPercent = 100;
  if (nextStage) {
	expPercent = Math.round((profile.exp - stage.minExp) / (nextStage.minExp - stage.minExp) * 100);
  }
  $('#charExpFill').style.width = `${expPercent}%`;
  $('#charExpFill').setAttribute('aria-valuenow', expPercent);
}

function renderBadges(profile) {
  const grid = $('#badgeGrid');
  grid.innerHTML = CONFIG.BADGES.map(b => {
	const earned = profile.badges[b.id];
	const date = earned ? new Date(earned).toLocaleDateString() : '미획득';
	return `
	  <div class="badge-item ${earned ? 'earned' : ''}" role="listitem" aria-label="${b.name}: ${earned ? `획득일 ${date}` : '미획득'} - ${b.desc}">
		<div class="badge-icon">${b.icon}</div>
		<div class="badge-name">${b.name}</div>
		<div class="badge-tooltip">${b.desc}${earned ? `\n획득: ${date}` : ''}</div>
	  </div>
	`;
  }).join('');
}

function renderAttendance(profile) {
  const grid = $('#attendanceGrid');
  const today = new Date();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  $('#attendanceMonth').textContent = `${year}년 ${month+1}월`;
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = todayKey();
  
  let html = '';
  ['일','월','화','수','목','금','토'].forEach(d => html += `<div class="attendance-day-header">${d}</div>`);
  
  for(let i=0;i<firstDay;i++) html += `<div class="attendance-day future"></div>`;
  
  for(let d=1; d<=daysInMonth; d++) {
	const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
	const isToday = dateStr === todayStr;
	const isFuture = new Date(dateStr) > today;
	const stamped = profile.attendance[dateStr];
	
	let cls = 'attendance-day';
	if (isFuture) cls += ' future';
	else if (stamped) cls += ' stamped';
	if (isToday) cls += ' today';
	
	html += `<div class="${cls}" data-date="${dateStr}" title="${dateStr}${stamped?' ✓':''}">${d}</div>`;
  }
  grid.innerHTML = html;
}

function changeMonth(delta) {
  currentMonth.setMonth(currentMonth.getMonth() + delta);
  renderProfile();
}

// 출석 체크 및 보상
async function checkAttendance() {
  const profile = await getProfile();
  const today = todayKey();
  if (profile.attendance[today]) return;
  
  profile.attendance[today] = nowISO();
  let streak = 1;
  let checkDate = new Date(today);
  checkDate.setDate(checkDate.getDate() - 1);
  while(profile.attendance[checkDate.toISOString().split('T')[0]]) {
	streak++; checkDate.setDate(checkDate.getDate() - 1);
  }
  const expGain = 10 + (streak > 7 ? 20 : streak * 2);
  profile.exp += expGain;
  
  await dbPut(CONFIG.STORES.profile, profile);
  showToast(`출석 도장 찍힘! +${expGain} EXP ${streak>1?`(${streak}일 연속)`:''}`, 'success');
  playSound('levelup');
  if (document.getElementById('screen-profile').classList.contains('active')) renderProfile();
}

// ===== 15. Badge Checking Logic (Phase 3) =====
async function checkBadges(record) {
  const profile = await getProfile();
  const newBadges = [];
  const now = nowISO();
  
  if (record.score === 100 && !profile.badges.first_perfect) newBadges.push('first_perfect');
  
  if (record.score === 100) {
	profile.stats.levelPerfectCounts[record.level] = (profile.stats.levelPerfectCounts[record.level] || 0) + 1;
	if (profile.stats.levelPerfectCounts[record.level] >= 3 && !profile.badges[`level${record.level}_master`]) {
	  newBadges.push(`level${record.level}_master`);
	}
  }
  
  if (record.avgTime <= 3 && record.total >= 20 && !profile.badges.speed_demon) newBadges.push('speed_demon');
  
  profile.stats.totalSolved += record.total;
  if (profile.stats.totalSolved >= 100 && !profile.badges.hundred_solver) newBadges.push('hundred_solver');
  if (profile.stats.totalSolved >= 1000 && !profile.badges.thousand_solver) newBadges.push('thousand_solver');
  
  const hour = new Date(record.date).getHours();
  if (hour >= 22 && !profile.badges.night_owl) newBadges.push('night_owl');
  if (hour < 7 && !profile.badges.early_bird) newBadges.push('early_bird');
  
  let streak = 0; let checkDate = new Date();
  for(let i=0;i<365;i++) {
	const key = checkDate.toISOString().split('T')[0];
	if (profile.attendance[key]) streak++;
	else break;
	checkDate.setDate(checkDate.getDate()-1);
  }
  if (streak >= 7 && !profile.badges.week_warrior) newBadges.push('week_warrior');
  
  // 연속 정답 배지 (게임 내 최대 스트릭 기준)
  let currentStreak = 0, maxStreak = 0;
  record.details.forEach(q => { if(q.correct) currentStreak++; else currentStreak=0; if(currentStreak>maxStreak) maxStreak=currentStreak; });
  if (maxStreak >= 5 && !profile.badges.streak_5) newBadges.push('streak_5');
  if (maxStreak >= 10 && !profile.badges.streak_10) newBadges.push('streak_10');

  for(const id of newBadges) {
	if (!profile.badges[id]) {
	  profile.badges[id] = now;
	  showToast(`🏅 새 배지 획득: ${CONFIG.BADGES.find(b=>b.id===id)?.name}`, 'success');
	  playSound('badge');
	}
  }
  
  if (newBadges.length) await dbPut(CONFIG.STORES.profile, profile);
}

// ===== 16. Profile Update on Finish =====
async function updateProfileOnFinish(record) {
  const profile = await getProfile();
  profile.stats.totalSolved += record.total;
  profile.stats.totalCorrect += record.correct;
  profile.exp += record.correct * 2 + (record.score === 100 ? 50 : 0);
  
  let currentStreak = 0, maxStreak = 0;
  record.details.forEach(q => { if(q.correct) currentStreak++; else currentStreak=0; if(currentStreak>maxStreak) maxStreak=currentStreak; });
  if (maxStreak > profile.stats.streakMax) profile.stats.streakMax = maxStreak;
  
  await dbPut(CONFIG.STORES.profile, profile);
}

// ===== 17. Parent Auth Logic =====
let parentAuthCallback = null;
function openParentAuth(callback) {
  parentAuthCallback = callback || (() => { isParentAuthed = true; showScreen('stats'); });
  closeModal('settings-modal');
  $('#authError').classList.add('hidden');
  $$('#auth-modal .pin-input').forEach((inp, i) => { inp.value = ''; if(i===0) setTimeout(()=>inp.focus(), 100); });
  openModal('auth-modal');
}

function verifyParentPin(silent = false) {
  if (silent) return isParentAuthed;

  const pins = $$('#auth-modal .pin-input');
  const pin = pins.map(p => p.value).join('');
  
  if (pin === CONFIG.PARENT_PIN) {
	isParentAuthed = true;
	closeModal('auth-modal');
	pins.forEach(p => p.value = '');
	if (parentAuthCallback) parentAuthCallback();
	showToast('인증 성공', 'success');
	return true;
  } else {
	$('#authError').classList.remove('hidden');
	pins.forEach(p => p.value = '');
	pins[0].focus();
	vibrate([100, 50, 100]);
	playSound('wrong');
	return false;
  }
}

// PIN Input Auto-focus
$$('#auth-modal .pin-input').forEach((inp, i, arr) => {
  inp.addEventListener('input', () => { if(inp.value && i < arr.length-1) arr[i+1].focus(); });
  inp.addEventListener('keydown', (e) => { if(e.key==='Backspace' && !inp.value && i>0) arr[i-1].focus(); });
});

// ===== 18. Data Export/Import =====
async function exportData() {
  const history = await dbGetAll(CONFIG.STORES.history);
  const profile = await getProfile();
  const settings = await getSettings(); // 현재 캐시 기준 저장
  const data = { version: 3, exportDate: nowISO(), history, profile, settings: currentSettings };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `math_practice_backup_${todayKey()}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('데이터 내보내기 완료', 'success');
}

async function importData(e) {
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  try {
	const data = JSON.parse(text);
	if (!data.history || !data.profile) throw new Error('Invalid format');
	
	if(!confirm('기존 데이터가 모두 덮어씌워집니다. 계속하시겠습니까?')) return;
	
	await dbClear(CONFIG.STORES.history);
	await dbClear(CONFIG.STORES.profile);
	await dbClear(CONFIG.STORES.settings);
	
	for(const r of data.history) await dbPut(CONFIG.STORES.history, r);
	await dbPut(CONFIG.STORES.profile, { key: 'main', ...data.profile });
	if(data.settings) { currentSettings = { ...DEFAULT_SETTINGS, ...data.settings }; await dbPut(CONFIG.STORES.settings, { key: '', value: currentSettings, updatedAt: nowISO() }); applySettings(currentSettings); }
	
	showToast('데이터 가져오기 완료. 새로고침합니다.', 'success');
	setTimeout(() => location.reload(), 1000);
  } catch(err) { console.error(err); showToast('가져오기 실패: 잘못된 파일', 'error'); }
  e.target.value = '';
}

async function clearAllHistory() {
  if(!confirm('정말 모든 기록(히스토리, 프로필, 설정)을 삭제하시겠습니까? 복구 불가합니다.')) return;
  if(!confirm('최종 확인: 영구 삭제됩니다.')) return;
  await dbClear(CONFIG.STORES.history);
  await dbClear(CONFIG.STORES.profile);
  await dbClear(CONFIG.STORES.settings);
  showToast('전체 데이터 초기화 완료. 새로고침합니다.', 'success');
  setTimeout(() => location.reload(), 1000);
}

async function confirmClearAll() {
  closeModal('settings-modal');
  await clearAllHistory();
}

// ===== 19. Statistics & Charts (Phase 4) =====
async function renderStats() {
  // 인증 체크는 showScreen에서 처리됨
  const records = await dbGetAll(CONFIG.STORES.history);
  const profile = await getProfile();
  renderStatsGrid(records, profile);
  renderWeeklyChart(records);
  renderWeaknessAnalysis(records);
}

function renderStatsGrid(records, profile) {
  const grid = $('#statsGrid');
  const totalSessions = records.length;
  const totalSolved = profile.stats.totalSolved || records.reduce((s,r)=>s+r.total,0);
  const totalCorrect = profile.stats.totalCorrect || records.reduce((s,r)=>s+r.correct,0);
  const overallAcc = totalSolved ? Math.round(totalCorrect/totalSolved*100) : 0;
  const bestStreak = profile.stats.streakMax || 0;
  
  grid.innerHTML = `
	<div class="stat-card"><div class="stat-value">${totalSessions}</div><div class="stat-label">총 세션</div></div>
	<div class="stat-card"><div class="stat-value">${totalSolved}</div><div class="stat-label">총 문항</div></div>
	<div class="stat-card"><div class="stat-value">${overallAcc}%</div><div class="stat-label">전체 정답률</div></div>
	<div class="stat-card"><div class="stat-value">${bestStreak}</div><div class="stat-label">최대 연승</div></div>
  `;
}

// --- Simple Canvas Chart (No Library) ---
function renderWeeklyChart(records) {
  const canvas = $('#weeklyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const padding = 40;
  const chartW = w - padding * 2;
  const chartH = h - padding * 2;
  
  ctx.clearRect(0, 0, w, h);
  
  // Last 7 days data
  const days = [];
  const scores = [];
  const today = new Date();
  for(let i=6; i>=0; i--) {
	const d = new Date(today); d.setDate(d.getDate() - i);
	const key = d.toISOString().split('T')[0];
	days.push(`${d.getMonth()+1}/${d.getDate()}`);
	const dayRecs = records.filter(r => r.date.startsWith(key));
	const avg = dayRecs.length ? Math.round(dayRecs.reduce((s,r)=>s+r.score,0)/dayRecs.length) : null;
	scores.push(avg);
  }
  
  // Grid & Axes
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  ctx.lineWidth = 1;
  ctx.font = '11px var(--font-main)';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
  ctx.textAlign = 'center';
  
  [0, 25, 50, 75, 100].forEach(v => {
	const y = padding + chartH * (1 - v/100);
	ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(w-padding, y); ctx.stroke();
	ctx.fillText(`${v}%`, padding - 20, y + 4);
  });
  
  days.forEach((day, i) => {
	const x = padding + (i / 6) * chartW;
	ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, h-padding); ctx.stroke();
	ctx.fillText(day, x, h - padding + 20);
  });
  
  // Line Path
  ctx.beginPath();
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  let firstPoint = true;
  scores.forEach((score, i) => {
	if (score === null) return;
	const x = padding + (i / 6) * chartW;
	const y = padding + chartH * (1 - score/100);
	if (firstPoint) { ctx.moveTo(x, y); firstPoint = false; }
	else { ctx.lineTo(x, y); }
  });
  ctx.stroke();
  
  // Points
  scores.forEach((score, i) => {
	if (score === null) return;
	const x = padding + (i / 6) * chartW;
	const y = padding + chartH * (1 - score/100);
	ctx.beginPath();
	ctx.arc(x, y, 6, 0, Math.PI*2);
	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
	ctx.fill();
	ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
	ctx.stroke();
  });
  
  // Legend
  const legendEl = $('#chartLegend');
  if (legendEl) legendEl.innerHTML = `
	<span class="legend-item"><span class="legend-color" style="background:var(--primary)"></span> 정답률</span>
	<span class="legend-item"><span class="legend-color" style="background:var(--success)"></span> 목표(80%)</span>
  `;
  
  // Target Line (80%)
  const targetY = padding + chartH * (1 - 80/100);
  ctx.setLineDash([5,5]);
  ctx.beginPath(); ctx.moveTo(padding, targetY); ctx.lineTo(w-padding, targetY); ctx.stroke();
  ctx.setLineDash([]);
}

function renderWeaknessAnalysis(records) {
  const container = $('#weaknessList');
  if (!records.length) { container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:1rem;">분석할 데이터가 없습니다.</p>'; return; }
  
  const stats = {};
  records.forEach(r => {
	r.details.forEach(q => {
	  const key = `${q.level}_${q.op}_${q.carry ? 'carry' : 'nocarry'}`;
	  if (!stats[key]) stats[key] = { total: 0, correct: 0, level: q.level, op: q.op, carry: q.carry };
	  stats[key].total++;
	  if (q.correct) stats[key].correct++;
	});
  });
  
  const weak = Object.values(stats)
	.filter(s => s.total >= 5 && s.correct/s.total < 0.7)
	.sort((a,b) => (a.correct/a.total) - (b.correct/b.total))
	.slice(0, 5);
  
  if (!weak.length) {
	container.innerHTML = '<p style="text-align:center; color:var(--success); padding:1rem;">🎉 뚜렷한 취약 유형이 없습니다! 훌륭해요!</p>';
	return;
  }
  
  const levelNames = {1:'1단계',2:'2단계',3:'3단계'};
  container.innerHTML = weak.map(s => {
	const rate = Math.round(s.correct/s.total*100);
	const typeName = `${levelNames[s.level]} ${s.op==='+'?'덧셈':'뺄셈'} ${s.carry?'(받아올림/내림)':'(기본)'}`;
	return `
	  <div class="weakness-item">
		<div class="weakness-info">
		  <div class="weakness-icon">${s.op==='+'?'➕':'➖'}</div>
		  <div class="weakness-text">
			<span class="weakness-name">${typeName}</span>
			<span class="weakness-rate">${s.correct}/${s.total} 정답 (${rate}%)</span>
		  </div>
		</div>
		<div class="weakness-bar"><div class="weakness-fill" style="width:${rate}%"></div></div>
	  </div>
	`;
  }).join('');
}

// ===== 20. Confetti Effect (Celebration) =====
let confettiParticles = [], confettiAnimationId = null;
const confettiCanvas = $('#confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');

function resizeConfettiCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfettiCanvas);
resizeConfettiCanvas();

function launchConfetti(duration = 3000) {
  confettiParticles = [];
  const colors = ['#4285f4','#34a853','#fbbc05','#ea4335','#ff6d00','#ab47bc','#26c6da'];
  const shapes = ['circle', 'square', 'triangle'];
  
  for(let i=0; i<150; i++) {
	confettiParticles.push({
	  x: Math.random() * confettiCanvas.width,
	  y: -20,
	  size: Math.random() * 8 + 4,
	  color: colors[Math.floor(Math.random() * colors.length)],
	  shape: shapes[Math.floor(Math.random() * shapes.length)],
	  vx: (Math.random() - 0.5) * 8,
	  vy: Math.random() * 3 + 2,
	  rotation: Math.random() * 360,
	  rotationSpeed: (Math.random() - 0.5) * 20,
	  opacity: 1
	});
  }
  
  const endTime = Date.now() + duration;
  
  function animate() {
	confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
	
	confettiParticles = confettiParticles.filter(p => {
	  p.x += p.vx;
	  p.y += p.vy;
	  p.vy += 0.05; // Gravity
	  p.rotation += p.rotationSpeed;
	  p.opacity -= 0.005;
	  
	  if (p.y > confettiCanvas.height + 50 || p.opacity <= 0) return false;
	  
	  confettiCtx.globalAlpha = p.opacity;
	  confettiCtx.fillStyle = p.color;
	  confettiCtx.save();
	  confettiCtx.translate(p.x, p.y);
	  confettiCtx.rotate(p.rotation * Math.PI / 180);
	  
	  if (p.shape === 'circle') {
		confettiCtx.beginPath(); confettiCtx.arc(0, 0, p.size, 0, Math.PI*2); confettiCtx.fill();
	  } else if (p.shape === 'square') {
		confettiCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
	  } else {
		confettiCtx.beginPath();
		confettiCtx.moveTo(0, -p.size);
		confettiCtx.lineTo(p.size*0.866, p.size/2);
		confettiCtx.lineTo(-p.size*0.866, p.size/2);
		confettiCtx.closePath(); confettiCtx.fill();
	  }
	  confettiCtx.restore();
	  return true;
	});
	
	if (Date.now() < endTime && confettiParticles.length > 0) {
	  confettiAnimationId = requestAnimationFrame(animate);
	} else {
	  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
	  confettiParticles = [];
	}
  }
  animate();
}

// ===== 21. Keyboard Support (Quiz Input) =====
function handleGlobalKeydown(e) {
  if ($$('.modal-overlay.active').length) return;
  
  const activeScreen = Object.values(screens).find(id => $('#'+id).classList.contains('active'));
  
  if (activeScreen === screens.quiz) {
	if (e.key >= '0' && e.key <= '9') handleKey(e.key);
	else if (e.key === 'Backspace') handleKey('⌫');
	else if (e.key === 'Enter') submitAnswer();
	else if (e.key === 'Escape') showScreen('start');
  }
  
  // Global shortcuts
  if (e.altKey && e.key === 'h') { e.preventDefault(); showScreen('history'); }
  if (e.altKey && e.key === 'p') { e.preventDefault(); showScreen('profile'); }
  if (e.altKey && e.key === 's') { e.preventDefault(); openModal('settings-modal'); }
}

// ===== 22. Initialization =====
async function initApp() {
  // 1. 설정 초기 로드 (DB → 캐시)
  await loadInitialSettings();

  // 2. Confetti Canvas 초기화
  resizeConfettiCanvas();

  // 3. Start Screen Stats 로드
  await loadStartStats();
  
  // 4. Event Listeners
  document.addEventListener('keydown', handleGlobalKeydown);
  
  // Answer Input direct typing (supplement keypad)
  $('#answerInput').addEventListener('input', (e) => {
	e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
  });
  
  // PIN Input Auto-focus (Auth Modal)
  $$('#auth-modal .pin-input').forEach((inp, i, arr) => {
	inp.addEventListener('input', () => { if(inp.value && i < arr.length-1) arr[i+1].focus(); });
	inp.addEventListener('keydown', (e) => { if(e.key==='Backspace' && !inp.value && i>0) arr[i-1].focus(); });
  });
  
  // Close modals on overlay click
  $$('.modal-overlay').forEach(overlay => {
	overlay.addEventListener('click', (e) => {
	  if (e.target === overlay) closeModal(overlay.id);
	});
  });
  
  // Prevent form submit on Enter in modals
  $$('.modal input').forEach(inp => inp.addEventListener('keydown', e => { if(e.key==='Enter') e.preventDefault(); }));
  
  // Service Worker Registration (Optional, for PWA/Offline if served via HTTP)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
	try {
	  // sw.js 파일이 별도로 있어야 함. 여기선 주석 처리 또는 간단 등록.
	  // const reg = await navigator.serviceWorker.register('./sw.js');
	  // console.log('SW Registered', reg.scope);
	} catch(err) { console.log('SW Registration skipped (offline file:// or no sw.js)'); }
  }
  
  console.log('🧮 산수 연습장 초기화 완료');
}

// ===== 23. Run =====
document.addEventListener('DOMContentLoaded', initApp);

// ===== 24. Global Error Handler =====
window.addEventListener('error', (e) => {
  console.error('Global Error:', e.error);
  showToast('오류가 발생했습니다. 콘솔을 확인해주세요.', 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled Promise Rejection:', e.reason);
  showToast('비동기 오류 발생', 'error');
});
</script>