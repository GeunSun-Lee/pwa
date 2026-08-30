// ==========================================================================
// db.js - IndexedDB Wrapper (ReadingLogDB) - Final Production Version
// ==========================================================================

// -------------------------------------------------------------------------
// 1. Constants & Schema Definition
// -------------------------------------------------------------------------
const DB_NAME = 'ReadingLogDB';
const DB_VERSION = 1; // 스키마 변경 시 증가 (마이그레이션 로직 필요 시 버전 업)

let _dbInstance = null;
let _initPromise = null;

// -------------------------------------------------------------------------
// 2. Low-level Helpers
// -------------------------------------------------------------------------

/** IDBRequest를 Promise로 래핑 */
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 트랜잭션 완료 대기 */
function waitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 트랜잭션 생성 헬퍼 */
async function getTransaction(storeNames, mode = 'readonly') {
  const db = await connect();
  return db.transaction(storeNames, mode);
}

function getStore(tx, storeName) {
  return tx.objectStore(storeName);
}

// -------------------------------------------------------------------------
// 3. Database Connection with Timeout & Error Handling
// -------------------------------------------------------------------------

/**
 * DB 연결 및 스키마 초기화 (5초 타임아웃, 블로킹 처리, 차단 감지)
 * @returns {Promise<IDBDatabase>}
 */
async function connect() {
  if (_dbInstance) return _dbInstance;
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    let finished = false;
    
    // 5초 타임아웃 (브라우저 차단/무한대기 방지)
    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('IndexedDB 연결 시간 초과 (5초). 브라우저 설정(시크릿 모드, 쿠키 차단, 사파리 추적방지 등)으로 차단되었을 수 있습니다.'));
      }
    }, 5000);

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // 스키마 업그레이드
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        if (oldVersion < 1) {
          // 1. books 스토어
          if (!db.objectStoreNames.contains('books')) {
            const store = db.createObjectStore('books', { keyPath: 'id' });
            store.createIndex('by_status', 'status', { unique: false });
            store.createIndex('by_title', 'title', { unique: false });
            store.createIndex('by_author', 'author', { unique: false });
            store.createIndex('by_completedAt', 'completedAt', { unique: false });
            store.createIndex('by_createdAt', 'createdAt', { unique: false });
            store.createIndex('by_isbn', 'isbn', { unique: true });
            store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
          }
          // 2. covers 스토어 (Blob 저장)
          if (!db.objectStoreNames.contains('covers')) {
            db.createObjectStore('covers', { keyPath: 'bookId' });
          }
          // 3. memos 스토어
          if (!db.objectStoreNames.contains('memos')) {
            const store = db.createObjectStore('memos', { keyPath: 'id', autoIncrement: true });
            store.createIndex('by_bookId', 'bookId', { unique: false });
            store.createIndex('by_createdAt', 'createdAt', { unique: false });
          }
          // 4. settings 스토어
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        }
        // 향후 버전 업그레이드 시 여기서 마이그레이션 로직 추가
      };

      request.onsuccess = (event) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        
        _dbInstance = event.target.result;
        
        // 연결 끊김/런타임 에러 핸들러
        _dbInstance.onclose = () => { 
          _dbInstance = null; 
          _initPromise = null; 
          console.warn('[DB] Connection closed unexpectedly'); 
        };
        _dbInstance.onerror = (e) => { 
          console.error('[DB] Runtime error:', e.target.error); 
        };
        
        console.log('[DB] Connected successfully');
        resolve(_dbInstance);
      };

      request.onerror = (event) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        
        const err = event.target.error;
        console.error('[DB] Open error:', err);
        
        let msg = `IndexedDB 열기 실패: ${err?.message || 'UnknownError'}`;
        if (err?.name === 'SecurityError' || err?.name === 'AbortError' || err?.name === 'NotAllowedError' || err?.name === 'InvalidStateError') {
          msg += ' (브라우저 보안 정책/시크릿 모드/쿠키 차단으로 접근 거부됨)';
        }
        reject(new Error(msg));
      };

      // 다른 탭에서 DB가 열려 있어 업그레이드가 블로킹되는 경우
      request.onblocked = () => {
        console.warn('[DB] Blocked: Close other tabs with this app open to allow update.');
      };

    } catch (err) {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      reject(err);
    }
  });

  return _initPromise;
}

// -------------------------------------------------------------------------
// 4. Public API: ReadingDB
// -------------------------------------------------------------------------

export const ReadingDB = {
  /**
   * DB 초기화 강제 호출 (타임아웃 포함)
   * @returns {Promise<IDBDatabase>}
   */
  async ready() {
    return connect();
  },

  // -------------------------------------------------------------------------
  // Books CRUD
  // -------------------------------------------------------------------------

  async getBook(id) {
    const tx = await getTransaction('books');
    return promisifyRequest(getStore(tx, 'books').get(id));
  },

  async putBook(book) {
    const tx = await getTransaction('books', 'readwrite');
    const key = await promisifyRequest(getStore(tx, 'books').put(book));
    await waitTx(tx);
    return key;
  },

  async delBook(id) {
    const tx = await getTransaction(['books', 'covers'], 'readwrite');
    getStore(tx, 'books').delete(id);
    getStore(tx, 'covers').delete(id);
    await waitTx(tx);
  },

  /**
   * 책 목록 조회 (커서 기반 페이지네이션) - 5초 타임아웃
   */
  async queryBooks({ index = 'by_createdAt', range = null, direction = 'prev', limit = 20, offset = 0 } = {}) {
    const tx = await getTransaction('books');
    const store = getStore(tx, 'books');
    const source = index ? store.index(index) : store;
    
    const request = source.openCursor(range, direction);
    const results = [];
    let skipped = 0;

    // 5초 타임아웃 래퍼
    return Promise.race([
      new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            if (skipped < offset) {
              skipped++;
              cursor.continue();
            } else if (results.length < limit) {
              results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DB_QUERY_TIMEOUT: queryBooks 5초 초과 (IndexedDB 커서 응답 없음)')), 5000)
      )
    ]);
  },

  async countBooks({ index = null, range = null } = {}) {
    const tx = await getTransaction('books');
    const source = index ? getStore(tx, 'books').index(index) : getStore(tx, 'books');
    
    // 5초 타임아웃
    return Promise.race([
      promisifyRequest(source.count(range)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_COUNT_TIMEOUT')), 5000))
    ]);
  },

  async getBookByIsbn(isbn) {
    const tx = await getTransaction('books');
    return promisifyRequest(getStore(tx, 'books').index('by_isbn').get(isbn));
  },

  // -------------------------------------------------------------------------
  // Covers (Blob Storage)
  // -------------------------------------------------------------------------

  async saveCover(bookId, blob) {
    const tx = await getTransaction('covers', 'readwrite');
    await promisifyRequest(getStore(tx, 'covers').put({
      bookId,
      blob,
      mimeType: blob.type,
      updatedAt: new Date().toISOString()
    }));
    await waitTx(tx);
  },

  async getCoverBlob(bookId) {
    const tx = await getTransaction('covers');
    const record = await promisifyRequest(getStore(tx, 'covers').get(bookId));
    return record?.blob ?? null;
  },

  async getCoverUrl(bookId) {
    const blob = await this.getCoverBlob(bookId);
    return blob ? URL.createObjectURL(blob) : null;
  },

  async deleteCover(bookId) {
    const tx = await getTransaction('covers', 'readwrite');
    getStore(tx, 'covers').delete(bookId);
    await waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Memos
  // -------------------------------------------------------------------------

  async getMemosByBook(bookId, limit = 50) {
    const tx = await getTransaction('memos');
    const index = getStore(tx, 'memos').index('by_bookId');
    const range = IDBKeyRange.only(bookId);
    const request = index.openCursor(range, 'prev');
    const results = [];

    return new Promise((resolve, reject) => {
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  async addMemo(memo) {
    const tx = await getTransaction('memos', 'readwrite');
    const id = await promisifyRequest(getStore(tx, 'memos').put({
      ...memo,
      createdAt: new Date().toISOString()
    }));
    await waitTx(tx);
    return id;
  },

  async deleteMemo(id) {
    const tx = await getTransaction('memos', 'readwrite');
    getStore(tx, 'memos').delete(id);
    await waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSetting(key) {
    const tx = await getTransaction('settings');
    const record = await promisifyRequest(getStore(tx, 'settings').get(key));
    return record?.value;
  },

  async setSetting(key, value) {
    const tx = await getTransaction('settings', 'readwrite');
    await promisifyRequest(getStore(tx, 'settings').put({ key, value }));
    await waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Backup / Restore
  // -------------------------------------------------------------------------

  async exportAll() {
    await connect();
    const [books, covers, memos, settings] = await Promise.all([
      promisifyRequest((await getTransaction('books')).objectStore('books').getAll()),
      promisifyRequest((await getTransaction('covers')).objectStore('covers').getAll()),
      promisifyRequest((await getTransaction('memos')).objectStore('memos').getAll()),
      promisifyRequest((await getTransaction('settings')).objectStore('settings').getAll())
    ]);

    // Blob -> Base64 변환
    const coversB64 = await Promise.all(covers.map(async (cover) => ({
      ...cover,
      blob: await this._blobToBase64(cover.blob)
    })));

    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      books,
      covers: coversB64,
      memos,
      settings
    };
  },

  async importAll(data) {
    if (!data || !Array.isArray(data.books)) throw new Error('유효하지 않은 백업 데이터입니다.');

    const db = await connect();
    const tx = db.transaction(['books', 'covers', 'memos', 'settings'], 'readwrite');

    // 기존 데이터 클리어
    await Promise.all([
      promisifyRequest(tx.objectStore('books').clear()),
      promisifyRequest(tx.objectStore('covers').clear()),
      promisifyRequest(tx.objectStore('memos').clear()),
      promisifyRequest(tx.objectStore('settings').clear())
    ]);

    // 신규 데이터 삽입
    if (data.books?.length) data.books.forEach(b => tx.objectStore('books').put(b));
    
    if (data.covers?.length) {
      for (const c of data.covers) {
        const blob = await this._base64ToBlob(c.blob, c.mimeType);
        tx.objectStore('covers').put({ bookId: c.bookId, blob, mimeType: c.mimeType, updatedAt: c.updatedAt });
      }
    }
    if (data.memos?.length) data.memos.forEach(m => tx.objectStore('memos').put(m));
    if (data.settings?.length) data.settings.forEach(s => tx.objectStore('settings').put(s));

    return waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  async _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  async _base64ToBlob(base64, mimeType) {
    const byteString = atob(base64.split(',')[1] || base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeType });
  }
};

// 개발 편의: 전역 노출
if (typeof window !== 'undefined') {
  window.ReadingDB = ReadingDB;
}