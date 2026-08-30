// ==========================================================================
// views/StatsView.js - Statistics Dashboard View (Canvas Charts)
// ==========================================================================

import { state, subscribe } from '../utils/store.js';
import { ReadingDB } from '../db.js';
import { formatDate, getDaysInMonth } from '../utils/date.js';
import { showToast } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Chart Rendering Engine (Canvas 2D Context Helpers)
// -------------------------------------------------------------------------
const ChartColors = {
  primary: 'var(--color-brand)',
  primaryLight: 'rgba(45, 106, 79, 0.15)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border)',
  bg: 'var(--color-bg-secondary)',
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  // Tag palette
  palette: [
    '#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2',
    '#1b4332', '#081c15', '#3a86ff', '#8338ec', '#ff006e'
  ]
};

/** CSS 변수 색상 해결 */
function resolveColor(cssVar) {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || cssVar;
}

/** 캔버스 고해상도(DPR) 설정 */
function setupHighDPI(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const displayWidth = width || rect.width;
  const displayHeight = height || rect.height;
  
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width: displayWidth, height: displayHeight };
}

/** 텍스트 그리기 헬퍼 */
function drawText(ctx, text, x, y, { font = '12px var(--font-sans)', color = 'var(--color-text-primary)', align = 'left', baseline = 'top' } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = resolveColor(color);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 둥근 사각형 그리기 (막대 차트용) */
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// -------------------------------------------------------------------------
// 2. Specific Chart Implementations
// -------------------------------------------------------------------------

/** 월별 독서량 막대 차트 */
function renderBarChart(canvas, data, options = {}) {
  const { ctx, width, height } = setupHighDPI(canvas);
  const padding = { top: 30, right: 20, bottom: 40, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barCount = data.length;
  const barWidth = Math.min(40, (chartW / barCount) * 0.7);
  const gap = (chartW - barWidth * barCount) / (barCount + 1);
  
  const color = resolveColor(options.color || ChartColors.primary);
  const textColor = resolveColor(ChartColors.text);
  const mutedColor = resolveColor(ChartColors.muted);
  const gridColor = resolveColor(ChartColors.border);

  // Y축 그리드 및 라벨
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (chartH / steps) * i;
    const val = Math.round(maxVal * (1 - i / steps));
    ctx.beginPath();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    drawText(ctx, val.toLocaleString(), padding.left - 10, y, { color: mutedColor, align: 'right', baseline: 'middle', font: '11px var(--font-sans)' });
  }

  // 막대 그리기
  data.forEach((d, i) => {
    const x = padding.left + gap + i * (barWidth + gap);
    const barH = (d.value / maxVal) * chartH;
    const y = padding.top + chartH - barH;
    
    ctx.fillStyle = color;
    drawRoundedRect(ctx, x, y, barWidth, barH, 4);
    ctx.fill();

    // X축 라벨 (월)
    drawText(ctx, d.label, x + barWidth / 2, height - padding.bottom + 15, { 
      color: textColor, align: 'center', baseline: 'top', font: '11px var(--font-sans)' 
    });
    
    // 값 라벨 (막대 위)
    if (d.value > 0) {
      drawText(ctx, d.value.toLocaleString(), x + barWidth / 2, y - 5, { 
        color: textColor, align: 'center', baseline: 'bottom', font: 'bold 11px var(--font-sans)' 
      });
    }
  });

  // Y축 제목
  drawText(ctx, options.yLabel || '권', 15, padding.top + chartH / 2, { 
    color: mutedColor, align: 'center', baseline: 'middle', font: '12px var(--font-sans)' 
  });
}

/** 도넛 차트 (태그 분포, 상태 분포) */
function renderDoughnutChart(canvas, data, options = {}) {
  const { ctx, width, height } = setupHighDPI(canvas);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 20;
  const innerRadius = radius * 0.6;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let startAngle = -Math.PI / 2;
  
  const legendItems = [];

  data.forEach((d, i) => {
    if (d.value === 0) return;
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const color = d.color || ChartColors.palette[i % ChartColors.palette.length];
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    
    // 범례 데이터 저장
    legendItems.push({ label: d.label, value: d.value, color, percentage: ((d.value / total) * 100).toFixed(1) });
    
    startAngle += sliceAngle;
  });

  // 중앙 텍스트 (총합)
  drawText(ctx, total.toLocaleString(), centerX, centerY - 8, { 
    color: resolveColor(ChartColors.text), align: 'center', baseline: 'bottom', font: 'bold 24px var(--font-sans)' 
  });
  drawText(ctx, options.centerLabel || '총계', centerX, centerY + 8, { 
    color: resolveColor(ChartColors.muted), align: 'center', baseline: 'top', font: '12px var(--font-sans)' 
  });

  return legendItems; // 범례 렌더링용 반환
}

/** 누적 페이지 라인 차트 */
function renderLineChart(canvas, data, options = {}) {
  const { ctx, width, height } = setupHighDPI(canvas);
  const padding = { top: 30, right: 20, bottom: 40, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const minVal = Math.min(...data.map(d => d.value), 0);
  const range = maxVal - minVal || 1;

  const color = resolveColor(options.color || ChartColors.primary);
  const gridColor = resolveColor(ChartColors.border);
  const textColor = resolveColor(ChartColors.text);
  const mutedColor = resolveColor(ChartColors.muted);

  // 그리드 (수평)
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (chartH / steps) * i;
    const val = Math.round(maxVal - (range / steps) * i);
    ctx.beginPath();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    drawText(ctx, val.toLocaleString(), padding.left - 10, y, { color: mutedColor, align: 'right', baseline: 'middle', font: '11px var(--font-sans)' });
  }

  // 경로 계산
  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - ((d.value - minVal) / range) * chartH,
    label: d.label,
    value: d.value
  }));

  // 영역 채우기 (그라디언트)
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, resolveColor(ChartColors.primaryLight));
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + chartH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // 선 그리기
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const cp = points[i - 1];
    // 부드러운 곡선 (베지에)
    const ctrlX = (cp.x + p.x) / 2;
    ctx.bezierCurveTo(ctrlX, cp.y, ctrlX, p.y, p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 점 그리기 + 툴팁용 히트맵 데이터 반환
  return points.map(p => ({ ...p, radius: 4 }));
}

/** 범례 렌더링 (도넛 차트 하단) */
function renderLegend(container, items) {
  container.innerHTML = items.map(item => `
    <div class="legend-item" style="display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0; font-size:0.8125rem;">
      <span style="width:12px; height:12px; border-radius:3px; background:${item.color}; flex-shrink:0;"></span>
      <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.label)}</span>
      <span style="color:var(--color-text-secondary); font-variant-numeric: tabular-nums;">${item.value.toLocaleString()}</span>
      <span style="color:var(--color-text-muted); font-size:0.75rem;">(${item.percentage}%)</span>
    </div>
  `).join('');
}

// -------------------------------------------------------------------------
// 3. Statistics Computation
// -------------------------------------------------------------------------

function computeStats(books, targetYear) {
  const filtered = books.filter(b => {
    if (!b.completedAt) return false; // 완독만 통계에 포함 (또는 옵션으로 분리)
    const year = new Date(b.completedAt).getFullYear();
    return targetYear === 'all' || year === targetYear;
  });

  const totalBooks = books.length;
  const completedBooks = filtered.length;
  const totalPages = books.reduce((sum, b) => sum + (b.totalPages || 0), 0);
  const completedPages = filtered.reduce((sum, b) => sum + (b.totalPages || 0), 0);
  const avgRating = books.filter(b => b.rating > 0).reduce((sum, b) => sum + b.rating, 0) / Math.max(1, books.filter(b => b.rating > 0).length);

  // 월별 완독 권수/페이지
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, pages: 0 }));
  filtered.forEach(b => {
    const m = new Date(b.completedAt).getMonth();
    monthly[m].count++;
    monthly[m].pages += b.totalPages || 0;
  });

  // 태그 분포 (완독 도서 기준)
  const tagMap = {};
  filtered.forEach(b => {
    (b.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; });
  });
  const tagData = Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value], i) => ({ label, value, color: ChartColors.palette[i] }));

  // 상태 분포 (전체 도서 기준)
  const statusMap = { wish: 0, reading: 0, paused: 0, completed: 0 };
  books.forEach(b => { if (statusMap.hasOwnProperty(b.status)) statusMap[b.status]++; });
  const statusData = Object.entries(statusMap).map(([label, value], i) => ({ 
    label: label.charAt(0).toUpperCase() + label.slice(1), 
    value, 
    color: ChartColors.palette[i] 
  }));

  // 누적 페이지 (월별 완독 페이지 누적)
  let cumulative = 0;
  const cumulativeData = monthly.map(m => {
    cumulative += m.pages;
    return { label: `${m.month}월`, value: cumulative };
  });

  return {
    summary: { totalBooks, completedBooks, totalPages, completedPages, avgRating: avgRating.toFixed(2) },
    monthlyCount: monthly.map(m => ({ label: `${m.month}월`, value: m.count })),
    monthlyPages: monthly.map(m => ({ label: `${m.month}월`, value: m.pages })),
    tagData,
    statusData,
    cumulativeData,
    availableYears: [...new Set(books.filter(b => b.completedAt).map(b => new Date(b.completedAt).getFullYear()))].sort((a, b) => b - a)
  };
}

// -------------------------------------------------------------------------
// 4. View Logic
// -------------------------------------------------------------------------

let _cleanupFns = [];
let _dom = {};
let _allBooks = []; // 캐시
let _currentYear = 'all';
let _chartInstances = {}; // 캔버스 참조 보관
let _resizeObserver = null;

function renderLayout(stats) {
  const years = [ 'all', ...stats.availableYears ];
  
  _dom.container.innerHTML = `
    <header class="page-header">
      <div>
        <h1 class="page-title">독서 통계</h1>
        <p class="page-subtitle">데이터 기반 독서 습관 분석</p>
      </div>
      <div class="page-actions">
        <select id="year-filter" class="filter-bar__select" style="min-width: 120px;" aria-label="연도 필터">
          ${years.map(y => `<option value="${y}" ${_currentYear === y ? 'selected' : ''}>${y === 'all' ? '전체' : y + '년'}</option>`).join('')}
        </select>
      </div>
    </header>

    <!-- Summary Cards -->
    <div class="stats-grid" role="list" aria-label="요약 통계">
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">총 등록 도서</span>
        <span class="stat-card__value">${stats.summary.totalBooks.toLocaleString()}권</span>
      </article>
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">완독 도서</span>
        <span class="stat-card__value stat-card__value--brand">${stats.summary.completedBooks.toLocaleString()}권</span>
      </article>
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">총 페이지</span>
        <span class="stat-card__value">${stats.summary.totalPages.toLocaleString()}p</span>
      </article>
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">완독 페이지</span>
        <span class="stat-card__value stat-card__value--brand">${stats.summary.completedPages.toLocaleString()}p</span>
      </article>
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">평균 평점</span>
        <span class="stat-card__value stat-card__value--brand">${stats.summary.avgRating} / 5.0</span>
      </article>
      <article class="stat-card" role="listitem">
        <span class="stat-card__label">완독률</span>
        <span class="stat-card__value">${stats.summary.totalBooks ? ((stats.summary.completedBooks / stats.summary.totalBooks) * 100).toFixed(1) : 0}%</span>
      </article>
    </div>

    <!-- Charts Row 1: Monthly Count & Pages -->
    <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; margin-bottom:1.5rem;">
      @media (min-width: 768px) { .chart-row { grid-template-columns: 1fr 1fr; } }
      <div class="chart-row">
        <section class="stat-chart" aria-labelledby="chart-monthly-count-title">
          <h3 id="chart-monthly-count-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">월별 완독 권수</h3>
          <canvas id="chart-monthly-count" height="300" role="img" aria-label="월별 완독 권수 막대 차트"></canvas>
          <div id="chart-monthly-count-legend" class="chart-legend" style="display:flex; flex-wrap:wrap; gap:1rem; margin-top:1rem; justify-content:center; font-size:0.8125rem;"></div>
        </section>
        <section class="stat-chart" aria-labelledby="chart-monthly-pages-title">
          <h3 id="chart-monthly-pages-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">월별 완독 페이지</h3>
          <canvas id="chart-monthly-pages" height="300" role="img" aria-label="월별 완독 페이지 막대 차트"></canvas>
        </section>
      </div>
    </div>

    <!-- Charts Row 2: Tag Distribution & Status Distribution -->
    <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; margin-bottom:1.5rem;">
      @media (min-width: 768px) { .chart-row { grid-template-columns: 1fr 1fr; } }
      <div class="chart-row">
        <section class="stat-chart" aria-labelledby="chart-tags-title">
          <h3 id="chart-tags-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">장르/태그 분포 (완독 기준)</h3>
          <div style="display:flex; height:300px; align-items:center;">
            <canvas id="chart-tags" height="300" style="flex:1; max-width:300px;" role="img" aria-label="태그 분포 도넛 차트"></canvas>
            <div id="chart-tags-legend" style="flex:1; min-width:150px; padding:1rem; overflow-y:auto;"></div>
          </div>
        </section>
        <section class="stat-chart" aria-labelledby="chart-status-title">
          <h3 id="chart-status-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">도서 상태 분포</h3>
          <div style="display:flex; height:300px; align-items:center;">
            <canvas id="chart-status" height="300" style="flex:1; max-width:300px;" role="img" aria-label="상태 분포 도넛 차트"></canvas>
            <div id="chart-status-legend" style="flex:1; min-width:150px; padding:1rem; overflow-y:auto;"></div>
          </div>
        </section>
      </div>
    </div>

    <!-- Chart Row 3: Cumulative Pages -->
    <section class="stat-chart" aria-labelledby="chart-cumulative-title" style="margin-bottom:1.5rem;">
      <h3 id="chart-cumulative-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">누적 완독 페이지 추이</h3>
      <canvas id="chart-cumulative" height="300" role="img" aria-label="누적 완독 페이지 라인 차트"></canvas>
    </section>
  `;

  cacheDomElements();
  bindEvents();
  renderAllCharts(stats);
}

function cacheDomElements() {
  _dom = {
    container: document.getElementById('app'),
    yearFilter: document.getElementById('year-filter'),
    charts: {
      monthlyCount: document.getElementById('chart-monthly-count'),
      monthlyPages: document.getElementById('chart-monthly-pages'),
      tags: document.getElementById('chart-tags'),
      status: document.getElementById('chart-status'),
      cumulative: document.getElementById('chart-cumulative')
    },
    legends: {
      monthlyCount: document.getElementById('chart-monthly-count-legend'),
      tags: document.getElementById('chart-tags-legend'),
      status: document.getElementById('chart-status-legend')
    }
  };
}

function bindEvents() {
  // 연도 필터 변경
  _dom.yearFilter?.addEventListener('change', (e) => {
    _currentYear = e.target.value;
    loadAndRenderStats();
  });
  _cleanupFns.push(() => _dom.yearFilter?.removeEventListener('change', null));

  // 리사이즈 옵저버 (차트 리렌더링)
  if (_resizeObserver) _resizeObserver.disconnect();
  _resizeObserver = new ResizeObserver(debounce(() => {
    if (_allBooks.length > 0) {
      const stats = computeStats(_allBooks, _currentYear);
      renderAllCharts(stats);
    }
  }, 200));
  
  Object.values(_dom.charts).forEach(canvas => {
    if (canvas) _resizeObserver.observe(canvas.parentElement);
  });
  _cleanupFns.push(() => _resizeObserver?.disconnect());
}

function renderAllCharts(stats) {
  // 1. 월별 권수
  renderBarChart(_dom.charts.monthlyCount, stats.monthlyCount, { color: ChartColors.primary, yLabel: '권' });
  // 범례 (막대 차트는 범례 불필요하나 월별 수치 표시 가능)

  // 2. 월별 페이지
  renderBarChart(_dom.charts.monthlyPages, stats.monthlyPages, { color: ChartColors.info, yLabel: '페이지' });

  // 3. 태그 분포
  const tagLegend = renderDoughnutChart(_dom.charts.tags, stats.tagData, { centerLabel: '완독 권수' });
  renderLegend(_dom.legends.tags, tagLegend);

  // 4. 상태 분포
  const statusLegend = renderDoughnutChart(_dom.charts.status, stats.statusData, { centerLabel: '총 권수' });
  renderLegend(_dom.legends.status, statusLegend);

  // 5. 누적 페이지
  renderLineChart(_dom.charts.cumulative, stats.cumulativeData, { color: ChartColors.success });
}

// -------------------------------------------------------------------------
// 5. Data Loading
// -------------------------------------------------------------------------

async function loadAndRenderStats() {
  _dom.container.querySelectorAll('canvas').forEach(c => c.style.opacity = '0.5'); // 로딩 표시
  
  try {
    // 전체 데이터 로드 (커서로 전체 순회)
    let allBooks = [];
    let cursor = null;
    const tx = await ReadingDB.ready().then(db => db.transaction('books', 'readonly'));
    const store = tx.objectStore('books');
    const req = store.openCursor();
    
    await new Promise((resolve, reject) => {
      req.onsuccess = (e) => {
        cursor = e.target.result;
        if (cursor) {
          allBooks.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
    await new Promise(r => tx.oncomplete = r);

    _allBooks = allBooks;
    const stats = computeStats(allBooks, _currentYear);
    
    // 레이아웃이 아직 안 그려졌으면 그리기 (최초 1회)
    if (!_dom.yearFilter) {
      renderLayout(stats);
    } else {
      // 이미 그려진 상태면 차트만 갱신
      renderAllCharts(stats);
      // 연도 옵션 업데이트 (최초 로드 시 년도 생겼을 수 있음)
      updateYearOptions(stats.availableYears);
    }
    
    _dom.container.querySelectorAll('canvas').forEach(c => c.style.opacity = '1');

  } catch (err) {
    console.error('[StatsView] Load failed:', err);
    showToast('통계 데이터를 불러오는데 실패했습니다.', 'error');
    _dom.container.querySelectorAll('canvas').forEach(c => c.style.opacity = '1');
  }
}

function updateYearOptions(years) {
  if (!_dom.yearFilter) return;
  const currentVal = _dom.yearFilter.value;
  const newOptions = ['all', ...years];
  if (newOptions.length !== _dom.yearFilter.options.length || 
      ![..._dom.yearFilter.options].some((opt, i) => opt.value === newOptions[i])) {
    _dom.yearFilter.innerHTML = newOptions.map(y => `<option value="${y}" ${currentVal === y ? 'selected' : ''}>${y === 'all' ? '전체' : y + '년'}</option>`).join('');
  }
}

// -------------------------------------------------------------------------
// 6. Public Init
// -------------------------------------------------------------------------

export async function init({ params, state, navigate, db, showToast }) {
  console.log('[StatsView] Initializing...');
  state.loading = true;
  
  await loadAndRenderStats();
  state.loading = false;

  return () => {
    console.log('[StatsView] Cleaning up...');
    _resizeObserver?.disconnect();
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
  };
}

// -------------------------------------------------------------------------
// 7. Helpers
// -------------------------------------------------------------------------

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 개발 편의
if (typeof window !== 'undefined') {
  window.__STATS_VIEW__ = { init };
}