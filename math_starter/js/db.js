// ==========================================
// js/db.js - IndexedDB Wrapper (Final Fixed)
// Fixes: #6 History Index/Sort, #11 Transaction Safety, #20 Nuke Order
// Schema Version: 2 (Added by_id_desc index)
// ==========================================

const DB_NAME = 'KidsMathDB';
const DB_VERSION = 2; // 👈 v1 -> v2: History 스토어에 'by_id_desc' 인덱스 추가

// ------------------------------------------------------------------
// 1. 스키마 정의 (중앙 집중 관리)
// ------------------------------------------------------------------
const STORES = {
  /** 앱 설정 (싱글톤 레코드, 키: 'config') */
  SETTINGS: {
    name: 'settings',
    keyPath: 'id',
    indexes: []
  },
  /** 풀이 이력 (자동 증가 키, 시간순/ID순 인덱스) */
  HISTORY: {
    name: 'history',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_timestamp', keyPath: 'timestamp', options: { unique: false } },
      { name: 'by_mode_type', keyPath: ['mode', 'type'], options: { unique: false } },
      // 👇 #6 Fix: ID 기준 내림차순 정렬용 인덱스 추가 (동일 타임스탬프 시 순서 보장)
      { name: 'by_id_desc', keyPath: 'id', options: { unique: true } }
    ]
  },
  /** 일별 통계 집계 (키: 'daily_YYYYMMDD') */
  STATS: {
    name: 'stats',
    keyPath: 'date',
    indexes: []
  }
};

// ------------------------------------------------------------------
// 2. DB 오픈/업그레이드 로직 (Singleton Promise)
// ------------------------------------------------------------------
let dbPromise = null;

/**
 * DB 인스턴스 반환 (지연 초기화)
 * @returns {Promise<IDBDatabase>}
 */
function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null; // 재시도 허용
      const msg = `IndexedDB 열기 실패: ${request.error?.message || 'Unknown'}`;
      reject(new Error(msg));
      console.error('[DB] Open Error:', request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      
      // 버전 변경 감지 시 연결 종료 및 캐시 무효화
      db.onversionchange = () => {
        console.warn('[DB] 버전 변경 감지 (타 탭에서 업그레이드), 연결 종료.');
        db.close();
        dbPromise = null;
        // 메인 스레드에 알림 (새로고침 유도 등)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('db:versionchange'));
        }
      };
      
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion;
      console.log(`[DB] 마이그레이션 실행: v${oldVersion} -> v${newVersion}`);

      // --- v1 초기 스키마 생성 ---
      if (oldVersion < 1) {
        createStore(db, STORES.SETTINGS);
        createStore(db, STORES.HISTORY);
        createStore(db, STORES.STATS);
      }
      
      // --- v2 마이그레이션: History 스토어에 by_id_desc 인덱스 추가 ---
      if (oldVersion < 2) {
        console.log('[DB] v2 마이그레이션: History.by_id_desc 인덱스 생성');
        // onupgradeneeded 내에서 트랜잭션 접근은 event.target.transaction 사용
        const transaction = event.target.transaction;
        const store = transaction.objectStore(STORES.HISTORY.name);
        if (!store.indexNames.contains('by_id_desc')) {
          store.createIndex('by_id_desc', 'id', { unique: true });
        }
      }
      
      // 향후 버전 업 시 여기에 else if (oldVersion < 3) ... 추가
    };
  });

  return dbPromise;
}

/** ObjectStore 및 인덱스 생성 헬퍼 (v1 초기 생성용) */
function createStore(db, storeDef) {
  if (!db.objectStoreNames.contains(storeDef.name)) {
    const store = db.createObjectStore(storeDef.name, { 
      keyPath: storeDef.keyPath, 
      autoIncrement: storeDef.autoIncrement || false 
    });
    (storeDef.indexes || []).forEach(idx => {
      store.createIndex(idx.name, idx.keyPath, idx.options || {});
    });
    console.log(`[DB] Store 생성됨: ${storeDef.name}`);
  }
}

// ------------------------------------------------------------------
// 3. 트랜잭션 실행 헬퍼 (🛡 #11 Fix: Transaction Inactive 방지)
// ------------------------------------------------------------------
/**
 * 트랜잭션 실행 래퍼.
 * 콜백은 **동기적**으로 IDBRequest만 생성해야 함 (await 금지).
 * 요청들을 수집하여 Promise.all + transaction 완료 대기.
 * @template T
 * @param {string[]} storeNames 
 * @param {'readonly' | 'readwrite'} mode 
 * @param {(stores: Map<string, IDBObjectStore>) => IDBRequest | IDBRequest[] | void} callback 
 * @returns {Promise<T>}
 */
function runTransaction(storeNames, mode, callback) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      const stores = new Map();
      storeNames.forEach(name => stores.set(name, transaction.objectStore(name)));

      let result;
      try {
        // 콜백 실행 (동기적으로 요청만 날림)
        const requests = callback(stores);
        // 단일 요청 또는 배열 수집
        const reqList = Array.isArray(requests) ? requests : (requests ? [requests] : []);
        
        // 모든 요청의 완료 프로미스화
        const requestPromises = reqList.map(req => new Promise((res, rej) => {
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        }));

        // 트랜잭션 전체 완료 대기
        transaction.oncomplete = () => {
          // 요청이 여러 개면 배열, 하나면 단일 값, 없으면 undefined 반환
          if (reqList.length === 1) resolve(requestPromises[0]);
          else if (reqList.length > 1) resolve(Promise.all(requestPromises));
          else resolve(result); // 요청 없으면 callback 리턴값(보통 undefined)
        };
        transaction.onerror = () => reject(new Error(`트랜잭션 실패: ${transaction.error?.message}`));
        transaction.onabort = () => reject(new Error('트랜잭션 중단됨'));

      } catch (err) {
        // 동기적 에러 캐치
        reject(err);
      }
    });
  });
}

// ------------------------------------------------------------------
// 4. 공개 API (Repository Pattern)
// ------------------------------------------------------------------

/** -------------------- Settings -------------------- */
export const SettingsDB = {
  /** 설정 조회 (없으면 기본값 반환) */
  async get() {
    return runTransaction([STORES.SETTINGS.name], 'readonly', (stores) => {
      return stores.get(STORES.SETTINGS.name).get('config');
    }).then(result => result || getDefaultSettings());
  },

  /** 설정 저장 (전체 교체/Upsert) */
  async put(settings) {
    const data = { ...getDefaultSettings(), ...settings, id: 'config', updatedAt: Date.now() };
    return runTransaction([STORES.SETTINGS.name], 'readwrite', (stores) => {
      return stores.get(STORES.SETTINGS.name).put(data);
    }).then(() => data);
  },

  /** 부분 업데이트 (main.js 설정 패널에서 사용) */
  async update(partial) {
    const current = await this.get();
    return this.put({ ...current, ...partial });
  }
};

/** 기본 설정 값 */
function getDefaultSettings() {
  return {
    id: 'config',
    soundOn: true,
    vibrationOn: true,
    difficulty: 1,
    maxNumber: 20,
    questionCount: 10,
    timeLimitPerQuestion: 0,
    questionType: 'mixed', // 👈 #23 Low Fix: main.js에서 참조하는 속성 추가
    theme: '',         // 'light' | 'dark' | '' (시스템 따름)
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/** -------------------- History -------------------- */
export const HistoryDB = {
  /** 기록 추가 */
  async add(record) {
    const data = {
      ...record,
      timestamp: record.timestamp || Date.now(),
    };
    return runTransaction([STORES.HISTORY.name], 'readwrite', (stores) => {
      return stores.get(STORES.HISTORY.name).add(data);
    }).then(id => ({ ...data, id })); // 👈 #1/3 Fix: main.js에서 id 사용 위해 반환
  },

  /** 최신 기록 N개 조회 (ID 내림차순 = 생성순 내림차순 보장) */
  async getRecent(limit = 20) {
    return runTransaction([STORES.HISTORY.name], 'readonly', (stores) => {
      const store = stores.get(STORES.HISTORY.name);
      // 👇 #6 Fix: 'by_id_desc' 인덱스 사용 (타임스탬프 동일 시 순서 보장)
      const index = store.index('by_id_desc'); 
      const req = index.openCursor(null, 'prev'); // 최신 ID부터
      
      const results = [];
      return new Promise((res, rej) => {
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            res(results);
          }
        };
        req.onerror = () => rej(req.error);
      });
    });
  },

  /** 기간별 조회 (타임스탬프 기준) */
  async getByRange(startTs, endTs) {
    return runTransaction([STORES.HISTORY.name], 'readonly', (stores) => {
      const store = stores.get(STORES.HISTORY.name);
      const index = store.index('by_timestamp');
      const range = IDBKeyRange.bound(startTs, endTs);
      const req = index.openCursor(range, 'prev');
      
      const results = [];
      return new Promise((res, rej) => {
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            res(results);
          }
        };
        req.onerror = () => rej(req.error);
      });
    });
  },

  /** 전체 개수 카운트 */
  async count() {
    return runTransaction([STORES.HISTORY.name], 'readonly', (stores) => {
      return stores.get(STORES.HISTORY.name).count();
    });
  },

  /** 오래된 기록 정리 (용량 관리용) */
  async clearOld(beforeTimestamp) {
    return runTransaction([STORES.HISTORY.name], 'readwrite', (stores) => {
      const store = stores.get(STORES.HISTORY.name);
      const index = store.index('by_timestamp');
      const range = IDBKeyRange.upperBound(beforeTimestamp, true);
      const req = index.openCursor(range);
      
      return new Promise((res, rej) => {
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            res({ deleted: true });
          }
        };
        req.onerror = () => rej(req.error);
      });
    });
  }
};

/** -------------------- Stats (Daily Aggregation) -------------------- */
export const StatsDB = {
  /** 오늘 날짜 키 생성 'YYYYMMDD' */
  _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  },

  /** 일일 통계 증가/업데이트 (원자적 읽기-수정-쓰기) */
  async incrementDaily(updates) {
    const dateKey = this._todayKey();
    return runTransaction([STORES.STATS.name], 'readwrite', (stores) => {
      const store = stores.get(STORES.STATS.name);
      
      // 1. 기존 데이터 읽기 (동기 요청)
      const getReq = store.get(dateKey);
      
      // 2. 콜백에서는 요청만 날리고, 후처리는 then에서? 
      // runTransaction 구조상 콜백은 동기여야 하므로, 
      // 여기서는 get -> put을 한 트랜잭션 안에서 처리하려면 커서 또는 두 번 요청 필요.
      // 하지만 runTransaction은 단일 콜백만 받음. 
      // 해결: get 요청을 날리고, onsuccess에서 put 요청을 날리는 방식은 트랜잭션이 닫힐 수 있음.
      // 안전한 패턴: getAll 후 put? 아니면 별도 트랜잭션? 
      // IndexedDB는 같은 트랜잭션 내에서 get 성공 후 put 가능 (마이크로태스크 큐 이전).
      // 하지만 runTransaction 래퍼가 requestPromises를 기다리므로 안전함.
      
      return new Promise((resolve, reject) => {
        getReq.onsuccess = () => {
          const existing = getReq.result || { 
            date: dateKey, 
            practiceCount: 0, 
            testCount: 0, 
            totalCorrect: 0, 
            totalQuestions: 0,
            totalTimeSec: 0,
            bestStreak: 0,
            currentStreak: 0
          };
          const merged = { ...existing, ...updates, date: dateKey };
          const putReq = store.put(merged);
          putReq.onsuccess = () => resolve(merged);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
  },

  /** 특정 날짜 통계 조회 */
  async getDaily(dateKey) {
    return runTransaction([STORES.STATS.name], 'readonly', (stores) => {
      return stores.get(STORES.STATS.name).get(dateKey || this._todayKey());
    });
  },

  /** 최근 N일 통계 조회 (차트용) */
  async getRecentDays(days = 30) {
    return runTransaction([STORES.STATS.name], 'readonly', (stores) => {
      const req = stores.get(STORES.STATS.name).getAll();
      return new Promise((res, rej) => {
        req.onsuccess = () => {
          const sorted = req.result.sort((a, b) => b.date.localeCompare(a.date));
          res(sorted.slice(0, days));
        };
        req.onerror = () => rej(req.error);
      });
    });
  }
};

/** -------------------- Utility -------------------- */
export const DBUtil = {
  /** DB 완전 삭제 (설정 초기화 시 사용) - 🛡 #20 Fix: dbPromise 선제 무효화 */
  async nuke() {
    // 1. 현재 커넥션 즉시 닫기 및 캐시 무효화 (최우선)
    if (dbPromise) {
      try {
        const db = await dbPromise;
        db.close();
      } catch (e) { /* 무시 */ }
    }
    dbPromise = null; // 👈 새 연결 차단

    // 2. 데이터베이스 삭제 요청
    return new Promise((res, rej) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => { 
        console.log('[DB] 데이터베이스 삭제됨'); 
        res(); 
      };
      req.onerror = () => rej(req.error);
      req.onblocked = () => console.warn('[DB] 삭제 차단됨 (다른 탭 열려있음)');
    });
  },

  /** 스토리지 사용량 확인 */
  async getUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
        percent: estimate.quota ? (estimate.usage / estimate.quota * 100).toFixed(2) : 0
      };
    }
    return { usage: 0, quota: 0, percent: 0 };
  }
};

// ------------------------------------------------------------------
// 5. 초기화 편의 함수 (앱 시작 시 호출)
// ------------------------------------------------------------------
export async function initDB() {
  try {
    await getDB(); 
    console.log('[DB] 초기화 완료');
    return true;
  } catch (e) {
    console.error('[DB] 초기화 실패:', e);
    // 🛠 수정: alert 제거, 에러만 던짐 (main.js에서 UI 처리)
    throw new Error('데이터 저장소(IndexedDB)에 접근할 수 없습니다.\n시크릿/개인정보 보호 모드를 해제하거나 브라우저 설정을 확인해주세요.');
  }
}

// 개발자 도구 콘솔에서 디버깅용 전역 노출 (비프로덕션)
if (typeof window !== 'undefined' && !window.__KIDS_MATH_DB__) {
  window.__KIDS_MATH_DB__ = { SettingsDB, HistoryDB, StatsDB, DBUtil, getDB, STORES, DB_VERSION };
}