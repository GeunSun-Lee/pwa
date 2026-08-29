/* ============================================================
   Study Planner - Refactored Main Logic (Vanilla ES6+)
   Module Pattern: CONFIG, Utils, State, Storage, Selectors, Logic
   ============================================================ */
(() => {
  'use strict';

  // ============================================================
  // 1. Configuration & Constants (설정 및 상수)
  // ============================================================
  const CONFIG = {
    STORAGE_KEY: 'studyPlanner_v1',
    STORAGE_VERSION: 1,
    TIME_SLOT_MINUTES: 30,
    DAY_START_HOUR: 6,
    DAY_END_HOUR: 24,
    TIME_ROW_HEIGHT: 48,           // CSS 변수 의존성 제거용 고정값
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
      { id: 'first_plan', name: '첫 계획', desc: '첫 공부 블록을 등록했어요', icon: '🌱', check: s => s.totalBlocks >= 1 },
      { id: 'streak_3', name: '3일 연속', desc: '3일 연속 학습 달성', icon: '🔥', check: s => s.streak >= 3 },
      { id: 'streak_7', name: '일주일 완주', desc: '7일 연속 학습 달성', icon: '🏆', check: s => s.streak >= 7 },
      { id: 'week_10h', name: '주 10시간', desc: '한 주 10시간 이상 공부', icon: '⏱️', check: s => s.weeklyMinutes >= 600 },
      { id: 'all_subjects', name: '골고루', desc: '하루 4과목 이상 공부', icon: '🌈', check: s => s.dailySubjectCount >= 4 },
      { id: 'night_owl', name: '올빼미', desc: '밤 10시 이후 공부', icon: '🦉', check: s => s.hasLateNight }
    ],
    SELECTORS: {
      // Views & Layout
      views: '.view-panel', navItems: '.nav-item', mainContent: '#main-content',
      // Header
      todayDate: '#today-date', streakCount: '#streak-count', streakCountLarge: '#streak-count-large',
      btnExport: '#btn-export', btnImportTrigger: '#btn-import-trigger', inputImport: '#input-import',
      btnSettings: '#btn-settings',
      // Today View
      timeGrid: '#time-grid', timeGutter: '.time-gutter', btnAddBlock: '#btn-add-block',
      statTarget: '#stat-target', statPlanned: '#stat-planned', statDone: '#stat-done',
      chartDonut: '#chart-subject-donut', chartLegend: '#chart-legend',
      // Week View
      weekGrid: '#week-grid', weekRange: '#week-range', btnPrevWeek: '#btn-prev-week',
      btnNextWeek: '#btn-next-week', btnApplyRoutine: '#btn-apply-routine',
      // Stats View
      streakCalendar: '#streak-calendar', streakHint: '#streak-hint',
      chartWeeklyBar: '#chart-weekly-bar', chartPeriod: '#chart-period',
      weeklyStatsDetail: '#weekly-stats-detail', badgesGrid: '#badges-grid', badgesEmpty: '#badges-empty',
      // Settings View
      subjectList: '#subject-list', routineList: '#routine-list',
      btnAddSubject: '#btn-add-subject', btnAddRoutine: '#btn-add-routine',
      toggleNotify: '#toggle-notify', toggleDark: '#toggle-dark',
      btnExportData: '#btn-export-data', btnResetData: '#btn-reset-data', inputImportData: '#input-import-data',
      // Modals
      modalBlock: '#modal-block', formBlock: '#form-block', inputBlockId: '#input-block-id', inputBlockDate: '#input-block-date',
      selectSubject: '#select-subject', inputStart: '#input-start', inputEnd: '#input-end', inputMemo: '#input-memo', inputRepeat: '#input-repeat',
      btnDeleteBlock: '#btn-delete-block', btnSaveBlock: '#btn-save-block',
      modalSubject: '#modal-subject', formSubject: '#form-subject', inputSubjectId: '#input-subject-id',
      inputSubjectName: '#input-subject-name', inputSubjectIcon: '#input-subject-icon', subjectColorPicker: '#subject-color-picker',
      modalRoutine: '#modal-routine', formRoutine: '#form-routine', inputRoutineId: '#input-routine-id',
      inputRoutineName: '#input-routine-name', routineBlocks: '#routine-blocks', btnAddRoutineBlock: '#btn-add-routine-block', btnDeleteRoutine: '#btn-delete-routine',
      // Toast
      toastContainer: '#toast-container',
      // Onboarding
      modalOnboarding: '#modal-onboarding', obSubjectList: '#onboarding-subject-list', obSelectedCount: '#ob-selected-count',
      obRoutineForm: '#onboarding-routine-form', obAddBlock: '#btn-ob-add-routine-block',
      obPrev: '#btn-ob-prev', obNext: '#btn-ob-next', obFinish: '#btn-ob-finish',
      obSteps: '.onboarding-step', obProgressSteps: '.progress-step'
    }
  };

  // ============================================================
  // 2. Utility Functions (순수 헬퍼 함수들)
  // ============================================================
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // 👇 null/undefined/false 자식 안전 처리
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => node.dataset[dk] = dv);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach(c => { if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(c)); });
    return node;
  };

  const fmt = {
    dateKey: (d = new Date()) => d.toISOString().slice(0, 10),
    timeKey: (d = new Date()) => d.toTimeString().slice(0, 5),
    dateLabel: (d) => `${d.getMonth()+1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`,
    durationLabel: (mins) => mins < 60 ? `${mins}분` : `${Math.floor(mins/60)}시간 ${mins%60? mins%60+'분':''}`,
    toInputVal: (d) => d.toISOString().slice(0, 10),
    parseDate: (str) => { const [y,m,d]=str.split('-').map(Number); return new Date(y,m-1,d); },
    timeToMins: (t) => { const [h,m]=t.split(':').map(Number); return h*60+m; },
    minsToTime: (m) => `${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`,
    compareTime: (a,b) => fmt.timeToMins(a) - fmt.timeToMins(b)
  };

  let _uidCounter = 0;
  const uid = (prefix = 'id') => {
    // 타임스탬프 + 랜덤 + 증가하는 카운터 = 사실상 충돌 불가능
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${++_uidCounter}`;
  };
  const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

  // ============================================================
  // 3. Reactive State Management (Proxy 기반 스토어)
  // ============================================================
  const createStore = (initial) => {
    const listeners = new Set();
    const state = new Proxy(initial, {
      set(t, p, v) { t[p]=v; listeners.forEach(f=>f(p,v)); return true; }
    });
    return {
      getState: () => state,
      subscribe: (fn) => { listeners.add(fn); return ()=>listeners.delete(fn); },
      commit: (prop) => listeners.forEach(fn=>fn(prop, state[prop])),
      mutate: (prop, mutator) => { mutator(state[prop]); listeners.forEach(fn=>fn(prop, state[prop])); }
    };
  };

  // ============================================================
  // 4. Initial State Shape (초기 상태 구조)
  // ============================================================
  const initialState = {
    version: CONFIG.STORAGE_VERSION,
    settings: {
      subjects: [...CONFIG.DEFAULT_SUBJECTS],
      routineTemplates: [],
      notifyEnabled: false,
      darkModeForced: false // 기본 라이트 모드
    },
    schedule: {}, // { "YYYY-MM-DD": [blocks...] }
    stats: { streak:0, lastActiveDate:null, badges:[], weeklyMinutes:0, dailySubjectCount:0, hasLateNight:false, totalBlocks:0 },
    ui: { currentView:'today', currentWeekStart:fmt.dateKey(new Date()), editingBlockId:null, editingSubjectId:null, editingRoutineId:null }
  };

  // ============================================================
  // 5. Persistence Layer (LocalStorage & JSON Import/Export)
  // ============================================================
  const Storage = {
    load() { try { const r=localStorage.getItem(CONFIG.STORAGE_KEY); return r?JSON.parse(r):null; } catch(e){ console.error(e); return null; } },
    save(state) { try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state)); } catch(e){ console.error(e); toast('저장 실패','error'); } },
    exportJSON(state) { const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`backup-${fmt.dateKey()}.json`; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u); toast('백업 완료','success'); },
    importJSON(file) { return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>{try{const d=JSON.parse(e.target.result); if(!d.settings||!d.schedule)throw'Invalid';res(d);}catch(err){rej(err);}}; r.readAsText(file);}); }
  };
  // ============================================================
  // 6. Derived State & Selectors (파생 상태 계산 - Getter 패턴)
  // ============================================================
  const Selectors = {
    todayKey: (s) => fmt.dateKey(),
    todayBlocks: (s) => (s.schedule[Selectors.todayKey(s)] || []).slice().sort((a,b)=>fmt.compareTime(a.start,b.start)),
    getBlocks: (s, key) => (s.schedule[key] || []).slice().sort((a,b)=>fmt.compareTime(a.start,b.start)),
    subjectMap: (s) => Object.fromEntries(s.settings.subjects.map(x=>[x.id,x])),
    activeSubjects: (s) => s.settings.subjects.slice().sort((a,b)=>a.order-b.order),
    weekStartKey: (s) => s.ui.currentWeekStart,
    weekDays: (s) => { const a=[]; const d=fmt.parseDate(s.ui.currentWeekStart); for(let i=0;i<7;i++){a.push(fmt.dateKey(d));d.setDate(d.getDate()+1);} return a; },
    weekBlocks: (s) => { const m={}; Selectors.weekDays(s).forEach(k=>m[k]=Selectors.getBlocks(s,k)); return m; },
    todayPlannedMinutes: (s) => Selectors.todayBlocks(s).reduce((sum,b)=>sum+fmt.timeToMins(b.end)-fmt.timeToMins(b.start),0),
    todayDoneMinutes: (s) => Selectors.todayBlocks(s).filter(b=>b.done).reduce((sum,b)=>sum+fmt.timeToMins(b.end)-fmt.timeToMins(b.start),0),
    todaySubjectDist: (s) => { const d={}; Selectors.todayBlocks(s).filter(b=>b.done).forEach(b=>{const m=fmt.timeToMins(b.end)-fmt.timeToMins(b.start); d[b.subjectId]=(d[b.subjectId]||0)+m;}); return d; }
  };

  // ============================================================
  // 7. Core Business Logic (핵심 로직: CRUD, 루틴, 과목)
  // ============================================================
  const Logic = {
    validateBlock(b) {
    if(!b.subjectId) return '과목을 선택하세요.';
    if(!b.start || !b.end) return '시작/끝 시간을 입력하세요.';
    if(fmt.compareTime(b.start, b.end) >= 0) return '끝 시간은 시작 시간보다 늦어야 합니다.';
    
    // 👇 [신규] 그리드 표시 범위 제한 (06:00 ~ 24:00)
    const startM = fmt.timeToMins(b.start);
    const endM = fmt.timeToMins(b.end);
    const minM = CONFIG.DAY_START_HOUR * 60;      // 360 (06:00)
    const maxM = CONFIG.DAY_END_HOUR * 60;        // 1440 (24:00)
    
    if (startM < minM || startM >= maxM) return `시작 시간은 ${CONFIG.DAY_START_HOUR}:00 ~ ${CONFIG.DAY_END_HOUR}:00 사이여야 합니다.`;
    if (endM > maxM || endM <= minM) return `끝 시간은 ${CONFIG.DAY_START_HOUR}:00 ~ ${CONFIG.DAY_END_HOUR}:00 사이여야 합니다.`;
    
    return null;
  },

    saveBlock(state, data) {
	  const err = Logic.validateBlock(data); 
	  if (err) return { success: false, error: err };

	  const key = data.date || Selectors.todayKey(state);
	  const list = state.schedule[key] || [];
	  
	  // 👇 [핵심] 새 블록 생성 시 무조건 새로운 고유 ID 발급
	  // data.id가 있더라도(수정 모드에서 넘어옴) 기존 리스트에 없으면 새 ID로 간주
	  const isEditing = data.id && list.some(b => b.id === data.id);
	  
	  let targetId = data.id;
	  if (!isEditing) {
		// 새 블록: 중복되지 않는 ID 강제 생성
		let newId;
		const existingIds = new Set(Object.values(state.schedule).flat().map(b => b.id));
		do { newId = uid('blk'); } while (existingIds.has(newId)); // 극히 드문 충돌 방지 루프
		targetId = newId;
	  }

	  const payload = { 
		id: targetId, 
		...data, 
		id: targetId, // 확정된 ID 덮어쓰기
		date: key, 
		done: false, 
		createdAt: Date.now() 
	  };

	  if (isEditing) {
		const idx = list.findIndex(b => b.id === data.id);
		if (idx > -1) list[idx] = { ...list[idx], ...data, id: targetId, date: key };
	  } else {
		list.push(payload);
	  }
	  
	  list.sort((a, b) => fmt.compareTime(a.start, b.start));
	  state.schedule[key] = list;
	  return { success: true };
	},

    deleteBlock(state, id, dateKey) {
      const key = dateKey || Selectors.todayKey(state);
      if(state.schedule[key]) {
        state.schedule[key] = state.schedule[key].filter(b=>b.id!==id);
        if(!state.schedule[key].length) delete state.schedule[key];
      }
      return key;
    },

    toggleDone(state, blockId, dateKey) {
	  const key = dateKey || Selectors.todayKey(state);
	  const list = state.schedule[key] || [];
	  
	  // 👇 find 대신 findIndex + splice/직접 수정으로 안전하게 (동일 ID 여러 개일 때 첫 번째만 수정 방지)
	  // 하지만 ID 유니크 보장했으므로 find 써도 무방. 단, 날짜 키로 범위 한정함.
	  const block = list.find(b => b.id === blockId);
	  if (block) {
		block.done = !block.done;
		block.updatedAt = Date.now();
		if (block.done) window.dispatchEvent(new CustomEvent('block-completed', { detail: { block, dateKey: key } }));
	  }
	},

    saveRoutine(state, data) {
      if(!data.name) return {ok:false,err:'템플릿 이름 필요'};
      if(!data.days?.length) return {ok:false,err:'요일 선택 필요'};
      if(!data.blocks?.length) return {ok:false,err:'블록 1개 이상 필요'};
      const list = state.settings.routineTemplates;
      if(data.id && list.some(t=>t.id===data.id)) Object.assign(list.find(t=>t.id===data.id), data);
      else list.push({id:uid('tpl'),...data,createdAt:Date.now()});
      return {ok:true};
    },

    deleteRoutine(state, id) { state.settings.routineTemplates = state.settings.routineTemplates.filter(t=>t.id!==id); },

    applyRoutineToWeek(state, id) {
      const tpl = state.settings.routineTemplates.find(t=>t.id===id); if(!tpl) return;
      Selectors.weekDays(state).forEach((key, i) => {
        if(!tpl.days.includes(String(i))) return;
        const arr = state.schedule[key] || [];
        tpl.blocks.forEach(b=>{ if(!arr.some(e=>e.subjectId===b.subjectId&&e.start===b.start&&e.end===b.end)) arr.push({id:uid('blk'),...b,date:key,done:false,repeat:true,createdAt:Date.now()}); });
        arr.sort((a,b)=>fmt.compareTime(a.start,b.start)); state.schedule[key]=arr;
      });
      toast('루틴 적용 완료!','success');
    },

    saveSubject(state, data) {
      if(!data.name) return {ok:false,err:'과목명 필요'};
      const list = state.settings.subjects;
      if(data.id && list.some(s=>s.id===data.id)) Object.assign(list.find(s=>s.id===data.id), data);
      else list.push({id:uid('subj'),...data,order:list.length+1});
      return {ok:true};
    },

    deleteSubject(state, id) {
      const subj = state.settings.subjects.find(s=>s.id===id);
      if(subj && CONFIG.DEFAULT_SUBJECTS.some(d=>d.id===id)) return {ok:false,err:'기본과목 삭제 불가'};
      state.settings.subjects = state.settings.subjects.filter(s=>s.id!==id);
      const fb = state.settings.subjects[0]?.id || 'etc';
      Object.values(state.schedule).forEach(arr=>arr.forEach(b=>{if(b.subjectId===id) b.subjectId=fb;}));
      return {ok:true};
    }
  };

  // ============================================================
  // 8. Statistics Engine (통계: 스트릭, 뱃지, 차트 데이터)
  // ============================================================
  const StatsEngine = {
    recomputeAll(s) { this.recomputeStreak(s); this.recomputeBadges(s); this.recomputeWeekly(s); this.recomputeDaily(s); },

    recomputeStreak(s) {
      const today=fmt.dateKey(); const doneDates=Object.keys(s.schedule).filter(d=>s.schedule[d].some(b=>b.done)).sort();
      if(!doneDates.length){ s.stats.streak=0; s.stats.lastActiveDate=null; return; }
      let streak=0; let d=new Date(today); if(!doneDates.includes(today)) d.setDate(d.getDate()-1);
      while(doneDates.includes(fmt.dateKey(d))){ streak++; d.setDate(d.getDate()-1); }
      s.stats.streak=streak; s.stats.lastActiveDate=doneDates[doneDates.length-1];
    },

    recomputeBadges(s) {
      const earned=new Set(s.stats.badges);
      const todayBlocks=Selectors.todayBlocks(s).filter(b=>b.done);
      const ctx={ totalBlocks:Object.values(s.schedule).flat().length, streak:s.stats.streak, weeklyMinutes:s.stats.weeklyMinutes, dailySubjectCount:new Set(todayBlocks.map(b=>b.subjectId)).size, hasLateNight:todayBlocks.some(b=>fmt.timeToMins(b.start)>=1320) };
      CONFIG.BADGES.forEach(b=>{ if(!earned.has(b.id)&&b.check(ctx)){ earned.add(b.id); window.dispatchEvent(new CustomEvent('badge-earned',{detail:b})); }});
      s.stats.badges=Array.from(earned);
    },

    recomputeWeekly(s) {
      let sum=0; const today=new Date();
      for(let i=0;i<7;i++){ const d=new Date(today); d.setDate(d.getDate()-i); const k=fmt.dateKey(d); (s.schedule[k]||[]).filter(b=>b.done).forEach(b=>sum+=fmt.timeToMins(b.end)-fmt.timeToMins(b.start)); }
      s.stats.weeklyMinutes=sum;
    },

    recomputeDaily(s) {
      const done=Selectors.todayBlocks(s).filter(b=>b.done);
      s.stats.dailySubjectCount=new Set(done.map(b=>b.subjectId)).size;
      s.stats.hasLateNight=done.some(b=>fmt.timeToMins(b.start)>=1320);
      s.stats.totalBlocks=Object.values(s.schedule).flat().length;
    },

    getDailySeries(s, days=7) { const a=[]; const t=new Date(); for(let i=days-1;i>=0;i--){ const d=new Date(t); d.setDate(d.getDate()-i); const k=fmt.dateKey(d); const m=(s.schedule[k]||[]).filter(b=>b.done).reduce((s,b)=>s+fmt.timeToMins(b.end)-fmt.timeToMins(b.start),0); a.push({date:k,label:`${d.getMonth()+1}/${d.getDate()}`,minutes:m}); } return a; },
    getSubjectDist(s, key=null) { return Selectors.todaySubjectDist(s); }
  };
 // ============================================================
  // 9. Notification & Toast System (알림, 토스트, 컨페티)
  // ============================================================
  const toast = (msg, type='info', dur=3000) => {
    const c = $(CONFIG.SELECTORS.toastContainer); if(!c) return;
    const n = document.createElement('div'); n.className = `toast ${type}`; n.role='alert'; n.textContent = msg;
    c.appendChild(n); requestAnimationFrame(()=>n.classList.add('show'));
    setTimeout(()=>{ n.classList.add('hiding'); n.addEventListener('transitionend',()=>n.remove()); }, dur);
  };

  const fireConfetti = () => {
    if(window.confetti) { window.confetti({particleCount:80, spread:70, origin:{y:0.6}, colors:['#2563eb','#43a047','#fb8c00','#e53935','#8e24aa']}); }
    else { const colors=['#2563eb','#43a047','#fb8c00','#e53935','#8e24aa']; for(let i=0;i<30;i++){ const p=document.createElement('div'); p.className='confetti-piece'; p.style.left=`${Math.random()*100}vw`; p.style.background=colors[Math.floor(Math.random()*colors.length)]; p.style.animationDuration=`${1+Math.random()*2}s`; document.body.appendChild(p); setTimeout(()=>p.remove(),3000); } }
  };

  // ============================================================
  // 10. Chart Rendering (바닐라 캔버스 차트 - 의존성 없음)
  // ============================================================
  const Charts = {
    donut(canvas, data, subjects) {
      const ctx=canvas.getContext('2d'); const dpr=window.devicePixelRatio||1; const size=Math.min(canvas.parentElement.clientWidth,200);
      canvas.width=size*dpr; canvas.height=size*dpr; canvas.style.width=size+'px'; canvas.style.height=size+'px'; ctx.scale(dpr,dpr);
      const cx=size/2, cy=size/2, r=Math.min(cx,cy)-10; const total=Object.values(data).reduce((a,b)=>a+b,0);
      if(!total){ ctx.clearRect(0,0,size,size); return; }
      let sa=-Math.PI/2; Object.entries(data).forEach(([id, mins])=>{ const sub=subjects[id]; if(!sub) return; const ang=(mins/total)*2*Math.PI; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,sa,sa+ang); ctx.closePath(); ctx.fillStyle=sub.color; ctx.fill(); sa+=ang; });
      ctx.globalCompositeOperation='destination-out'; ctx.beginPath(); ctx.arc(cx,cy,r*0.55,0,2*Math.PI); ctx.fill(); ctx.globalCompositeOperation='source-over';
    },

    legend(container, data, subjects) {
      const total=Object.values(data).reduce((a,b)=>a+b,0); container.innerHTML='';
      Object.entries(data).forEach(([id,mins])=>{ const sub=subjects[id]; if(!sub) return; const pct=total?Math.round(mins/total*100):0; container.appendChild(el('div',{class:'legend-item'},[el('span',{class:'legend-color',style:`background:${sub.color}`}),el('span',{class:'legend-name'},sub.name),el('span',{class:'legend-duration'},`${fmt.durationLabel(mins)} (${pct}%)`)])); });
    },

    bar(canvas, series) {
      const ctx=canvas.getContext('2d'); const dpr=window.devicePixelRatio||1; const rect=canvas.parentElement.getBoundingClientRect(); const w=rect.width, h=160;
      canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.width=w+'px'; canvas.style.height=h+'px'; ctx.scale(dpr,dpr);
      const pad={t:20,r:10,b:30,l:40}; const cw=w-pad.l-pad.r; const ch=h-pad.t-pad.b; const max=Math.max(...series.map(d=>d.minutes),1); const bw=cw/series.length*0.6; const gap=cw/series.length*0.4;
      ctx.strokeStyle='#e2e8f0'; ctx.font='10px var(--font-mono)'; ctx.fillStyle='#94a3b8';
      [0,.25,.5,.75,1].forEach(r=>{ const y=pad.t+ch*(1-r); ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(w-pad.r,y); ctx.stroke(); ctx.fillText(fmt.durationLabel(Math.round(max*r)),4,y+3); });
      series.forEach((d,i)=>{ const x=pad.l+i*(bw+gap)+gap/2; const bh=(d.minutes/max)*ch; const y=pad.t+ch-bh; const today=d.date===fmt.dateKey(); const g=ctx.createLinearGradient(0,y,0,y+bh); g.addColorStop(0,today?'#2563eb':'#3b82f6'); g.addColorStop(1,today?'#1e40af':'#60a5fa'); ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(x,y,bw,bh,4); ctx.fill(); ctx.fillStyle=today?'#2563eb':'#64748b'; ctx.font='11px var(--font-sans)'; ctx.textAlign='center'; ctx.fillText(d.label,x+bw/2,h-pad.b+16); if(d.minutes){ ctx.fillStyle='#1e293b'; ctx.font='10px var(--font-mono)'; ctx.fillText(fmt.durationLabel(d.minutes),x+bw/2,y-4); } });
    },

    streakCalendar(container, state) {
      const today=new Date(); const weeks=52, cell=12, gap=3; const act={};
      Object.entries(state.schedule).forEach(([k,bs])=>{ const m=bs.filter(b=>b.done).reduce((s,b)=>s+fmt.timeToMins(b.end)-fmt.timeToMins(b.start),0); if(m>0){ let lv=1; if(m>=360)lv=4; else if(m>=180)lv=3; else if(m>=60)lv=2; act[k]=lv; } });
      container.innerHTML=''; container.style.gridTemplateColumns=`repeat(${weeks},${cell}px)`; container.style.gap=`${gap}px`;
      for(let w=0;w<weeks;w++){ for(let d=0;d<7;d++){ const daysAgo=(weeks-1-w)*7+(6-d); const dt=new Date(today); dt.setDate(dt.getDate()-daysAgo); const key=fmt.dateKey(dt); const lv=act[key]||0; const future=dt>today; const isToday=key===fmt.dateKey(); const cellEl=el('div',{class:`streak-day lv${lv}`,title:`${fmt.dateLabel(dt)}: ${lv?fmt.durationLabel(act[key]*60):'없음'}`,style:`width:${cell}px;height:${cell}px`}); if(isToday) cellEl.classList.add('today'); if(future) cellEl.style.visibility='hidden'; container.appendChild(cellEl); } }
    }
  };

  // ============================================================
  // 11. View Renderers (화면 그리기 네임스페이스)
  // ============================================================
  const Render = {
    switchView(view, state) {
      $$(CONFIG.SELECTORS.views).forEach(v=>v.hidden=true); $(`#view-${view}`).hidden=false;
      $$(CONFIG.SELECTORS.navItems).forEach(b=>{ const a=b.dataset.view===view; b.classList.toggle('active',a); b.setAttribute('aria-selected',a); });
      state.ui.currentView=view;
      if(view==='today') this.today(state); else if(view==='week') this.week(state); else if(view==='stats') this.stats(state); else if(view==='settings') this.settings(state);
    },

    header(state) { $(CONFIG.SELECTORS.todayDate).textContent=fmt.dateLabel(new Date()); $(CONFIG.SELECTORS.streakCount).textContent=state.stats.streak; $(CONFIG.SELECTORS.streakCountLarge).textContent=state.stats.streak; },

    // --- Today View ---
    today(state) { this.timeGrid(state); this.dailySummary(state); },

     timeGrid(state) {
      console.log('[Render] timeGrid 시작');
      
      const gutter = $(CONFIG.SELECTORS.timeGutter);
      const grid = $(CONFIG.SELECTORS.timeGrid);
      
      // 1. 요소 존재 검사
      if (!gutter || !grid) {
        console.error('[Render] ❌ DOM 요소를 찾을 수 없음:', { 
          gutterSel: CONFIG.SELECTORS.timeGutter, gutter: !!gutter,
          gridSel: CONFIG.SELECTORS.timeGrid, grid: !!grid 
        });
        toast('화면 구성 오류: 시간표 영역을 찾을 수 없습니다. 새로고침 해보세요.', 'error');
        return;
      }

      // 2. 데이터 준비 (👇 subjectMap 정의 필수!)
      const blocks = Selectors.todayBlocks(state);
      const subjectMap = Selectors.subjectMap(state); // 👈 여기가 핵심! 누락되면 ReferenceError 발생
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const isToday = true;
      const rowHeight = CONFIG.TIME_ROW_HEIGHT; // 48
      const totalSlots = (CONFIG.DAY_END_HOUR - CONFIG.DAY_START_HOUR) * (60 / CONFIG.TIME_SLOT_MINUTES); // 36

      try {
        // 3. 초기화
        gutter.innerHTML = '';
        grid.innerHTML = '';

        // 4. 행 생성 루프 (0 ~ 36, 총 37개: 06:00 ~ 24:00)
        for (let i = 0; i <= totalSlots; i++) {
          const totalMins = CONFIG.DAY_START_HOUR * 60 + i * CONFIG.TIME_SLOT_MINUTES;
          const h = Math.floor(totalMins / 60);
          const m = totalMins % 60;
          const timeLabel = fmt.minsToTime(totalMins);

          // 거터 라벨 (정시만 텍스트 표시)
          const labelText = (m === 0) ? `${h.toString().padStart(2,'0')}:00` : '';
          const labelStyle = (m === 0) ? '' : 'visibility:hidden';
          const labelEl = el('div', { class: 'time-label', style: labelStyle }, labelText);
          labelEl.style.height = rowHeight + 'px'; 
          labelEl.style.boxSizing = 'border-box';
          gutter.appendChild(labelEl);

          // 그리드 행
          const row = el('div', { class: 'time-row', 'data-time': timeLabel, style: `height:${rowHeight}px` });
          const cell = el('div', { class: 'time-cell', 'data-time': timeLabel, 'data-date': Selectors.todayKey(state) });
          if (isToday && totalMins === nowMins) cell.classList.add('today-now');
          row.appendChild(cell);
          grid.appendChild(row);
        }
        console.log('[Render] 그리드 행 생성 완료:', totalSlots + 1, '행');

        // 5. 블록 렌더링
        blocks.forEach(block => {
          const startM = fmt.timeToMins(block.start);
          const endM = fmt.timeToMins(block.end);
          
          // 방어: 유효한 시간 범위인지 확인
          if (startM < CONFIG.DAY_START_HOUR * 60 || endM > CONFIG.DAY_END_HOUR * 60) {
            console.warn('[Render] 블록 시간 범위 초과, 스킵:', block);
            return;
          }

          const startSlotIndex = (startM - CONFIG.DAY_START_HOUR * 60) / CONFIG.TIME_SLOT_MINUTES;
          const durationSlots = (endM - startM) / CONFIG.TIME_SLOT_MINUTES;
          
          if (durationSlots <= 0) return;

          const top = startSlotIndex * rowHeight;
          const height = durationSlots * rowHeight;
          
          // 👇 여기서 subjectMap 사용 (위에 정의되어 있어야 함)
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
          
          blkEl.draggable = true;
          blkEl.addEventListener('dragstart', Controller.onDragStart);
          blkEl.addEventListener('dragend', Controller.onDragEnd);
          blkEl.addEventListener('click', (e) => { if(e.target !== blkEl.querySelector('.block-check')) Controller.openBlockModal(block.id); });
          
          grid.appendChild(blkEl);
        });
        console.log('[Render] 블록 렌더링 완료:', blocks.length, '개');

      } catch (err) {
        console.error('[Render] timeGrid 실행 중 오류:', err);
        toast('시간표 그리기 중 오류 발생', 'error');
      }
    },

    dailySummary(state) { const p=Selectors.todayPlannedMinutes(state), d=Selectors.todayDoneMinutes(state), t=240; $(CONFIG.SELECTORS.statTarget).textContent=fmt.durationLabel(t); $(CONFIG.SELECTORS.statPlanned).textContent=fmt.durationLabel(p); $(CONFIG.SELECTORS.statDone).textContent=fmt.durationLabel(d); const dist=Selectors.todaySubjectDist(state), subs=Selectors.subjectMap(state); Charts.donut($(CONFIG.SELECTORS.chartDonut),dist,subs); Charts.legend($(CONFIG.SELECTORS.chartLegend),dist,subs); },

    // --- Week View ---
    week(state) { const days=Selectors.weekDays(state), blocks=Selectors.weekBlocks(state), subs=Selectors.subjectMap(state), start=fmt.parseDate(days[0]), end=fmt.parseDate(days[6]); $(CONFIG.SELECTORS.weekRange).textContent=`${start.getMonth()+1}/${start.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}`; const g=$(CONFIG.SELECTORS.weekGrid); g.innerHTML=''; days.forEach((k,i)=>{ const dt=fmt.parseDate(k), today=k===fmt.dateKey(); const col=el('div',{class:'week-col'},[el('div',{class:`week-col-header ${today?'today':''}`},[el('span',{class:'day-name'},'일월화수목금토'[dt.getDay()]),el('span',{class:'day-date'},dt.getDate())]),el('div',{class:'week-col-body','data-date':k},(blocks[k]||[]).map(b=>{ const sub=subs[b.subjectId]||{color:'#757575',name:'',icon:''}; return el('div',{class:`week-block ${b.done?'done':''}`,style:`background:${sub.color}`,dataset:{blockId:b.id,date:k},onclick:()=>Controller.openBlockModal(b.id,k)},[el('div',{class:'w-block-title'},`${sub.icon} ${sub.name}`),b.memo?el('div',{class:'w-block-memo'},b.memo):null,el('div',{class:'w-block-time'},`${b.start} ~ ${b.end}`)])}))]); g.appendChild(col); }); $(CONFIG.SELECTORS.btnApplyRoutine).hidden=!state.settings.routineTemplates.length; },

    // --- Stats View ---
    stats(state) { Charts.streakCalendar($(CONFIG.SELECTORS.streakCalendar),state); $(CONFIG.SELECTORS.streakHint).textContent=state.stats.streak>0?`최근 ${state.stats.lastActiveDate?fmt.dateLabel(fmt.parseDate(state.stats.lastActiveDate)):'오늘'} 완료!`:'오늘 공부하면 스트릭 시작!'; const days=$(CONFIG.SELECTORS.chartPeriod).value==='week'?7:30; Charts.bar($(CONFIG.SELECTORS.chartWeeklyBar),StatsEngine.getDailySeries(state,days)); const det=$(CONFIG.SELECTORS.weeklyStatsDetail); det.innerHTML=''; StatsEngine.getDailySeries(state,days).forEach(d=>det.appendChild(el('div',{},[el('dt',{},d.label),el('dd',{},d.minutes?fmt.durationLabel(d.minutes):'-')]))); this.badges(state); },

    badges(state) { const g=$(CONFIG.SELECTORS.badgesGrid), e=$(CONFIG.SELECTORS.badgesEmpty), earned=new Set(state.stats.badges); g.innerHTML=''; CONFIG.BADGES.forEach(b=>{ const got=earned.has(b.id); g.appendChild(el('div',{class:`badge-card ${got?'earned':'locked'}`,title:got?`${b.name}:${b.desc}`:`미획득:${b.desc}`},[el('div',{class:'badge-icon'},got?b.icon:'🔒'),el('div',{class:'badge-name'},b.name)])); }); e.hidden=earned.size>0; },

    // --- Settings View ---
    settings(state) { this.subjectList(state); this.routineList(state); $(CONFIG.SELECTORS.toggleNotify).checked=state.settings.notifyEnabled; $(CONFIG.SELECTORS.toggleDark).checked=state.settings.darkModeForced===true; },

      subjectList(state) {
      const l = $(CONFIG.SELECTORS.subjectList);
      l.innerHTML = '';
      
      Selectors.activeSubjects(state).forEach(s => {
        const def = CONFIG.DEFAULT_SUBJECTS.some(d => d.id === s.id);
        
        // li 엘리먼트 생성
        const liEl = el('li', {
          class: 'subject-item',
          draggable: true,
          dataset: { subjectId: s.id }
        }, [
          // 1. 색상 점
          el('span', { class: 'subject-color-dot', style: `background:${s.color}` }),
          // 2. 아이콘
          el('span', { class: 'subject-icon' }, s.icon),
          // 3. 이름
          el('span', { class: 'subject-name' }, s.name),
          // 4. 액션 버튼 영역
          el('div', { class: 'subject-actions' }, [
            // 수정 버튼
            el('button', {
              class: 'icon-btn',
              'aria-label': '수정',
              onclick: () => Controller.openSubjectModal(s.id)
            }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, 
                el('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' })
              )
            ),
            // 삭제 버튼 (기본 과목이 아닐 때만)
            !def ? el('button', {
              class: 'icon-btn',
              'aria-label': '삭제',
              onclick: () => Controller.deleteSubject(s.id)
            }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, 
                el('path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })
              )
            ) : null
          ])
        ]);
        
        l.appendChild(liEl);
      });
      
      Controller.bindSubjectSortable(l);
    },

     routineList(state) {
      const l = $(CONFIG.SELECTORS.routineList);
      l.innerHTML = '';
      
      const dayNames = '일월화수목금토';

      state.settings.routineTemplates.forEach(t => {
        const daysStr = t.days.map(d => dayNames[d]).join(', ');
        
        // 루틴 아이템(li) 생성
        const liEl = el('li', { class: 'routine-item' }, [
          // --- 정보 영역 ---
          el('div', { class: 'routine-info' }, [
            el('div', { class: 'routine-name' }, t.name),
            el('div', { class: 'routine-meta' }, [
              el('span', { class: 'routine-day' }, `요일: ${daysStr}`),
              el('span', { class: 'routine-day' }, `블록: ${t.blocks.length}개`)
            ])
          ]),
          
          // --- 액션 버튼 영역 ---
          el('div', { class: 'routine-actions' }, [
            // 1. 이 주 적용 버튼
            el('button', {
              class: 'icon-btn',
              'aria-label': '이 주 적용',
              onclick: () => Logic.applyRoutineToWeek(state, t.id)
            }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, [
                el('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
                el('path', { d: 'M22 21H2' }),
                el('path', { d: 'M8.5 4h7a2 2 0 0 1 2 2v6' })
              ])
            ),
            
            // 2. 수정 버튼
            el('button', {
              class: 'icon-btn',
              'aria-label': '수정',
              onclick: () => Controller.openRoutineModal(t.id)
            }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, [
                el('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' })
              ])
            ),
            
            // 3. 삭제 버튼
            el('button', {
              class: 'icon-btn',
              'aria-label': '삭제',
              onclick: () => Controller.deleteRoutine(t.id)
            }, 
              el('svg', { class: 'icon', viewBox: '0 0 24 24' }, [
                el('path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })
              ])
            )
          ])
        ]);
        
        l.appendChild(liEl);
      });
    },
  };
  // ============================================================
  // 12. Controller (이벤트 핸들링, 모달, 드래그, 설정 액션, 온보딩)
  // ============================================================
  const Controller = {
    draggedBlock: null,
    draggedFromDate: null,

    // --- 초기화 및 전역 바인딩 ---
    init(state) {
      // 뷰 전환 (하단 네비)
      $$(CONFIG.SELECTORS.navItems).forEach(btn=>btn.addEventListener('click',()=>this.switchView(btn.dataset.view,state)));
      // 헤더 버튼
      $(CONFIG.SELECTORS.btnAddBlock).addEventListener('click',()=>this.openBlockModal(null,Selectors.todayKey(state)));
      $(CONFIG.SELECTORS.btnExport).addEventListener('click',()=>Storage.exportJSON(state));
      $(CONFIG.SELECTORS.btnImportTrigger).addEventListener('click',()=>$(CONFIG.SELECTORS.inputImport).click());
      $(CONFIG.SELECTORS.inputImport).addEventListener('change',e=>this.handleImport(e,state));
      $(CONFIG.SELECTORS.btnSettings).addEventListener('click',()=>this.switchView('settings',state));
      // 주간 네비
      $(CONFIG.SELECTORS.btnPrevWeek).addEventListener('click',()=>this.navigateWeek(state,-1));
      $(CONFIG.SELECTORS.btnNextWeek).addEventListener('click',()=>this.navigateWeek(state,1));
      $(CONFIG.SELECTORS.btnApplyRoutine).addEventListener('click',()=>this.openRoutinePicker(state));
      // 통계 기간
      $(CONFIG.SELECTORS.chartPeriod).addEventListener('change',()=>Render.stats(state));
      // 설정 폼
      $(CONFIG.SELECTORS.btnAddSubject).addEventListener('click',()=>this.openSubjectModal(null));
      $(CONFIG.SELECTORS.btnAddRoutine).addEventListener('click',()=>this.openRoutineModal(null));
      $(CONFIG.SELECTORS.toggleNotify).addEventListener('change',e=>{state.settings.notifyEnabled=e.target.checked;this.requestNotificationPermission();});
      $(CONFIG.SELECTORS.toggleDark).addEventListener('change',e=>this.setDarkMode(e.target.checked,state));
      $(CONFIG.SELECTORS.btnExportData).addEventListener('click',()=>Storage.exportJSON(state));
      $(CONFIG.SELECTORS.inputImportData).addEventListener('change',e=>this.handleImport(e,state));
      $(CONFIG.SELECTORS.btnResetData).addEventListener('click',()=>this.confirmReset(state));
      // 모달 폼 제출
      $(CONFIG.SELECTORS.formBlock).addEventListener('submit',e=>this.handleBlockSubmit(e,state));
      $(CONFIG.SELECTORS.formSubject).addEventListener('submit',e=>this.handleSubjectSubmit(e,state));
      $(CONFIG.SELECTORS.formRoutine).addEventListener('submit',e=>this.handleRoutineSubmit(e,state));
      // 모달 삭제 버튼
      $(CONFIG.SELECTORS.btnDeleteBlock).addEventListener('click',()=>this.deleteCurrentBlock(state));
      $(CONFIG.SELECTORS.btnDeleteRoutine).addEventListener('click',()=>this.deleteCurrentRoutine(state));
      // 모달 공통: 백드랍/ESC 닫기 방지(필수 완료 강제용) - 온보딩 제외
      $$('dialog.modal:not(#modal-onboarding)').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d)d.close();});d.addEventListener('cancel',e=>{e.preventDefault();d.close();});});
      // 드래그 앤 드롭 (데스크탑)
      const grid=$(CONFIG.SELECTORS.timeGrid); grid.addEventListener('dragover',this.onDragOver); grid.addEventListener('dragleave',this.onDragLeave); grid.addEventListener('drop',e=>this.onDrop(e,state));
      // 터치 드래그 (모바일)
      this.bindTouchDrag(grid,state);
      // 색상 피커 라디오 버튼 변경 감지 (설정 모달 열릴 때 동적 바인딩 불필요, 폼 제출시 쿼리셀렉터로 처리)
    },

    switchView(view,state){ Render.switchView(view,state); $(CONFIG.SELECTORS.mainContent).scrollTop=0; },
    navigateWeek(state,delta){ const d=fmt.parseDate(state.ui.currentWeekStart); d.setDate(d.getDate()+delta*7); const diff=d.getDay()===0?-6:1-d.getDay(); d.setDate(d.getDate()+diff); state.ui.currentWeekStart=fmt.dateKey(d); Render.week(state); },

    // --- 블록 모달 ---
    openBlockModal(id, dateKey) {
      const state=store.getState(); const block=id?(state.schedule[dateKey||Selectors.todayKey(state)]||[]).find(b=>b.id===id):null;
      const f=$(CONFIG.SELECTORS.formBlock); f.reset();
      $(CONFIG.SELECTORS.inputBlockId).value=block?.id||'';
      $(CONFIG.SELECTORS.inputBlockDate).value=dateKey||Selectors.todayKey(state);
      const sel=$(CONFIG.SELECTORS.selectSubject); sel.innerHTML=''; Selectors.activeSubjects(state).forEach(s=>sel.appendChild(el('option',{value:s.id},`${s.icon} ${s.name}`)));
      if(block){ $('#modal-title').textContent='공부 블록 수정'; sel.value=block.subjectId; $(CONFIG.SELECTORS.inputStart).value=block.start; $(CONFIG.SELECTORS.inputEnd).value=block.end; $(CONFIG.SELECTORS.inputMemo).value=block.memo||''; $(CONFIG.SELECTORS.inputRepeat).checked=block.repeat||false; $(CONFIG.SELECTORS.btnDeleteBlock).hidden=false; }
      else{ $('#modal-title').textContent='공부 블록 추가'; const now=new Date(); const st=fmt.minsToTime(now.getHours()*60+now.getMinutes()); const et=fmt.minsToTime(now.getHours()*60+now.getMinutes()+60); $(CONFIG.SELECTORS.inputStart).value=st; $(CONFIG.SELECTORS.inputEnd).value=et; $(CONFIG.SELECTORS.btnDeleteBlock).hidden=true; }
      $(CONFIG.SELECTORS.modalBlock).showModal();
    },

    handleBlockSubmit(e, state) {
	  const submitter = e.submitter;
	  // 취소/X버튼 클릭 시 네이티브 다이얼로그 닫기 처리 후 리턴
	  if (submitter && (submitter.value === 'cancel' || submitter.formMethod === 'dialog' || submitter.classList.contains('modal-close'))) {
		return; 
	  }

	  e.preventDefault(); 
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
	  
	  // 👇 res.ok -> res.success 로 수정
	  if (res.success) {
		store.commit('schedule');
		StatsEngine.recomputeAll(state);
		toast('저장되었습니다.', 'success');
		$(CONFIG.SELECTORS.modalBlock).close(); // 👈 성공 시 모달 명시적 닫기
		Render.today(state); 
		Render.week(state); 
		Render.stats(state);
	  } else {
		toast(res.error || '저장 실패', 'error');
	  }
	},

    deleteCurrentBlock(state) { const f=$(CONFIG.SELECTORS.formBlock); const id=f.blockId.value, date=f.date.value; if(!id||!confirm('삭제하시겠습니까?')) return; Logic.deleteBlock(state,id,date); store.commit('schedule'); StatsEngine.recomputeAll(state); toast('삭제됨','success'); $(CONFIG.SELECTORS.modalBlock).close(); Render.today(state); Render.week(state); Render.stats(state); },

    toggleBlock(blockId) { 
	  const state = store.getState();
	  const todayKey = Selectors.todayKey(state); // 현재 보고 있는 날짜 기준
	  
	  // 1. 상태(State) 업데이트 - Logic에서 날짜 키 포함하여 토글
	  Logic.toggleDone(state, blockId, todayKey); 
	  
	  // 2. 즉시 UI 피드백 - 해당 날짜 그리드 내의 특정 블록만 선택
	  // document.querySelectorAll로 모든 매칭 요소를 가져와 날짜 속성으로 필터링
	  const blocks = document.querySelectorAll(`.study-block[data-block-id="${blockId}"]`);
	  blocks.forEach(el => {
		// data-date가 오늘 날짜인 것만 토글 (다른 날짜 중복 ID 방지)
		if (el.dataset.date === todayKey) {
		  el.classList.toggle('done');
		}
	  });
	  
	  // 3. 통계/요약 리렌더링
	  Render.dailySummary(state); 
	  Render.stats(state); 
	},

    // --- 과목 모달 ---
    openSubjectModal(id) {
      const state=store.getState(); const f=$(CONFIG.SELECTORS.formSubject); f.reset(); const p=$(CONFIG.SELECTORS.subjectColorPicker); p.innerHTML='';
      ['#e53935','#1e88e5','#43a047','#fb8c00','#00acc1','#8e24aa','#d81b60','#757575','#f57c00','#3949ab','#00897b','#c0ca33'].forEach((c,i)=>{const id=`color_${i}`; p.appendChild(el('label',{class:'color-option'},[el('input',{type:'radio',name:'color',value:c,id,checked:i===0}),el('span',{class:'color-swatch',style:`background:${c}`})]));});
      if(id){ const s=state.settings.subjects.find(x=>x.id===id); $('#modal-subject-title').textContent='과목 수정'; $(CONFIG.SELECTORS.inputSubjectId).value=s.id; $(CONFIG.SELECTORS.inputSubjectName).value=s.name; $(CONFIG.SELECTORS.inputSubjectIcon).value=s.icon; const r=p.querySelector(`input[value="${s.color}"]`); if(r) r.checked=true; }
      else{ $('#modal-subject-title').textContent='과목 추가'; $(CONFIG.SELECTORS.inputSubjectId).value=''; }
      $(CONFIG.SELECTORS.modalSubject).showModal();
    },

    handleSubjectSubmit(e,state) {
      const sub=e.submitter; if(sub&&(sub.value==='cancel'||sub.formMethod==='dialog'||sub.classList.contains('modal-close'))) return;
      e.preventDefault(); const f=e.target; const color=f.querySelector('input[name="color"]:checked')?.value||'#757575'; const data={id:f.subjectId.value||null,name:f.name.value,color,icon:f.icon.value||'📝'};
      const res=Logic.saveSubject(state,data);
      if(res.ok){ toast('저장됨','success'); $(CONFIG.SELECTORS.modalSubject).close(); Render.settings(state); Render.today(state); Render.week(state); }
      else toast(res.err,'error');
    },

    deleteSubject(id){ const state=store.getState(); if(confirm('과목 삭제 시 관련 일정은 "자율"로 변경됩니다. 계속?')){ const res=Logic.deleteSubject(state,id); if(res.ok){toast('삭제됨','success');Render.settings(state);Render.today(state);}else toast(res.err,'error');} },

    // --- 루틴 모달 ---
    openRoutineModal(id) {
      const state=store.getState(); const f=$(CONFIG.SELECTORS.formRoutine); f.reset(); const c=$(CONFIG.SELECTORS.routineBlocks); c.innerHTML=''; $$('#modal-routine .day-check').forEach(ch=>ch.checked=false);
      const addRow=b=>{const opts=Selectors.activeSubjects(state).map(s=>el('option',{value:s.id},`${s.icon} ${s.name}`)).join(''); c.appendChild(el('div',{class:'routine-block-row'},[el('select',{name:'subjectId',required:true},opts),el('input',{type:'time',name:'start',required:true,value:b.start||'19:00'}),el('input',{type:'time',name:'end',required:true,value:b.end||'20:00'}),el('button',{type:'button',class:'btn btn-sm btn-danger',onclick:e=>e.target.closest('.routine-block-row').remove()},'삭제')]));};
      if(id){ const t=state.settings.routineTemplates.find(x=>x.id===id); $('#modal-routine-title').textContent='루틴 수정'; $(CONFIG.SELECTORS.inputRoutineId).value=t.id; $(CONFIG.SELECTORS.inputRoutineName).value=t.name; t.days.forEach(d=>$(`#modal-routine input[value="${d}"]`).checked=true); t.blocks.forEach(b=>addRow(b)); $(CONFIG.SELECTORS.btnDeleteRoutine).hidden=false; }
      else{ $('#modal-routine-title').textContent='루틴 템플릿 만들기'; $(CONFIG.SELECTORS.inputRoutineId).value=''; addRow(); $(CONFIG.SELECTORS.btnDeleteRoutine).hidden=true; }
      $(CONFIG.SELECTORS.modalRoutine).showModal();
    },

    handleRoutineSubmit(e,state) {
      const sub=e.submitter; if(sub&&(sub.value==='cancel'||sub.formMethod==='dialog'||sub.classList.contains('modal-close'))) return;
      e.preventDefault(); const f=e.target; const days=Array.from(f.querySelectorAll('input[name="days"]:checked')).map(c=>c.value); const blocks=Array.from(f.querySelectorAll('.routine-block-row')).map(r=>({subjectId:r.querySelector('[name="subjectId"]').value,start:r.querySelector('[name="start"]').value,end:r.querySelector('[name="end"]').value})).filter(b=>b.subjectId&&b.start&&b.end);
      const data={id:f.routineId.value||null,name:f.name.value,days,blocks}; const res=Logic.saveRoutine(state,data);
      if(res.ok){ toast('저장됨','success'); $(CONFIG.SELECTORS.modalRoutine).close(); Render.settings(state); } else toast(res.err,'error');
    },

    deleteCurrentRoutine(state){ const id=$(CONFIG.SELECTORS.inputRoutineId).value; if(confirm('템플릿 삭제?')){ Logic.deleteRoutine(state,id); toast('삭제됨','success'); $(CONFIG.SELECTORS.modalRoutine).close(); Render.settings(state); } },

    openRoutinePicker(state){ const tpl=state.settings.routineTemplates; if(!tpl.length) return; if(tpl.length===1){Logic.applyRoutineToWeek(state,tpl[0].id);return;} const choice=prompt('적용할 루틴 번호:\n'+tpl.map((t,i)=>`${i+1}. ${t.name}`).join('\n')); const idx=parseInt(choice)-1; if(idx>=0&&idx<tpl.length) Logic.applyRoutineToWeek(state,tpl[idx].id); },

    // --- 드래그 앤 드롭 (데스크탑) ---
    onDragStart(e){ this.draggedBlock=e.target.closest('.study-block'); if(!this.draggedBlock) return; this.draggedFromDate=this.draggedBlock.dataset.date; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; setTimeout(()=>e.target.classList.add('drag-ghost'),0); },
    onDragEnd(e){ e.target.classList.remove('dragging','drag-ghost'); $$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); this.draggedBlock=null; this.draggedFromDate=null; },
    onDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; const cell=e.target.closest('.time-cell'); if(cell){$$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); cell.classList.add('drop-target');} },
    onDragLeave(e){ if(!e.currentTarget.contains(e.relatedTarget)) $$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); },
    onDrop(e,state){ e.preventDefault(); const cell=e.target.closest('.time-cell'); $$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); if(!this.draggedBlock||!cell) return; const id=this.draggedBlock.dataset.blockId; const newDate=cell.dataset.date||Selectors.todayKey(state); const newTime=cell.dataset.time; const block=(state.schedule[this.draggedFromDate]||[]).find(b=>b.id===id); if(!block) return; const dur=fmt.timeToMins(block.end)-fmt.timeToMins(block.start); const ns=fmt.timeToMins(newTime); if(ns<CONFIG.DAY_START_HOUR*60||ns+dur>CONFIG.DAY_END_HOUR*60){toast('시간 범위 초과(06:00~24:00)','error');return;} Logic.deleteBlock(state,id,this.draggedFromDate); Logic.saveBlock(state,{...block,id:null,date:newDate,start:fmt.minsToTime(ns),end:fmt.minsToTime(ns+dur)}); toast('이동됨','success'); Render.today(state); Render.week(state); Render.stats(state); },

    // --- 터치 드래그 (모바일) ---
    bindTouchDrag(grid,state){ let startY=0, startX=0, dragEl=null, ph=null, startTop=0, rowH=CONFIG.TIME_ROW_HEIGHT;
      grid.addEventListener('touchstart',e=>{const t=e.target.closest('.study-block'); if(!t) return; dragEl=t; const tc=e.touches[0]; startY=tc.clientY; startX=tc.clientX; startTop=dragEl.offsetTop; ph=document.createElement('div'); ph.className='study-block placeholder'; ph.style.height=dragEl.offsetHeight+'px'; ph.style.opacity='0.3'; dragEl.parentNode.insertBefore(ph,dragEl); dragEl.classList.add('dragging'); dragEl.style.position='absolute'; dragEl.style.zIndex=100; dragEl.style.width=dragEl.offsetWidth+'px';},{passive:true});
      grid.addEventListener('touchmove',e=>{if(!dragEl) return; e.preventDefault(); const tc=e.touches[0]; dragEl.style.top=(startTop+tc.clientY-startY)+'px'; const rect=dragEl.getBoundingClientRect(); const target=document.elementFromPoint(tc.clientX,rect.top+rect.height/2); const cell=target?.closest('.time-cell'); $$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); if(cell) cell.classList.add('drop-target');},{passive:false});
      grid.addEventListener('touchend',e=>{if(!dragEl) return; dragEl.classList.remove('dragging'); dragEl.style.position=''; dragEl.style.zIndex=''; dragEl.style.top=''; dragEl.style.width=''; $$('.time-cell.drop-target').forEach(c=>c.classList.remove('drop-target')); const cell=ph.parentElement?.querySelector('.time-cell.drop-target'); if(cell&&ph){ const id=dragEl.dataset.blockId; const newDate=cell.dataset.date||Selectors.todayKey(state); const newTime=cell.dataset.time; const block=(state.schedule[dragEl.dataset.date]||[]).find(b=>b.id===id); if(block){ const dur=fmt.timeToMins(block.end)-fmt.timeToMins(block.start); const ns=fmt.timeToMins(newTime); if(ns>=CONFIG.DAY_START_HOUR*60&&ns+dur<=CONFIG.DAY_END_HOUR*60){ Logic.deleteBlock(state,id,dragEl.dataset.date); Logic.saveBlock(state,{...block,id:null,date:newDate,start:fmt.minsToTime(ns),end:fmt.minsToTime(ns+dur)}); toast('이동됨','success'); Render.today(state); Render.week(state); Render.stats(state); } else toast('범위 초과','error'); } } ph?.remove(); ph=null; dragEl=null;}); },

    // --- 설정 액션 ---
    async handleImport(e,state){ const file=e.target.files[0]; if(!file) return; e.target.value=''; try{ const data=await Storage.importJSON(file); Object.assign(state.settings,data.settings); Object.assign(state.schedule,data.schedule); Object.assign(state.stats,data.stats); Object.assign(state.ui,data.ui); Storage.save(state); StatsEngine.recomputeAll(state); Render.header(state); Render.today(state); Render.week(state); Render.stats(state); Render.settings(state); toast('복구 완료','success'); }catch{ toast('잘못된 파일','error'); } },
    confirmReset(state){ if(confirm('⚠️ 모든 데이터 영구 삭제. 정말?')) if(confirm('되돌릴 수 없음. 확실?')){ localStorage.removeItem(CONFIG.STORAGE_KEY); location.reload(); } },
    setDarkMode(forced,state){ state.settings.darkModeForced=forced; const html=document.documentElement; if(forced===true) html.setAttribute('data-theme','dark'); else if(forced===false) html.setAttribute('data-theme','light'); else html.removeAttribute('data-theme'); },
    async requestNotificationPermission(){ if(!('Notification' in window)) return; if(Notification.permission==='default'){ const p=await Notification.requestPermission(); if(p!=='granted') toast('알림 권한 차단됨','warning'); } },

    // 과목 정렬
    bindSubjectSortable(list){ let dragItem=null; list.querySelectorAll('.subject-item').forEach(it=>{it.draggable=true; it.addEventListener('dragstart',e=>{dragItem=it; it.classList.add('dragging'); e.dataTransfer.effectAllowed='move';}); it.addEventListener('dragend',()=>{it.classList.remove('dragging'); dragItem=null;}); it.addEventListener('dragover',e=>e.preventDefault()); it.addEventListener('drop',e=>{e.preventDefault(); if(dragItem&&dragItem!==it){ const items=[...list.querySelectorAll('.subject-item')]; const from=items.indexOf(dragItem), to=items.indexOf(it); if(from<to) it.after(dragItem); else it.before(dragItem); const state=store.getState(); items.forEach((i,idx)=>{const s=state.settings.subjects.find(x=>x.id===i.dataset.subjectId); if(s) s.order=idx;}); Render.subjectList(state);} }); }); },

    // ============ [신규] Onboarding Logic ============
    Onboarding: {
      currentStep:1, selectedSubjects:[], routineBlocks:[],
      init(state){ if(localStorage.getItem('onboardingCompleted')==='true') return; setTimeout(()=>this.open(state),300); this.bindEvents(state); },
      bindEvents(state){ $(CONFIG.SELECTORS.obPrev).addEventListener('click',()=>this.prevStep(state)); $(CONFIG.SELECTORS.obNext).addEventListener('click',()=>this.nextStep(state)); $(CONFIG.SELECTORS.obFinish).addEventListener('click',()=>this.finish(state)); $(CONFIG.SELECTORS.obAddBlock).addEventListener('click',()=>this.addRoutineBlockRow()); const m=$(CONFIG.SELECTORS.modalOnboarding); m.addEventListener('cancel',e=>e.preventDefault()); m.addEventListener('click',e=>{if(e.target===m)e.preventDefault();}); },
      open(state){ this.currentStep=1; this.selectedSubjects=[]; this.routineBlocks=[]; this.renderStep1Subjects(state); this.updateUI(); $(CONFIG.SELECTORS.modalOnboarding).showModal(); },
      renderStep1Subjects(state){ const c=$(CONFIG.SELECTORS.obSubjectList); c.innerHTML=''; Selectors.activeSubjects(state).forEach(s=>{ const btn=el('button',{type:'button',class:'ob-subject-btn','data-id':s.id,onclick:()=>this.toggleSubject(s,btn)},[el('span',{class:'icon'},s.icon),el('span',{class:'name'},s.name)]); btn.style.setProperty('--subj-color',s.color); c.appendChild(btn); }); },
      toggleSubject(s,btn){ const i=this.selectedSubjects.findIndex(x=>x.id===s.id); if(i>-1){this.selectedSubjects.splice(i,1);btn.classList.remove('selected');}else{if(this.selectedSubjects.length>=8){toast('최대 8개','warning');return;} this.selectedSubjects.push(s);btn.classList.add('selected');} $(CONFIG.SELECTORS.obSelectedCount).textContent=this.selectedSubjects.length; },
      addRoutineBlockRow(b={}){ const c=$(CONFIG.SELECTORS.obRoutineForm); const opts=this.selectedSubjects.map(s=>el('option',{value:s.id},`${s.icon} ${s.name}`)).join(''); c.appendChild(el('div',{class:'ob-routine-row'},[el('select',{name:'subjectId',required:true},opts),el('input',{type:'time',name:'start',required:true,value:b.start||'16:00'}),el('input',{type:'time',name:'end',required:true,value:b.end||'17:30'}),el('button',{type:'button',class:'btn btn-danger btn-sm',onclick:e=>e.target.closest('.ob-routine-row').remove()},'삭제')])); },
      nextStep(state){ if(this.currentStep===1){if(this.selectedSubjects.length<3){toast('과목 3개 이상 선택','warning');return;} this.currentStep=2; this.renderStep2Routine();} else if(this.currentStep===2){if(!this.validateRoutine()) return; this.currentStep=3;} this.updateUI(); },
      prevStep(state){ if(this.currentStep>1){this.currentStep--;this.updateUI();} },
      updateUI(){ $$(CONFIG.SELECTORS.obSteps).forEach(el=>el.hidden=parseInt(el.dataset.step)!==this.currentStep); $$(CONFIG.SELECTORS.obProgressSteps).forEach((el,i)=>{el.classList.toggle('active',i+1===this.currentStep);el.classList.toggle('completed',i+1<this.currentStep);}); $(CONFIG.SELECTORS.obPrev).hidden=this.currentStep===1; $(CONFIG.SELECTORS.obNext).hidden=this.currentStep===3; $(CONFIG.SELECTORS.obFinish).hidden=this.currentStep!==3; },
      renderStep2Routine(){ const c=$(CONFIG.SELECTORS.obRoutineForm); c.innerHTML=''; this.selectedSubjects.slice(0,3).forEach((s,i)=>{ const sh=16+i*1.5; const st=`${Math.floor(sh).toString().padStart(2,'0')}:${sh%1?'30':'00'}`; const eh=sh+1; const et=`${Math.floor(eh).toString().padStart(2,'0')}:${eh%1?'30':'00'}`; this.addRoutineBlockRow({subjectId:s.id,start:st,end:et}); }); if(!this.selectedSubjects.length) this.addRoutineBlockRow(); },
      validateRoutine(){ const rows=$$('.ob-routine-row',$(CONFIG.SELECTORS.obRoutineForm)); if(!rows.length){toast('시간 1개 이상','warning');return false;} this.routineBlocks=[]; for(const r of rows){ const sub=r.querySelector('[name="subjectId"]').value, st=r.querySelector('[name="start"]').value, et=r.querySelector('[name="end"]').value; if(!sub||!st||!et){toast('빈칸 채우기','warning');return false;} if(fmt.compareTime(st,et)>=0){toast('끝시간 늦게','warning');return false;} this.routineBlocks.push({subjectId:sub,start:st,end:et});} return true; },
      finish(state){ const map=Object.fromEntries(this.selectedSubjects.map((s,i)=>[s.id,i+1])); state.settings.subjects.forEach(s=>{s.order=map[s.id]||100+s.order;}); state.settings.subjects.sort((a,b)=>a.order-b.order); if(this.routineBlocks.length){Logic.saveRoutine(state,{id:null,name:'평일 기본 루틴',days:['1','2','3','4','5'],blocks:this.routineBlocks});} const today=Selectors.todayKey(state); const first=this.routineBlocks[0]; if(first){Logic.saveBlock(state,{id:null,date:today,...first,memo:'첫 공부! 🎉',repeat:false});} store.commit('settings'); store.commit('schedule'); StatsEngine.recomputeAll(state); localStorage.setItem('onboardingCompleted','true'); $(CONFIG.SELECTORS.modalOnboarding).close(); toast('환영해요! 첫 루틴 저장 🎉','success'); Render.header(state); Render.today(state); }
    }
  };
  // ============================================================
  // 13. Global Event Listeners (전역 사이드 이펙트: 컨페티, 뱃지, 단축키)
  // ============================================================
  // 블록 완료 시 컨페티 & 즉시 통계 갱신
  window.addEventListener('block-completed', () => {
    fireConfetti();
    const state = store.getState();
    StatsEngine.recomputeAll(state);
    Render.header(state);
    Render.dailySummary(state);
    Render.stats(state);
  });

  // 뱃지 획득 알림
  window.addEventListener('badge-earned', (e) => {
    const b = e.detail;
    toast(`🏅 새 뱃지: ${b.name} ${b.icon}`, 'success', 5000);
  });

  // 키보드 단축키 (입력 필드 포커스 시 제외)
  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    const state = store.getState();
    const map = { 'n':()=>Controller.openBlockModal(null,Selectors.todayKey(state)), 't':()=>Controller.switchView('today',state), 'w':()=>Controller.switchView('week',state), 's':()=>Controller.switchView('stats',state), ',':()=>Controller.switchView('settings',state), 'ArrowLeft':()=>{if(state.ui.currentView==='week')Controller.navigateWeek(state,-1);}, 'ArrowRight':()=>{if(state.ui.currentView==='week')Controller.navigateWeek(state,1);}, '?':()=>toast('단축키: N(새블록) T(오늘) W(주간) S(기록) ,(설정) ←/→(주이동)','info',4000) };
    if(map[e.key]) { e.preventDefault(); map[e.key](); }
  });

  // 온라인/오프라인 감지
  window.addEventListener('online', ()=>toast('온라인 상태','success'));
  window.addEventListener('offline', ()=>toast('오프라인 모드 (로컬 저장)','warning'));

  // ============================================================
  // 14. Application Bootstrap (앱 진입점)
  // ============================================================
  const store = createStore(initialState);

  function initApp() {
    // 1. 로컬스토리지 로드 및 병합
    const saved = Storage.load();
    if (saved) {
      Object.assign(store.getState().settings, saved.settings);
      Object.assign(store.getState().schedule, saved.schedule);
      Object.assign(store.getState().stats, saved.stats);
      Object.assign(store.getState().ui, saved.ui);
    }

    const state = store.getState();

    // 2. 테마 초기화 (기본 라이트 강제)
    const darkVal = state.settings.darkModeForced === true;
    Controller.setDarkMode(darkVal, state);
    $(CONFIG.SELECTORS.toggleDark).checked = darkVal;

    // 3. 알림 권한 동기화
    $(CONFIG.SELECTORS.toggleNotify).checked = state.settings.notifyEnabled;

    // 4. 통계 초기 계산
    StatsEngine.recomputeAll(state);

    // 5. 컨트롤러/렌더러 초기화
    Controller.init(state);
    Render.header(state);
    Render.switchView(state.ui.currentView || 'today', state);

    // 6. 온보딩 실행 (최초 1회)
    Controller.Onboarding.init(state);

    // 7. PWA 설치 프롬프트 처리
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e;
      const banner = document.querySelector('.pwa-install-banner');
      if (banner) banner.classList.remove('hidden');
      banner?.querySelector('.btn-primary')?.addEventListener('click', async () => {
        banner.classList.add('hidden');
        await deferredPrompt.prompt();
        if ((await deferredPrompt.userChoice).outcome === 'accepted') toast('설치 감사!', 'success');
        deferredPrompt = null;
      });
    });

    console.log('📝 Study Planner Ready!');
  }

  // DOM Ready 시 실행
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
  else initApp();

  // ============================================================
  // 15. Global Export (디버깅용 콘솔 접근)
  // ============================================================
  window.StudyPlanner = {
    store, Storage, Logic, StatsEngine, Render, Controller, fmt,
    toast: (msg, type) => toast(msg, type)
  };

})(); // IIFE End