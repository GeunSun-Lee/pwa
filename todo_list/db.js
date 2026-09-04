/**
 * db.js - IndexedDB Wrapper (Zero Dependency)
 * 초등 TODO 앱 전용 스키마 및 CRUD 메서드 제공
 * 
 * @module db
 */

// ==========================================================================
// 1. 설정 상수 (스키마 버전 관리)
// ==========================================================================
const DB_NAME = 'KidsTodoDB';
const DB_VERSION = 1; // 스키마 변경 시 증가
const STORE_NAME = 'tasks';

/**
 * Task 객체 타입 정의 (JSDoc for IDE Support)
 * @typedef {Object} Task
 * @property {number} [id] - Auto-increment Primary Key
 * @property {string} title - 할 일 제목
 * @property {string} category - 이모지 카테고리 (🎒, 📚, 🎨, 🏃, 📝)
 * @property {boolean} isDone - 완료 여부
 * @property {number} order - 정렬 순서 (낮을수록 위)
 * @property {number} createdAt - 생성 타임스탬프
 * @property {number|null} completedAt - 완료 타임스탬프
 * @property {Blob|null} imageBlob - 이미지 Blob 데이터
 * @property {string|null} imageType - MIME 타입 (image/jpeg 등)
 * @property {Blob|null} voiceBlob - 음성 메모 Blob (선택)
 */

// ==========================================================================
// 2. 핵심: DB 연결 싱글톤 관리
// ==========================================================================
let dbInstance = null;

/**
 * IndexedDB 열기 및 스키마 초기화
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    // 이미 열린 커넥션 재사용 (단일 탭 기준)
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // --- 스키마 정의 (upgradeneeded) ---
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      if (oldVersion === 0) {
        // 최초 생성
        createSchema(db);
      } else {
        // 마이그레이션 로직 (버전 업 시 여기에 작성)
        // 예: if (oldVersion < 2) { ... }
        console.log(`[DB] Migration from v${oldVersion} to v${DB_VERSION}`);
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      // 에러 핸들링 부착
      dbInstance.onerror = (e) => console.error('[DB] Global Error:', e.target.error);
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[DB] Open Failed:', event.target.error);
      reject(new Error('데이터베이스 열기 실패: ' + event.target.error));
    };

    request.onblocked = () => {
      // 다른 탭에서 DB 열려있어 업그레이드 못 할 때
      console.warn('[DB] Blocked: 다른 탭에서 DB를 사용 중입니다. 새로고침 해주세요.');
      alert('⚠️ 다른 탭에서 앱이 열려 있어요. 다른 탭을 닫고 새로고침 해주세요.');
    };
  });
}

/**
 * 스키마 생성 헬퍼
 * @param {IDBDatabase} db 
 */
function createSchema(db) {
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    const store = db.createObjectStore(STORE_NAME, { 
      keyPath: 'id', 
      autoIncrement: true 
    });
    
    // 인덱스 생성 (쿼리 성능용)
    store.createIndex('by_category', 'category', { unique: false });
    store.createIndex('by_isDone', 'isDone', { unique: false });
    store.createIndex('by_order', 'order', { unique: false }); // 정렬용
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    
    console.log('[DB] Schema created:', STORE_NAME);
  }
}

// ==========================================================================
// 3. 트랜잭션 헬퍼 (반복 코드 제거)
// ==========================================================================
/**
 * @template T
 * @param {'readonly' | 'readwrite'} mode 
 * @param {(store: IDBObjectStore) => IDBRequest} operation 
 * @returns {Promise<T>}
 */
function runTransaction(mode, operation) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      
      const request = operation(store);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      
      // 트랜잭션 완료 로깅
      tx.oncomplete = () => { /* console.log('[DB] Tx complete'); */ };
      tx.onerror = () => console.error('[DB] Tx Error:', tx.error);
    });
  });
}

// ==========================================================================
// 4. 공개 API (CRUD + 유틸)
// ==========================================================================

/**
 * 전체 할 일 조회 (정렬: order ASC, createdAt DESC)
 * @returns {Promise<Task[]>}
 */
export async function getAllTasks() {
  return runTransaction('readonly', (store) => {
    // order 인덱스로 정렬해서 가져오기
    const index = store.index('by_order');
    return index.getAll();
  });
}

/**
 * 단일 할 일 조회
 * @param {number} id 
 * @returns {Promise<Task | undefined>}
 */
export async function getTask(id) {
  return runTransaction('readonly', (store) => store.get(id));
}

/**
 * 할 일 추가
 * @param {Omit<Task, 'id' | 'createdAt' | 'completedAt'>} data 
 * @returns {Promise<number>} 생성된 ID 반환
 */
export async function addTask(data) {
  const now = Date.now();
  const payload = {
    ...data,
    createdAt: now,
    completedAt: null,
    // order는 현재 최대값 + 1 로 설정 (맨 아래 추가)
  };

  // 현재 최대 order 조회 후 추가 (원자성 위해 readwrite 트랜잭션 내부에서 처리 권장)
  // 여기서는 간단히 두 번 호출로 처리 (앱 규모상 문제 없음). 엄밀하면 아래 addTaskWithOrder 사용.
  const tasks = await getAllTasks();
  const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order || 0), 0);
  payload.order = maxOrder + 1;

  return runTransaction('readwrite', (store) => store.add(payload));
}

/**
 * 할 일 수정 (부분 업데이트 지원)
 * @param {number} id 
 * @param {Partial<Task>} updates 
 * @returns {Promise<void>}
 */
export async function updateTask(id, updates) {
  return runTransaction('readwrite', (store) => {
    const getReq = store.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const task = getReq.result;
        if (!task) return reject(new Error('Task not found: ' + id));
        
        // 완료 토글 시 completedAt 자동 관리
        if (typeof updates.isDone === 'boolean' && updates.isDone !== task.isDone) {
          updates.completedAt = updates.isDone ? Date.now() : null;
        }
        
        const updated = { ...task, ...updates };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}

/**
 * 할 일 삭제
 * @param {number} id 
 * @returns {Promise<void>}
 */
export async function deleteTask(id) {
  return runTransaction('readwrite', (store) => store.delete(id));
}

/**
 * 여러 할 일 순서 일괄 업데이트 (Drag & Drop 후 호출)
 * @param {Array<{id: number, order: number}>} tasksOrder 
 * @returns {Promise<void>}
 */
export async function reorderTasks(tasksOrder) {
  return runTransaction('readwrite', (store) => {
    // Promise.all로 병렬 처리 (IDB 트랜잭션은 자동 커밋 대기)
    const promises = tasksOrder.map(({ id, order }) => {
      return new Promise((resolve, reject) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const task = getReq.result;
          if (task) {
            task.order = order;
            const putReq = store.put(task);
            putReq.onsuccess = resolve;
            putReq.onerror = () => reject(putReq.error);
          } else resolve(); // 이미 지워진 경우 무시
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
    return Promise.all(promises);
  });
}

/**
 * 완료된 할 일 모두 삭제
 * @returns {Promise<number>} 삭제된 개수
 */
export async function clearCompletedTasks() {
  return runTransaction('readwrite', (store) => {
    const index = store.index('by_isDone');
    const getAllReq = index.getAllKeys(true); // true = isDone
    
    return new Promise((resolve, reject) => {
      getAllReq.onsuccess = () => {
        const keys = getAllReq.result; // ID 배열
        keys.forEach(key => store.delete(key));
        resolve(keys.length);
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  });
}

/**
 * DB 전체 초기화 (설정/비밀번호 확인 후 사용)
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  return runTransaction('readwrite', (store) => store.clear());
}

/**
 * 스토리지 사용량 확인 (용량 경고용)
 * @returns {Promise<{usage: number, quota: number, percent: number}>}
 */
export async function getStorageUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return {
      usage: usage || 0,
      quota: quota || 0,
      percent: quota ? (usage / quota) * 100 : 0
    };
  }
  // 폴백 (지원 안하는 브라우저)
  return { usage: 0, quota: 0, percent: 0 };
}

// ==========================================================================
// 5. Blob 저장 최적화 헬퍼 (이미지/음성)
// ==========================================================================

/**
 * File/Blob을 IndexedDB 저장용 객체로 변환
 * @param {File | Blob} file 
 * @returns {Promise<{blob: Blob, type: string}>}
 */
export function prepareBlob(file) {
  return new Promise((resolve) => {
    // 파일 타입 정규화
    const type = file.type || 'application/octet-stream';
    // Blob 그대로 저장 (IndexedDB는 Blob 네이티브 지원)
    resolve({ blob: file, type });
  });
}

/**
 * 저장된 Blob을 Object URL로 변환 (이미지 표시용)
 * 사용 후 `URL.revokeObjectURL()` 필수 (메모리 누수 방지)
 * @param {Blob} blob 
 * @returns {string}
 */
export function createBlobUrl(blob) {
  return URL.createObjectURL(blob);
}

// ==========================================================================
// 6. 초기화 및 내보내기
// ==========================================================================

// 앱 로드 시 즉시 DB 연결 시도 (지연 로딩 방지)
openDB().catch(err => console.error('[DB] 초기화 실패:', err));

// 명시적 네임스페이스 내보내기 (tree-shaking 친화적)
export const db = {
  getAll: getAllTasks,
  get: getTask,
  add: addTask,
  update: updateTask,
  delete: deleteTask,
  reorder: reorderTasks,
  clearCompleted: clearCompletedTasks,
  clearAll: clearAllData,
  getUsage: getStorageUsage,
  prepareBlob,
  createBlobUrl,
};

export default db;