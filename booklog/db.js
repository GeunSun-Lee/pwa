// ==========================================================================
// db.js - IndexedDB Wrapper (ReadingDB)
// ==========================================================================

/**
 * @typedef {Object} BookEntity
 * @property {string} id - UUID v4
 * @property {string} title
 * @property {string} author
 * @property {string} publisher
 * @property {string} publishDate - YYYY-MM-DD
 * @property {string} isbn - Unique
 * @property {number} totalPages
 * @property {string[]} tags
 * @property {'reading'|'completed'|'paused'|'wish'} status
 * @property {number} rating - 0.0 ~ 5.0
 * @property {string} review - Markdown
 * @property {string} startedAt - ISO String
 * @property {string|null} completedAt
 * @property {number} currentPage
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [externalCoverUrl] - 외부 API 표지 URL (선택)
 */

/**
 * @typedef {Object} CoverEntity
 * @property {string} bookId - FK to books.id
 * @property {Blob} blob - 이미지 바이너리
 * @property {string} mimeType
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} MemoEntity
 * @property {number} id - Auto increment
 * @property {string} bookId
 * @property {number} page
 * @property {string} text
 * @property {string} createdAt
 */

/**
 * @typedef {Object} SettingsEntity
 * @property {string} key
 * @property {*} value
 */

const DB_NAME = 'ReadingLogDB';
const DB_VERSION = 1; // 스키마 변경 시 증가 (마이그레이션 로직 필요)

let _dbInstance = null; // 싱글톤 캐시
let _initPromise = null; // 초기화 중복 방지

/**
 * IDBRequest를 Promise로 래핑
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IDBTransaction 완료 대기
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function waitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * 데이터베이스 연결 및 스키마 초기화
 * @returns {Promise<IDBDatabase>}
 */
async function connect() {
  if (_dbInstance) return _dbInstance;
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // --- Version 1: 초기 스키마 생성 ---
      if (oldVersion < 1) {
        // 1. books 스토어
        if (!db.objectStoreNames.contains('books')) {
          const bookStore = db.createObjectStore('books', { keyPath: 'id' });
          bookStore.createIndex('by_status', 'status', { unique: false });
          bookStore.createIndex('by_title', 'title', { unique: false });
          bookStore.createIndex('by_author', 'author', { unique: false });
          bookStore.createIndex('by_completedAt', 'completedAt', { unique: false });
          bookStore.createIndex('by_createdAt', 'createdAt', { unique: false });
          bookStore.createIndex('by_isbn', 'isbn', { unique: true });
          // multiEntry: true -> tags 배열의 각 요소를 별도 인덱스 엔트리로 생성 (태그 검색 핵심)
          bookStore.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
        }

        // 2. covers 스토어 (Blob 저장용)
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'bookId' });
        }

        // 3. memos 스토어 (독서 메모/인용구)
        if (!db.objectStoreNames.contains('memos')) {
          const memoStore = db.createObjectStore('memos', { keyPath: 'id', autoIncrement: true });
          memoStore.createIndex('by_bookId', 'bookId', { unique: false });
          memoStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // 4. settings 스토어 (키-값)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      }

      // --- 향후 버전 업그레이드 시 이곳에 마이그레이션 로직 추가 ---
      // if (oldVersion < 2) { ... }
    };

    request.onsuccess = (event) => {
      _dbInstance = event.target.result;
      // DB 닫힘/에러 시 캐시 무효화
      _dbInstance.onclose = () => { _dbInstance = null; _initPromise = null; };
      _dbInstance.onerror = () => { _dbInstance = null; _initPromise = null; };
      resolve(_dbInstance);
    };
    request.onerror = (event) => {
      _initPromise = null;
      reject(event.target.error);
    };
  });

  return _initPromise;
}

/**
 * 트랜잭션 생성 헬퍼
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @returns {Promise<IDBTransaction>}
 */
async function getTransaction(storeNames, mode = 'readonly') {
  const db = await connect();
  return db.transaction(storeNames, mode);
}

/**
 * 스토어 접근 헬퍼
 * @param {IDBTransaction} tx
 * @param {string} storeName
 * @returns {IDBObjectStore}
 */
function getStore(tx, storeName) {
  return tx.objectStore(storeName);
}

// ==========================================================================
// Public API: ReadingDB
// ==========================================================================

export const ReadingDB = {
  /**
   * DB 초기화 강제 호출 (앱 시작 시 한 번 호출 권장)
   */
  async ready() {
    await connect();
  },

  // -------------------------------------------------------------------------
  // Books CRUD
  // -------------------------------------------------------------------------

  /**
   * 단일 책 조회
   * @param {string} id
   * @returns {Promise<BookEntity|undefined>}
   */
  async getBook(id) {
    const tx = await getTransaction('books');
    return promisifyRequest(getStore(tx, 'books').get(id));
  },

  /**
   * 책 저장 (생성/수정)
   * @param {BookEntity} book
   * @returns {Promise<string>} 저장된 키 (id)
   */
  async putBook(book) {
    const tx = await getTransaction('books', 'readwrite');
    const key = await promisifyRequest(getStore(tx, 'books').put(book));
    await waitTx(tx);
    return key;
  },

  /**
   * 책 삭제 (연관 표지 이미지도 함께 삭제)
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delBook(id) {
    // books, covers 두 스토어에 대한 원자적 삭제를 위해 단일 트랜잭션 사용
    const tx = await getTransaction(['books', 'covers'], 'readwrite');
    getStore(tx, 'books').delete(id);
    getStore(tx, 'covers').delete(id);
    await waitTx(tx);
  },

  /**
   * 책 목록 조회 (커서 기반 페이지네이션, 인덱스 정렬/필터링 지원)
   * @param {Object} options
   * @param {string} [options.index='by_createdAt'] - 사용할 인덱스명
   * @param {IDBKeyRange} [options.range] - 필터 범위 (IDBKeyRange.only/bound 등)
   * @param {'next'|'prev'|'nextunique'|'prevunique'} [options.direction='prev'] - 정렬 방향 (prev=내림차순)
   * @param {number} [options.limit=20] - 가져올 개수
   * @param {number} [options.offset=0] - 건너뛸 개수
   * @returns {Promise<BookEntity[]>}
   */
  async queryBooks({ index = 'by_createdAt', range = null, direction = 'prev', limit = 20, offset = 0 } = {}) {
    const tx = await getTransaction('books');
    const store = getStore(tx, 'books');
    const source = index ? store.index(index) : store;
    
    const request = source.openCursor(range, direction);
    const results = [];
    let skipped = 0;

    return new Promise((resolve, reject) => {
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
    });
  },

  /**
   * 책 개수 세기 (페이지네이션 총 개수용)
   * @param {Object} options
   * @param {string} [options.index]
   * @param {IDBKeyRange} [options.range]
   * @returns {Promise<number>}
   */
  async countBooks({ index = null, range = null } = {}) {
    const tx = await getTransaction('books');
    const source = index ? getStore(tx, 'books').index(index) : getStore(tx, 'books');
    return promisifyRequest(source.count(range));
  },

  /**
   * ISBN으로 책 조회 (중복 체크용)
   * @param {string} isbn
   * @returns {Promise<BookEntity|undefined>}
   */
  async getBookByIsbn(isbn) {
    const tx = await getTransaction('books');
    return promisifyRequest(getStore(tx, 'books').index('by_isbn').get(isbn));
  },

  // -------------------------------------------------------------------------
  // Covers (Blob Storage)
  // -------------------------------------------------------------------------

  /**
   * 표지 이미지 저장/업데이트
   * @param {string} bookId
   * @param {Blob} blob
   * @returns {Promise<void>}
   */
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

  /**
   * 표지 Blob 조회
   * @param {string} bookId
   * @returns {Promise<Blob|null>}
   */
  async getCoverBlob(bookId) {
    const tx = await getTransaction('covers');
    const record = await promisifyRequest(getStore(tx, 'covers').get(bookId));
    return record?.blob ?? null;
  },

  /**
   * 표지 Object URL 생성 (이미지 태그 src용)
   * 사용 후 `URL.revokeObjectURL()` 필수
   * @param {string} bookId
   * @returns {Promise<string|null>}
   */
  async getCoverUrl(bookId) {
    const blob = await this.getCoverBlob(bookId);
    return blob ? URL.createObjectURL(blob) : null;
  },

  /**
   * 표지 삭제
   * @param {string} bookId
   */
  async deleteCover(bookId) {
    const tx = await getTransaction('covers', 'readwrite');
    getStore(tx, 'covers').delete(bookId);
    await waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Memos (독서 메모/인용구)
  // -------------------------------------------------------------------------

  /**
   * 메모 목록 조회 (책별, 최신순)
   * @param {string} bookId
   * @param {number} [limit=50]
   * @returns {Promise<MemoEntity[]>}
   */
  async getMemosByBook(bookId, limit = 50) {
    const tx = await getTransaction('memos');
    const index = getStore(tx, 'memos').index('by_bookId');
    const range = IDBKeyRange.only(bookId);
    // 최신순(prev) 정렬
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

  /**
   * 메모 추가
   * @param {Omit<MemoEntity, 'id'|'createdAt'>} memo
   * @returns {Promise<number>} 생성된 메모 ID
   */
  async addMemo(memo) {
    const tx = await getTransaction('memos', 'readwrite');
    const id = await promisifyRequest(getStore(tx, 'memos').put({
      ...memo,
      createdAt: new Date().toISOString()
    }));
    await waitTx(tx);
    return id;
  },

  /**
   * 메모 삭제
   * @param {number} id
   */
  async deleteMemo(id) {
    const tx = await getTransaction('memos', 'readwrite');
    getStore(tx, 'memos').delete(id);
    await waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Settings (키-값 저장소)
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
  // Backup / Restore (전체 데이터 직렬화)
  // -------------------------------------------------------------------------

  /**
   * 전체 데이터 내보내기 (JSON 직렬화 가능 형태로 변환)
   * Blob -> Base64 DataURL 변환 포함
   * @returns {Promise<Object>}
   */
  async exportAll() {
    await connect(); // DB 연결 보장
    
    // 병렬로 모든 스토어 데이터 가져오기
    const [books, covers, memos, settings] = await Promise.all([
      this._getAll('books'),
      this._getAll('covers'),
      this._getAll('memos'),
      this._getAll('settings')
    ]);

    // Blob을 Base64 문자열로 변환 (JSON 직렬화 위해)
    const coversBase64 = await Promise.all(covers.map(async (cover) => ({
      ...cover,
      blob: await this._blobToBase64(cover.blob)
    })));

    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      books,
      covers: coversBase64,
      memos,
      settings
    };
  },

  /**
   * 전체 데이터 가져오기 (덮어쓰기)
   * @param {Object} data - exportAll() 반환 형식과 동일
   * @returns {Promise<void>}
   */
  async importAll(data) {
    if (!data || !Array.isArray(data.books)) {
      throw new Error('유효하지 않은 백업 데이터 형식입니다.');
    }

    const db = await connect();
    // 단일 트랜잭션으로 원자성 보장 (모든 스토어 포함)
    const tx = db.transaction(['books', 'covers', 'memos', 'settings'], 'readwrite');
    
    // 1. 기존 데이터 전체 삭제
    await Promise.all([
      this._clearStore(tx, 'books'),
      this._clearStore(tx, 'covers'),
      this._clearStore(tx, 'memos'),
      this._clearStore(tx, 'settings')
    ]);

    // 2. 신규 데이터 삽입
    // books
    if (data.books?.length) {
      const bookStore = getStore(tx, 'books');
      for (const book of data.books) bookStore.put(book);
    }
    // covers (Base64 -> Blob 변환)
    if (data.covers?.length) {
      const coverStore = getStore(tx, 'covers');
      for (const cover of data.covers) {
        const blob = await this._base64ToBlob(cover.blob, cover.mimeType);
        coverStore.put({ ...cover, blob });
      }
    }
    // memos
    if (data.memos?.length) {
      const memoStore = getStore(tx, 'memos');
      for (const memo of data.memos) memoStore.put(memo);
    }
    // settings
    if (data.settings?.length) {
      const settingStore = getStore(tx, 'settings');
      for (const setting of data.settings) settingStore.put(setting);
    }

    return waitTx(tx);
  },

  // -------------------------------------------------------------------------
  // Private Helpers (Internal)
  // -------------------------------------------------------------------------

  /**
   * 스토어 전체 레코드 가져오기 (내부용)
   */
  _getAll(storeName) {
    return connect().then(db => 
      promisifyRequest(db.transaction(storeName).objectStore(storeName).getAll())
    );
  },

  /**
   * 스토어 전체 삭제 (내부용)
   */
  _clearStore(tx, storeName) {
    return promisifyRequest(getStore(tx, storeName).clear());
  },

  /**
   * Blob -> Base64 DataURL
   */
  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Base64 DataURL -> Blob
   */
  _base64ToBlob(base64, mimeType) {
    // "data:image/jpeg;base64,/9j/4AAQ..." 형식 파싱
    const byteString = atob(base64.split(',')[1] || base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeType });
  }
};

// 개발 편의를 위해 window에도 노출 (콘솔 디버깅용)
if (typeof window !== 'undefined') {
  window.ReadingDB = ReadingDB;
}