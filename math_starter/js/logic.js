// ==========================================
// js/logic.js - 산수 로직 (Final Fixed)
// Fixes: #10 Duplicate Key in Problem Set, #17 Parameter Naming Convention
// Features: Pure Functions, Seedable Random, Error Analysis, Formatters
// ==========================================

// ------------------------------------------------------------------
// 1. 설정 상수 (난이도 스펙 정의) - Readonly for Safety
// ------------------------------------------------------------------
/**
 * @typedef {Object} DifficultySpec
 * @property {number} level - 난이도 레벨 (1~4)
 * @property {string} name - 표시명
 * @property {number} minA - 첫 번째 피연산자 최소값
 * @property {number} maxA - 첫 번째 피연산자 최대값
 * @property {number} minB - 두 번째 피연산자 최소값
 * @property {number} maxB - 두 번째 피연산자 최대값
 * @property {boolean} allowCarry - 덧셈 시 받아올림 허용 여부
 * @property {boolean} allowBorrow - 뺄셈 시 받아내림 허용 여부
 * @property {boolean} allowNegativeResult - 뺄셈 결과 음수 허용 여부 (초등 저학년 false)
 * @property {number} timeLimitSec - 도전 모드 기본 제한 시간 (문제당, 0=무제한)
 */

export const DIFFICULTY_SPECS = Object.freeze([
  null, // 0-index dummy
  { // Level 1: 한 자리 수 ± 한 자리 수 (0~9), 받아올림/내림 없음
    level: 1, name: '1단계: 한 자리 수',
    minA: 0, maxA: 9, minB: 0, maxB: 9,
    allowCarry: false, allowBorrow: false, allowNegativeResult: false,
    timeLimitSec: 10
  },
  { // Level 2: 두 자리 수 ± 한 자리 수 (10~99 ± 0~9), 받아올림/내림 없음
    level: 2, name: '2단계: 두 자리 수 ± 한 자리 (받아올림/내림 없음)',
    minA: 10, maxA: 99, minB: 0, maxB: 9,
    allowCarry: false, allowBorrow: false, allowNegativeResult: false,
    timeLimitSec: 15
  },
  { // Level 3: 두 자리 수 ± 한 자리 수 (10~99 ± 0~9), 받아올림/내림 있음
    level: 3, name: '3단계: 두 자리 수 ± 한 자리 (받아올림/내림 있음)',
    minA: 10, maxA: 99, minB: 0, maxB: 9,
    allowCarry: true, allowBorrow: true, allowNegativeResult: false,
    timeLimitSec: 20
  },
  { // Level 4: 두 자리 수 ± 두 자리 수 (10~99 ± 10~99), 받아올림/내림 있음
    level: 4, name: '4단계: 두 자리 수 ± 두 자리 수',
    minA: 10, maxA: 99, minB: 10, maxB: 99,
    allowCarry: true, allowBorrow: true, allowNegativeResult: false,
    timeLimitSec: 30
  }
]);

// ------------------------------------------------------------------
// 2. 난수 생성 유틸 (Seedable Random - 테스트/리플레이용)
// ------------------------------------------------------------------
let _seed = Date.now(); // 내부 시드

/** 시드 설정 (동일 시드 = 동일 문제 시퀀스 보장) */
export function setRandomSeed(seed) {
  _seed = Math.trunc(seed) >>> 0; // 32bit unsigned 정수 강제
}

/** Linear Congruential Generator (LCG) - Math.random 대체 */
function _nextRandom() {
  // Numerical Recipes constants (glibc)
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0x100000000; // 0 ~ 1
}

/** [min, max] 정수 난수 반환 */
function _randomInt(min, max) {
  return Math.floor(_nextRandom() * (max - min + 1)) + min;
}

/** 배열 셔플 (Fisher-Yates) */
function _shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = _randomInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------------
// 3. 핵심 연산 로직 (Constraint Solving)
// ------------------------------------------------------------------

/**
 * 제약 조건 하에서 유효한 (a, b) 쌍 생성
 * @param {DifficultySpec} spec 
 * @param {'addition' | 'subtraction'} op 
 * @returns {{a: number, b: number, answer: number, meta: {isCarry: boolean}}}
 */
function _generatePair(spec, op) {
  const { minA, maxA, minB, maxB, allowCarry, allowBorrow, allowNegativeResult } = spec;
  
  // 안전장치: 무한 루프 방지 (최대 1000회 시도)
  for (let attempt = 0; attempt < 1000; attempt++) {
    const a = _randomInt(minA, maxA);
    const b = _randomInt(minB, maxB);

    if (op === 'addition') {
      const sum = a + b;
      // 받아올림 체크: 일의 자리 합 >= 10
      const hasCarry = (a % 10) + (b % 10) >= 10;
      if (!allowCarry && hasCarry) continue;
      
      // 최대값 제한 (spec 범위 내 생성되므로 별도 체크 불필요)
      return { a, b, answer: sum, meta: { isCarry: hasCarry } };
      
    } else { // subtraction
      // 음수 결과 방지
      if (!allowNegativeResult && a < b) continue;
      
      const diff = a - b;
      // 받아내림 체크: 일의 자리 a < b
      const hasBorrow = (a % 10) < (b % 10);
      if (!allowBorrow && hasBorrow) continue;
      
      return { a, b, answer: diff, meta: { isBorrow: hasBorrow } };
    }
  }
  
  // 이론상 도달 불가 (스펙 범위 내 해가 항상 존재함)
  console.warn('[Logic] 유효한 조합 생성 실패 후 폴백 반환', spec, op);
  return { 
    a: minA, 
    b: minB, 
    answer: op === 'addition' ? minA + minB : minA - minB, 
    meta: { isCarry: false, isBorrow: false } 
  };
}

/**
 * 단일 문제 객체 생성
 * @typedef {Object} Problem
 * @property {number} a
 * @property {number} b
 * @property {'addition' | 'subtraction'} op
 * @property {number} answer
 * @property {number} difficulty
 * @property {string} text - "12 + 5" 형태
 * @property {Object} meta - { operatorSymbol, isCarry, isBorrow }
 */
export function generateProblem(difficulty, type = 'mixed') {
  const spec = DIFFICULTY_SPECS[difficulty] || DIFFICULTY_SPECS[1];
  
  // 연산 결정
  let op;
  if (type === 'addition') op = 'addition';
  else if (type === 'subtraction') op = 'subtraction';
  else op = _nextRandom() < 0.5 ? 'addition' : 'subtraction'; // mixed: 50:50
  
  const { a, b, answer, meta } = _generatePair(spec, op);
  
  return {
    a,
    b,
    op,
    answer,
    difficulty: spec.level,
    text: `${a} ${op === 'addition' ? '+' : '−'} ${b}`,
    meta: { 
      operatorSymbol: op === 'addition' ? '+' : '−',
      ...meta // isCarry 또는 isBorrow 포함
    }
  };
}

/**
 * 여러 문제 일괄 생성 (시험 모드용, 중복 최소화)
 * @param {number} count
 * @param {number} difficulty
 * @param {'addition' | 'subtraction' | 'mixed'} type
 * @returns {Problem[]}
 */
export function generateProblemSet(count, difficulty, type = 'mixed') {
  const problems = new Set(); // 텍스트 기준 중복 제거
  const result = [];
  
  // 생성 시도 횟수 제한 (count * 3) - 무한 루프 방지
  while (result.length < count && problems.size < count * 3) {
    const p = generateProblem(difficulty, type);
    // 🛡 #10 Fix: 키 구분자(,) 추가로 "12+3" vs "1+23" 충돌 방지
    const key = `${p.a},${p.op},${p.b}`; 
    
    if (!problems.has(key)) {
      problems.add(key);
      result.push(p);
    }
  }
  
  // 극히 드문 케이스: 제약 조건이 빡빡해 중복 허용하여 채움
  while (result.length < count) {
    result.push(generateProblem(difficulty, type));
  }
  
  return _shuffleArray(result); // 순서 섞기
}

// ------------------------------------------------------------------
// 4. 채점 및 피드백 로직
// ------------------------------------------------------------------

/**
 * @typedef {Object} CheckResult
 * @property {boolean} correct
 * @property {number}Answer - 사용자 입력값
 * @property {number} correctAnswer - 정답
 * @property {number} diff - 차이 (오답 분석용)
 * @property {string|null} errorType - 오답 유형 분류
 */

export function checkAnswer(problem,Answer) { // 🛡 #17 Fix: Answer ->Answer (camelCase)
  const correct = problem.answer ===Answer;
  return {
    correct,
   Answer, // 🛡 #17 Fix
    correctAnswer: problem.answer,
    diff:Answer - problem.answer,
    errorType: correct ? null : _analyzeError(problem,Answer)
  };
}

/** 오답 패턴 분석 (교육적 피드백용) */
function _analyzeError(problem,Answer) { // 파라미터명 Answer 통일
  const { a, b, op, answer } = problem;
  const diff =Answer - answer;
  
  // 1. 부호 실수 (덧셈→뺄셈, 뺄셈→덧셈)
  const reverseOpAnswer = op === 'addition' ? a - b : a + b;
  if (Answer === reverseOpAnswer) return 'SIGN_ERROR';
  
  // 2. 10의 자리/1의 자리 혼동 (예: 23+5=28 -> 78 답함)
  if (op === 'addition') {
    const correctOnes = (a + b) % 10;
    const Ones =Answer % 10; 
    const correctTens = Math.floor((a + b) / 10);
    const Tens = Math.floor(Answer / 10); 
    
    if (correctOnes ===Ones && correctTens !==Tens) return 'TENS_PLACE_ERROR';
    if (correctTens ===Tens && correctOnes !==Ones) return 'ONES_PLACE_ERROR';
  }
  
  // 3. 받아올림/내림 누락/과다 (차이가 10의 배수)
  if (Math.abs(diff) % 10 === 0 && Math.abs(diff) >= 10) return 'CARRY_BORROW_ERROR';
  
  // 4. 1 차이 (단순 계산 실수)
  if (Math.abs(diff) === 1) return 'OFF_BY_ONE';
  
  return 'CALCULATION_ERROR';
}

// ------------------------------------------------------------------
// 5. 통계/분석 헬퍼
// ------------------------------------------------------------------

/** 정답률 계산 (정수 반올림) */
export function calculateAccuracy(correct, total) {
  if (total === 0) return 0;
  return Math.round((correct / total) * 100);
}

/** 연습 모드 추천 문제 수 */
export function getRecommendedPracticeCount(difficulty) {
  return [0, 15, 12, 10, 8][difficulty] || 10;
}

/** 도전 모드 기본 설정 가져오기 */
export function getChallengeConfig(difficulty) {
  const spec = DIFFICULTY_SPECS[difficulty] || DIFFICULTY_SPECS[1];
  return {
    questionCount: 10,
    timeLimitPerQuestion: spec.timeLimitSec,
    totalTimeLimit: spec.timeLimitSec * 10
  };
}

/** 레벨 업 조건 판정 (연습 모드 완료 시 호출 권장) */
export function shouldLevelUp(stats) {
  // stats: { correct, total, avgTimePerQuestion, difficulty }
  const accuracy = calculateAccuracy(stats.correct, stats.total);
  const spec = DIFFICULTY_SPECS[stats.difficulty] || DIFFICULTY_SPECS[1];
  const timeLimit = spec.timeLimitSec || 10;
  const timeRatio = (stats.avgTimePerQuestion || timeLimit) / timeLimit;
  
  // 정답률 90% 이상, 평균 시간 제한 시간의 50% 이하
  return accuracy >= 90 && timeRatio <= 0.5;
}

// ------------------------------------------------------------------
// 6. 표현식 포맷팅 (UI 표시용)
// ------------------------------------------------------------------

/** "12 + 5 = ?" 또는 "12 + 5 = 17" 형태 문자열 */
export function formatExpression(problem, showAnswer = false,Answer = null) {
  const { a, b, op, answer } = problem;
  const symbol = op === 'addition' ? '+' : '−';
  let rightSide = '?';
  
  if (showAnswer) {
    rightSide = String(answer);
  } else if (Answer !== null && Answer !== undefined) {
    rightSide = String(Answer);
  }
  
  return `${a} ${symbol} ${b} = ${rightSide}`;
}

/** 세로식 문자열 생성 (가로모드/인쇄용) */
export function formatVerticalExpression(problem, showAnswer = false) {
  const { a, b, op, answer } = problem;
  const symbol = op === 'addition' ? '+' : '−';
  const maxLen = Math.max(String(a).length, String(b).length + 1, String(answer).length);
  
  const pad = (n, len) => String(n).padStart(len, ' ');
  const line1 = pad(a, maxLen);
  const line2 = symbol + pad(b, maxLen - 1);
  const line3 = '─'.repeat(maxLen);
  const line4 = showAnswer ? pad(answer, maxLen) : '?'.padStart(maxLen, '?');
  
  return [line1, line2, line3, line4].join('\n');
}

// ------------------------------------------------------------------
// 7. 개발/테스트용 내보내기 (Syntax Error Fix: Top-level Export)
// ------------------------------------------------------------------
// 프로덕션(브라우저)에서는 globalThis.__VITEST__가 falsy이므로 빈 객체 내보냄.
// 테스트(Vitest/Jest) 환경에서는 전역 변수 __VITEST__ 또는 __TEST__가 truthy이므로 내부 함수 노출.
const _internals = (typeof globalThis !== 'undefined' && (globalThis.__VITEST__ || globalThis.__TEST__))
  ? { 
      _generatePair, 
      _nextRandom, 
      _shuffleArray, 
      _analyzeError,
      _seed: () => _seed 
    } 
  : {};

export { _internals };