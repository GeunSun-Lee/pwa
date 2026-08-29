/* ============================================================
   Study Planner - Main Application Logic (Vanilla ES6+)
   단일 파일 IIFE 모듈 패턴, LocalStorage 영속성, Proxy 상태관리
   ============================================================ */
(() => {
  'use strict';

  // ------------------------------------------------------------
  // 1. Configuration & Constants
  // ------------------------------------------------------------
  const CONFIG = {
    STORAGE_KEY: 'studyPlanner_v1',
    STORAGE_VERSION: 1,
    TIME_SLOT_MINUTES: 30,           // 타임 그리드 간격
    DAY_START_HOUR: 6,               // 그리드 시작 시간
    DAY_END_HOUR: 24,                // 그리드 종료 시간 (예: 24시 = 자정)
	TIME_ROW_HEIGHT: 48, // 👈 [추가] CSS 변수(--time-row-h) 대신 사용할 고정값 (px)
    DEFAULT_SUBJECTS: [
      { id: 'kor', name: '국어', color: '#e53935', icon: '📖', order: 1 },
      { id: 'eng', name: '영어', color: '#1e88e5', icon: '🔤', order: 2 },
      { id: 'math', name: '수학', color: '#43a047', icon: '🧮', order: 3 },
      { id: 'soc', name: '사회', color: '#fb8c00', icon: '🌍', order: 4 },
      { id: 'sci', name: '과학', color: '#00acc1', icon: '🔬', order: 5 },
      { id: 'hist', name: '역사', color: '#8e24aa', icon: '🏛️', order: 6 },
      { id: 'art', name: '예체능', color: '#d81b60', icon: '🎨', order: 7 },
      { id: 'etc', name: '자율', color: '#757575', icon: '📝', order: 8 }
    ],
    BADGES: [
      { id: 'first_plan', name: '첫 계획', desc: '첫 공부 블록을 등록했어요', icon: '🌱', condition: s => s.totalBlocks >= 1 },
      { id: 'streak_3', name: '3일 연속', desc: '3일 연속 학습 달성', icon: '🔥', condition: s => s.streak >= 3 },
      { id: 'streak_7', name: '일주일 완주', desc: '7일 연속 학습 달성', icon: '🏆', condition: s => s.streak >= 7 },
      { id: 'week_10h', name: '주 10시간', desc: '한 주 10시간 이상 공부', icon: '⏱️', condition: s => s.weeklyMinutes >= 600 },
      { id: 'all_subjects', name: '골고루', desc: '하루 4과목 이상 공부', icon: '🌈', condition: s => s.dailySubjectCount >= 4 },
      { id: 'night_owl', name: '올빼미', desc: '밤 10시 이후 공부', icon: '🦉', condition: s => s.hasLateNight }
    ],
    SELECTORS: {
      // Views
      views: '.view-panel',
      navItems: '.nav-item',
      // Today
      timeGrid: '#time-grid',
      timeGutter: '.time-gutter',
      btnAddBlock: '#btn-add-block',
      statTarget: '#stat-target',
      statPlanned: '#stat-planned',
      statDone: '#stat-done',
      chartDonut: '#chart-subject-donut',
      chartLegend: '#chart-legend',
      // Week
      weekGrid: '#week-grid',
      weekRange: '#week-range',
      btnPrevWeek: '#btn-prev-week',
      btnNextWeek: '#btn-next-week',
      btnApplyRoutine: '#btn-apply-routine',
      // Stats
      streakCount: '#streak-count',
      streakCountLarge: '#streak-count-large',
      streakCalendar: '#streak-calendar',
      streakHint: '#streak-hint',
      chartWeeklyBar: '#chart-weekly-bar',
      chartPeriod: '#chart-period',
      weeklyStatsDetail: '#weekly-stats-detail',
      badgesGrid: '#badges-grid',
      badgesEmpty: '#badges-empty',
      // Settings
      subjectList: '#subject-list',
      routineList: '#routine-list',
      btnAddSubject: '#btn-add-subject',
      btnAddRoutine: '#btn-add-routine',
      toggleNotify: '#toggle-notify',
      toggleDark: '#toggle-dark',
      btnExportData: '#btn-export-data',
      btnResetData: '#btn-reset-data',
      inputImportData: '#input-import-data',
      // Header
      todayDate: '#today-date',
      btnExport: '#btn-export',
      btnImportTrigger: '#btn-import-trigger',
      inputImport: '#input-import',
      btnSettings: '#btn-settings',
      // Modals
      modalBlock: '#modal-block',
      formBlock: '#form-block',
      modalSubject: '#modal-subject',
      formSubject: '#form-subject',
      modalRoutine: '#modal-routine',
      formRoutine: '#form-routine',
      // Toast
      toastContainer: '#toast-container'
    }
  };

  // ------------------------------------------------------------
  // 2. Utility Functions (Pure Helpers)
  // ------------------------------------------------------------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const fmt = {
    // YYYY-MM-DD
    dateKey: (d = new Date()) => d.toISOString().slice(0, 10),
    // HH:MM
    timeKey: (d = new Date()) => d.toTimeString().slice(0, 5),
    // "M월 D일 (요일)"
    dateLabel: (d) => `${d.getMonth()+1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`,
    // "HH:MM"
    timeLabel: (mins) => {
      const h = Math.floor(mins / 60).toString().padStart(2, '0');
      const m = (mins % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
    },
    // "X시간 Y분"
    durationLabel: (mins) => {
      if (mins < 60) return `${mins}분`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}시간 ${m}분` : `${h}시간`;
    },
    // Date 객체 -> "YYYY-MM-DD"
    toInputVal: (d) => d.toISOString().slice(0, 10),
    // "YYYY-MM-DD" -> Date (지역시간 기준 00:00)
    parseDate: (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    },
    // "HH:MM" -> minutes from midnight
    timeToMins: (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    },
    // minutes -> "HH:MM"
    minsToTime: (mins) => {
      const h = Math.floor(mins / 60).toString().padStart(2, '0');
      const m = (mins % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
    },
    // 두 시간 비교 (분 단위)
    compareTime: (a, b) => fmt.timeToMins(a) - fmt.timeToMins(b)
  };

  // 고유 ID 생성 (간단 버전)
  const uid = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // DOM 생성 헬퍼
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => node.dataset[dk] = dv);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach(c => node.append(c.nodeType ? c : document.createTextNode(c)));
    return node;
  };

  // 디바운스
  const debounce = (fn, ms = 150) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  // ------------------------------------------------------------
  // 3. Reactive State Management (Proxy 기반)
  // ------------------------------------------------------------
  const createStore = (initialState) => {
    const listeners = new Set();
    const state = new Proxy(initialState, {
      set(target, prop, value) {
        target[prop] = value;
        listeners.forEach(fn => fn(prop, value));
        return true;
      }
    });
    return {
      getState: () => state,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      // 깊은 변이 후 수동 트리거용
      commit: (prop) => listeners.forEach(fn => fn(prop, state[prop])),
      // 배열 메서드 래핑 (변이 감지 위해)
      mutate: (prop, mutator) => {
        mutator(state[prop]);
        listeners.forEach(fn => fn(prop, state[prop]));
      }
    };
  };

  // ------------------------------------------------------------
  // 4. Initial State Shape
  // ------------------------------------------------------------
  const initialState = {
    // Meta
    version: CONFIG.STORAGE_VERSION,
    // Settings
    settings: {
      subjects: [...CONFIG.DEFAULT_SUBJECTS],
      routineTemplates: [],
      notifyEnabled: false,
      darkModeForced: false // 👈 [수정] null -> false (기본: 라이트 모드 강제)
    },
    // Schedule: { "YYYY-MM-DD": [ {id, subjectId, start, end, memo, done, repeat}, ... ] }
    schedule: {},
    // Computed/Cached Stats (재계산 비용 절감)
    stats: {
      streak: 0,
      lastActiveDate: null,
      badges: [],
      weeklyMinutes: 0,
      dailySubjectCount: 0,
      hasLateNight: false,
      totalBlocks: 0
    },
    // UI State
    ui: {
      currentView: 'today',
      currentWeekStart: fmt.dateKey(new Date()), // 월요일 기준
      editingBlockId: null,
      editingSubjectId: null,
      editingRoutineId: null
    }
  };

  // ------------------------------------------------------------
  // 5. Persistence Layer (LocalStorage + JSON Import/Export)
  // ------------------------------------------------------------
  const Storage = {
    load() {
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // 마이그레이션 로직 자리
        if (parsed.version !== CONFIG.STORAGE_VERSION) {
          console.warn('[Storage] Version mismatch, migrating...');
          // migrate(parsed);
        }
        return parsed;
      } catch (e) {
        console.error('[Storage] Load failed', e);
        return null;
      }
    },
    save(state) {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('[Storage] Save failed', e);
        toast('데이터 저장에 실패했습니다. 저장 공간을 확인하세요.', 'error');
      }
    },
    exportJSON(state) {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `study-backup-${fmt.dateKey()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('백업 파일이 다운로드되었습니다.', 'success');
    },
    importJSON(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (!data.settings || !data.schedule) throw new Error('Invalid format');
            resolve(data);
          } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }
  };
    // ------------------------------------------------------------
  // 6. Derived State & Selectors (상태 파생 계산)
  // ------------------------------------------------------------
  const Selectors = {
    // 오늘 날짜 키
    todayKey: (state) => fmt.dateKey(),
    // 오늘 일정 배열 (시간순 정렬)
    todayBlocks: (state) => {
      const key = Selectors.todayKey(state);
      return (state.schedule[key] || []).slice().sort((a, b) => fmt.compareTime(a.start, b.start));
    },
    // 특정 날짜 일정
    getBlocks: (state, dateKey) => (state.schedule[dateKey] || []).slice().sort((a, b) => fmt.compareTime(a.start, b.start)),
    // 과목 맵 (id -> subject)
    subjectMap: (state) => Object.fromEntries(state.settings.subjects.map(s => [s.id, s])),
    // 활성 과목만 (순서대로)
    activeSubjects: (state) => state.settings.subjects.slice().sort((a, b) => a.order - b.order),
    // 주간 시작일(월) 구하기
    weekStartKey: (state) => state.ui.currentWeekStart,
    weekEndKey: (state) => {
      const d = fmt.parseDate(state.ui.currentWeekStart);
      d.setDate(d.getDate() + 6);
      return fmt.dateKey(d);
    },
    // 주간 7일 키 배열
    weekDays: (state) => {
      const arr = [];
      const d = fmt.parseDate(state.ui.currentWeekStart);
      for (let i = 0; i < 7; i++) {
        arr.push(fmt.dateKey(d));
        d.setDate(d.getDate() + 1);
      }
      return arr;
    },
    // 주간 전체 블록 (날짜별 그룹)
    weekBlocks: (state) => {
      const days = Selectors.weekDays(state);
      const map = {};
      days.forEach(key => map[key] = Selectors.getBlocks(state, key));
      return map;
    },
    // 완료된 블록 수 (오늘)
    todayDoneCount: (state) => Selectors.todayBlocks(state).filter(b => b.done).length,
    // 총 계획 분 (오늘)
    todayPlannedMinutes: (state) => Selectors.todayBlocks(state).reduce((sum, b) => sum + (fmt.timeToMins(b.end) - fmt.timeToMins(b.start)), 0),
    // 완료 분 (오늘)
    todayDoneMinutes: (state) => Selectors.todayBlocks(state).filter(b => b.done).reduce((sum, b) => sum + (fmt.timeToMins(b.end) - fmt.timeToMins(b.start)), 0),
    // 과목별 분포 (오늘)
    todaySubjectDist: (state) => {
      const dist = {};
      Selectors.todayBlocks(state).filter(b => b.done).forEach(b => {
        const sub = Selectors.subjectMap(state)[b.subjectId];
        const mins = fmt.timeToMins(b.end) - fmt.timeToMins(b.start);
        dist[b.subjectId] = (dist[b.subjectId] || 0) + mins;
      });
      return dist;
    }
  };

  // ------------------------------------------------------------
  // 7. Core Business Logic (Schedule CRUD & Routines)
  // ------------------------------------------------------------
  const Logic = {
    // 블록 유효성 검사
    validateBlock(block) {
      if (!block.subjectId) return '과목을 선택하세요.';
      if (!block.start || !block.end) return '시작/끝 시간을 입력하세요.';
      if (fmt.compareTime(block.start, block.end) >= 0) return '끝 시간은 시작 시간보다 늦어야 합니다.';
      return null;
    },

    // 블록 저장 (생성/수정)
    saveBlock(state, blockData) {
      const err = Logic.validateBlock(blockData);
      if (err) return { success: false, error: err };

      const dateKey = blockData.date || Selectors.todayKey(state);
      const blocks = state.schedule[dateKey] || [];
      const mins = fmt.timeToMins(blockData.end) - fmt.timeToMins(blockData.start);

      if (blockData.id && blocks.some(b => b.id === blockData.id)) {
        // 수정
        Object.assign(blocks.find(b => b.id === blockData.id), blockData);
      } else {
        // 생성
        const newBlock = { id: uid('blk'), ...blockData, date: dateKey, done: false, createdAt: Date.now() };
        blocks.push(newBlock);
      }
      // 시간순 정렬
      blocks.sort((a, b) => fmt.compareTime(a.start, b.start));
      state.schedule[dateKey] = blocks;
      return { success: true };
    },

    // 블록 삭제
    deleteBlock(state, blockId, dateKey) {
      const key = dateKey || Selectors.todayKey(state);
      if (state.schedule[key]) {
        const filtered = state.schedule[key].filter(b => b.id !== blockId);
        if (filtered.length === 0) {
          delete state.schedule[key];
        } else {
          state.schedule[key] = filtered;
        }
      }
    },

    // 블록 완료 토글
    toggleDone(state, blockId, dateKey) {
      const key = dateKey || Selectors.todayKey(state);
      const block = (state.schedule[key] || []).find(b => b.id === blockId);
      if (block) {
        block.done = !block.done;
        block.updatedAt = Date.now();
        // 컨페티 트리거용 이벤트 디스패치
        if (block.done) window.dispatchEvent(new CustomEvent('block-completed', { detail: { block, dateKey: key } }));
      }
    },

    // 루틴 템플릿 저장
    saveRoutine(state, routineData) {
      if (!routineData.name) return { success: false, error: '템플릿 이름을 입력하세요.' };
      if (!routineData.days?.length) return { success: false, error: '적용 요일을 선택하세요.' };
      if (!routineData.blocks?.length) return { success: false, error: '최소 1개 이상의 시간 블록을 추가하세요.' };

      const templates = state.settings.routineTemplates;
      if (routineData.id && templates.some(t => t.id === routineData.id)) {
        Object.assign(templates.find(t => t.id === routineData.id), routineData);
      } else {
        templates.push({ id: uid('tpl'), ...routineData, createdAt: Date.now() });
      }
      return { success: true };
    },

    // 루틴 삭제
    deleteRoutine(state, routineId) {
      state.settings.routineTemplates = state.settings.routineTemplates.filter(t => t.id !== routineId);
    },

    // 루틴 -> 주간 적용 (현재 주)
    applyRoutineToWeek(state, routineId) {
      const tpl = state.settings.routineTemplates.find(t => t.id === routineId);
      if (!tpl) return;

      const weekDays = Selectors.weekDays(state);
      weekDays.forEach((dateKey, dayIndex) => {
        if (!tpl.days.includes(String(dayIndex))) return; // 0:일 ~ 6:토
        const existing = state.schedule[dateKey] || [];
        tpl.blocks.forEach(b => {
          // 중복 체크 (같은 시간, 같은 과목)
          const dup = existing.some(e => e.subjectId === b.subjectId && e.start === b.start && e.end === b.end);
          if (!dup) {
            existing.push({ id: uid('blk'), ...b, date: dateKey, done: false, repeat: true, createdAt: Date.now() });
          }
        });
        existing.sort((a, b) => fmt.compareTime(a.start, b.start));
        state.schedule[dateKey] = existing;
      });
      toast('루틴이 금주 일정에 적용되었습니다!', 'success');
    },

    // 과목 저장
    saveSubject(state, subjData) {
      if (!subjData.name) return { success: false, error: '과목명을 입력하세요.' };
      const subjects = state.settings.subjects;
      if (subjData.id && subjects.some(s => s.id === subjData.id)) {
        Object.assign(subjects.find(s => s.id === subjData.id), subjData);
      } else {
        subjects.push({ id: uid('subj'), ...subjData, order: subjects.length + 1 });
      }
      return { success: true };
    },

    // 과목 삭제 (기본 8개 보호)
    deleteSubject(state, subjId) {
      const subj = state.settings.subjects.find(s => s.id === subjId);
      if (subj && CONFIG.DEFAULT_SUBJECTS.some(d => d.id === subjId)) {
        return { success: false, error: '기본 과목은 삭제할 수 없습니다.' };
      }
      state.settings.subjects = state.settings.subjects.filter(s => s.id !== subjId);
      // 관련 블록 과목 ID 초기화 (또는 삭제) - 여기선 '자율'로 매핑
      const fallback = state.settings.subjects[0]?.id || 'etc';
      Object.values(state.schedule).forEach(arr => {
        arr.forEach(b => { if (b.subjectId === subjId) b.subjectId = fallback; });
      });
      return { success: true };
    }
  };

  // ------------------------------------------------------------
  // 8. Statistics Engine (Streak, Badges, Charts)
  // ------------------------------------------------------------
  const StatsEngine = {
    // 전체 재계산 (앱 시작 시, 데이터 변경 시 호출)
    recomputeAll(state) {
      StatsEngine.recomputeStreak(state);
      StatsEngine.recomputeBadges(state);
      StatsEngine.recomputeWeeklyMinutes(state);
      StatsEngine.recomputeDailyStats(state);
    },

    // 스트릭 계산 (연속 학습일)
    recomputeStreak(state) {
      const today = fmt.dateKey();
      const dates = Object.keys(state.schedule).filter(d => 
        state.schedule[d].some(b => b.done)
      ).sort(); // 과거 -> 최근

      if (dates.length === 0) {
        state.stats.streak = 0; state.stats.lastActiveDate = null; return;
      }

      let streak = 0;
      let checkDate = new Date(today);
      // 오늘 했으면 오늘부터, 안 했으면 어제부터 거꾸로
      const todayDone = dates.includes(today);
      if (!todayDone) checkDate.setDate(checkDate.getDate() - 1);

      while (true) {
        const key = fmt.dateKey(checkDate);
        if (dates.includes(key)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else break;
      }
      state.stats.streak = streak;
      state.stats.lastActiveDate = dates[dates.length - 1];
    },

    // 뱃지 조건 체크
    recomputeBadges(state) {
      const earned = new Set(state.stats.badges);
      const todayKey = Selectors.todayKey(state);
      const todayBlocks = Selectors.todayBlocks(state);
      const doneBlocks = todayBlocks.filter(b => b.done);
      
      const context = {
        totalBlocks: Object.values(state.schedule).flat().length,
        streak: state.stats.streak,
        weeklyMinutes: state.stats.weeklyMinutes,
        dailySubjectCount: new Set(doneBlocks.map(b => b.subjectId)).size,
        hasLateNight: doneBlocks.some(b => fmt.timeToMins(b.start) >= 22 * 60)
      };

      CONFIG.BADGES.forEach(b => {
        if (!earned.has(b.id) && b.condition(context)) {
          earned.add(b.id);
          // 알림용 이벤트
          window.dispatchEvent(new CustomEvent('badge-earned', { detail: b }));
        }
      });
      state.stats.badges = Array.from(earned);
    },

    // 주간 총 분 (최근 7일)
    recomputeWeeklyMinutes(state) {
      const today = new Date();
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = fmt.dateKey(d);
        (state.schedule[key] || []).filter(b => b.done).forEach(b => {
          sum += fmt.timeToMins(b.end) - fmt.timeToMins(b.start);
        });
      }
      state.stats.weeklyMinutes = sum;
    },

    // 오늘 통계 캐시
    recomputeDailyStats(state) {
      const doneBlocks = Selectors.todayBlocks(state).filter(b => b.done);
      state.stats.dailySubjectCount = new Set(doneBlocks.map(b => b.subjectId)).size;
      state.stats.hasLateNight = doneBlocks.some(b => fmt.timeToMins(b.start) >= 22 * 60);
      state.stats.totalBlocks = Object.values(state.schedule).flat().length;
    },

    // 차트용 데이터: 최근 N일 일별 분
    getDailySeries(state, days = 7) {
      const series = [];
      const today = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = fmt.dateKey(d);
        const mins = (state.schedule[key] || []).filter(b => b.done).reduce((s, b) => s + fmt.timeToMins(b.end) - fmt.timeToMins(b.start), 0);
        series.push({ date: key, label: `${d.getMonth()+1}/${d.getDate()}`, minutes: mins });
      }
      return series;
    },

    // 차트용 데이터: 과목별 분포 (오늘 또는 기간)
    getSubjectDist(state, dateKey = null) {
      const targetKey = dateKey || Selectors.todayKey(state);
      return Selectors.todaySubjectDist(state); // 오늘 기준
    }
  };

  // ------------------------------------------------------------
  // 9. Notification & Toast System
  // ------------------------------------------------------------
  const toast = (message, type = 'info', duration = 3000) => {
    const container = $(CONFIG.SELECTORS.toastContainer);
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<span>${message}</span>`;
    container.appendChild(el);
    // 강제 리플로우 후 애니메이션
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.add('hiding');
      el.addEventListener('transitionend', () => el.remove());
    }, duration);
  };

  // 컨페티 효과 (canvas-confetti 라이브러리 없을 때 폴백)
  const fireConfetti = () => {
    if (window.confetti) {
      window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ['#2563eb', '#43a047', '#fb8c00', '#e53935', '#8e24aa'] });
    } else {
      // CSS Fallback
      const colors = ['#2563eb', '#43a047', '#fb8c00', '#e53935', '#8e24aa'];
      for (let i = 0; i < 30; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = `${1 + Math.random() * 2}s`;
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 3000);
      }
    }
  };
  // ------------------------------------------------------------
  // 10. Chart Rendering (Vanilla Canvas - No Dependencies)
  // ------------------------------------------------------------
  const Charts = {
    // 도넛 차트 (과목별 비율)
    renderDonut(canvas, data, subjects) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const size = Math.min(canvas.parentElement.clientWidth, 200);
      canvas.width = size * dpr; canvas.height = size * dpr;
      canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
      ctx.scale(dpr, dpr);
      const cx = size / 2, cy = size / 2, r = Math.min(cx, cy) - 10;
      const total = Object.values(data).reduce((a, b) => a + b, 0);
      if (total === 0) { ctx.clearRect(0, 0, size, size); return; }

      let startAngle = -Math.PI / 2;
      Object.entries(data).forEach(([subjId, mins]) => {
        const subj = subjects[subjId]; if (!subj) return;
        const sliceAngle = (mins / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = subj.color; ctx.fill();
        startAngle += sliceAngle;
      });
      // 중앙 홀 뚫기
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    },

    // 범례 렌더링
    renderLegend(container, data, subjects) {
      const total = Object.values(data).reduce((a, b) => a + b, 0);
      container.innerHTML = '';
      Object.entries(data).forEach(([id, mins]) => {
        const subj = subjects[id]; if (!subj) return;
        const pct = total ? Math.round((mins / total) * 100) : 0;
        container.appendChild(el('div', { class: 'legend-item' }, [
          el('span', { class: 'legend-color', style: `background:${subj.color}` }),
          el('span', { class: 'legend-name' }, subj.name),
          el('span', { class: 'legend-duration' }, `${fmt.durationLabel(mins)} (${pct}%)`)
        ]));
      });
    },

    // 막대 차트 (주간/월간 추이)
    renderBar(canvas, series, options = {}) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = rect.width, h = 160;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);

      const padding = { top: 20, right: 10, bottom: 30, left: 40 };
      const cw = w - padding.left - padding.right;
      const ch = h - padding.top - padding.bottom;
      const maxVal = Math.max(...series.map(d => d.minutes), 1);
      const barW = cw / series.length * 0.6;
      const gap = cw / series.length * 0.4;

      // Y축 그리드 & 라벨
      ctx.strokeStyle = '#e2e8f0'; ctx.font = '10px var(--font-mono)'; ctx.fillStyle = '#94a3b8';
      [0, 0.25, 0.5, 0.75, 1].forEach(ratio => {
        const y = padding.top + ch * (1 - ratio);
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(w - padding.right, y); ctx.stroke();
        ctx.fillText(fmt.durationLabel(Math.round(maxVal * ratio)), 4, y + 3);
      });

      // 막대 그리기
      series.forEach((d, i) => {
        const x = padding.left + i * (barW + gap) + gap / 2;
        const bh = (d.minutes / maxVal) * ch;
        const y = padding.top + ch - bh;
        const isToday = d.date === fmt.dateKey();
        
        // 그라데이션
        const grad = ctx.createLinearGradient(0, y, 0, y + bh);
        grad.addColorStop(0, isToday ? '#2563eb' : '#3b82f6');
        grad.addColorStop(1, isToday ? '#1e40af' : '#60a5fa');
        ctx.fillStyle = grad;
        
        const radius = 4;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bh, radius);
        ctx.fill();

        // 라벨 (X축)
        ctx.fillStyle = isToday ? '#2563eb' : '#64748b';
        ctx.font = '11px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x + barW / 2, h - padding.bottom + 16);
        
        // 값 텍스트 (막대 위)
        if (d.minutes > 0) {
          ctx.fillStyle = '#1e293b';
          ctx.font = '10px var(--font-mono)';
          ctx.fillText(fmt.durationLabel(d.minutes), x + barW / 2, y - 4);
        }
      });
    },

    // 스트릭 캘린더 (GitHub Contribution Graph 스타일)
    renderStreakCalendar(container, state) {
      const today = new Date();
      const weeks = 52; // 1년
      const cellSize = 12;
      const gap = 3;
      const cols = weeks;
      const rows = 7;
      
      // 데이터 맵 생성: "YYYY-MM-DD" -> level (0-4)
      const activityMap = {};
      Object.entries(state.schedule).forEach(([dateKey, blocks]) => {
        const doneMins = blocks.filter(b => b.done).reduce((s, b) => s + fmt.timeToMins(b.end) - fmt.timeToMins(b.start), 0);
        if (doneMins > 0) {
          let level = 1;
          if (doneMins >= 360) level = 4; // 6h+
          else if (doneMins >= 180) level = 3; // 3h+
          else if (doneMins >= 60) level = 2; // 1h+
          activityMap[dateKey] = level;
        }
      });

      container.innerHTML = '';
      container.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
      container.style.gap = `${gap}px`;

      // 일요일부터 시작 (0) -> 월요일(1) 기준 조정 필요시 로직 수정
      // 여기서는 JS Date 기준(일=0) 그대로 7행 그리드 구성
      for (let w = 0; w < cols; w++) {
        for (let d = 0; d < rows; d++) {
          // 날짜 계산: 오늘로부터 (52주 * 7일) 전 부터 오늘까지 역순? 
          // 보통 기여도 그래프는 과거 -> 현재 (왼 -> 오)
          // 오늘 기준 몇 일 전인지 계산
          const daysAgo = (cols - 1 - w) * 7 + (rows - 1 - d); // 거꾸로 채우기
          const date = new Date(today); date.setDate(date.getDate() - daysAgo);
          const key = fmt.dateKey(date);
          const level = activityMap[key] || 0;
          const isFuture = date > today;
          const isToday = key === fmt.dateKey();

          const cell = el('div', { 
            class: `streak-day lv${level}`, 
            title: `${fmt.dateLabel(date)}: ${level ? fmt.durationLabel(activityMap[key] * 60) : '학습 없음'}`,
            style: `width:${cellSize}px;height:${cellSize}px;`
          });
          if (isToday) cell.classList.add('today');
          if (isFuture) cell.style.visibility = 'hidden'; // 미래 날짜 숨김
          container.appendChild(cell);
        }
      }
    }
  };

  // ------------------------------------------------------------
  // 11. View Renderers (Main UI Update Functions)
  // ------------------------------------------------------------
  const Render = {
    // 공통: 현재 뷰 전환
    switchView(viewName, state) {
      $$(CONFIG.SELECTORS.views).forEach(v => v.hidden = true);
      $(`#view-${viewName}`).hidden = false;
      $$(CONFIG.SELECTORS.navItems).forEach(btn => {
        const active = btn.dataset.view === viewName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
      });
      state.ui.currentView = viewName;
      
      // 뷰별 지연 렌더링 트리거
      if (viewName === 'today') Render.today(state);
      else if (viewName === 'week') Render.week(state);
      else if (viewName === 'stats') Render.stats(state);
      else if (viewName === 'settings') Render.settings(state);
    },

    // 헤더 업데이트 (날짜, 스트릭)
    header(state) {
      const today = new Date();
      $(CONFIG.SELECTORS.todayDate).textContent = fmt.dateLabel(today);
      $(CONFIG.SELECTORS.streakCount).textContent = state.stats.streak;
      $(CONFIG.SELECTORS.streakCountLarge).textContent = state.stats.streak;
    },

    // --------------------------------------------------------
    // Today View
    // --------------------------------------------------------
    today(state) {
      Render.timeGrid(state);
      Render.dailySummary(state);
    },

    // 타임 그리드 (거터 + 셀 + 블록) - 수정된 버전
    timeGrid(state) {
      const gutter = $(CONFIG.SELECTORS.timeGutter);
      const grid = $(CONFIG.SELECTORS.timeGrid);
      const blocks = Selectors.todayBlocks(state);
      const subjectMap = Selectors.subjectMap(state);
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const isToday = true;

      // 1. 거터(시간 레이블) & 그리드 행 생성
      gutter.innerHTML = '';
      grid.innerHTML = '';
      const totalSlots = (CONFIG.DAY_END_HOUR - CONFIG.DAY_START_HOUR) * (60 / CONFIG.TIME_SLOT_MINUTES); // 36
      const rowHeight = CONFIG.TIME_ROW_HEIGHT; // 👈 [수정] 고정값 사용

      for (let i = 0; i <= totalSlots; i++) {
        const totalMins = CONFIG.DAY_START_HOUR * 60 + i * CONFIG.TIME_SLOT_MINUTES;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        const timeLabel = fmt.minsToTime(totalMins);

        // Gutter Label (정시만 표시)
        const labelEl = el('div', { class: 'time-label' }, m === 0 ? `${h.toString().padStart(2,'0')}:00` : '');
        if (m !== 0) labelEl.style.visibility = 'hidden';
        gutter.appendChild(labelEl);

        // Grid Row
        const row = el('div', { class: 'time-row', 'data-time': timeLabel });
        const cell = el('div', { class: 'time-cell', 'data-time': timeLabel, 'data-date': Selectors.todayKey(state) });
        if (isToday && totalMins === nowMins) cell.classList.add('today-now');
        row.appendChild(cell);
        grid.appendChild(row);
      }

      // 2. 블록 절대 배치
      blocks.forEach(block => {
        const startM = fmt.timeToMins(block.start);
        const endM = fmt.timeToMins(block.end);
        
        // 시작 행 인덱스 계산 (0부터 시작)
        const startSlotIndex = (startM - CONFIG.DAY_START_HOUR * 60) / CONFIG.TIME_SLOT_MINUTES;
        const durationSlots = (endM - startM) / CONFIG.TIME_SLOT_MINUTES;

        // 방어 코드: 유효한 슬롯 범위 내에 있는지 확인
        if (startSlotIndex < 0 || durationSlots <= 0 || startSlotIndex > totalSlots) return;

        const top = startSlotIndex * rowHeight;
        const height = durationSlots * rowHeight;
        
        const subj = subjectMap[block.subjectId] || { color: '#757575', name: '미분류', icon: '❓' };
        
        const blkEl = el('div', {
          class: `study-block ${block.done ? 'done' : ''} ${block.repeat ? 'repeat' : ''}`,
          style: `top:${top}px; height:${height}px; background:${subj.color};`,
          dataset: { blockId: block.id, date: block.date || Selectors.todayKey(state) }
        }, [
          el('div', { class: 'block-check', 'aria-label': block.done ? '완료 취소' : '완료 처리', onclick: (e)=>{e.stopPropagation(); Controller.toggleBlock(block.id);} }),
          el('div', { class: 'block-title' }, `${subj.icon} ${subj.name}`),
          block.memo ? el('div', { class: 'block-memo' }, block.memo) : null,
          el('div', { class: 'block-time' }, `${block.start} ~ ${block.end}`)
        ]);
        
        // 드래그 이벤트
        blkEl.draggable = true;
        blkEl.addEventListener('dragstart', Controller.onDragStart);
        blkEl.addEventListener('dragend', Controller.onDragEnd);
        // 클릭 시 수정 모달 (체크박스 제외)
        blkEl.addEventListener('click', (e) => { 
          if (e.target !== blkEl.querySelector('.block-check')) Controller.openBlockModal(block.id); 
        });
        
        grid.appendChild(blkEl); // grid(container)에 직접 추가
      });
    },

    // 일일 통계 요약
    dailySummary(state) {
      const planned = Selectors.todayPlannedMinutes(state);
      const done = Selectors.todayDoneMinutes(state);
      const target = 240; // 기본 목표 4시간 (설정화 가능)
      
      $(CONFIG.SELECTORS.statTarget).textContent = fmt.durationLabel(target);
      $(CONFIG.SELECTORS.statTarget).dateTime = `PT${target}M`;
      $(CONFIG.SELECTORS.statPlanned).textContent = fmt.durationLabel(planned);
      $(CONFIG.SELECTORS.statPlanned).dateTime = `PT${planned}M`;
      $(CONFIG.SELECTORS.statDone).textContent = fmt.durationLabel(done);
      $(CONFIG.SELECTORS.statDone).dateTime = `PT${done}M`;

      // 차트
      const dist = Selectors.todaySubjectDist(state);
      const subjects = Selectors.subjectMap(state);
      Charts.renderDonut($(CONFIG.SELECTORS.chartDonut), dist, subjects);
      Charts.renderLegend($(CONFIG.SELECTORS.chartLegend), dist, subjects);
    },

    // --------------------------------------------------------
    // Week View
    // --------------------------------------------------------
    week(state) {
      const weekDays = Selectors.weekDays(state);
      const weekBlocks = Selectors.weekBlocks(state);
      const subjectMap = Selectors.subjectMap(state);
      const start = fmt.parseDate(weekDays[0]);
      const end = fmt.parseDate(weekDays[6]);
      
      $(CONFIG.SELECTORS.weekRange).textContent = `${start.getMonth()+1}/${start.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}`;
      
      const grid = $(CONFIG.SELECTORS.weekGrid);
      grid.innerHTML = '';
      
      weekDays.forEach((dayKey, idx) => {
        const date = fmt.parseDate(dayKey);
        const isToday = dayKey === fmt.dateKey();
        const blocks = weekBlocks[dayKey] || [];
        
        const col = el('div', { class: 'week-col' }, [
          el('div', { class: `week-col-header ${isToday ? 'today' : ''}` }, [
            el('span', { class: 'day-name' }, '일월화수목금토'[date.getDay()]),
            el('span', { class: 'day-date' }, date.getDate())
          ]),
          el('div', { class: 'week-col-body', 'data-date': dayKey }, 
            blocks.map(block => {
              const subj = subjectMap[block.subjectId] || { color: '#757575', name: '', icon: '' };
              return el('div', {
                class: `week-block ${block.done ? 'done' : ''}`,
                style: `background:${subj.color};`,
                dataset: { blockId: block.id, date: dayKey },
                onclick: () => Controller.openBlockModal(block.id, dayKey)
              }, [
                el('div', { class: 'w-block-title' }, `${subj.icon} ${subj.name}`),
                block.memo ? el('div', { class: 'w-block-memo' }, block.memo) : null,
                el('div', { class: 'w-block-time' }, `${block.start} ~ ${block.end}`)
              ]);
            })
          )
        ]);
        grid.appendChild(col);
      });
      
      // 루틴 적용 버튼 표시 여부
      $(CONFIG.SELECTORS.btnApplyRoutine).hidden = state.settings.routineTemplates.length === 0;
    },

    // --------------------------------------------------------
    // Stats View
    // --------------------------------------------------------
    stats(state) {
      // 스트릭 캘린더
      Charts.renderStreakCalendar($(CONFIG.SELECTORS.streakCalendar), state);
      $(CONFIG.SELECTORS.streakHint).textContent = state.stats.streak > 0 
        ? `최근 ${state.stats.lastActiveDate ? fmt.dateLabel(fmt.parseDate(state.stats.lastActiveDate)) : '오늘'} 학습 완료!` 
        : '오늘 공부하면 스트릭이 시작돼요!';
      
      // 주간 막대 차트
      const period = $(CONFIG.SELECTORS.chartPeriod).value; // 'week' or 'month'
      const days = period === 'week' ? 7 : 30;
      const series = StatsEngine.getDailySeries(state, days);
      Charts.renderBar($(CONFIG.SELECTORS.chartWeeklyBar), series);
      
      // 상세 통계 (요일별)
      const detailEl = $(CONFIG.SELECTORS.weeklyStatsDetail);
      detailEl.innerHTML = '';
      series.forEach(d => {
        detailEl.appendChild(el('div', {}, [
          el('dt', {}, d.label),
          el('dd', {}, d.minutes > 0 ? fmt.durationLabel(d.minutes) : '-')
        ]));
      });

      // 뱃지
      Render.badges(state);
    },

    badges(state) {
      const grid = $(CONFIG.SELECTORS.badgesGrid);
      const empty = $(CONFIG.SELECTORS.badgesEmpty);
      const earnedSet = new Set(state.stats.badges);
      
      grid.innerHTML = '';
      CONFIG.BADGES.forEach(b => {
        const earned = earnedSet.has(b.id);
        grid.appendChild(el('div', { 
          class: `badge-card ${earned ? 'earned' : 'locked'}`, 
          title: earned ? `${b.name}: ${b.desc}` : `미획득: ${b.desc}`
        }, [
          el('div', { class: 'badge-icon' }, earned ? b.icon : '🔒'),
          el('div', { class: 'badge-name' }, b.name)
        ]));
      });
      empty.hidden = earnedSet.size > 0;
    },

    // --------------------------------------------------------
    // Settings View
    // --------------------------------------------------------
    settings(state) {
      Render.subjectList(state);
      Render.routineList(state);
      // 토글 동기화
      $(CONFIG.SELECTORS.toggleNotify).checked = state.settings.notifyEnabled;
      $(CONFIG.SELECTORS.toggleDark).checked = state.settings.darkModeForced === true;
    },

    subjectList(state) {
      const list = $(CONFIG.SELECTORS.subjectList);
      list.innerHTML = '';
      Selectors.activeSubjects(state).forEach((subj, idx) => {
        const isDefault = CONFIG.DEFAULT_SUBJECTS.some(d => d.id === subj.id);
        list.appendChild(el('li', { class: 'subject-item', draggable: true, dataset: { subjectId: subj.id } }, [
          el('span', { class: 'subject-color-dot', style: `background:${subj.color}` }),
          el('span', { class: 'subject-icon' }, subj.icon),
          el('span', { class: 'subject-name' }, subj.name),
          el('div', { class: 'subject-actions' }, [
            el('button', { class: 'icon-btn', 'aria-label': '수정', onclick: () => Controller.openSubjectModal(subj.id) }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, el('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' })), 
            ),
            !isDefault ? el('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => Controller.deleteSubject(subj.id) }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, el('path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })) 
            ) : null
          ])
        ]));
      });
      // 드래그 정렬 바인딩
      Controller.bindSubjectSortable(list);
    },

    routineList(state) {
      const list = $(CONFIG.SELECTORS.routineList);
      list.innerHTML = '';
      state.settings.routineTemplates.forEach(tpl => {
        const dayNames = '일월화수목금토';
        const daysStr = tpl.days.map(d => dayNames[d]).join(', ');
        const blockCount = tpl.blocks.length;
        list.appendChild(el('li', { class: 'routine-item' }, [
          el('div', { class: 'routine-info' }, [
            el('div', { class: 'routine-name' }, tpl.name),
            el('div', { class: 'routine-meta' }, [
              el('span', { class: 'routine-day' }, `요일: ${daysStr}`),
              el('span', { class: 'routine-day' }, `블록: ${blockCount}개`)
            ])
          ]),
          el('div', { class: 'routine-actions' }, [
            el('button', { class: 'icon-btn', 'aria-label': '이 주에 적용', onclick: () => Logic.applyRoutineToWeek(store.getState(), tpl.id) }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, el('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }), el('path', { d: 'M22 21H2' }), el('path', { d: 'M8.5 4h7a2 2 0 0 1 2 2v6' })) 
            ),
            el('button', { class: 'icon-btn', 'aria-label': '수정', onclick: () => Controller.openRoutineModal(tpl.id) }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, el('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' })) 
            ),
            el('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => Controller.deleteRoutine(tpl.id) }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, el('path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })) 
            )
          ])
        ]));
      });
    }
  };
   // ------------------------------------------------------------
  // 12. Controller (Event Handlers & UI Interactions)
  // ------------------------------------------------------------
  const Controller = {
    // 현재 드래그 중인 블록 참조
    draggedBlock: null,
    draggedFromDate: null,

    // 초기화 및 이벤트 바인딩
    init(state) {
      // 뷰 전환 (하단 네비)
      $$(CONFIG.SELECTORS.navItems).forEach(btn => 
        btn.addEventListener('click', () => this.switchView(btn.dataset.view, state))
      );

      // 헤더 버튼
      $(CONFIG.SELECTORS.btnAddBlock).addEventListener('click', () => this.openBlockModal(null, Selectors.todayKey(state)));
      $(CONFIG.SELECTORS.btnExport).addEventListener('click', () => Storage.exportJSON(state));
      $(CONFIG.SELECTORS.btnImportTrigger).addEventListener('click', () => $(CONFIG.SELECTORS.inputImport).click());
      $(CONFIG.SELECTORS.inputImport).addEventListener('change', (e) => this.handleImport(e, state));
      $(CONFIG.SELECTORS.btnSettings).addEventListener('click', () => this.switchView('settings', state));

      // 주간 뷰 네비
      $(CONFIG.SELECTORS.btnPrevWeek).addEventListener('click', () => this.navigateWeek(state, -1));
      $(CONFIG.SELECTORS.btnNextWeek).addEventListener('click', () => this.navigateWeek(state, 1));
      $(CONFIG.SELECTORS.btnApplyRoutine).addEventListener('click', () => this.openRoutinePicker(state));

      // 통계 뷰 기간 변경
      $(CONFIG.SELECTORS.chartPeriod).addEventListener('change', () => Render.stats(state));

      // 설정 폼 이벤트
      $(CONFIG.SELECTORS.btnAddSubject).addEventListener('click', () => this.openSubjectModal(null));
      $(CONFIG.SELECTORS.btnAddRoutine).addEventListener('click', () => this.openRoutineModal(null));
      $(CONFIG.SELECTORS.toggleNotify).addEventListener('change', (e) => { state.settings.notifyEnabled = e.target.checked; this.requestNotificationPermission(); });
      $(CONFIG.SELECTORS.toggleDark).addEventListener('change', (e) => this.setDarkMode(e.target.checked, state));
      $(CONFIG.SELECTORS.btnExportData).addEventListener('click', () => Storage.exportJSON(state));
      $(CONFIG.SELECTORS.inputImportData).addEventListener('change', (e) => this.handleImport(e, state));
      $(CONFIG.SELECTORS.btnResetData).addEventListener('click', () => this.confirmReset(state));

      // 모달 폼 제출
      $(CONFIG.SELECTORS.formBlock).addEventListener('submit', (e) => this.handleBlockSubmit(e, state));
      $(CONFIG.SELECTORS.formSubject).addEventListener('submit', (e) => this.handleSubjectSubmit(e, state));
      $(CONFIG.SELECTORS.formRoutine).addEventListener('submit', (e) => this.handleRoutineSubmit(e, state));

      // 모달 삭제 버튼
      $('#btn-delete-block').addEventListener('click', () => this.deleteCurrentBlock(state));
      $('#btn-delete-routine').addEventListener('click', () => this.deleteCurrentRoutine(state));

      // 모달 외부 클릭/ESC 닫기
      $$('dialog.modal').forEach(d => {
		// 1. 배경(Backdrop) 클릭 시 닫기 (유지)
		d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

		// 2. ESC 키 취소 이벤트 (유지 - preventDefault 후 close로 커스텀 동작 가능)
		d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); });

		// 3. X버튼/취소버튼 클릭 리스너 -> **삭제 가능** (HTML에서 처리됨)
      });

      // 드래그 앤 드롭 (타임 그리드 위)
      const grid = $(CONFIG.SELECTORS.timeGrid);
      grid.addEventListener('dragover', this.onDragOver);
      grid.addEventListener('dragleave', this.onDragLeave);
      grid.addEventListener('drop', (e) => this.onDrop(e, state));
      
      // 터치 지원 (모바일 드래그)
      this.bindTouchDrag(grid, state);

      // 색상 피커 초기화 (설정 모달 열릴 때 동적 바인딩)
      // -> openSubjectModal에서 처리
    },

    // 뷰 전환
    switchView(viewName, state) {
      Render.switchView(viewName, state);
      // 스크롤 최상단
      $(CONFIG.SELECTORS.mainContent).scrollTop = 0;
    },

    // 주간 이동
    navigateWeek(state, delta) {
      const current = fmt.parseDate(state.ui.currentWeekStart);
      current.setDate(current.getDate() + delta * 7);
      // 월요일로 보정
      const day = current.getDay(); // 0:일
      const diff = day === 0 ? -6 : 1 - day; // 월요일(1) 기준
      current.setDate(current.getDate() + diff);
      state.ui.currentWeekStart = fmt.dateKey(current);
      Render.week(state);
    },

    // --------------------------------------------------------
    // Block Modal Management
    // --------------------------------------------------------
    openBlockModal(blockId, dateKey = null) {
      const state = store.getState();
      const block = blockId ? 
        (state.schedule[dateKey || Selectors.todayKey(state)] || []).find(b => b.id === blockId) 
        : null;
      
      const form = $(CONFIG.SELECTORS.formBlock);
      form.reset();
      $('#input-block-id').value = block?.id || '';
      $('#input-block-date').value = dateKey || Selectors.todayKey(state);
      
      // 과목 옵션 채우기
      const sel = $('#select-subject');
      sel.innerHTML = '';
      Selectors.activeSubjects(state).forEach(s => 
        sel.appendChild(el('option', { value: s.id }, `${s.icon} ${s.name}`))
      );
      
      if (block) {
        $('#modal-title').textContent = '공부 블록 수정';
        $('#select-subject').value = block.subjectId;
        $('#input-start').value = block.start;
        $('#input-end').value = block.end;
        $('#input-memo').value = block.memo || '';
        $('#input-repeat').checked = block.repeat || false;
        $('#btn-delete-block').hidden = false;
      } else {
        $('#modal-title').textContent = '공부 블록 추가';
        // 기본값: 현재 시간 ~ +1시간
        const now = new Date();
        const start = fmt.minsToTime(now.getHours() * 60 + now.getMinutes());
        const end = fmt.minsToTime(now.getHours() * 60 + now.getMinutes() + 60);
        $('#input-start').value = start;
        $('#input-end').value = end;
        $('#btn-delete-block').hidden = true;
      }
      $(CONFIG.SELECTORS.modalBlock).showModal();
    },

    handleBlockSubmit(e, state) {
    // 👇 [핵심 추가] 취소/X버튼 클릭 시 submit 이벤트 무시
    const submitter = e.submitter; // 클릭된 버튼 요소
    if (submitter && (submitter.value === 'cancel' || submitter.classList.contains('modal-close') || submitter.formMethod === 'dialog')) {
      return; // 다이얼로그는 브라우저가 자동으로 닫아줌 (JS 개입 불필요)
    }

    e.preventDefault(); // 저장 버튼일 때만 기본 동작(페이지 리로드 등) 방지
    const form = e.target;
    const data = {
      id: form.blockId.value || null,
      date: form.date.value,
      subjectId: form.subjectId.value,
      start: form.startTime.value,
      end: form.endTime.value,
      memo: form.memo.value,
      repeat: form.repeat.checked
    };
    const res = Logic.saveBlock(state, data);
    if (res.success) {
      toast('저장되었습니다.', 'success');
      $(CONFIG.SELECTORS.modalBlock).close(); // 수동 닫기 (저장 버튼은 formmethod="dialog" 없으므로)
      if (state.ui.currentView === 'today') Render.today(state);
      else if (state.ui.currentView === 'week') Render.week(state);
      else if (state.ui.currentView === 'stats') Render.stats(state);
    } else {
      toast(res.error, 'error');
    }
  },

    deleteCurrentBlock(state) {
      const form = $(CONFIG.SELECTORS.formBlock);
      const id = form.blockId.value;
      const date = form.date.value;
      if (confirm('정말 삭제하시겠습니까?')) {
        Logic.deleteBlock(state, id, date);
        toast('삭제되었습니다.', 'success');
        $(CONFIG.SELECTORS.modalBlock).close();
        Render.today(state); Render.week(state); Render.stats(state);
      }
    },

    toggleBlock(blockId) {
      const state = store.getState();
      Logic.toggleDone(state, blockId);
      // 즉각적인 UI 피드백 (리렌더 없이 클래스 토글)
      const el = document.querySelector(`.study-block[data-block-id="${blockId}"]`);
      if (el) el.classList.toggle('done');
      Render.dailySummary(state); Render.stats(state);
    },

    // --------------------------------------------------------
    // Subject Modal
    // --------------------------------------------------------
    openSubjectModal(subjectId) {
      const state = store.getState();
      const form = $(CONFIG.SELECTORS.formSubject);
      form.reset();
      const picker = $('#subject-color-picker');
      picker.innerHTML = '';
      
      // 색상 옵션 생성
      const colors = ['#e53935','#1e88e5','#43a047','#fb8c00','#00acc1','#8e24aa','#d81b60','#757575','#f57c00','#3949ab','#00897b','#c0ca33'];
      colors.forEach((c, i) => {
        const id = `color_${i}`;
        picker.appendChild(el('label', { class: 'color-option' }, [
          el('input', { type: 'radio', name: 'color', value: c, id, checked: i===0 }),
          el('span', { class: 'color-swatch', style: `background:${c}` })
        ]));
      });

      if (subjectId) {
        const subj = state.settings.subjects.find(s => s.id === subjectId);
        $('#modal-subject-title').textContent = '과목 수정';
        $('#input-subject-id').value = subj.id;
        $('#input-subject-name').value = subj.name;
        $('#input-subject-icon').value = subj.icon;
        const radio = picker.querySelector(`input[value="${subj.color}"]`);
        if (radio) radio.checked = true;
        // 👇 [삭제] $('#btn-delete-subject').hidden = false;  <-- 이 줄 제거 (버튼 없음)
      } else {
        $('#modal-subject-title').textContent = '과목 추가';
        $('#input-subject-id').value = '';
        // 👇 [삭제] $('#btn-delete-subject').hidden = true;   <-- 이 줄 제거 (버튼 없음)
      }
      $(CONFIG.SELECTORS.modalSubject).showModal();
    },

    handleSubjectSubmit(e, state) {
      const submitter = e.submitter;
      // 👇 [강화] value="cancel" 이거나 formmethod="dialog" 이거나 modal-close 클래스면 무조건 무시
      const isCancelAction = submitter && (
        submitter.value === 'cancel' || 
        submitter.formMethod === 'dialog' || 
        submitter.classList.contains('modal-close')
      );

      if (isCancelAction) {
        return; // 브라우저 네이티브로 다이얼로그 닫힘 (유효성 검사 안 함)
      }

      // --- 저장 버튼 클릭 시만 아래 로직 실행 ---
      e.preventDefault(); // 기본 다이얼로그 닫기 방지 (JS에서 수동 close)
      const form = e.target;
      const color = form.querySelector('input[name="color"]:checked')?.value || '#757575';
      const data = {
        id: form.subjectId.value || null,
        name: form.name.value,
        color: color,
        icon: form.icon.value || '📝'
      };
      const res = Logic.saveSubject(state, data);
      if (res.success) {
        toast('저장되었습니다.', 'success');
        $(CONFIG.SELECTORS.modalSubject).close();
        Render.settings(state); Render.today(state); Render.week(state);
      } else {
        toast(res.error, 'error');
      }
    },

    deleteSubject(subjectId) {
      const state = store.getState();
      if (confirm('과목을 삭제하면 관련 일정의 과목이 "자율"로 변경됩니다. 계속할까요?')) {
        const res = Logic.deleteSubject(state, subjectId);
        if (res.success) { toast('삭제되었습니다.', 'success'); Render.settings(state); Render.today(state); }
        else toast(res.error, 'error');
      }
    },

    // --------------------------------------------------------
    // Routine Modal
    // --------------------------------------------------------
    openRoutineModal(routineId) {
      const state = store.getState();
      const form = $(CONFIG.SELECTORS.formRoutine);
      form.reset();
      const container = $('#routine-blocks');
      container.innerHTML = '';
      
      // 요일 체크박스 초기화
      $$('#modal-routine .day-check').forEach(c => c.checked = false);

      const addBlockRow = (block = {}) => {
        const subjects = Selectors.activeSubjects(state);
        const options = subjects.map(s => el('option', { value: s.id }, `${s.icon} ${s.name}`)).join('');
        const row = el('div', { class: 'routine-block-row' }, [
          el('select', { name: 'subjectId', required: true }, options),
          el('input', { type: 'time', name: 'start', required: true, value: block.start || '19:00' }),
          el('input', { type: 'time', name: 'end', required: true, value: block.end || '20:00' }),
          el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: (e) => e.target.closest('.routine-block-row').remove() }, '삭제')
        ]);
        container.appendChild(row);
      };

      if (routineId) {
        const tpl = state.settings.routineTemplates.find(t => t.id === routineId);
        $('#modal-routine-title').textContent = '루틴 템플릿 수정';
        $('#input-routine-id').value = tpl.id;
        $('#input-routine-name').value = tpl.name;
        tpl.days.forEach(d => $(`#modal-routine input[value="${d}"]`).checked = true);
        tpl.blocks.forEach(b => addBlockRow(b));
        $('#btn-delete-routine').hidden = false;
      } else {
        $('#modal-routine-title').textContent = '루틴 템플릿 만들기';
        $('#input-routine-id').value = '';
        addBlockRow(); // 기본 1행
        $('#btn-delete-routine').hidden = true;
      }
      $(CONFIG.SELECTORS.modalRoutine).showModal();
    },

    handleRoutineSubmit(e, state) {
		// 👇 [핵심 추가] 취소/X버튼 클릭 시 즉시 리턴
		const submitter = e.submitter;
		if (submitter && (submitter.value === 'cancel' || submitter.classList.contains('modal-close') || submitter.formMethod === 'dialog')) {
		  return;
		}

		e.preventDefault();
		const form = e.target;
		const days = Array.from(form.querySelectorAll('input[name="days"]:checked')).map(c => c.value);
		const blocks = Array.from(form.querySelectorAll('.routine-block-row')).map(row => ({
		  subjectId: row.querySelector('[name="subjectId"]').value,
		  start: row.querySelector('[name="start"]').value,
		  end: row.querySelector('[name="end"]').value
		})).filter(b => b.subjectId && b.start && b.end);

		const data = {
		  id: form.routineId.value || null,
		  name: form.name.value,
		  days: days,
		  blocks: blocks
		};
		const res = Logic.saveRoutine(state, data);
		if (res.success) {
		  toast('저장되었습니다.', 'success');
		  $(CONFIG.SELECTORS.modalRoutine).close();
		  Render.settings(state);
		} else toast(res.error, 'error');
	  },

    deleteCurrentRoutine(state) {
      const id = $('#input-routine-id').value;
      if (confirm('템플릿을 삭제하시겠습니까?')) {
        Logic.deleteRoutine(state, id);
        toast('삭제되었습니다.', 'success');
        $(CONFIG.SELECTORS.modalRoutine).close();
        Render.settings(state);
      }
    },

    // 루틴 적용 피커 (간단 알럿 대신 모달 또는 프롬프트)
    openRoutinePicker(state) {
      const templates = state.settings.routineTemplates;
      if (!templates.length) return;
      if (templates.length === 1) { Logic.applyRoutineToWeek(state, templates[0].id); return; }
      
      // 간단한 선택 UI (confirm 시퀀스 또는 별도 모달)
      // 여기서는 첫 번째 것만 적용하는 것으로 간소화하거나, 프롬프트 사용
      const names = templates.map((t, i) => `${i+1}. ${t.name}`).join('\n');
      const choice = prompt(`적용할 루틴 번호를 입력하세요:\n${names}`);
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < templates.length) Logic.applyRoutineToWeek(state, templates[idx].id);
    },
   // --------------------------------------------------------
    // Drag & Drop (Desktop) - Time Grid
    // --------------------------------------------------------
    onDragStart(e) {
      this.draggedBlock = e.target.closest('.study-block');
      if (!this.draggedBlock) return;
      this.draggedFromDate = this.draggedBlock.dataset.date;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // 드래그 고스트 이미지 커스텀 (선택적)
      setTimeout(() => e.target.classList.add('drag-ghost'), 0);
    },

    onDragEnd(e) {
      e.target.classList.remove('dragging', 'drag-ghost');
      $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
      this.draggedBlock = null;
      this.draggedFromDate = null;
    },

    onDragOver(e) {
      e.preventDefault(); // 드롭 허용 필수
      e.dataTransfer.dropEffect = 'move';
      const cell = e.target.closest('.time-cell');
      if (cell) {
        $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
        cell.classList.add('drop-target');
      }
    },

    onDragLeave(e) {
      // 그리드 밖으로 나갔을 때만 제거 (자식 요소 이동 시 불필요한 방지)
      if (!e.currentTarget.contains(e.relatedTarget)) {
        $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
      }
    },

    onDrop(e, state) {
      e.preventDefault();
      const targetCell = e.target.closest('.time-cell');
      $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
      
      if (!this.draggedBlock || !targetCell) return;

      const blockId = this.draggedBlock.dataset.blockId;
      const newDate = targetCell.dataset.date || Selectors.todayKey(state); // 주간 뷰 드롭 고려
      const newTime = targetCell.dataset.time; // "HH:MM"
      
      // 블록 길이 유지하며 이동
      const block = (state.schedule[this.draggedFromDate] || []).find(b => b.id === blockId);
      if (!block) return;

      const duration = fmt.timeToMins(block.end) - fmt.timeToMins(block.start);
      const newStartMins = fmt.timeToMins(newTime);
      const newEndMins = newStartMins + duration;

      // 경계 체크 (6시~24시)
      if (newStartMins < CONFIG.DAY_START_HOUR * 60 || newEndMins > CONFIG.DAY_END_HOUR * 60) {
        toast('시간 범위(06:00~24:00)를 벗어날 수 없습니다.', 'error');
        return;
      }

      // 원본에서 삭제
      Logic.deleteBlock(state, blockId, this.draggedFromDate);
      // 새 위치에 생성
      Logic.saveBlock(state, {
        ...block,
        id: null, // 새 ID 발급
        date: newDate,
        start: fmt.minsToTime(newStartMins),
        end: fmt.minsToTime(newEndMins)
      });

      toast('일정이 이동되었습니다.', 'success');
      Render.today(state); Render.week(state); Render.stats(state);
    },

    // --------------------------------------------------------
    // Touch Drag (Mobile) - Simplified
    // --------------------------------------------------------
    bindTouchDrag(grid, state) {
      let touchStartY = 0, touchStartX = 0;
      let draggedEl = null, placeholder = null, startTop = 0;
      const rowHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--time-row-h'));

      grid.addEventListener('touchstart', (e) => {
        const target = e.target.closest('.study-block');
        if (!target) return;
        draggedEl = target;
        const touch = e.touches[0];
        touchStartY = touch.clientY;
        touchStartX = touch.clientX;
        startTop = draggedEl.offsetTop;
        
        // 플레이스홀더 생성 (레이아웃 유지)
        placeholder = document.createElement('div');
        placeholder.className = 'study-block placeholder';
        placeholder.style.height = `${draggedEl.offsetHeight}px`;
        placeholder.style.opacity = '0.3';
        draggedEl.parentNode.insertBefore(placeholder, draggedEl);
        draggedEl.classList.add('dragging');
        draggedEl.style.position = 'absolute';
        draggedEl.style.zIndex = '100';
        draggedEl.style.width = `${draggedEl.offsetWidth}px`;
      }, { passive: true });

      grid.addEventListener('touchmove', (e) => {
        if (!draggedEl) return;
        e.preventDefault(); // 스크롤 방지
        const touch = e.touches[0];
        const deltaY = touch.clientY - touchStartY;
        draggedEl.style.top = `${startTop + deltaY}px`;
        
        // 호버 효과: 가장 가까운 셀 하이라이트
        const rect = draggedEl.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const targetCell = document.elementFromPoint(touch.clientX, centerY);
        const cell = targetCell?.closest('.time-cell');
        $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
        if (cell) cell.classList.add('drop-target');
      }, { passive: false });

      grid.addEventListener('touchend', (e) => {
        if (!draggedEl) return;
        draggedEl.classList.remove('dragging');
        draggedEl.style.position = '';
        draggedEl.style.zIndex = '';
        draggedEl.style.top = '';
        draggedEl.style.width = '';
        $$('.time-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
        
        const targetCell = placeholder?.parentElement?.querySelector('.time-cell.drop-target');
        if (targetCell && placeholder) {
          const blockId = draggedEl.dataset.blockId;
          const newDate = targetCell.dataset.date || Selectors.todayKey(state);
          const newTime = targetCell.dataset.time;
          const block = (state.schedule[draggedEl.dataset.date] || []).find(b => b.id === blockId);
          
          if (block) {
            const duration = fmt.timeToMins(block.end) - fmt.timeToMins(block.start);
            const newStartMins = fmt.timeToMins(newTime);
            const newEndMins = newStartMins + duration;
            if (newStartMins >= CONFIG.DAY_START_HOUR * 60 && newEndMins <= CONFIG.DAY_END_HOUR * 60) {
              Logic.deleteBlock(state, blockId, draggedEl.dataset.date);
              Logic.saveBlock(state, { ...block, id: null, date: newDate, start: fmt.minsToTime(newStartMins), end: fmt.minsToTime(newEndMins) });
              toast('일정이 이동되었습니다.', 'success');
              Render.today(state); Render.week(state); Render.stats(state);
            } else {
              toast('시간 범위를 벗어났습니다.', 'error');
            }
          }
        }
        placeholder?.remove();
        placeholder = null;
        draggedEl = null;
      });
    },

    // --------------------------------------------------------
    // Settings Actions: Import / Reset / DarkMode / Notify
    // --------------------------------------------------------
    async handleImport(e, state) {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = ''; // 같은 파일 재선택 가능하게
      
      try {
        const data = await Storage.importJSON(file);
        // 상태 병합 (기존 상태 유지하며 덮어쓰기)
        Object.assign(state.settings, data.settings);
        Object.assign(state.schedule, data.schedule);
        Object.assign(state.stats, data.stats);
        Object.assign(state.ui, data.ui);
        
        Storage.save(state);
        StatsEngine.recomputeAll(state); // 통계 재계산
        Render.header(state);
        Render.today(state); Render.week(state); Render.stats(state); Render.settings(state);
        toast('데이터가 복구되었습니다.', 'success');
      } catch (err) {
        console.error(err);
        toast('잘못된 백업 파일입니다.', 'error');
      }
    },

    confirmReset(state) {
      if (confirm('⚠️ 모든 데이터(일정, 설정, 기록)가 영구 삭제됩니다. 정말 초기화하시겠습니까?')) {
        if (confirm('되돌릴 수 없습니다. 확실하신가요?')) {
          localStorage.removeItem(CONFIG.STORAGE_KEY);
          location.reload(); // 가장 확실한 초기화
        }
      }
    },

    setDarkMode(forced, state) {
      state.settings.darkModeForced = forced;
      const html = document.documentElement;
      if (forced === true) html.setAttribute('data-theme', 'dark');
      else if (forced === false) html.setAttribute('data-theme', 'light');
      else html.removeAttribute('data-theme'); // 시스템 설정 따름
    },

    async requestNotificationPermission() {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') toast('알림 권한이 차단되었습니다. 브라우저 설정에서 허용해주세요.', 'warning');
      }
    },

    // 과목 정렬 (Sortable) 바인딩
    bindSubjectSortable(list) {
      // 간단한 네이티브 드래그 정렬 구현
      let draggedItem = null;
      list.querySelectorAll('.subject-item').forEach(item => {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
          draggedItem = item; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => { item.classList.remove('dragging'); draggedItem = null; });
        item.addEventListener('dragover', (e) => { e.preventDefault(); });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          if (draggedItem && draggedItem !== item) {
            const items = [...list.querySelectorAll('.subject-item')];
            const from = items.indexOf(draggedItem);
            const to = items.indexOf(item);
            if (from < to) item.after(draggedItem); else item.before(draggedItem);
            // Order 업데이트
            const state = store.getState();
            items.forEach((it, idx) => {
              const subj = state.settings.subjects.find(s => s.id === it.dataset.subjectId);
              if (subj) subj.order = idx;
            });
            Render.subjectList(state); // 재렌더링으로 순서 고정
          }
        });
      });
    }
  };
   // ------------------------------------------------------------
  // 13. Global Event Listeners (Reactive Side Effects)
  // ------------------------------------------------------------
  // 블록 완료 시 컨페티 & 스트릭 업데이트
  window.addEventListener('block-completed', (e) => {
    const { block, dateKey } = e.detail;
    fireConfetti();
    toast(`🎉 ${block.memo || '공부'} 완료!`, 'success', 2000);
    // 즉시 통계 반영을 위해 재계산 트리거
    const state = store.getState();
    StatsEngine.recomputeStreak(state);
    StatsEngine.recomputeBadges(state);
    StatsEngine.recomputeWeeklyMinutes(state);
    StatsEngine.recomputeDailyStats(state);
    Render.header(state);
    Render.dailySummary(state);
    Render.stats(state);
  });

  // 뱃지 획득 시 알림
  window.addEventListener('badge-earned', (e) => {
    const badge = e.detail;
    toast(`🏅 새로운 뱃지 획득: ${badge.name} (${badge.icon})`, 'success', 5000);
    // 뱃지 모달이나 화려한 이펙트 추가 가능
  });

  // 키보드 단축키
  window.addEventListener('keydown', (e) => {
    // Input/textarea/select 포커스 중이면 무시
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const state = store.getState();
    
    if (e.key === 'n' || e.key === 'N') { // N: 새 블록
      e.preventDefault(); Controller.openBlockModal(null, Selectors.todayKey(state));
    } else if (e.key === 't' || e.key === 'T') { // T: 오늘 뷰
      Controller.switchView('today', state);
    } else if (e.key === 'w' || e.key === 'W') { // W: 주간 뷰
      Controller.switchView('week', state);
    } else if (e.key === 's' || e.key === 'S') { // S: 통계 뷰
      Controller.switchView('stats', state);
    } else if (e.key === ',' || e.key === '<') { // ,: 설정
      Controller.switchView('settings', state);
    } else if (e.key === 'ArrowLeft') { // ←: 주간 이전
      if (state.ui.currentView === 'week') Controller.navigateWeek(state, -1);
    } else if (e.key === 'ArrowRight') { // →: 주간 다음
      if (state.ui.currentView === 'week') Controller.navigateWeek(state, 1);
    } else if (e.key === '?' || e.key === '/') { // ?: 도움말 (추후 구현)
      toast('단축키: N(새블록) T(오늘) W(주간) S(기록) ,(설정) ←/→(주이동)', 'info', 4000);
    }
  });

  // 온라인/오프라인 감지
  window.addEventListener('online', () => toast('온라인 상태가 되었습니다.', 'success'));
  window.addEventListener('offline', () => toast('오프라인 모드입니다. 데이터는 로컬에 저장됩니다.', 'warning'));

  // ------------------------------------------------------------
  // 14. Application Bootstrap (Main Entry Point)
  // ------------------------------------------------------------
  const store = createStore(initialState);

  // 초기 로드
  function initApp() {
    const saved = Storage.load();
    if (saved) {
      Object.assign(store.getState().settings, saved.settings);
      Object.assign(store.getState().schedule, saved.schedule);
      Object.assign(store.getState().stats, saved.stats);
      Object.assign(store.getState().ui, saved.ui);
    }
    
    const state = store.getState();

	// 👇 [수정] darkModeForced 값이 boolean(false/true)이므로 무조건 적용
    // 저장된 값이 null(구 버전)이라도 false로 폴백 처리
	const darkModeVal = state.settings.darkModeForced === true; 
    Controller.setDarkMode(darkModeVal, state);
    $(CONFIG.SELECTORS.toggleDark).checked = darkModeVal;
    
    // 알림 권한 상태 동기화
    $(CONFIG.SELECTORS.toggleNotify).checked = state.settings.notifyEnabled;

    // 통계 초기 계산
    StatsEngine.recomputeAll(state);

    // 컨트롤러 초기화 (이벤트 바인딩)
    Controller.init(state);

    // 초기 뷰 렌더링
    Render.header(state);
    Render.switchView(state.ui.currentView || 'today', state);

    // PWA 설치 프롬프트 처리 (선택적)
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e;
      // 설치 배너 표시 로직 (CSS 3단계에 .pwa-install-banner 있음)
      const banner = document.querySelector('.pwa-install-banner');
      if (banner) banner.classList.remove('hidden');
      banner?.querySelector('.btn-primary')?.addEventListener('click', async () => {
        banner.classList.add('hidden');
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') toast('설치해 주셔서 감사합니다!', 'success');
        deferredPrompt = null;
      });
    });

    console.log('📝 Study Planner Ready!');
  }

  // DOM 준비 시 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  // ------------------------------------------------------------
  // 15. Global Export (Debugging / Console Access)
  // ------------------------------------------------------------
  // 콘솔에서 store.getState(), Storage.exportJSON() 등 디버깅용
  window.StudyPlanner = {
    store,
    Storage,
    Logic,
    StatsEngine,
    Render,
    Controller,
    fmt,
    toast: (msg, type) => toast(msg, type)
  };

})(); // IIFE End