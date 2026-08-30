// ==========================================================================
// views/SettingsView.js - Settings, Backup/Restore, App Info
// ==========================================================================

import { state, subscribe } from '../utils/store.js';
import { ReadingDB } from '../db.js';
import { formatDate, formatRelativeTime } from '../utils/date.js';
import { showToast, showConfirm, showAlert, closeModal } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Constants & Module State
// -------------------------------------------------------------------------
let _cleanupFns = [];
let _dom = {};
let _deferredInstallPrompt = null; // PWA 설치 프롬프트 저장
let _isExporting = false;
let _isImporting = false;

// -------------------------------------------------------------------------
// 2. Render Layout
// -------------------------------------------------------------------------

function renderLayout(settings) {
  const { theme, lastBackup, storageUsage } = settings;
  
  _dom.container.innerHTML = `
    <header class="page-header">
      <div>
        <h1 class="page-title">설정</h1>
        <p class="page-subtitle">앱 동작, 데이터 관리, 정보 확인</p>
      </div>
    </header>

    <div class="settings-view">
      <!-- Section 1: Appearance -->
      <section class="settings-section">
        <header class="settings-section__header">
          <h2 class="settings-section__title">🎨 화면 설정</h2>
          <p class="settings-section__desc">테마 모드를 선택하세요. '시스템 설정'을 따르면 OS 테마에 맞춰 자동 변경됩니다.</p>
        </header>
        <div class="settings-section__body">
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">테마 모드</span>
              <span class="setting-item__desc">라이트 / 다크 / 시스템 연동</span>
            </div>
            <div class="setting-item__control">
              <div class="theme-toggle-group" role="radiogroup" aria-label="테마 선택">
                ${['', 'light', 'dark'].map(t => `
                  <label class="theme-toggle-btn ${theme === t ? 'active' : ''}" data-theme="${t}" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.5rem 1rem; border:1px solid var(--color-border); border-radius:var(--radius-md); cursor:pointer; background:var(--color-bg-secondary); transition:all var(--transition-fast);">
                    <input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''} style="accent-color: var(--color-brand);">
                    <span>${t === '' ? '💻 시스템' : t === 'light' ? '☀️ 라이트' : '🌙 다크'}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: Data Management -->
      <section class="settings-section">
        <header class="settings-section__header">
          <h2 class="settings-section__title">💾 데이터 관리</h2>
          <p class="settings-section__desc">독서록 데이터를 백업하거나 다른 기기에서 복원하세요. Zip 압축으로 용량을 줄입니다.</p>
        </header>
        <div class="settings-section__body">
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">데이터 내보내기 (백업)</span>
              <span class="setting-item__desc">전체 데이터(도서, 메모, 표지 이미지)를 .zip 파일로 다운로드합니다.</span>
            </div>
            <div class="setting-item__control">
              <button class="btn btn-primary" id="btn-export" ${_isExporting ? 'disabled' : ''}>
                ${_isExporting ? '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;margin-right:0.5rem;"></span>백업 중...' : '백업 파일 다운로드'}
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">데이터 가져오기 (복원)</span>
              <span class="setting-item__desc">백업 파일(.zip 또는 .json)을 선택해 현재 데이터를 덮어씁니다. <strong class="text-danger">기존 데이터는 모두 삭제됩니다.</strong></span>
            </div>
            <div class="setting-item__control">
              <label class="btn btn-secondary" style="cursor:pointer;">
                백업 파일 선택
                <input type="file" id="import-file-input" accept=".zip,.json" class="form-input" style="display:none;" aria-label="백업 파일 선택">
              </label>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">마지막 백업</span>
              <span class="setting-item__desc" id="last-backup-text">${lastBackup ? `🕐 ${formatRelativeTime(lastBackup)} (${formatDate(lastBackup, 'YYYY-MM-DD HH:mm')})` : '백업 기록 없음'}</span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">저장소 사용량</span>
              <span class="setting-item__desc" id="storage-usage-text">계산 중...</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3: PWA & App Info -->
      <section class="settings-section">
        <header class="settings-section__header">
          <h2 class="settings-section__title">📱 앱 정보 & 설치</h2>
        </header>
        <div class="settings-section__body">
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">버전</span>
              <span class="setting-item__desc">1.0.0 (Build: ${new Date().toISOString().split('T')[0]})</span>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">홈 화면에 추가</span>
              <span class="setting-item__desc" id="pwa-install-desc">이 앱을 기기에 설치하여 오프라인에서 이용하세요.</span>
            </div>
            <div class="setting-item__control">
              <button class="btn btn-primary" id="btn-install-pwa" style="display:none;">설치하기</button>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">사용 라이브러리</span>
              <span class="setting-item__desc">IndexedDB (Native), Marked.js, UUID, JSZip</span>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label">라이선스</span>
              <span class="setting-item__desc">MIT License. 오픈소스 프로젝트.</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 4: Danger Zone -->
      <section class="settings-section" style="border-color: var(--color-danger);">
        <header class="settings-section__header" style="border-color: var(--color-danger);">
          <h2 class="settings-section__title" style="color: var(--color-danger);">⚠️ 위험 구역</h2>
          <p class="settings-section__desc">실행 시 되돌릴 수 없는 작업들입니다. 신중하게 진행하세요.</p>
        </header>
        <div class="settings-section__body">
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label" style="color: var(--color-danger);">브라우저 캐시 삭제</span>
              <span class="setting-item__desc">Service Worker 캐시, 이미지 Object URL 등 임시 파일을 정리합니다. 로그아웃되지 않습니다.</span>
            </div>
            <div class="setting-item__control">
              <button class="btn btn-ghost btn-danger" id="btn-clear-cache">캐시 정리</button>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-item__info">
              <span class="setting-item__label" style="color: var(--color-danger);">모든 데이터 초기화</span>
              <span class="setting-item__desc"><strong>IndexedDB의 모든 데이터(도서, 메모, 표지, 설정)가 영구 삭제</strong>됩니다. 백업 후 진행하세요.</span>
            </div>
            <div class="setting-item__control">
              <button class="btn btn-danger" id="btn-nuke-data">전체 데이터 삭제</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  cacheDomElements();
  bindEvents();
  updateStorageUsage();
  setupPWAInstallListener();
}

function cacheDomElements() {
  _dom = {
    container: document.getElementById('app'),
    themeBtns: document.querySelectorAll('.theme-toggle-btn'),
    btnExport: document.getElementById('btn-export'),
    btnImport: document.getElementById('import-file-input'),
    btnInstallPwa: document.getElementById('btn-install-pwa'),
    btnClearCache: document.getElementById('btn-clear-cache'),
    btnNukeData: document.getElementById('btn-nuke-data'),
    lastBackupText: document.getElementById('last-backup-text'),
    storageUsageText: document.getElementById('storage-usage-text'),
    pwaInstallDesc: document.getElementById('pwa-install-desc')
  };
}

// -------------------------------------------------------------------------
// 3. Event Handlers
// -------------------------------------------------------------------------

function bindEvents() {
  // 테마 변경
  _dom.themeBtns.forEach(btn => {
    btn.addEventListener('click', () => handleThemeChange(btn.dataset.theme));
  });
  _cleanupFns.push(() => _dom.themeBtns.forEach(btn => btn.onclick = null));

  // 백업
  _dom.btnExport?.addEventListener('click', handleExport);
  _cleanupFns.push(() => _dom.btnExport?.removeEventListener('click', handleExport));

  // 복원
  _dom.btnImport?.addEventListener('change', handleImport);
  _cleanupFns.push(() => _dom.btnImport?.removeEventListener('change', handleImport));

  // PWA 설치
  _dom.btnInstallPwa?.addEventListener('click', handlePWAInstall);
  _cleanupFns.push(() => _dom.btnInstallPwa?.removeEventListener('click', handlePWAInstall));

  // 캐시 삭제
  _dom.btnClearCache?.addEventListener('click', handleClearCache);
  _cleanupFns.push(() => _dom.btnClearCache?.removeEventListener('click', handleClearCache));

  // 전체 데이터 삭제
  _dom.btnNukeData?.addEventListener('click', handleNukeData);
  _cleanupFns.push(() => _dom.btnNukeData?.removeEventListener('click', handleNukeData));
}

// -------------------------------------------------------------------------
// 4. Core Actions
// -------------------------------------------------------------------------

// --- Theme ---
async function handleThemeChange(theme) {
  const html = document.documentElement;
  html.dataset.theme = theme === '' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  await ReadingDB.setSetting('theme', theme);
  showToast(`테마가 '${theme === '' ? '시스템 연동' : theme}'로 변경되었습니다.`, 'success');
  
  _dom.themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  _dom.themeBtns.forEach(b => b.querySelector('input').checked = b.dataset.theme === theme);
}

// --- Export (Backup) ---
async function handleExport() {
  if (_isExporting) return;
  _isExporting = true;
  _dom.btnExport.disabled = true;
  _dom.btnExport.innerHTML = '<span class="loading__spinner" style="width:16px;height:16px;border-width:2px;margin-right:0.5rem;"></span>백업 생성 중...';

  try {
    // 1. DB에서 전체 데이터 추출 (Base64 이미지 포함)
    const data = await ReadingDB.exportAll();
    
    // 2. JSZip으로 압축
    const zip = new JSZip();
    
    // 메타데이터 파일
    zip.file('metadata.json', JSON.stringify({
      version: data.version,
      exportedAt: data.exportedAt,
      bookCount: data.books.length,
      memoCount: data.memos.length,
      coverCount: data.covers.length
    }, null, 2));

    // 도서 데이터
    zip.file('books.json', JSON.stringify(data.books, null, 2));
    
    // 메모 데이터
    zip.file('memos.json', JSON.stringify(data.memos, null, 2));
    
    // 설정 데이터
    zip.file('settings.json', JSON.stringify(data.settings, null, 2));

    // 표지 이미지들 (Base64 -> Blob -> Zip)
    // 메인 스레드 블로킹 방지를 위해 배치 처리
    const coversFolder = zip.folder('covers');
    for (let i = 0; i < data.covers.length; i++) {
      const cover = data.covers[i];
      // Base64 DataURL -> Binary String -> Uint8Array
      const base64 = cover.blob.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
      
      const ext = cover.mimeType.split('/')[1] || 'jpg';
      coversFolder.file(`${cover.bookId}.${ext}`, bytes, { binary: true });
      
      // 진행률 표시 (선택적)
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0)); // 이벤트 루프 양보
    }

    // 3. Zip 파일 생성 및 다운로드
    const content = await zip.generateAsync({ 
      type: 'blob', 
      compression: 'DEFLATE', 
      compressionOptions: { level: 6 } 
    });
    
    const filename = `reading-log-backup-${formatDate(new Date(), 'YYYYMMDD')}.zip`;
    downloadBlob(content, filename);
    
    // 마지막 백업 시간 저장
    await ReadingDB.setSetting('lastBackup', new Date().toISOString());
    _dom.lastBackupText.textContent = `🕐 방금 전 (${formatDate(new Date(), 'YYYY-MM-DD HH:mm')})`;
    
    showToast('백업 파일이 다운로드되었습니다.', 'success');
  } catch (err) {
    console.error('[SettingsView] Export failed:', err);
    showToast(`백업 실패: ${err.message}`, 'error');
  } finally {
    _isExporting = false;
    _dom.btnExport.disabled = false;
    _dom.btnExport.innerHTML = '백업 파일 다운로드';
  }
}

// --- Import (Restore) ---
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // 동일 파일 재선택 가능

  if (!await showConfirm('백업 파일을 복원하시겠습니까?', '현재 데이터는 모두 삭제되고 백업 데이터로 대체됩니다. 이 작업은 되돌릴 수 없습니다.')) return;

  _isImporting = true;
  showToast('백업 파일을 분석 중...', 'info', 0);

  try {
    let data;
    
    if (file.name.endsWith('.zip')) {
      // Zip 파일 파싱
      const zip = await JSZip.loadAsync(file);
      
      // 필수 파일 확인
      const booksFile = zip.file('books.json');
      const memosFile = zip.file('memos.json');
      const settingsFile = zip.file('settings.json');
      // covers 폴더는 선택적
      
      if (!booksFile) throw new Error('유효하지 않은 백업 파일입니다. (books.json 없음)');

      const books = JSON.parse(await booksFile.async('text'));
      const memos = memosFile ? JSON.parse(await memosFile.async('text')) : [];
      const settings = settingsFile ? JSON.parse(await settingsFile.async('text')) : [];
      
      // 표지 이미지 복원 (비동기 병렬 처리)
      const covers = [];
      const coversFolder = zip.folder('covers');
      if (coversFolder) {
        for (const [filename, zipEntry] of Object.entries(coversFolder.files)) {
          if (!zipEntry.dir) {
            const blob = await zipEntry.async('blob');
            const bookId = filename.split('.')[0];
            covers.push({ bookId, blob, mimeType: blob.type, updatedAt: new Date().toISOString() });
          }
        }
      }

      data = { books, memos, settings, covers, version: 1, exportedAt: new Date().toISOString() };
      
    } else if (file.name.endsWith('.json')) {
      // 구버전 JSON 단일 파일 지원
      const text = await file.text();
      data = JSON.parse(text);
      // covers가 Base64 문자열 배열로 들어있음 가정
    } else {
      throw new Error('지원하지 않는 파일 형식입니다. (.zip 또는 .json)');
    }

    // 데이터 검증
    if (!data.books || !Array.isArray(data.books)) throw new Error('데이터 형식이 올바르지 않습니다.');

    showToast('데이터를 복원 중입니다...', 'info', 0);
    
    // 4. DB에 일괄 적용 (ReadingDB.importAll은 JSON 객체 기대)
    // covers가 Blob 배열이면 importAll에서 처리 가능하도록 변환 필요
    // ReadingDB.importAll 구현체 확인: Base64 문자열 기대함.
    // 여기서는 Zip에서 꺼낸 Blob을 Base64로 변환하여 넘김.
    
    const importData = {
      ...data,
      covers: await Promise.all((data.covers || []).map(async c => ({
        ...c,
        blob: await blobToBase64(c.blob)
      })))
    };

    await ReadingDB.importAll(importData);
    
    showToast('데이터 복원이 완료되었습니다. 페이지를 새로고침합니다.', 'success');
    setTimeout(() => window.location.reload(), 1500);
    
  } catch (err) {
    console.error('[SettingsView] Import failed:', err);
    showToast(`복원 실패: ${err.message}`, 'error');
  } finally {
    _isImporting = false;
  }
}

// --- PWA Install ---
function setupPWAInstallListener() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    if (_dom.btnInstallPwa) {
      _dom.btnInstallPwa.style.display = 'inline-flex';
      _dom.pwaInstallDesc.textContent = '설치 버튼을 눌러 홈 화면에 추가하세요.';
    }
  });

  window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    if (_dom.btnInstallPwa) _dom.btnInstallPwa.style.display = 'none';
    _dom.pwaInstallDesc.textContent = '이미 설치되었습니다. 🎉';
    showToast('앱이 설치되었습니다!', 'success');
  });
}

async function handlePWAInstall() {
  if (!_deferredInstallPrompt) {
    showToast('설치 프롬프트를 사용할 수 없습니다. 브라우저 메뉴에서 "홈 화면에 추가"를 선택하세요.', 'info');
    return;
  }
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') showToast('설치를 진행합니다.', 'success');
  _deferredInstallPrompt = null;
  _dom.btnInstallPwa.style.display = 'none';
}

// --- Clear Cache ---
async function handleClearCache() {
  if (!await showConfirm('브라우저 캐시를 삭제하시겠습니까?', 'Service Worker 캐시와 임시 Object URL이 정리됩니다. 데이터는 삭제되지 않습니다.')) return;
  
  try {
    // 1. Service Worker 캐시 삭제
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    // 2. Service Worker 언레지스터 (선택적, 보통 유지)
    // const regs = await navigator.serviceWorker.getRegistrations();
    // await Promise.all(regs.map(r => r.unregister()));
    
    showToast('캐시가 정리되었습니다. 새로고침 시 최신 버전 로드.', 'success');
  } catch (err) {
    showToast('캐시 정리 실패: ' + err.message, 'error');
  }
}

// --- Nuke Data ---
async function handleNukeData() {
  const confirm1 = await showConfirm('정말 모든 데이터를 삭제하시겠습니까?', '도서, 메모, 표지 이미지, 설정 등 IndexedDB의 모든 데이터가 영구 삭제됩니다. 백업을 먼저 권장합니다.');
  if (!confirm1) return;

  const confirm2 = await showConfirm('최종 확인: 복구할 수 없습니다. 계속하시겠습니까?', '데이터베이스가 완전히 비워집니다.');
  if (!confirm2) return;

  try {
    showToast('데이터를 삭제 중...', 'info', 0);
    const db = await ReadingDB.ready(); // DB 인스턴스 가져오기
    
    // 모든 Object Store 클리어
    const storeNames = ['books', 'covers', 'memos', 'settings'];
    const tx = db.transaction(storeNames, 'readwrite');
    await Promise.all(storeNames.map(name => {
      return new Promise((res, rej) => {
        const req = tx.objectStore(name).clear();
        req.onsuccess = res; req.onerror = rej;
      });
    }));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

    showToast('모든 데이터가 삭제되었습니다. 페이지를 새로고침합니다.', 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    showToast('삭제 실패: ' + err.message, 'error');
  }
}

// --- Storage Usage ---
async function updateStorageUsage() {
  try {
    let usageText = '';
    
    // 1. Storage Estimate API
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const used = (estimate.usage / (1024 * 1024)).toFixed(2);
      const quota = (estimate.quota / (1024 * 1024)).toFixed(2);
      usageText += `브라우저 할당량: ${used} MB / ${quota} MB`;
    }

    // 2. IndexedDB 근사 크기 계산 (샘플링)
    // 전체 순회는 무거우므로 books/covers 개수로 추정
    const tx = await ReadingDB.ready().then(db => db.transaction(['books', 'covers'], 'readonly'));
    const bookCount = await new Promise(r => { const req = tx.objectStore('books').count(); req.onsuccess = () => r(req.result); });
    const coverCount = await new Promise(r => { const req = tx.objectStore('covers').count(); req.onsuccess = () => r(req.result); });
    
    usageText += ` | 도서: ${bookCount}권, 표지: ${coverCount}개`;
    
    _dom.storageUsageText.textContent = usageText;
  } catch (err) {
    _dom.storageUsageText.textContent = '용량 정보를 가져올 수 없습니다.';
  }
}

// -------------------------------------------------------------------------
// 5. Helpers
// -------------------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// -------------------------------------------------------------------------
// 6. Public Init
// -------------------------------------------------------------------------

export async function init({ state, navigate, db, showToast, showConfirm }) {
  console.log('[SettingsView] Initializing...');
  
  // 설정값 로드
  const [theme, lastBackup] = await Promise.all([
    ReadingDB.getSetting('theme') || '',
    ReadingDB.getSetting('lastBackup')
  ]);

  renderLayout({ theme, lastBackup, storageUsage: null });
  await updateStorageUsage();

  return () => {
    console.log('[SettingsView] Cleaning up...');
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
  };
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__SETTINGS_VIEW__ = { init };
}