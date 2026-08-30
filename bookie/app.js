/* ============================================================
   app.js — 책읽기 친구 (단일 파일, ES Module)
   ============================================================ */

// ------------------------------------------------------------
// 0. 유틸리티 & 폴리필
// ------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().split('T')[0];
const fmtDate = (iso) => iso?.split('T')[0] ?? '';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Blob → Base64 (내보내기용)
const blobToBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});
const base64ToBlob = (b64, type) => {
  const [, mime, data] = b64.match(/^data:(.*?);base64,(.*)$/) || [];
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || type });
};

// 이미지 리사이즈 (최대 400px, 품질 0.8)
const resizeImage = (file, max = 400, quality = 0.8) => new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    let { width, height } = img;
    if (width > height) {
      if (width > max) { height = Math.round(height * max / width); width = max; }
    } else {
      if (height > max) { width = Math.round(width * max / height); height = max; }
    }
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(res, file.type || 'image/jpeg', quality);
  };
  img.src = URL.createObjectURL(file);
});

// ------------------------------------------------------------
// 1. IndexedDB 래퍼 (Promise 기반, idb 경량 구현)
// ------------------------------------------------------------
class SimpleIDB {
  constructor(name, version, schema) {
    this.name = name; this.version = version; this.schema = schema;
    this.dbp = null;
  }
  open() {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        this.schema.stores.forEach(s => {
          if (!db.objectStoreNames.contains(s.name)) {
            const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
            s.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath, idx.options));
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('[IDB] blocked');
    });
    return this.dbp;
  }
  // 트랜잭션 헬퍼
  async _tx(mode, stores, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      fn(tx);
    });
  }
  get(store, key) {
    return this._tx('readonly', [store], tx => {
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  getAll(store, indexName, range, direction = 'next') {
    return this._tx('readonly', [store], tx => {
      const src = indexName ? tx.objectStore(store).index(indexName) : tx.objectStore(store);
      const req = src.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  put(store, value) {
    return this._tx('readwrite', [store], tx => {
      tx.objectStore(store).put(value);
    });
  }
  delete(store, key) {
    return this._tx('readwrite', [store], tx => {
      tx.objectStore(store).delete(key);
    });
  }
  clear(store) {
    return this._tx('readwrite', [store], tx => {
      tx.objectStore(store).clear();
    });
  }
  // 커서 순회 (대량 데이터)
  async cursor(store, fn, indexName, direction = 'next') {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const src = indexName ? tx.objectStore(store).index(indexName) : tx.objectStore(store);
      const req = src.openCursor(null, direction);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { fn(cursor.value, cursor.key); cursor.continue(); }
        else resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

// 스키마 정의
const DB_SCHEMA = {
  stores: [
    { name: 'books', keyPath: 'id', indexes: [
      { name: 'by_date', keyPath: 'readDate' },
      { name: 'by_title', keyPath: 'title' },
      { name: 'by_rating', keyPath: 'rating' }
    ]},
    { name: 'settings', keyPath: 'key' },
    { name: 'badges', keyPath: 'id', indexes: [{ name: 'by_date', keyPath: 'earnedAt' }] }
  ]
};
const db = new SimpleIDB('ReadingLogDB', 1, DB_SCHEMA);

// ------------------------------------------------------------
// 2. 상태 관리 (간단한 옵저버 패턴)
// ------------------------------------------------------------
const State = (() => {
  const listeners = new Map();
  const state = {
    view: 'list', viewParams: {},
    books: [], filteredBooks: [],
    settings: { pinHash: null, pinSalt: null, theme: '' },
   : { isParent: false },
    pendingForm: null, // 수정 중인 책 ID
    media: { coverBlob: null, audioBlob: null, recording: false, mediaRecorder: null, chunks: [] }
  };
  return {
    get: (k) => state[k],
    set: (k, v) => { state[k] = v; (listeners.get(k) || []).forEach(cb => cb(v)); },
    on: (k, cb) => { (listeners.get(k) || listeners.set(k, []).get(k)).push(cb); },
    off: (k, cb) => { const arr = listeners.get(k); if (arr) arr.splice(arr.indexOf(cb), 1); },
    all: () => state
  };
})();

// ------------------------------------------------------------
// 3. 해시 라우터
// ------------------------------------------------------------
class Router {
  constructor(routes) { this.routes = routes; window.addEventListener('hashchange', () => this.resolve()); }
  async resolve() {
    const hash = location.hash.slice(1) || '/';
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query);
    for (const [pattern, controller] of this.routes) {
      const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
      const match = path.match(regex);
      if (match) {
        State.set('viewParams', match.groups || {});
        State.set('view', pattern);
        await controller(match.groups || {}, Object.fromEntries(params));
        return;
      }
    }
    // 404 -> list
    location.hash = '#/list';
  }
  navigate(to) { location.hash = to; }
}

// ------------------------------------------------------------
// 4. 뷰 컨트롤러 베이스 & 렌더링 헬퍼
// ------------------------------------------------------------
const templates = {};
function getTemplate(id) {
  if (!templates[id]) templates[id] = document.getElementById(id).content.cloneNode(true);
  return templates[id];
}
function renderTemplate(id, target = $('#app')) {
  target.innerHTML = '';
  target.appendChild(getTemplate(id));
  return target.firstElementChild;
}
function bindEvents(root, bindings) {
  // bindings: { 'selector': { event: handler, ... }, ... }
  Object.entries(bindings).forEach(([sel, evs]) => {
    const els = sel === ':root' ? [root] : root.querySelectorAll(sel);
    els.forEach(el => Object.entries(evs).forEach(([ev, fn]) => el.addEventListener(ev, fn)));
  });
}
function showToast(msg, type = 'info') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function showDialog(html) {
  const d = document.createElement('dialog');
  d.className = 'onboarding-dialog';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.showModal();
  return {
    close: (val) => { d.close(val); d.remove(); },
    onClose: (fn) => d.addEventListener('close', () => fn(d.returnValue), { once: true })
  };
}

// ------------------------------------------------------------
// 5. 서비스: 암호화, 미디어, 내보내기
// ------------------------------------------------------------
const CryptoService = {
  async hashPin(pin, salt = crypto.getRandomValues(new Uint8Array(16))) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
    return { hash: new Uint8Array(hash), salt };
  },
  async verifyPin(pin, salt, hash) {
    const { hash: h } = await this.hashPin(pin, salt);
    return h.every((v, i) => v === hash[i]);
  },
  bufToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); },
  hexToBuf(hex) { return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16))); }
};

const MediaService = {
  // 카메라/파일 → 리사이즈 Blob
  async pickImage() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const blob = await resizeImage(file);
        resolve(blob);
      };
      input.click();
    });
  },
  // 음성 녹음
  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.start(100);
      State.set('media', { ...State.get('media'), recording: true, mediaRecorder: mr, chunks, stream });
      return true;
    } catch (e) { showToast('마이크 권한이 필요합니다.', 'error'); return false; }
  },
  stopRecording() {
    return new Promise((resolve) => {
      const { mediaRecorder, chunks, stream } = State.get('media');
      if (!mediaRecorder) return resolve(null);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        State.set('media', { ...State.get('media'), recording: false, audioBlob: blob, mediaRecorder: null, chunks: [], stream: null });
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  },
  // 음성 인식 (Web Speech API)
  startRecognition(lang = 'ko-KR') {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Promise.reject('지원 안 함');
    return new Promise((resolve, reject) => {
      const rec = new SR();
      rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = e => resolve(e.results[0][0].transcript);
      rec.onerror = reject;
      rec.onend = () => rec.stop();
      rec.start();
    });
  }
};

const ExportService = {
  async exportJSON() {
    const books = await db.getAll('books');
    const settings = await db.get('settings', 'app_config');
    const badges = await db.getAll('badges');
    const data = { version: 1, exportedAt: nowISO(), books, settings, badges };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.download(blob, `독서록_백업_${todayISO()}.json`);
  },
  async exportCSV() {
    const books = await db.getAll('books', 'by_date', null, 'prev'); // 최신순
    const headers = ['날짜', '제목', '지은이', '별점', '느낌', '한줄평', '페이지', 'ISBN'];
    const rows = books.map(b => [
      fmtDate(b.readDate), b.title, b.author, b.rating, b.feeling, b.memo.replace(/\n/g, ' '), b.pages || '', b.isbn || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    this.download(blob, `독서록_백업_${todayISO()}.csv`);
  },
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  async importJSON(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const data = JSON.parse(r.result);
          if (!data.books) throw new Error('잘못된 파일');
          // 트랜잭션으로 일괄 저장
          await db.clear('books');
          for (const b of data.books) await db.put('books', b);
          if (data.settings) await db.put('settings', { key: 'app_config', ...data.settings });
          if (data.badges) { await db.clear('badges'); for (const b of data.badges) await db.put('badges', b); }
          showToast('가져오기 완료!', 'success');
          resolve(true);
        } catch (e) { showToast('파일 형식이 올바르지 않습니다.', 'error'); reject(e); }
      };
      r.onerror = reject;
      r.readAsText(file);
    });
  }
};

// ------------------------------------------------------------
// 6. 뷰 컨트롤러 구현
// ------------------------------------------------------------

// --- List View ---
async function ListController() {
  const root = renderTemplate('tpl-list');
  const listEl = $('#bookList', root);
  const emptyEl = $('#emptyState', root);
  const loadMoreBtn = $('#btnLoadMore', root);
  const fab = $('#fabAdd');
  fab.hidden = false;

  // 통계 업데이트
  const updateStats = (books) => {
    const total = books.length;
    const thisMonth = books.filter(b => b.readDate.startsWith(todayISO().slice(0, 7))).length;
    const avg = total ? (books.reduce((s, b) => s + b.rating, 0) / total).toFixed(1) : '0.0';
    $('#statTotalBooks').textContent = total;
    $('#statMonthBooks').textContent = thisMonth;
    $('#statAvgRating').textContent = avg;
  };

  const renderBooks = (books, append = false) => {
    if (!append) listEl.innerHTML = '';
    if (books.length === 0 && !append) { emptyEl.hidden = false; loadMoreBtn.hidden = true; return; }
    emptyEl.hidden = true;
    books.forEach(b => {
      const card = document.createElement('li');
      card.className = 'book-card';
      card.dataset.id = b.id;
      const cover = b.coverImage ? URL.createObjectURL(b.coverImage) : '';
      card.innerHTML = `
        <img class="book-card__cover" src="${cover || ''}" alt="${b.title} 표지" loading="lazy">
        <div class="book-card__body">
          <h3 class="book-card__title">${b.title}</h3>
          <p class="book-card__author">${b.author || '미상'}</p>
          <div class="book-card__meta">
            <span class="book-card__rating">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>
            <time class="book-card__date">${fmtDate(b.readDate)}</time>
          </div>
        </div>`;
      listEl.appendChild(card);
    });
    loadMoreBtn.hidden = books.length < 20; // 페이지 크기 20
  };

  // 초기 로드 (최신 20개)
  let loaded = 0;
  const PAGE = 20;
  const loadPage = async (append) => {
    const all = await db.getAll('books', 'by_date', null, 'prev');
    State.set('books', all);
    updateStats(all);
    const slice = all.slice(loaded, loaded + PAGE);
    renderBooks(slice, append);
    loaded += slice.length;
  };
  await loadPage(false);

  // 이벤트 바인딩
  bindEvents(root, {
    '.book-card': { click: (e) => { const id = e.currentTarget.dataset.id; Router.navigate(`#/detail/${id}`); } },
    '#btnLoadMore': { click: () => loadPage(true) }
  });
  $('#btnParent').onclick = () => Router.navigate('#/parent-lock');
  fab.onclick = () => Router.navigate('#/add');
}

// --- Form View (Add/Edit) ---
async function FormController(params) {
  const isEdit = params.id === 'edit'; // 라우트에서 /add 또는 /edit/:id 구분 필요 -> 라우터 패턴 수정
  // 라우터 패턴: '#/add' , '#/edit/:id'
  // 여기서는 State.viewParams.id 로 구분
  const bookId = State.get('viewParams').id;
  const isEditMode = !!bookId && bookId !== 'add';

  const root = renderTemplate('tpl-form');
  const form = $('#bookForm', root);
  const coverPreview = $('#coverPreview', root);
  const coverInput = $('#inputCover', root);
  const btnTake = $('#btnTakePhoto', root);
  const btnChoose = $('#btnChooseFile', root);
  const btnClear = $('#btnClearCover', root);
  const btnRecord = $('#btnRecord', root);
  const btnStop = $('#btnStopRecord', root);
  const recUI = $('#recordingUI', root);
  const recTime = $('#recordingTime', root);
  const audioPlayer = $('#audioPlayback', root);
  const micBtns = $$('.btn-mic', root);

  // 초기화
  State.set('media', { coverBlob: null, audioBlob: null, recording: false, mediaRecorder: null, chunks: [] });
  if (isEditMode) {
    const book = await db.get('books', bookId);
    if (!book) return Router.navigate('#/list');
    State.set('pendingForm', bookId);
    // 폼 채우기
    form.id.value = book.id;
    form.createdAt.value = book.createdAt;
    form.title.value = book.title;
    form.author.value = book.author || '';
    form.rating.value = book.rating;
    form.feeling.value = book.feeling || '';
    form.memo.value = book.memo || '';
    form.readDate.value = fmtDate(book.readDate);
    form.pages.value = book.pages || '';
    form.isbn.value = book.isbn || '';
    if (book.coverImage) {
      coverPreview.classList.add('has-image');
      coverPreview.innerHTML = `<img src="${URL.createObjectURL(book.coverImage)}" alt="표지">`;
      btnClear.hidden = false;
      State.set('media', { ...State.get('media'), coverBlob: book.coverImage });
    }
    if (book.audioBlob) {
      audioPlayer.src = URL.createObjectURL(book.audioBlob);
      audioPlayer.hidden = false;
      State.set('media', { ...State.get('media'), audioBlob: book.audioBlob });
    }
  } else {
    form.readDate.value = todayISO();
    form.createdAt.value = nowISO();
    form.id.value = uuid();
  }

  // 표지 이미지 처리
  const setCover = (blob) => {
    State.set('media', { ...State.get('media'), coverBlob: blob });
    coverPreview.classList.add('has-image');
    coverPreview.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="표지">`;
    btnClear.hidden = false;
  };
  btnTake.onclick = async () => { const blob = await MediaService.pickImage(); if (blob) setCover(blob); };
  btnChoose.onclick = () => coverInput.click();
  coverInput.onchange = async () => { const f = coverInput.files[0]; if (f) { const blob = await resizeImage(f); setCover(blob); } coverInput.value = ''; };
  btnClear.onclick = () => {
    State.set('media', { ...State.get('media'), coverBlob: null });
    coverPreview.classList.remove('has-image');
    coverPreview.innerHTML = `<i class="bi bi-camera-fill cover-preview__icon"></i><span class="cover-preview__text">표지 찍기/선택</span>`;
    btnClear.hidden = true;
  };

  // 음성 녹음
  let recTimer = null;
  btnRecord.onclick = async () => {
    const ok = await MediaService.startRecording();
    if (!ok) return;
    btnRecord.hidden = true; recUI.hidden = false;
    let sec = 0; recTimer = setInterval(() => { sec++; recTime.textContent = `${String(sec>>1).padStart(2,'0')}:${String(sec%2?30:0).padStart(2,'0')}`; }, 500);
  };
  btnStop.onclick = async () => {
    const blob = await MediaService.stopRecording();
    clearInterval(recTimer);
    btnRecord.hidden = false; recUI.hidden = true;
    if (blob) {
      audioPlayer.src = URL.createObjectURL(blob);
      audioPlayer.hidden = false;
      State.set('media', { ...State.get('media'), audioBlob: blob });
    }
  };

  // 음성 입력 (Speech Recognition)
  micBtns.forEach(btn => {
    btn.onclick = async () => {
      const targetId = btn.id.replace('mic', 'input').toLowerCase(); // micTitle -> inputTitle
      const target = $(`#${targetId}`, root);
      if (!target) return;
      btn.classList.add('listening');
      try {
        const text = await MediaService.startRecognition();
        target.value += (target.value ? ' ' : '') + text;
        target.dispatchEvent(new Event('input'));
      } catch (e) { showToast('음성 인식을 사용할 수 없습니다.', 'error'); }
      btn.classList.remove('listening');
    };
  });

  // 폼 제출
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const book = {
      id: fd.get('id'),
      createdAt: fd.get('createdAt'),
      updatedAt: nowISO(),
      title: fd.get('title').trim(),
      author: fd.get('author').trim(),
      rating: parseInt(fd.get('rating')),
      feeling: fd.get('feeling'),
      memo: fd.get('memo').trim(),
      readDate: fd.get('readDate'),
      pages: fd.get('pages') ? parseInt(fd.get('pages')) : null,
      isbn: fd.get('isbn').trim() || null,
      coverImage: State.get('media').coverBlob,
      audioBlob: State.get('media').audioBlob
    };
    if (!book.title) return showToast('제목은 필수입니다.', 'error');
    if (!book.readDate) return showToast('읽은 날짜를 선택하세요.', 'error');
    if (!book.rating) return showToast('별점을 선택하세요.', 'error');

    await db.put('books', book);
    showToast(isEditMode ? '수정되었습니다.' : '저장되었습니다.', 'success');
    Router.navigate('#/list');
  };

  $('#btnCancel', root).onclick = () => Router.navigate('#/list');

  // 헤더 타이틀 변경
  $('.app-bar__title').textContent = isEditMode ? '책 수정' : '책 추가';
}

// --- Detail View ---
async function DetailController(params) {
  const book = await db.get('books', params.id);
  if (!book) return Router.navigate('#/list');
  const root = renderTemplate('tpl-detail');
  const cont = $('#detailContent', root);
  const cover = book.coverImage ? URL.createObjectURL(book.coverImage) : '';
  const audio = book.audioBlob ? URL.createObjectURL(book.audioBlob) : '';

  cont.innerHTML = `
    <img class="book-detail__cover" src="${cover || ''}" alt="${book.title} 표지">
    <div class="book-detail__content">
      <h2 class="book-detail__title">${book.title}</h2>
      <p class="book-detail__author">${book.author || '작자 미상'}</p>
      <div class="book-detail__meta">
        <span class="book-detail__rating">${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</span>
        <span>${book.feeling || ''}</span>
        <time>${fmtDate(book.readDate)}</time>
        ${book.pages ? `<span>${book.pages}쪽</span>` : ''}
        ${book.isbn ? `<span>ISBN: ${book.isbn}</span>` : ''}
      </div>
      <p class="book-detail__memo">${book.memo || '한줄평이 없습니다.'}</p>
      ${audio ? `<div class="book-detail__audio"><audio controls src="${audio}"></audio></div>` : ''}
    </div>`;

  // 보호자 모드일 때만 수정/삭제 버튼 표시
  const isParent = State.get('').isParent;
  $('#btnEdit', root).hidden = !isParent;
  $('#btnDelete', root).hidden = !isParent;

  $('#btnEdit', root).onclick = () => Router.navigate(`#/edit/${book.id}`);
  $('#btnDelete', root).onclick = async () => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await db.delete('books', book.id);
    // Blob URL 해제 (메모리 누수 방지) - 실제로는 GC가 처리하지만 명시적 해제 권장
    if (cover) URL.revokeObjectURL(cover);
    if (audio) URL.revokeObjectURL(audio);
    showToast('삭제되었습니다.', 'success');
    Router.navigate('#/list');
  };
}

// --- Parent Lock View ---
async function ParentLockController() {
  const root = renderTemplate('tpl-parent-lock');
  const form = $('#pinForm', root);
  const inputs = $$('input', form);
  const errorEl = $('#pinError', root);
  const settings = await db.get('settings', 'app_config');

  // PIN 입력 자동 포커스 이동
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      if (inp.value.length === 1 && i < 3) inputs[i + 1].focus();
      errorEl.hidden = true;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
    });
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const pin = Array.from(inputs).map(i => i.value).join('');
    if (pin.length !== 4) return;
    if (!settings?.pinHash) { // 최초 설정
      const { hash, salt } = await CryptoService.hashPin(pin);
      await db.put('settings', { key: 'app_config', pinHash: CryptoService.bufToHex(hash), pinSalt: CryptoService.bufToHex(salt), theme: '' });
      State.set('', { isParent: true });
      State.set('settings', { pinHash: CryptoService.bufToHex(hash), pinSalt: CryptoService.bufToHex(salt) });
      Router.navigate('#/parent');
      return;
    }
    const ok = await CryptoService.verifyPin(pin, CryptoService.hexToBuf(settings.pinSalt), CryptoService.hexToBuf(settings.pinHash));
    if (ok) {
      State.set('', { isParent: true });
      State.set('settings', settings);
      Router.navigate('#/parent');
    } else {
      errorEl.hidden = false;
      inputs.forEach(i => i.value = '');
      inputs[0].focus();
    }
  };
  $('#btnForgotPin', root).onclick = () => showToast('PIN을 잊으셨다면 앱 데이터를 삭제 후 재설정해야 합니다.', 'info');
}

// --- Parent Dashboard View ---
async function ParentController() {
  if (!State.get('').isParent) return Router.navigate('#/parent-lock');
  const root = renderTemplate('tpl-parent');
  const settings = State.get('settings');

  // 테마 토글
  const toggle = $('#toggleTheme', root);
  toggle.checked = settings.theme === 'dark' || (settings.theme === '' && matchMedia('(prefers-color-scheme: dark)').matches);
  toggle.onchange = async () => {
    const theme = toggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    settings.theme = theme;
    await db.put('settings', { key: 'app_config', ...settings });
  };

  // 내보내기
  $('#btnExportJson', root).onclick = () => ExportService.exportJSON();
  $('#btnExportCsv', root).onclick = () => ExportService.exportCSV();

  // 가져오기
  $('#btnImport', root).onclick = () => $('#inputImport', root).click();
  $('#inputImport', root).onchange = async (e) => {
    const file = e.target.files[0];
    if (file) { await ExportService.importJSON(file); Router.navigate('#/list'); }
    e.target.value = '';
  };

  // 비밀번호 변경
  $('#btnChangePin', root).onclick = async () => {
    const newPin = prompt('새 4자리 PIN을 입력하세요');
    if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return showToast('4자리 숫자를 입력하세요.', 'error');
    const { hash, salt } = await CryptoService.hashPin(newPin);
    settings.pinHash = CryptoService.bufToHex(hash);
    settings.pinSalt = CryptoService.bufToHex(salt);
    await db.put('settings', { key: 'app_config', ...settings });
    State.set('settings', settings);
    showToast('비밀번호가 변경되었습니다.', 'success');
  };

  // 전체 삭제
  $('#btnClearAll', root).onclick = async () => {
    if (!confirm('정말 모든 독서록을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    if (!confirm('최종 확인: 모든 데이터(책, 설정, 뱃지)가 영구 삭제됩니다.')) return;
    await db.clear('books'); await db.clear('badges');
    // 설정 중 테마만 남기고 PIN 초기화
    const newSettings = { key: 'app_config', theme: settings.theme };
    await db.put('settings', newSettings);
    State.set('settings', newSettings);
    State.set('', { isParent: false });
    showToast('모든 데이터가 삭제되었습니다.', 'success');
    Router.navigate('#/list');
  };
}

// --- Stats View ---
async function StatsController() {
  const root = renderTemplate('tpl-stats');
  const books = await db.getAll('books', 'by_date', null, 'prev');
  if (!books.length) { root.innerHTML = '<p class="empty-state__text" style="padding:2rem;text-align:center">통계를 낼 데이터가 없습니다.</p>'; return; }

  // 통계 계산
  const total = books.length;
  const thisMonth = books.filter(b => b.readDate.startsWith(todayISO().slice(0, 7))).length;
  const avgRating = (books.reduce((s, b) => s + b.rating, 0) / total).toFixed(1);
  // 연속 읽기 (간단 구현: 날짜 중복 제거 후 정렬)
  const dates = [...new Set(books.map(b => b.readDate))].sort();
  let bestStreak = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const d1 = new Date(dates[i-1]), d2 = new Date(dates[i]);
    if ((d2 - d1) / 864e5 === 1) cur++; else cur = 1;
    if (cur > bestStreak) bestStreak = cur;
  }

  $('#statTotal').textContent = total;
  $('#statThisMonth').textContent = thisMonth;
  $('#statAvgStar').textContent = avgRating;
  $('#statBestStreak').textContent = bestStreak;

  // 월별 데이터 (최근 12개월)
  const monthly = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    monthly[key] = 0;
  }
  books.forEach(b => { if (monthly[b.readDate.slice(0,7)] !== undefined) monthly[b.readDate.slice(0,7)]++; });

  // 별점 분포
  const ratingDist = [0,0,0,0,0];
  books.forEach(b => ratingDist[b.rating - 1]++);

  // 최애 작가/느낌
  const count = (arr, key) => arr.reduce((a, b) => { const v = b[key]; if (v) a[v] = (a[v]||0)+1; return a; }, {});
  const topAuthors = Object.entries(count(books, 'author')).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topFeelings = Object.entries(count(books, 'feeling')).sort((a,b)=>b[1]-a[1]).slice(0,5);

  $('#favAuthors').innerHTML = topAuthors.map(([k,v]) => `<span class="tag">${k} (${v})</span>`).join('');
  $('#favFeelings').innerHTML = topFeelings.map(([k,v]) => `<span class="tag">${k} (${v})</span>`).join('');

  // Chart.js 동적 로드 및 렌더링
  try {
    const { Chart } = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
    new Chart($('#chartMonthly', root), {
      type: 'bar', data: { labels: Object.keys(monthly), datasets: [{ label: '권수', data: Object.values(monthly), backgroundColor: 'rgba(74,144,226,0.6)', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
    new Chart($('#chartRating', root), {
      type: 'doughnut', data: { labels: ['★','★★','★★★','★★★★','★★★★★'], datasets: [{ data: ratingDist, backgroundColor: ['#ef4444','#f97316','#fbbf24','#84cc16','#22c55e'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' }
    });
  } catch (e) { console.warn('Chart.js 로드 실패', e); }
}

// --- Onboarding ---
function OnboardingController() {
  const dialog = document.getElementById('onboardingDialog');
  if (!dialog) return;
  dialog.showModal();
  $('#btnOnboardingClose').onclick = () => { dialog.close(); Router.navigate('#/list'); };
}

// ------------------------------------------------------------
// 7. 라우터 설정 및 앱 초기화
// ------------------------------------------------------------
const routes = [
  ['/list', ListController],
  ['/add', FormController],
  ['/edit/(?<id>[^/]+)', FormController],
  ['/detail/(?<id>[^/]+)', DetailController],
  ['/parent-lock', ParentLockController],
  ['/parent', ParentController],
  ['/stats', StatsController],
  ['/onboarding', OnboardingController]
];
const router = new Router(routes);

// 전역 네비게이션 바인딩
$('#btnParent').onclick = () => {
  if (State.get('').isParent) router.navigate('#/parent');
  else router.navigate('#/parent-lock');
};

// 초기화
async function init() {
  // 1. DB 오픈
  await db.open();

  // 2. 설정 로드
  const settings = await db.get('settings', 'app_config');
  if (settings) {
    State.set('settings', settings);
    if (settings.theme !== '') document.documentElement.dataset.theme = settings.theme;
  }

  // 3. 온보딩 체크
  const visited = localStorage.getItem('onboarding_done');
  if (!visited) {
    router.navigate('#/onboarding');
    localStorage.setItem('onboarding_done', 'true');
  } else {
    router.resolve(); // 현재 해시 처리
  }

  // 4. PWA 설치 프롬프트
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    // 필요시 배너 표시 로직 추가
  });
  // 설치 완료 감지
  window.addEventListener('appinstalled', () => { deferredPrompt = null; console.log('PWA installed'); });

  // 5. Service Worker 업데이트 알림
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          if (confirm('새 버전이 있습니다. 새로고침하시겠습니까?')) location.reload();
        }
      });
    });
  }

  // 6. 전역 키보드 단축키 (선택)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const dialog = document.querySelector('dialog[open]');
      if (dialog) dialog.close();
    }
  });
}

// 시작
init().catch(console.error);

// 개발용 전역 노출 (콘솔 디버깅)
window.__APP__ = { db, State, router, CryptoService, MediaService, ExportService };