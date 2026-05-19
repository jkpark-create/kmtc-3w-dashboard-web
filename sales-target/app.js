// ═════════════════════════════════════════════════════════════════
// Sales Target & Progress drill-down
//   - index.json   : target/performance/gap per (origin, salesman) from Summary_All
//   - manifest.json: catalog of {origin, salesman, yyyymm} -> file mapping
//   - data/*.json  : per-chunk shipper aggregates + BKG_NO list (lazy load)
// ═════════════════════════════════════════════════════════════════

const STATE = {
  index: null,
  manifest: null,
  chunkCache: new Map(),
  view: 'summary',
  expandedKey: null,  // "<origin>||<salesman>" for drill view
  expandedShipperKey: null,
  filters: {
    quarter: 'q1',
    origin: 'ALL',
    sales: 'ALL',
    month: 'ALL',
    grade: 'ALL',
    profit: 'ALL',
    wos: 'W3',
  },
  pivot: { row: 'origin', col: 'metric', metric: 'fst' },
  initialUrlParams: null,
};

const QUARTER_MONTHS = {
  q1: ['202601', '202602', '202603'],
  q2: ['202604', '202605', '202606'],
};

// ─── Helpers ──────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const gv = (id) => document.getElementById(id)?.value;
const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

function fmtPct(frac, digits = 1) {
  if (frac === null || frac === undefined || Number.isNaN(frac)) return '-';
  return (frac * 100).toFixed(digits) + '%';
}
function fmtPctSigned(frac, digits = 1) {
  if (frac === null || frac === undefined || Number.isNaN(frac)) return '-';
  const pct = frac * 100;
  const sign = pct > 0 ? '+' : '';
  return sign + pct.toFixed(digits) + '%';
}
function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function gapClass(gap) {
  if (gap === null || gap === undefined || Number.isNaN(gap)) return '';
  if (gap >= 0) return 'pos';
  if (gap >= -0.02) return 'warn';
  return 'neg';
}
function safeRatio(num, den) {
  if (!den || Number.isNaN(num) || Number.isNaN(den)) return null;
  return num / den;
}
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeToken(text) {
  return String(text || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'UNKNOWN';
}
function gradeBadge(grade) {
  if (!grade) return '';
  const first = grade.charAt(0).toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(first)) {
    return `<span class="grade-${first}">${escapeHtml(grade)}</span>`;
  }
  return escapeHtml(grade);
}

// ─── Loaders ──────────────────────────────────────────────────────
async function loadJson(url) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Failed to load ${url}: HTTP ${resp.status}`);
  return resp.json();
}

async function init() {
  try {
    const [index, manifest] = await Promise.all([
      loadJson('index.json'),
      loadJson('manifest.json'),
    ]);
    STATE.index = index;
    STATE.manifest = manifest;
    STATE.initialUrlParams = readUrlParams();
    setupFilters();
    setupListeners();
    applyInitialParams();
    render();
    setText('dataInfo', `데이터 기준일: ${formatDataDate(index.data_date)} · ${manifest.chunk_count.toLocaleString()}개 chunk / ${manifest.bkg_rows.toLocaleString()}개 BKG`);
    const link = document.getElementById('workbookLink');
    if (link) link.href = index.workbook_url || '#';
  } catch (err) {
    console.error(err);
    showError(`초기 로딩 실패: ${err.message}. 먼저 \`py -3 scripts/build_sales_target_drill_data.py\` 를 실행해 index.json / manifest.json 을 생성해 주세요.`);
  }
}

function formatDataDate(s) {
  if (!s || s.length < 8) return s || '-';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function showError(msg) {
  const area = document.getElementById('errorArea');
  if (area) area.innerHTML = `<div class="error-banner">${escapeHtml(msg)}</div>`;
  setText('initLoading', '');
}

function readUrlParams() {
  const p = new URLSearchParams(location.search);
  const out = {};
  for (const k of ['origin', 'sales', 'quarter', 'month', 'grade', 'profit', 'wos', 'view']) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function applyInitialParams() {
  const params = STATE.initialUrlParams || {};
  if (params.quarter) STATE.filters.quarter = params.quarter;
  if (params.month) STATE.filters.month = params.month;
  if (params.grade) STATE.filters.grade = params.grade;
  if (params.profit) STATE.filters.profit = params.profit;
  if (params.wos) STATE.filters.wos = params.wos;
  if (params.origin) STATE.filters.origin = params.origin;
  if (params.sales) STATE.filters.sales = params.sales;
  if (params.view && ['summary', 'drill', 'pivot'].includes(params.view)) STATE.view = params.view;
  document.getElementById('fQuarter').value = STATE.filters.quarter;
  document.getElementById('fOrigin').value = STATE.filters.origin;
  document.getElementById('fSales').value = STATE.filters.sales;
  document.getElementById('fMonth').value = STATE.filters.month;
  document.getElementById('fGrade').value = STATE.filters.grade;
  document.getElementById('fProfit').value = STATE.filters.profit;
  document.getElementById('fWos').value = STATE.filters.wos;
  $$('.view-tabs .vtab').forEach(el => el.classList.toggle('active', el.dataset.view === STATE.view));
}

// ─── Filter setup ────────────────────────────────────────────────
function setupFilters() {
  const origins = STATE.manifest.origins || [];
  fillSelect('fOrigin', origins, 'ALL', '전체');
  refreshSalesOptions();
  refreshMonthOptions();
}

function fillSelect(id, list, currentValue, allLabel) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  sel.appendChild(makeOption('ALL', allLabel || '전체'));
  list.forEach(v => sel.appendChild(makeOption(v, v)));
  sel.value = list.includes(currentValue) ? currentValue : 'ALL';
}

function makeOption(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function refreshSalesOptions() {
  const origin = STATE.filters.origin;
  let names;
  if (origin === 'ALL') {
    const set = new Set();
    Object.values(STATE.manifest.salespeople_by_origin || {}).forEach(arr => arr.forEach(n => set.add(n)));
    names = Array.from(set).sort();
  } else {
    names = (STATE.manifest.salespeople_by_origin || {})[origin] || [];
  }
  fillSelect('fSales', names, STATE.filters.sales, '전체');
}

function refreshMonthOptions() {
  const months = STATE.manifest.months || [];
  const q = STATE.filters.quarter;
  const inQuarter = months.filter(m => (QUARTER_MONTHS[q] || []).includes(m));
  fillSelect('fMonth', inQuarter, STATE.filters.month, '전체 (분기 합산)');
}

function setupListeners() {
  document.getElementById('fQuarter').addEventListener('change', e => {
    STATE.filters.quarter = e.target.value;
    STATE.filters.month = 'ALL';
    refreshMonthOptions();
    render();
  });
  document.getElementById('fOrigin').addEventListener('change', e => {
    STATE.filters.origin = e.target.value;
    STATE.filters.sales = 'ALL';
    refreshSalesOptions();
    render();
  });
  document.getElementById('fSales').addEventListener('change', e => {
    STATE.filters.sales = e.target.value;
    render();
  });
  ['fMonth', 'fGrade', 'fProfit', 'fWos'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      const key = { fMonth: 'month', fGrade: 'grade', fProfit: 'profit', fWos: 'wos' }[id];
      STATE.filters[key] = e.target.value;
      render();
    });
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    STATE.filters = { quarter: 'q1', origin: 'ALL', sales: 'ALL', month: 'ALL', grade: 'ALL', profit: 'ALL', wos: 'W3' };
    STATE.expandedKey = null;
    STATE.expandedShipperKey = null;
    document.getElementById('fQuarter').value = 'q1';
    refreshSalesOptions();
    refreshMonthOptions();
    document.getElementById('fOrigin').value = 'ALL';
    document.getElementById('fSales').value = 'ALL';
    document.getElementById('fMonth').value = 'ALL';
    document.getElementById('fGrade').value = 'ALL';
    document.getElementById('fProfit').value = 'ALL';
    document.getElementById('fWos').value = 'W3';
    render();
  });
  $$('.view-tabs .vtab').forEach(el => el.addEventListener('click', () => {
    STATE.view = el.dataset.view;
    $$('.view-tabs .vtab').forEach(x => x.classList.toggle('active', x === el));
    render();
  }));
}

// ─── Filtered summary rows from index.json ───────────────────────
function filteredSummaryRows() {
  const { origin, sales } = STATE.filters;
  const rows = STATE.index?.rows || [];
  return rows.filter(r => {
    if (origin !== 'ALL' && r.tab !== origin) return false;
    if (r.row_type === 'TOTAL') return sales === 'ALL';
    if (sales !== 'ALL' && r.name !== sales) return false;
    return true;
  });
}

function kpiOfRow(r, quarter, kpiKey) {
  return r.kpi?.[kpiKey]?.[quarter] || { target: null, perform: null, progress: null, gap: null };
}

// Aggregate KPI across multiple rows (for filter scope summary cards).
// Aggregation rule: simple mean of available perform values weighted by accounts.total. Target uses same weighting.
// (This is approximate when filter spans multiple origins/salespeople; for the in-row values we always show the sheet's own number.)
function aggregateKpi(rows, quarter, kpiKey) {
  const performKey = quarter === 'q1' ? 'perform' : 'progress';
  let tw = 0, pw = 0, gw = 0, w = 0;
  rows.forEach(r => {
    if (r.row_type === 'TOTAL') return;
    const k = kpiOfRow(r, quarter, kpiKey);
    const weight = Math.max(1, r.accounts?.total || 1);
    if (k.target !== null && k.target !== undefined) { tw += k.target * weight; w += weight; }
    if (k[performKey] !== null && k[performKey] !== undefined) pw += k[performKey] * weight;
    if (k.gap !== null && k.gap !== undefined) gw += k.gap * weight;
  });
  if (w === 0) return { target: null, perform: null, gap: null };
  return { target: tw / w, perform: pw / w, gap: gw / w };
}

function renderKpiCards() {
  const rows = filteredSummaryRows();
  const sales = rows.filter(r => r.row_type === 'SALES');
  const origins = new Set(sales.map(r => r.tab));
  const totalAccounts = sales.reduce((s, r) => s + (r.accounts?.total || 0), 0);
  setText('cOrigin', origins.size ? origins.size : '0');
  setText('cSales', sales.length);
  setText('cCust', totalAccounts.toLocaleString());

  const q = STATE.filters.quarter;
  const bk = aggregateKpi(rows, q, 'booking');
  const lf = aggregateKpi(rows, q, 'lifting');
  const hp = aggregateKpi(rows, q, 'high_profit');
  setText('cBkT', fmtPct(bk.target));
  setText('cBkP', fmtPct(bk.perform));
  setText('cBkG', fmtPctSigned(bk.gap));
  setText('cLfT', fmtPct(lf.target));
  setText('cLfP', fmtPct(lf.perform));
  setText('cLfG', fmtPctSigned(lf.gap));
  setText('cHpT', fmtPct(hp.target));
  setText('cHpP', fmtPct(hp.perform));
  setText('cHpG', fmtPctSigned(hp.gap));
  for (const [id, val] of [['cBkG', bk.gap], ['cLfG', lf.gap], ['cHpG', hp.gap]]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove('pos', 'neg');
    if (val === null || val === undefined || Number.isNaN(val)) continue;
    el.classList.add(val >= 0 ? 'pos' : 'neg');
  }
}

// ─── View renderers ──────────────────────────────────────────────
function render() {
  renderKpiCards();
  const panel = document.getElementById('viewPanel');
  if (STATE.view === 'summary') panel.innerHTML = renderSummaryView();
  else if (STATE.view === 'drill') panel.innerHTML = renderDrillView();
  else panel.innerHTML = renderPivotView();
  attachRowHandlers();
}

// View 1: Target Summary — origin × salesperson, Target/Perform/Gap across 3 KPIs
function renderSummaryView() {
  const q = STATE.filters.quarter;
  const performLabel = q === 'q1' ? 'Perform' : 'Progress';
  const rows = filteredSummaryRows();
  if (!rows.length) {
    return `<div class="empty">필터 조건에 맞는 데이터가 없습니다.</div>`;
  }
  let h = `<div class="panel-header">
    <div class="panel-title">선적지 × 영업사원 — Target vs Performance (${q.toUpperCase()})</div>
    <div class="panel-actions"><span class="legend">
      <span><span class="swatch" style="background:#e6f4ea"></span>달성</span>
      <span><span class="swatch" style="background:#fef7e0"></span>-2%p 이내</span>
      <span><span class="swatch" style="background:#fce8e6"></span>미달</span>
    </span></div>
  </div>`;
  h += `<table class="dt"><thead><tr>
    <th rowspan="2">선적지</th>
    <th rowspan="2">영업사원</th>
    <th rowspan="2">'25 비중</th>
    <th colspan="3">3W Booking (vs BSA)</th>
    <th colspan="3">Actual Lifting Rate</th>
    <th colspan="3">High-Profit Rate</th>
    <th colspan="3">No. of A/C (Q1)</th>
  </tr><tr>
    <th>Target</th><th>${performLabel}</th><th>+/-</th>
    <th>Target</th><th>${performLabel}</th><th>+/-</th>
    <th>Target</th><th>${performLabel}</th><th>+/-</th>
    <th>Total</th><th>3W</th><th>%</th>
  </tr></thead><tbody>`;

  rows.forEach(r => {
    const bk = kpiOfRow(r, q, 'booking');
    const lf = kpiOfRow(r, q, 'lifting');
    const hp = kpiOfRow(r, q, 'high_profit');
    const performKey = q === 'q1' ? 'perform' : 'progress';
    const totalCls = r.row_type === 'TOTAL' ? ' row-total' : '';
    const clickAttr = r.row_type === 'SALES'
      ? ` data-action="drill" data-origin="${escapeHtml(r.tab)}" data-sales="${escapeHtml(r.name)}" class="row-clickable${totalCls}"`
      : ` class="${totalCls}"`;
    h += `<tr${clickAttr}>
      <td class="txt">${escapeHtml(r.tab)}</td>
      <td class="txt">${escapeHtml(r.name)}</td>
      <td>${fmtPct(r.share_2025)}</td>
      <td>${fmtPct(bk.target)}</td><td>${fmtPct(bk[performKey])}</td><td class="pct ${gapClass(bk.gap)}">${fmtPctSigned(bk.gap)}</td>
      <td>${fmtPct(lf.target)}</td><td>${fmtPct(lf[performKey])}</td><td class="pct ${gapClass(lf.gap)}">${fmtPctSigned(lf.gap)}</td>
      <td>${fmtPct(hp.target)}</td><td>${fmtPct(hp[performKey])}</td><td class="pct ${gapClass(hp.gap)}">${fmtPctSigned(hp.gap)}</td>
      <td>${fmtNum(r.accounts?.total)}</td>
      <td>${fmtNum(r.accounts?.w3)}</td>
      <td>${fmtPct(r.accounts?.pct)}</td>
    </tr>`;
  });
  h += '</tbody></table>';
  h += `<p style="margin-top:10px;font-size:11px;color:#80868b">행 클릭 → 해당 영업사원의 화주·BKG 상세 (② 탭으로 이동)</p>`;
  return h;
}

// View 2: Drill — pick (origin, salesperson), then load chunks for the quarter/month, show shipper table; click shipper -> BKG_NO list
function renderDrillView() {
  const { origin, sales } = STATE.filters;
  if (origin === 'ALL' || sales === 'ALL') {
    return `<div class="empty">상단 필터에서 <b>선적지</b>와 <b>영업사원</b>을 각각 하나씩 선택하거나, ① 탭의 행을 클릭하세요.</div>`;
  }
  const months = monthsForFilter();
  if (!months.length) return `<div class="empty">선택한 분기에 해당하는 월 데이터가 없습니다.</div>`;

  const containerId = `drill-${safeToken(origin)}-${safeToken(sales)}-${safeToken(STATE.filters.quarter)}`;
  // Trigger async load
  queueMicrotask(() => loadDrillData(origin, sales, months, containerId));
  return `<div class="crumbs">
      <span class="crumb active">${escapeHtml(origin)}</span>
      <span class="sep">›</span>
      <span class="crumb active">${escapeHtml(sales)}</span>
      <span class="sep">›</span>
      <span class="crumb">${escapeHtml(monthLabel(months))}</span>
    </div>
    <div id="${containerId}"><div class="loading">상세 데이터 로딩 중...</div></div>`;
}

function monthsForFilter() {
  const all = STATE.manifest.months || [];
  if (STATE.filters.month !== 'ALL') return all.filter(m => m === STATE.filters.month);
  return all.filter(m => (QUARTER_MONTHS[STATE.filters.quarter] || []).includes(m));
}
function monthLabel(months) {
  if (!months.length) return '-';
  if (months.length === 1) return formatMonth(months[0]);
  return `${formatMonth(months[0])} ~ ${formatMonth(months[months.length - 1])}`;
}
function formatMonth(yyyymm) {
  if (!yyyymm || yyyymm.length !== 6) return yyyymm;
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

async function loadChunk(origin, sales, yyyymm) {
  const key = `${origin}||${sales}||${yyyymm}`;
  if (STATE.chunkCache.has(key)) return STATE.chunkCache.get(key);
  const chunks = STATE.manifest.chunks || [];
  const meta = chunks.find(c => c.origin === origin && c.salesman === sales && c.yyyymm === yyyymm);
  if (!meta) return null;
  try {
    const data = await loadJson(meta.file);
    STATE.chunkCache.set(key, data);
    return data;
  } catch (err) {
    console.error('chunk load failed', meta.file, err);
    return null;
  }
}

async function loadDrillData(origin, sales, months, containerId) {
  const chunks = await Promise.all(months.map(m => loadChunk(origin, sales, m)));
  const valid = chunks.filter(Boolean);
  if (!valid.length) {
    document.getElementById(containerId).innerHTML = `<div class="empty">선택된 범위에서 ${escapeHtml(sales)}의 BKG 데이터를 찾지 못했습니다.</div>`;
    return;
  }
  const merged = mergeChunks(valid);
  // Tag with origin/salesman/yyyymm so the flat BKG list can show context columns.
  valid.forEach(chunk => {
    (chunk.bookings || []).forEach(b => {
      b.__origin = chunk.origin;
      b.__salesman = chunk.salesman;
      b.__yyyymm = chunk.yyyymm;
    });
  });
  const filtered = applyBookingFilters(merged.bookings);
  const shippers = aggregateShippers(filtered);
  STATE.drillBookings = filtered;
  document.getElementById(containerId).innerHTML =
    renderShipperTable(origin, sales, shippers, filtered) +
    renderAllMatchingBkgPanel(filtered, `${origin}__${sales}`);
  attachShipperHandlers(origin, sales, filtered);
  attachAllBkgPanelHandlers(filtered, `${origin}__${sales}`);
}

function mergeChunks(chunks) {
  const bookings = [];
  chunks.forEach(c => bookings.push(...(c.bookings || [])));
  return { bookings };
}

function applyBookingFilters(bookings) {
  const { grade, profit, wos } = STATE.filters;
  return bookings.filter(b => {
    if (wos === 'W3' && !b.is_w3) return false;
    if (profit === 'HI' && !b.is_hi) return false;
    if (profit === 'NOTHI' && b.is_hi) return false;
    if (grade !== 'ALL') {
      const g = (b.grade || '').charAt(0).toUpperCase();
      if (grade === 'AB' && !(g === 'A' || g === 'B')) return false;
      if (grade === 'CD' && !(g === 'C' || g === 'D')) return false;
      if (['A', 'B', 'C', 'D'].includes(grade) && g !== grade) return false;
    }
    return true;
  });
}

function aggregateShippers(bookings) {
  const map = new Map();
  bookings.forEach(b => {
    const key = b.shipper_no || b.shipper_name || '(unknown)';
    if (!map.has(key)) {
      map.set(key, {
        shipper_no: b.shipper_no,
        shipper_name: b.shipper_name,
        grade: b.grade,
        bkg_count: 0,
        fst_teu: 0,
        lst_teu: 0,
        cm1: 0,
        w3_fst: 0,
        w3_lst: 0,
        hi_w3_fst: 0,
        cancel_teu: 0,
        bkg_nos: new Set(),
      });
    }
    const s = map.get(key);
    s.bkg_count++;
    s.bkg_nos.add(b.bkg_no);
    s.fst_teu += b.fst_teu || 0;
    s.lst_teu += b.lst_teu || 0;
    s.cm1 += b.cm1 || 0;
    if (b.is_w3) {
      s.w3_fst += b.fst_teu || 0;
      s.w3_lst += b.lst_teu || 0;
      if (b.is_hi) s.hi_w3_fst += b.fst_teu || 0;
    }
    if (b.is_cancel) s.cancel_teu += b.fst_teu || 0;
    if (!s.grade && b.grade) s.grade = b.grade;
  });
  return Array.from(map.values())
    .map(s => ({
      ...s,
      bkg_count_unique: s.bkg_nos.size,
      lst_rate_w3: safeRatio(s.w3_lst, s.w3_fst),
      hi_share_w3: safeRatio(s.hi_w3_fst, s.w3_fst),
      cm1_per_teu: safeRatio(s.cm1, s.lst_teu),
    }))
    .sort((a, b) => b.fst_teu - a.fst_teu);
}

function renderShipperTable(origin, sales, shippers, bookings) {
  if (!shippers.length) {
    return `<div class="empty">필터 조건에 맞는 화주가 없습니다. (등급/고수익/WOS 필터를 확인하세요)</div>`;
  }
  const totals = {
    bkg: shippers.reduce((s, r) => s + r.bkg_count, 0),
    bkgU: shippers.reduce((s, r) => s + r.bkg_count_unique, 0),
    fst: shippers.reduce((s, r) => s + r.fst_teu, 0),
    lst: shippers.reduce((s, r) => s + r.lst_teu, 0),
    w3fst: shippers.reduce((s, r) => s + r.w3_fst, 0),
    w3lst: shippers.reduce((s, r) => s + r.w3_lst, 0),
    w3hi: shippers.reduce((s, r) => s + r.hi_w3_fst, 0),
    cm1: shippers.reduce((s, r) => s + r.cm1, 0),
  };
  const lstRate = safeRatio(totals.w3lst, totals.w3fst);
  const hiShare = safeRatio(totals.w3hi, totals.w3fst);

  let h = `<div class="panel-header">
    <div class="panel-title">화주별 실적 — ${escapeHtml(origin)} · ${escapeHtml(sales)} (${escapeHtml(monthLabel(monthsForFilter()))})</div>
    <div class="panel-actions">화주 ${shippers.length}개 · BKG ${fmtNum(totals.bkg)}건 · 고유 BKG_NO ${fmtNum(totals.bkgU)}건</div>
  </div>
  <table class="dt"><thead><tr>
    <th>화주</th><th>등급</th><th>고유 BKG_NO</th><th>BKG 건</th><th>FST TEU</th><th>LST TEU</th><th>WOS-3 FST</th><th>WOS-3 LST</th><th>실선적률(W3)</th><th>고수익 비중(W3)</th><th>CM1</th>
  </tr></thead><tbody>`;
  shippers.forEach((s, i) => {
    h += `<tr class="row-clickable" data-action="shipper-toggle" data-shipper-key="${escapeHtml(s.shipper_no || s.shipper_name)}" data-idx="${i}">
      <td class="txt">${escapeHtml(s.shipper_name || s.shipper_no || '-')} <span style="color:#80868b;font-size:10px">${escapeHtml(s.shipper_no || '')}</span></td>
      <td>${gradeBadge(s.grade)}</td>
      <td>${fmtNum(s.bkg_count_unique)}</td>
      <td>${fmtNum(s.bkg_count)}</td>
      <td>${fmtNum(s.fst_teu)}</td>
      <td>${fmtNum(s.lst_teu)}</td>
      <td>${fmtNum(s.w3_fst)}</td>
      <td>${fmtNum(s.w3_lst)}</td>
      <td class="pct">${fmtPct(s.lst_rate_w3)}</td>
      <td class="pct">${fmtPct(s.hi_share_w3)}</td>
      <td>${fmtNum(s.cm1)}</td>
    </tr>`;
  });
  h += `<tr class="row-total">
      <td class="txt">합계</td><td></td>
      <td>${fmtNum(totals.bkgU)}</td>
      <td>${fmtNum(totals.bkg)}</td>
      <td>${fmtNum(totals.fst)}</td>
      <td>${fmtNum(totals.lst)}</td>
      <td>${fmtNum(totals.w3fst)}</td>
      <td>${fmtNum(totals.w3lst)}</td>
      <td class="pct">${fmtPct(lstRate)}</td>
      <td class="pct">${fmtPct(hiShare)}</td>
      <td>${fmtNum(totals.cm1)}</td>
    </tr></tbody></table>
    <p style="margin-top:10px;font-size:11px;color:#80868b">화주 행 클릭 → 해당 화주의 BKG_NO 리스트 펼침</p>`;
  return h;
}

function attachShipperHandlers(origin, sales, bookings) {
  document.querySelectorAll('[data-action="shipper-toggle"]').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.shipperKey;
      const idx = Number(row.dataset.idx);
      const existing = document.querySelector(`tr.detail-row[data-key="${CSS.escape(key)}"]`);
      if (existing) { existing.remove(); return; }
      // Close other open details
      document.querySelectorAll('tr.detail-row').forEach(r => r.remove());
      const detail = document.createElement('tr');
      detail.className = 'detail-row';
      detail.dataset.key = key;
      const cell = document.createElement('td');
      cell.colSpan = 11;
      cell.innerHTML = renderBkgDetail(key, bookings);
      detail.appendChild(cell);
      row.parentNode.insertBefore(detail, row.nextSibling);
    });
  });
}

// ─── "전체 매칭 BKG 보기" panel — flat list across all shippers in current scope ─
function renderAllMatchingBkgPanel(bookings, scopeKey) {
  const total = bookings.length;
  const filterDesc = describeActiveFilters();
  return `<div class="all-bkg-panel" data-scope="${escapeHtml(scopeKey)}" style="margin-top:14px;border:1px solid #dadce0;border-radius:8px;background:#fff">
    <div class="all-bkg-head" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:#f8fafd;border-radius:8px 8px 0 0;cursor:pointer" data-action="toggle-all-bkg">
      <div>
        <span style="font-weight:600;color:#202124">조건에 맞는 전체 BKG_NO 보기</span>
        <span style="margin-left:10px;font-size:12px;color:#5f6368">${fmtNum(total)}건 · ${filterDesc}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="reset" data-action="export-all-bkg" type="button" style="padding:4px 10px">CSV 내보내기</button>
        <span class="chev" style="font-size:14px;color:#5f6368">▾</span>
      </div>
    </div>
    <div class="all-bkg-body" style="display:none;padding:10px 14px"></div>
  </div>`;
}

function describeActiveFilters() {
  const parts = [];
  const f = STATE.filters;
  parts.push(`분기 ${f.quarter.toUpperCase()}`);
  if (f.month !== 'ALL') parts.push(`월 ${formatMonth(f.month)}`);
  if (f.origin !== 'ALL') parts.push(`선적지 ${f.origin}`);
  if (f.sales !== 'ALL') parts.push(`영업사원 ${f.sales}`);
  if (f.grade !== 'ALL') parts.push(`등급 ${f.grade}`);
  if (f.profit !== 'ALL') parts.push(f.profit === 'HI' ? '고수익만' : '고수익 제외');
  if (f.wos === 'W3') parts.push('WOS-3'); else parts.push('WOS 전체');
  return parts.join(' · ');
}

function buildFlatBkgTable(bookings) {
  if (!bookings.length) return `<div class="empty">조건에 맞는 BKG가 없습니다.</div>`;
  const sorted = bookings.slice().sort((a, b) => (b.fst_teu || 0) - (a.fst_teu || 0));
  const cap = 1000;
  const limited = sorted.slice(0, cap);
  let h = '';
  if (sorted.length > cap) {
    h += `<div style="font-size:11px;color:#b06000;margin-bottom:8px">대용량(${fmtNum(sorted.length)}건)이라 상위 ${fmtNum(cap)}건만 표시합니다. 전체는 CSV 내보내기를 사용하세요.</div>`;
  }
  h += `<table class="dt"><thead><tr>
    <th>BKG_NO</th><th>선적지</th><th>영업사원</th><th>월</th>
    <th>화주</th><th>등급</th><th>POL→POD</th><th>VSL/VOY</th>
    <th>Booking</th><th>FST TEU</th><th>LST TEU</th><th>CM1</th><th>CM1/TEU</th>
    <th>WOS</th><th>고수익</th><th>상태</th>
  </tr></thead><tbody>`;
  limited.forEach(b => {
    const route = `${escapeHtml(b.pol || '')}→${escapeHtml(b.pod || '')}${b.dly_plc && b.dly_plc !== b.pod ? '/' + escapeHtml(b.dly_plc) : ''}`;
    const vsl = `${escapeHtml(b.vsl || b.lst_vsl || '')}/${escapeHtml(b.voy || b.lst_voy || '')}`;
    const statusClass = (b.is_cancel ? 'lst-status-캔슬' : (b.is_lifted ? 'lst-status-실선적' : ''));
    h += `<tr>
      <td><span class="bkg-no">${escapeHtml(b.bkg_no)}</span></td>
      <td class="txt">${escapeHtml(b.__origin || '')}</td>
      <td class="txt">${escapeHtml(b.__salesman || '')}</td>
      <td>${escapeHtml(b.__yyyymm ? formatMonth(b.__yyyymm) : '')}</td>
      <td class="txt">${escapeHtml(b.shipper_name || b.shipper_no || '-')} <span style="color:#80868b;font-size:10px">${escapeHtml(b.shipper_no || '')}</span></td>
      <td>${gradeBadge(b.grade)}</td>
      <td class="txt">${route}</td>
      <td class="txt">${vsl}</td>
      <td>${escapeHtml(b.booking_date)}</td>
      <td>${fmtNum(b.fst_teu)}</td>
      <td>${fmtNum(b.lst_teu)}</td>
      <td>${fmtNum(b.cm1)}</td>
      <td>${fmtNum(b.cm1_per_teu, 0)}</td>
      <td>${escapeHtml(b.lead_time_bkg_sche || '')}</td>
      <td>${b.is_hi ? '<span class="hi-tag">HI</span>' : ''}</td>
      <td class="${statusClass}">${escapeHtml(b.lst_status || '')}</td>
    </tr>`;
  });
  h += '</tbody></table>';
  return h;
}

function attachAllBkgPanelHandlers(bookings, scopeKey) {
  const panel = document.querySelector(`.all-bkg-panel[data-scope="${CSS.escape(scopeKey)}"]`);
  if (!panel) return;
  const body = panel.querySelector('.all-bkg-body');
  const chev = panel.querySelector('.chev');
  panel.querySelector('[data-action="toggle-all-bkg"]').addEventListener('click', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.action === 'export-all-bkg') return;
    if (body.style.display === 'none') {
      if (!body.dataset.rendered) {
        body.innerHTML = buildFlatBkgTable(bookings);
        body.dataset.rendered = '1';
      }
      body.style.display = 'block';
      chev.textContent = '▴';
    } else {
      body.style.display = 'none';
      chev.textContent = '▾';
    }
  });
  panel.querySelector('[data-action="export-all-bkg"]').addEventListener('click', (e) => {
    e.stopPropagation();
    exportBkgListAsCsv(bookings, `bkg_${scopeKey}_${STATE.filters.quarter}_${new Date().toISOString().slice(0,10)}.csv`);
  });
}

function exportBkgListAsCsv(bookings, filename) {
  const headers = [
    'BKG_NO','origin','salesman','yyyymm','shipper_no','shipper_name','grade',
    'pol','pod','dly_plc','vsl','voy','lst_vsl','lst_voy','lst_route',
    'booking_date','booking_schedule','cancel_date','week_start','lead_time_bkg_sche',
    'fst_teu','lst_teu','cm1','cm1_per_teu','is_w3','is_hi','is_lifted','is_cancel','lst_status'
  ];
  const lines = [headers.join(',')];
  bookings.forEach(b => {
    const row = [
      b.bkg_no, b.__origin, b.__salesman, b.__yyyymm, b.shipper_no, b.shipper_name, b.grade,
      b.pol, b.pod, b.dly_plc, b.vsl, b.voy, b.lst_vsl, b.lst_voy, b.lst_route,
      b.booking_date, b.booking_schedule, b.cancel_date, b.week_start_date, b.lead_time_bkg_sche,
      b.fst_teu, b.lst_teu, b.cm1, b.cm1_per_teu, b.is_w3, b.is_hi, b.is_lifted, b.is_cancel, b.lst_status
    ].map(v => csvEscape(v));
    lines.push(row.join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function renderBkgDetail(shipperKey, allBookings) {
  const bks = allBookings.filter(b => (b.shipper_no || b.shipper_name) === shipperKey);
  if (!bks.length) return `<div class="detail-box"><div class="empty">BKG 없음</div></div>`;
  bks.sort((a, b) => (b.week_start_date || '').localeCompare(a.week_start_date || ''));
  let h = `<div class="detail-box"><h4>BKG_NO 상세 (${bks.length}건)</h4>
    <table class="dt"><thead><tr>
      <th>BKG_NO</th><th>POL→POD</th><th>VSL/VOY</th><th>Booking일</th><th>FST TEU</th><th>LST TEU</th><th>CM1</th><th>CM1/TEU</th><th>WOS</th><th>등급</th><th>고수익</th><th>상태</th>
    </tr></thead><tbody>`;
  bks.forEach(b => {
    const route = `${escapeHtml(b.pol || '')}→${escapeHtml(b.pod || '')}${b.dly_plc && b.dly_plc !== b.pod ? '/' + escapeHtml(b.dly_plc) : ''}`;
    const vsl = `${escapeHtml(b.vsl || b.lst_vsl || '')}/${escapeHtml(b.voy || b.lst_voy || '')}`;
    const statusClass = (b.is_cancel ? 'lst-status-캔슬' : (b.is_lifted ? 'lst-status-실선적' : ''));
    h += `<tr>
      <td><span class="bkg-no">${escapeHtml(b.bkg_no)}</span></td>
      <td class="txt">${route}</td>
      <td class="txt">${vsl}</td>
      <td>${escapeHtml(b.booking_date)}</td>
      <td>${fmtNum(b.fst_teu)}</td>
      <td>${fmtNum(b.lst_teu)}</td>
      <td>${fmtNum(b.cm1)}</td>
      <td>${fmtNum(b.cm1_per_teu, 0)}</td>
      <td>${escapeHtml(b.lead_time_bkg_sche || '')}</td>
      <td>${gradeBadge(b.grade)}</td>
      <td>${b.is_hi ? '<span class="hi-tag">HI</span>' : ''}</td>
      <td class="${statusClass}">${escapeHtml(b.lst_status || '')}</td>
    </tr>`;
  });
  h += '</tbody></table></div>';
  return h;
}

// View 3: Pivot — user-selected row / column dimensions over BKG-level booking data
function renderPivotView() {
  const months = monthsForFilter();
  const allOriginsScope = STATE.filters.origin === 'ALL';
  const allSalesScope = STATE.filters.sales === 'ALL';
  // Performance warning: full-cube load can be heavy. Recommend narrowing.
  const chunkEstimate = (STATE.manifest.chunks || []).filter(c => {
    if (STATE.filters.origin !== 'ALL' && c.origin !== STATE.filters.origin) return false;
    if (STATE.filters.sales !== 'ALL' && c.salesman !== STATE.filters.sales) return false;
    return months.includes(c.yyyymm);
  }).length;
  const containerId = 'pivot-body';
  let h = `<div class="pivot-config">
    <span>행:</span>
    <select id="pivotRow">
      <option value="origin">선적지</option>
      <option value="salesman">영업사원</option>
      <option value="shipper">화주</option>
      <option value="grade">등급</option>
      <option value="pod_country">POD 국가</option>
      <option value="pod">POD 항구</option>
      <option value="yyyymm">월</option>
    </select>
    <span style="margin-left:8px">열:</span>
    <select id="pivotCol">
      <option value="-">(없음)</option>
      <option value="yyyymm">월</option>
      <option value="origin">선적지</option>
      <option value="salesman">영업사원</option>
      <option value="grade">등급</option>
      <option value="pod_country">POD 국가</option>
      <option value="hi">고수익 여부</option>
      <option value="wos">WOS 단계</option>
    </select>
    <span style="margin-left:8px">값:</span>
    <select id="pivotMetric">
      <option value="fst">FST TEU</option>
      <option value="lst">LST TEU</option>
      <option value="w3_fst">WOS-3 FST TEU</option>
      <option value="w3_lst">WOS-3 LST TEU</option>
      <option value="bkg_count">BKG 건수</option>
      <option value="bkg_unique">고유 BKG_NO</option>
      <option value="shipper_unique">화주 수</option>
      <option value="cm1">CM1</option>
      <option value="cm1_per_teu">CM1/TEU</option>
    </select>
    <span style="margin-left:auto;color:#80868b">스코프: ${chunkEstimate} chunks</span>
  </div>`;
  if (chunkEstimate > 200) {
    h += `<div class="error-banner">현재 필터 범위가 ${chunkEstimate}개 chunk 입니다. 응답이 느릴 수 있습니다. 선적지·영업사원·분기 필터로 범위를 좁히는 것을 권장합니다.</div>`;
  }
  h += `<div id="${containerId}"><div class="loading">Pivot 데이터 준비 중...</div></div>`;
  queueMicrotask(() => {
    document.getElementById('pivotRow').value = STATE.pivot.row;
    document.getElementById('pivotCol').value = STATE.pivot.col;
    document.getElementById('pivotMetric').value = STATE.pivot.metric;
    ['pivotRow', 'pivotCol', 'pivotMetric'].forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        const key = { pivotRow: 'row', pivotCol: 'col', pivotMetric: 'metric' }[id];
        STATE.pivot[key] = e.target.value;
        rebuildPivot(containerId);
      });
    });
    rebuildPivot(containerId);
  });
  return h;
}

async function rebuildPivot(containerId) {
  const months = monthsForFilter();
  const chunkList = (STATE.manifest.chunks || []).filter(c => {
    if (STATE.filters.origin !== 'ALL' && c.origin !== STATE.filters.origin) return false;
    if (STATE.filters.sales !== 'ALL' && c.salesman !== STATE.filters.sales) return false;
    return months.includes(c.yyyymm);
  });
  const el = document.getElementById(containerId);
  if (!chunkList.length) { el.innerHTML = `<div class="empty">선택된 범위의 chunk가 없습니다.</div>`; return; }
  el.innerHTML = `<div class="loading">Pivot ${chunkList.length}개 chunk 집계 중...</div>`;
  const loaded = await Promise.all(chunkList.map(c => loadChunk(c.origin, c.salesman, c.yyyymm)));
  const valid = loaded.filter(Boolean);
  // gather bookings with origin/salesman context attached
  const bookings = [];
  valid.forEach((chunk, i) => {
    (chunk.bookings || []).forEach(b => bookings.push({ ...b, __origin: chunk.origin, __salesman: chunk.salesman, __yyyymm: chunk.yyyymm }));
  });
  const filtered = applyBookingFilters(bookings);
  el.innerHTML = renderPivotTable(filtered);
}

function pivotKeyOf(b, dim) {
  switch (dim) {
    case 'origin': return b.__origin;
    case 'salesman': return b.__salesman;
    case 'yyyymm': return b.__yyyymm;
    case 'shipper': return b.shipper_name || b.shipper_no || '-';
    case 'grade': return (b.grade || '-').charAt(0).toUpperCase() || '-';
    case 'pod_country': return b.pod_country || '-';
    case 'pod': return b.pod || '-';
    case 'hi': return b.is_hi ? '고수익' : '일반';
    case 'wos': return b.lead_time_bkg_sche || '(미분류)';
    default: return '-';
  }
}

function pivotAggregate(rows, metric) {
  const init = { fst: 0, lst: 0, w3_fst: 0, w3_lst: 0, bkg_count: 0, bkg_no_set: new Set(), shipper_set: new Set(), cm1: 0 };
  rows.forEach(b => {
    init.fst += b.fst_teu || 0;
    init.lst += b.lst_teu || 0;
    if (b.is_w3) { init.w3_fst += b.fst_teu || 0; init.w3_lst += b.lst_teu || 0; }
    init.bkg_count++;
    if (b.bkg_no) init.bkg_no_set.add(b.bkg_no);
    if (b.shipper_no || b.shipper_name) init.shipper_set.add(b.shipper_no || b.shipper_name);
    init.cm1 += b.cm1 || 0;
  });
  switch (metric) {
    case 'fst': return init.fst;
    case 'lst': return init.lst;
    case 'w3_fst': return init.w3_fst;
    case 'w3_lst': return init.w3_lst;
    case 'bkg_count': return init.bkg_count;
    case 'bkg_unique': return init.bkg_no_set.size;
    case 'shipper_unique': return init.shipper_set.size;
    case 'cm1': return init.cm1;
    case 'cm1_per_teu': return init.lst ? init.cm1 / init.lst : 0;
    default: return 0;
  }
}

function renderPivotTable(bookings) {
  const { row, col, metric } = STATE.pivot;
  if (!bookings.length) return `<div class="empty">데이터 없음 (필터 확인)</div>`;
  // Build row x col cube
  const cube = new Map(); // rowKey -> Map(colKey -> bookings[])
  const rowKeys = new Set();
  const colKeys = new Set();
  bookings.forEach(b => {
    const rk = pivotKeyOf(b, row);
    const ck = col === '-' ? '__total__' : pivotKeyOf(b, col);
    rowKeys.add(rk);
    colKeys.add(ck);
    if (!cube.has(rk)) cube.set(rk, new Map());
    const inner = cube.get(rk);
    if (!inner.has(ck)) inner.set(ck, []);
    inner.get(ck).push(b);
  });
  const rowOrder = Array.from(rowKeys).sort();
  const colOrder = col === '-' ? ['__total__'] : Array.from(colKeys).sort();
  const fmt = metric === 'cm1_per_teu' ? v => fmtNum(v, 0)
            : (metric === 'bkg_count' || metric === 'bkg_unique' || metric === 'shipper_unique') ? v => fmtNum(v, 0)
            : v => fmtNum(v, 0);

  // Persist cube on STATE so pivot cell click handlers can resolve the BKG subset.
  STATE.pivotCube = cube;
  STATE.pivotColOrder = colOrder;
  STATE.pivotRowOrder = rowOrder;

  let h = `<div style="font-size:11px;color:#80868b;margin-bottom:6px">셀 클릭 → 해당 조건에 맞는 BKG_NO 리스트 보기</div>`;
  h += `<table class="dt"><thead><tr><th>${escapeHtml(rowLabel(row))}</th>`;
  colOrder.forEach(ck => h += `<th>${ck === '__total__' ? '합계' : escapeHtml(ck)}</th>`);
  if (col !== '-') h += '<th>합계</th>';
  h += '</tr></thead><tbody>';
  // Compute column totals
  const colTotals = {};
  rowOrder.forEach(rk => {
    h += `<tr><td class="txt">${escapeHtml(rk)}</td>`;
    let rowTotalBookings = [];
    colOrder.forEach(ck => {
      const bks = cube.get(rk)?.get(ck) || [];
      rowTotalBookings = rowTotalBookings.concat(bks);
      const val = pivotAggregate(bks, metric);
      colTotals[ck] = (colTotals[ck] || []).concat(bks);
      const clickable = bks.length ? ` class="pivot-cell row-clickable" data-rk="${escapeHtml(rk)}" data-ck="${escapeHtml(ck)}"` : '';
      h += `<td${clickable}>${fmt(val)}</td>`;
    });
    if (col !== '-') {
      h += `<td class="pct pivot-cell row-clickable" data-rk="${escapeHtml(rk)}" data-ck="__row_total__">${fmt(pivotAggregate(rowTotalBookings, metric))}</td>`;
    }
    h += '</tr>';
  });
  h += `<tr class="row-total"><td class="txt">합계</td>`;
  let grandList = [];
  colOrder.forEach(ck => {
    const list = colTotals[ck] || [];
    grandList = grandList.concat(list);
    h += `<td class="pivot-cell row-clickable" data-rk="__col_total__" data-ck="${escapeHtml(ck)}">${fmt(pivotAggregate(list, metric))}</td>`;
  });
  if (col !== '-') h += `<td class="pivot-cell row-clickable" data-rk="__grand__" data-ck="__grand__">${fmt(pivotAggregate(grandList, metric))}</td>`;
  h += '</tr>';
  h += '</tbody></table>';
  // Reserved area for click-expansion BKG list
  h += `<div id="pivotBkgPanel" style="margin-top:14px"></div>`;
  // attach cell handlers next frame
  queueMicrotask(() => attachPivotCellHandlers(bookings, colTotals));
  return h;
}

function attachPivotCellHandlers(bookings, colTotals) {
  document.querySelectorAll('.pivot-cell').forEach(cell => {
    cell.style.cursor = 'pointer';
    cell.addEventListener('click', () => {
      const rk = cell.dataset.rk;
      const ck = cell.dataset.ck;
      let subset = [];
      if (rk === '__grand__' && ck === '__grand__') {
        subset = bookings;
      } else if (rk === '__col_total__') {
        subset = colTotals[ck] || [];
      } else if (ck === '__row_total__') {
        const innerMap = STATE.pivotCube.get(rk);
        if (innerMap) for (const list of innerMap.values()) subset = subset.concat(list);
      } else {
        subset = (STATE.pivotCube.get(rk)?.get(ck)) || [];
      }
      const panel = document.getElementById('pivotBkgPanel');
      const label = `행 ${rk === '__col_total__' ? '합계' : rk} · 열 ${ck === '__row_total__' || ck === '__total__' ? '합계' : ck}`;
      panel.innerHTML = renderPivotCellDetail(subset, label);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const exp = panel.querySelector('[data-action="export-pivot-cell"]');
      if (exp) exp.addEventListener('click', () => exportBkgListAsCsv(subset, `pivot_${safeToken(rk)}_${safeToken(ck)}_${new Date().toISOString().slice(0,10)}.csv`));
      const close = panel.querySelector('[data-action="close-pivot-cell"]');
      if (close) close.addEventListener('click', () => { panel.innerHTML = ''; });
    });
  });
}

function renderPivotCellDetail(subset, label) {
  return `<div style="border:1px solid #dadce0;border-radius:8px;background:#fff;padding:0;overflow:hidden">
    <div style="padding:10px 14px;background:#f8fafd;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dadce0">
      <div><b>Pivot 셀 상세</b> <span style="color:#5f6368;font-size:12px;margin-left:8px">${escapeHtml(label)} · ${fmtNum(subset.length)}건</span></div>
      <div style="display:flex;gap:6px">
        <button class="reset" data-action="export-pivot-cell" type="button">CSV 내보내기</button>
        <button class="reset" data-action="close-pivot-cell" type="button">닫기</button>
      </div>
    </div>
    <div style="padding:10px 14px">${buildFlatBkgTable(subset)}</div>
  </div>`;
}

function rowLabel(dim) {
  return ({
    origin: '선적지', salesman: '영업사원', shipper: '화주', grade: '등급',
    pod_country: 'POD 국가', pod: 'POD 항구', yyyymm: '월',
    hi: '고수익', wos: 'WOS 단계',
  }[dim]) || dim;
}

function attachRowHandlers() {
  document.querySelectorAll('[data-action="drill"]').forEach(row => {
    row.addEventListener('click', () => {
      STATE.filters.origin = row.dataset.origin;
      STATE.filters.sales = row.dataset.sales;
      document.getElementById('fOrigin').value = STATE.filters.origin;
      refreshSalesOptions();
      document.getElementById('fSales').value = STATE.filters.sales;
      STATE.view = 'drill';
      $$('.view-tabs .vtab').forEach(el => el.classList.toggle('active', el.dataset.view === 'drill'));
      render();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
