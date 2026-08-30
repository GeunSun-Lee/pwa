// ==========================================================================
// views/StatsView.js - Statistics Dashboard View (Verified & Fixed)
// ==========================================================================

import { ReadingDB } from '../db.js';
import { formatDate } from '../utils/date.js';
import { showToast } from '../utils/ui-helpers.js';

// -------------------------------------------------------------------------
// 1. Chart Rendering Engine (Canvas 2D)
// -------------------------------------------------------------------------
const ChartColors = {
  primary: 'var(--color-brand)',
  primaryLight: 'rgba(45, 106, 79, 0.15)', // resolveColor로 처리 안 되므로 하드코딩(투명도 필요)
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border)',
  bg: 'var(--color-bg-secondary)',
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  palette: [
    '#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2',
    '#1b4332', '#081c15', '#3a86ff', '#8338ec', '#ff006e'
  ]
};

function resolveColor(cssVar) {
  // CSS 변수일 경우 계산된 값 반환, 아니면 원본 반환
  if (typeof cssVar === 'string' && cssVar.startsWith('var(')) {
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || cssVar;
  }
  return cssVar;
}

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

function drawText(ctx, text, x, y, { font = '12px var(--font-sans)', color = 'var(--color-text-primary)', align = 'left', baseline = 'top' } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = resolveColor(color);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

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
// 2. Chart Implementations
// -------------------------------------------------------------------------

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

  // Y Grid
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (chartH / steps) * i;
    const val = Math.round(maxVal * (1 - i / steps));
    ctx.beginPath();
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    drawText(ctx, val.toLocaleString(), padding.left - 10, y, { color: mutedColor, align: 'right', baseline: 'middle', font: '11px var(--font-sans)' });
  }

  // Bars
  data.forEach((d, i) => {
    const x = padding.left + gap + i * (barWidth + gap);
    const barH = (d.value / maxVal) * chartH;
    const y = padding.top + chartH - barH;
    ctx.fillStyle = color;
    drawRoundedRect(ctx, x, y, barWidth, barH, 4);
    ctx.fill();
    drawText(ctx, d.label, x + barWidth / 2, height - padding.bottom + 15, { color: textColor, align: 'center', baseline: 'top', font: '11px var(--font-sans)' });
    if (d.value > 0) drawText(ctx, d.value.toLocaleString(), x + barWidth / 2, y - 5, { color: textColor, align: 'center', baseline: 'bottom', font: 'bold 11px var(--font-sans)' });
  });
  drawText(ctx, options.yLabel || '권', 15, padding.top + chartH / 2, { color: mutedColor, align: 'center', baseline: 'middle', font: '12px var(--font-sans)' });
}

function renderDoughnutChart(canvas, data, options = {}) {
  const { ctx, width, height } = setupHighDPI(canvas);
  const centerX = width / 2, centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 20;
  const innerRadius = radius * 0.6;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let startAngle = -Math.PI / 2;
  const legendItems = [];

  data.forEach((d, i) => {
    if (d.value === 0) return;
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const color = resolveColor(d.color || ChartColors.palette[i % ChartColors.palette.length]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    legendItems.push({ label: d.label, value: d.value, color, percentage: ((d.value / total) * 100).toFixed(1) });
    startAngle += sliceAngle;
  });

  drawText(ctx, total.toLocaleString(), centerX, centerY - 8, { color: resolveColor(ChartColors.text), align: 'center', baseline: 'bottom', font: 'bold 24px var(--font-sans)' });
  drawText(ctx, options.centerLabel || '총계', centerX, centerY + 8, { color: resolveColor(ChartColors.muted), align: 'center', baseline: 'top', font: '12px var(--font-sans)' });
  return legendItems;
}

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
  const mutedColor = resolveColor(ChartColors.muted);

  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (chartH / steps) * i;
    const val = Math.round(maxVal - (range / steps) * i);
    ctx.beginPath(); ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    drawText(ctx, val.toLocaleString(), padding.left - 10, y, { color: mutedColor, align: 'right', baseline: 'middle', font: '11px var(--font-sans)' });
  }

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartW,
    y: padding.top + chartH - ((d.value - minVal) / range) * chartH,
    label: d.label, value: d.value
  }));

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, resolveColor(ChartColors.primaryLight));
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + chartH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
  ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();

  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i], cp = points[i-1];
    const ctrlX = (cp.x + p.x) / 2;
    ctx.bezierCurveTo(ctrlX, cp.y, ctrlX, p.y, p.x, p.y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();

  return points.map(p => ({ ...p, radius: 4 }));
}

function renderLegend(container, items) {
  if (!container) return;
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
    if (!b.completedAt) return false;
    const year = new Date(b.completedAt).getFullYear();
    return targetYear === 'all' || year === targetYear;
  });

  const totalBooks = books.length;
  const completedBooks = filtered.length;
  const totalPages = books.reduce((sum, b) => sum + (b.totalPages || 0), 0);
  const completedPages = filtered.reduce((sum, b) => sum + (b.totalPages || 0), 0);
  const ratedBooks = books.filter(b => b.rating > 0);
  const avgRating = ratedBooks.length ? ratedBooks.reduce((sum, b) => sum + b.rating, 0) / ratedBooks.length : 0;

  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, pages: 0 }));
  filtered.forEach(b => {
    const m = new Date(b.completedAt).getMonth();
    monthly[m].count++;
    monthly[m].pages += b.totalPages || 0;
  });

  const tagMap = {};
  filtered.forEach(b => (b.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
  const tagData = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value], i) => ({ label, value, color: ChartColors.palette[i] }));

  const statusMap = { wish: 0, reading: 0, paused: 0, completed: 0 };
  books.forEach(b => { if (statusMap.hasOwnProperty(b.status)) statusMap[b.status]++; });
  const statusData = Object.entries(statusMap).map(([label, value], i) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), value, color: ChartColors.palette[i] }));

  let cumulative = 0;
  const cumulativeData = monthly.map(m => { cumulative += m.pages; return { label: `${m.month}월`, value: cumulative }; });

  const availableYears = [...new Set(books.filter(b => b.completedAt).map(b => new Date(b.completedAt).getFullYear()))].sort((a, b) => b - a);

  return { summary: { totalBooks, completedBooks, totalPages, completedPages, avgRating: avgRating.toFixed(2) }, monthlyCount: monthly.map(m => ({ label: `${m.month}월`, value: m.count })), monthlyPages: monthly.map(m => ({ label: `${m.month}월`, value: m.pages })), tagData, statusData, cumulativeData, availableYears };
}

// -------------------------------------------------------------------------
// 4. View Logic
// -------------------------------------------------------------------------
let _cleanupFns = [];
let _dom = {};
let _allBooks = [];
let _currentYear = 'all';
let _resizeObserver = null;

function renderLayout(stats) {
  const years = ['all', ...stats.availableYears];
  _dom.container.innerHTML = `
    <header class="page-header">
      <div><h1 class="page-title">독서 통계</h1><p class="page-subtitle">데이터 기반 독서 습관 분석</p></div>
      <div class="page-actions">
        <select id="year-filter" class="filter-bar__select" style="min-width: 120px;" aria-label="연도 필터">
          ${years.map(y => `<option value="${y}" ${_currentYear === y ? 'selected' : ''}>${y === 'all' ? '전체' : y + '년'}</option>`).join('')}
        </select>
      </div>
    </header>

    <div class="stats-grid" role="list" aria-label="요약 통계">
      <article class="stat-card" role="listitem"><span class="stat-card__label">총 등록 도서</span><span class="stat-card__value">${stats.summary.totalBooks.toLocaleString()}권</span></article>
      <article class="stat-card" role="listitem"><span class="stat-card__label">완독 도서</span><span class="stat-card__value stat-card__value--brand">${stats.summary.completedBooks.toLocaleString()}권</span></article>
      <article class="stat-card" role="listitem"><span class="stat-card__label">총 페이지</span><span class="stat-card__value">${stats.summary.totalPages.toLocaleString()}p</span></article>
      <article class="stat-card" role="listitem"><span class="stat-card__label">완독 페이지</span><span class="stat-card__value stat-card__value--brand">${stats.summary.completedPages.toLocaleString()}p</span></article>
      <article class="stat-card" role="listitem"><span class="stat-card__label">평균 평점</span><span class="stat-card__value stat-card__value--brand">${stats.summary.avgRating} / 5.0</span></article>
      <article class="stat-card" role="listitem"><span class="stat-card__label">완독률</span><span class="stat-card__value">${stats.summary.totalBooks ? ((stats.summary.completedBooks / stats.summary.totalBooks) * 100).toFixed(1) : 0}%</span></article>
    </div>

    <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; margin-bottom:1.5rem;">
      <section class="stat-chart" aria-labelledby="chart-monthly-count-title">
        <h3 id="chart-monthly-count-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">월별 완독 권수</h3>
        <canvas id="chart-monthly-count" height="300" role="img" aria-label="월별 완독 권수 막대 차트"></canvas>
      </section>
      <section class="stat-chart" aria-labelledby="chart-monthly-pages-title">
        <h3 id="chart-monthly-pages-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">월별 완독 페이지</h3>
        <canvas id="chart-monthly-pages" height="300" role="img" aria-label="월별 완독 페이지 막대 차트"></canvas>
      </section>
    </div>

    <div style="display:grid; grid-template-columns: 1fr; gap:1.5rem; margin-bottom:1.5rem;">
      <section class="stat-chart" aria-labelledby="chart-tags-title">
        <h3 id="chart-tags-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">장르/태그 분포 (완독 기준)</h3>
        <div style="display:flex; height:300px; align-items:center; gap:1rem;">
          <canvas id="chart-tags" height="300" style="flex:1; max-width:300px;" role="img" aria-label="태그 분포 도넛 차트"></canvas>
          <div id="chart-tags-legend" style="flex:1; min-width:150px; padding:1rem; overflow-y:auto;"></div>
        </div>
      </section>
      <section class="stat-chart" aria-labelledby="chart-status-title">
        <h3 id="chart-status-title" style="margin-bottom:1rem; font-size:1rem; font-weight:600;">도서 상태 분포</h3>
        <div style="display:flex; height:300px; align-items:center; gap:1rem;">
          <canvas id="chart-status" height="300" style="flex:1; max-width:300px;" role="img" aria-label="상태 분포 도넛 차트"></canvas>
          <div id="chart-status-legend" style="flex:1; min-width:150px; padding:1rem; overflow-y:auto;"></div>
        </div>
      </section>
    </div>

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
      tags: document.getElementById('chart-tags-legend'),
      status: document.getElementById('chart-status-legend')
    }
  };
}

function bindEvents() {
  _dom.yearFilter?.addEventListener('change', (e) => { _currentYear = e.target.value; loadAndRenderStats(); });
  if (_resizeObserver) _resizeObserver.disconnect();
  _resizeObserver = new ResizeObserver(debounce(() => { if (_allBooks.length) { const stats = computeStats(_allBooks, _currentYear); renderAllCharts(stats); } }, 200));
  Object.values(_dom.charts).forEach(canvas => { if (canvas) _resizeObserver.observe(canvas.parentElement); });
  _cleanupFns.push(() => _resizeObserver?.disconnect());
}

function renderAllCharts(stats) {
  renderBarChart(_dom.charts.monthlyCount, stats.monthlyCount, { color: ChartColors.primary, yLabel: '권' });
  renderBarChart(_dom.charts.monthlyPages, stats.monthlyPages, { color: ChartColors.info, yLabel: '페이지' });
  const tagLegend = renderDoughnutChart(_dom.charts.tags, stats.tagData, { centerLabel: '완독 권수' });
  renderLegend(_dom.legends.tags, tagLegend);
  const statusLegend = renderDoughnutChart(_dom.charts.status, stats.statusData, { centerLabel: '총 권수' });
  renderLegend(_dom.legends.status, statusLegend);
  renderLineChart(_dom.charts.cumulative, stats.cumulativeData, { color: ChartColors.success });
}

// -------------------------------------------------------------------------
// 5. Data Loading
// -------------------------------------------------------------------------
async function loadAndRenderStats() {
  try {
    // 로딩 상태 UI
    _dom.container.querySelectorAll('canvas').forEach(c => c.style.opacity = '0.5');
    
    let allBooks = [];
    const db = await ReadingDB.ready(); // DB 인스턴스 확보
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const req = store.openCursor();
    
    await new Promise((resolve, reject) => {
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { allBooks.push(cursor.value); cursor.continue(); }
        else { resolve(); }
      };
      req.onerror = () => reject(req.error);
    });
    await new Promise(r => tx.oncomplete = r);

    _allBooks = allBooks;
    const stats = computeStats(allBooks, _currentYear);
    
    if (!_dom.yearFilter) { renderLayout(stats); } 
    else { renderAllCharts(stats); updateYearOptions(stats.availableYears); }
    
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
  if (newOptions.length !== _dom.yearFilter.options.length || ![..._dom.yearFilter.options].some((opt, i) => opt.value === newOptions[i])) {
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
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// 개발 편의
if (typeof window !== 'undefined') { window.__STATS_VIEW__ = { init }; }