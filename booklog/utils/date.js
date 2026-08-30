// ==========================================================================
// utils/date.js - Date Formatting & Parsing Utilities
// ==========================================================================

/**
 * Date 객체를 지정된 패턴 문자열로 포맷팅
 * @param {Date|string|number} date - Date 객체, 타임스탬프, ISO 문자열 등
 * @param {string} [pattern='YYYY-MM-DD'] - 포맷 패턴
 * @returns {string} 포맷팅된 문자열 (유효하지 않은 날짜면 빈 문자열)
 * 
 * @example
 * formatDate(new Date(), 'YYYY-MM-DD')        // "2026-08-30"
 * formatDate('2026-08-30', 'YYYY년 M월 D일')  // "2026년 8월 30일"
 * formatDate(Date.now(), 'YYYY/MM/DD HH:mm')  // "2026/08/30 09:43"
 */
export function formatDate(date, pattern = 'YYYY-MM-DD') {
  const d = toDate(date);
  if (!d) return '';

  // 패턴 토큰 매핑
  const tokens = {
    'YYYY': d.getFullYear(),
    'YY': String(d.getFullYear()).slice(-2),
    'M': d.getMonth() + 1,
    'MM': String(d.getMonth() + 1).padStart(2, '0'),
    'D': d.getDate(),
    'DD': String(d.getDate()).padStart(2, '0'),
    'H': d.getHours(),
    'HH': String(d.getHours()).padStart(2, '0'),
    'h': d.getHours() % 12 || 12, // 12시간제
    'hh': String(d.getHours() % 12 || 12).padStart(2, '0'),
    'm': d.getMinutes(),
    'mm': String(d.getMinutes()).padStart(2, '0'),
    's': d.getSeconds(),
    'ss': String(d.getSeconds()).padStart(2, '0'),
    'A': d.getHours() >= 12 ? 'PM' : 'AM',
    'a': d.getHours() >= 12 ? 'pm' : 'am',
  };

  // 긴 토큰 우선 치환 (YYYY -> YY 덮어쓰기 방지)
  return pattern.replace(/YYYY|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g, (match) => {
    return tokens[match] !== undefined ? tokens[match] : match;
  });
}

/**
 * 상대 시간 문자열 반환 (한국어)
 * @param {Date|string|number} date - 기준 날짜
 * @param {Date|number} [baseDate=Date.now()] - 비교 기준 시점
 * @returns {string} 상대 시간 문자열
 * 
 * @example
 * formatRelativeTime(Date.now() - 1000 * 30)       // "방금 전"
 * formatRelativeTime(Date.now() - 1000 * 60 * 5)   // "5분 전"
 * formatRelativeTime(Date.now() - 1000 * 60 * 60 * 3) // "3시간 전"
 * formatRelativeTime('2026-08-28')                 // "2일 전"
 * formatRelativeTime('2025-01-01')                 // "8달 전" (또는 "작년")
 */
export function formatRelativeTime(date, baseDate = Date.now()) {
  const target = toDate(date);
  const base = toDate(baseDate);
  if (!target || !base) return '';

  const diffMs = base.getTime() - target.getTime(); // 양수: 과거, 음수: 미래
  const absDiffMs = Math.abs(diffMs);
  
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30.44 * day; // 평균 월 길이
  const year = 365.25 * day;

  const isPast = diffMs >= 0;
  const suffix = isPast ? ' 전' : ' 후';

  // 1분 미만
  if (absDiffMs < minute) return '방금 전';
  
  // 분 단위
  if (absDiffMs < hour) {
    const mins = Math.floor(absDiffMs / minute);
    return `${mins}분${suffix}`;
  }
  
  // 시간 단위
  if (absDiffMs < day) {
    const hours = Math.floor(absDiffMs / hour);
    return `${hours}시간${suffix}`;
  }
  
  // 일 단위
  if (absDiffMs < week) {
    const days = Math.floor(absDiffMs / day);
    return `${days}일${suffix}`;
  }
  
  // 주 단위 (선택적: 주 단위 쓰려면 주석 해제)
  // if (absDiffMs < month) {
  //   const weeks = Math.floor(absDiffMs / week);
  //   return `${weeks}주${suffix}`;
  // }

  // 월 단위
  if (absDiffMs < year) {
    const months = Math.floor(absDiffMs / month);
    return `${months}달${suffix}`;
  }
  
  // 년 단위
  const years = Math.floor(absDiffMs / year);
  if (years === 1 && isPast) return '작년';
  if (years === 1 && !isPast) return '내년';
  return `${years}년${suffix}`;
}

/**
 * 입력 값을 안전한 Date 객체로 변환
 * @param {string|Date|number|null|undefined} value - 파싱할 값
 * @returns {Date|null} 유효한 Date 객체 또는 null
 * 
 * @example
 * parseDateInput('2026-08-30')     // Date 객체 (로컬 자정 기준)
 * parseDateInput('2026-08-30T12:00:00Z') // Date 객체
 * parseDateInput('invalid')        // null
 * parseDateInput(null)             // null
 */
export function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    // 1. ISO 문자열 우선 파싱 (timezone 정보 포함 가능)
    const isoDate = new Date(value);
    if (!isNaN(isoDate.getTime())) {
      // 'YYYY-MM-DD' 형태(날짜만)인 경우 로컬 자정으로 해석되도록 보정
      // new Date('2026-08-30')은 UTC 자정으로 파싱되어 한국에서 전날 오후가 될 수 있음.
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parts = value.split('-').map(Number);
        // 월은 0-based
        return new Date(parts[0], parts[1] - 1, parts[2]);
      }
      return isoDate;
    }
  }
  return null;
}

/**
 * 내부 헬퍼: 다양한 입력을 Date 객체로 정규화
 * @param {*} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 오늘 날짜 문자열 반환 (input type="date" value 용)
 * @returns {string} 'YYYY-MM-DD'
 */
export function todayString() {
  const d = new Date();
  return formatDate(d, 'YYYY-MM-DD');
}

/**
 * 두 날짜 사이 간격 일수 계산
 * @param {Date|string} start 
 * @param {Date|string} end 
 * @returns {number} 일수 차이 (end - start)
 */
export function diffDays(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return 0;
  // 시간 부분 제거하여 날짜만 비교
  const utc1 = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const utc2 = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * 특정 연월의 마지막 날짜 반환
 * @param {number} year 
 * @param {number} month - 1~12
 * @returns {number} 마지막 일 (28~31)
 */
export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month는 1-based 전달 시 0이 전달되어 전월 말일 반환
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__DATE_UTILS__ = { formatDate, formatRelativeTime, parseDateInput, todayString, diffDays };
}
