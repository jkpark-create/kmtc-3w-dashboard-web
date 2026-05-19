// ═════════════════════════════════════════════════════════════════
// Sales Target & Progress drill-down
//   - index.json   : target/performance/gap per (origin, salesman) from Summary_All
//   - manifest.json: catalog of {origin, salesman, yyyymm} -> file mapping
//   - data/*.json  : per-chunk shipper aggregates + BKG_NO list (lazy load)
// ═════════════════════════════════════════════════════════════════

// Whitelist of countries / ports allowed in filters. Anything outside this list
// is excluded from the Country/Port dropdowns (and from the resulting query scope).
const WHITELIST_ORIGINS = [
  { country: 'CN', label: { ko: '중국 / China', en: 'China' }, ports: ['CN_SHA','CN_NBO','CN_TAO','CN_XGG','CN_DLC','CN_LYG','CN_SHK_DCB','CN_XMN','CN_NNS'] },
  { country: 'HK', label: { ko: '홍콩 / Hong Kong', en: 'Hong Kong' }, ports: ['HK'] },
  { country: 'TW', label: { ko: '대만 / Taiwan', en: 'Taiwan' }, ports: ['TW'] },
  { country: 'TH', label: { ko: '태국 / Thailand', en: 'Thailand' }, ports: ['TH'] },
  { country: 'VN', label: { ko: '베트남 / Vietnam', en: 'Vietnam' }, ports: ['VN_SGN_CMP','VN_HPH'] },
  { country: 'PH', label: { ko: '필리핀 / Philippines', en: 'Philippines' }, ports: ['PH'] },
  { country: 'MY', label: { ko: '말레이시아 / Malaysia', en: 'Malaysia' }, ports: ['PKG+PKW','PEN','PGU'] },
  { country: 'SG', label: { ko: '싱가포르 / Singapore', en: 'Singapore' }, ports: ['SG'] },
  { country: 'ID', label: { ko: '인도네시아 / Indonesia', en: 'Indonesia' }, ports: ['JKT','SUB'] },
  { country: 'IN', label: { ko: '인도 / India', en: 'India' }, ports: ['IN'] },
  { country: 'AE', label: { ko: 'UAE', en: 'UAE' }, ports: ['AE'] },
];
const COUNTRY_OF_PORT = (() => {
  const m = new Map();
  WHITELIST_ORIGINS.forEach(c => c.ports.forEach(p => m.set(p, c.country)));
  return m;
})();
const ALL_WHITELIST_PORTS = WHITELIST_ORIGINS.flatMap(c => c.ports);

const STATE = {
  index: null,
  manifest: null,
  chunkCache: new Map(),
  view: 'summary',
  expandedKey: null,  // "<origin>||<salesman>" for drill view
  expandedShipperKey: null,
  filters: {
    quarter: 'q1',
    countries: [],     // [] = no country filter (all whitelist countries)
    origins: [],       // [] = no port filter (all whitelist ports, narrowed by countries)
    destCountries: [], // [] = no dest country filter
    destPorts: [],     // [] = no dest port filter
    sales: [],         // [] = all salespeople in current origin scope
    month: 'ALL',
    grade: 'ALL',
    profit: 'ALL',
    wos: 'W3',
  },
  pivot: { row: 'origin', col: 'metric', metric: 'fst' },
  initialUrlParams: null,
  lang: 'ko',
  multiSelect: {}, // id -> { values: Set, options: [...], onChange, refresh, render }
};

// Effective origin scope: ports the user wants to see, intersected with whitelist.
function effectiveOrigins() {
  const { countries, origins } = STATE.filters;
  let allowed = ALL_WHITELIST_PORTS;
  if (countries.length) {
    const c = new Set(countries);
    allowed = allowed.filter(p => c.has(COUNTRY_OF_PORT.get(p)));
  }
  if (origins.length) {
    const o = new Set(origins);
    allowed = allowed.filter(p => o.has(p));
  }
  return new Set(allowed);
}

const I18N = {
  ko: {
    title: 'Sales Target & Progress',
    backDash: '← -3W Booking Dashboard',
    workbook: 'Target Workbook ↗',
    guide: '📖 가이드',
    fQuarter: '분기', fCountry: '선적국가', fOrigin: '선적포트',
    fDestCountry: '도착국가', fDestPort: '도착포트',
    fSales: '영업사원', fMonth: '월(상세)',
    fGrade: '등급', fProfit: '고수익', fWos: 'WOS',
    btnReset: '필터 초기화',
    all: '전체', msAll: '전체', msNone: '해제', msSearch: '검색...',
    msPlaceholder: '전체', msSelected: (n) => `${n}개 선택`,
    msNoOptions: '선택 가능한 항목이 없습니다',
    msPickedAll: (n) => `전체 ${n}개`,
    salesHint: '전체 (선적지 선택 시 좁힘)',
    salesHintNarrowed: (n) => `${n}명 (선적지 기준)`,
    monthAll: '전체 (분기 합산)',
    profitHi: '고수익만', profitNotHi: '고수익 제외',
    q2Label: '2Q 2026 (Progress)',
    cardScope: '대상 영업사원', originCount: '선적지', salesCount: '영업사원', custCount: '화주 (A/C)',
    bkLabel: '3W Before Booking Rate (vs BSA)',
    lfLabel: '3W Before Actual Lifting Rate',
    hpLabel: '3W Before High-Profit Rate',
    kT: 'Target', kP: 'Perform',
    vSummary: '① Target 요약 (선적지 × 영업사원)',
    vDrill: '② 영업사원 → 화주 → BKG 상세',
    vPivot: '③ 조합 Pivot',
    legendOk: '달성', legendWarn: '-2%p 이내', legendNeg: '미달',
    panelTitleSummary: '선적지 × 영업사원 — Target vs Performance',
    cluePivot: '셀 클릭 → 해당 조건에 맞는 BKG_NO 리스트 보기',
    clueDrill: '행 클릭 → 해당 영업사원의 화주·BKG 상세 (② 탭으로 이동)',
    clueShipper: '화주 행 클릭 → 해당 화주의 BKG_NO 리스트 펼침',
    pickOriginSales: '상단 필터에서 <b>선적지</b>와 <b>영업사원</b>을 각각 하나씩 선택하거나, ① 탭의 행을 클릭하세요.',
    noChunks: '선택한 분기에 해당하는 월 데이터가 없습니다.',
    noMatches: '필터 조건에 맞는 데이터가 없습니다.',
    noShipper: '필터 조건에 맞는 화주가 없습니다. (등급/고수익/WOS 필터를 확인하세요)',
    loadingDetail: '상세 데이터 로딩 중...',
    panelAllBkg: '조건에 맞는 전체 BKG_NO 보기',
    btnCsv: 'CSV 내보내기', btnClose: '닫기',
    pivotScope: '스코프', pivotRowLabel: '행', pivotColLabel: '열', pivotMetric: '값', pivotNone: '(없음)',
    pivotHeavy: (n) => `현재 필터 범위가 ${n}개 chunk 입니다. 응답이 느릴 수 있습니다. 선적지·영업사원·분기 필터로 범위를 좁히는 것을 권장합니다.`,
    pivotCellDetail: 'Pivot 셀 상세',
    columns: {
      origin: '선적지', sales: '영업사원', share25: "'25 비중",
      bk3w: '3W Booking (vs BSA)', lf3w: 'Actual Lifting Rate', hp3w: 'High-Profit Rate',
      ac: 'No. of A/C (Q1)', acTotal: 'Total', ac3w: '3W', acPct: '%',
      target: 'Target', perform: 'Perform', progress: 'Progress', gap: '+/-',
      shipper: '화주', grade: '등급', bkgUnique: '고유 BKG_NO', bkgCnt: 'BKG 건',
      fstTeu: 'FST TEU', lstTeu: 'LST TEU', w3fst: 'WOS-3 FST', w3lst: 'WOS-3 LST',
      lstRate: '실선적률(W3)', hiShare: '고수익 비중(W3)', cm1: 'CM1',
      bkgNo: 'BKG_NO', month: '월', polPod: 'POL→POD', vslVoy: 'VSL/VOY',
      booking: 'Booking', wos: 'WOS', hi: '고수익', status: '상태', cm1PerTeu: 'CM1/TEU',
      totalLabel: '합계',
    },
    dimNames: { origin: '선적지', salesman: '영업사원', shipper: '화주', grade: '등급', pod_country: 'POD 국가', pod: 'POD 항구', yyyymm: '월', hi: '고수익', wos: 'WOS 단계' },
    metricNames: { fst: 'FST TEU', lst: 'LST TEU', w3_fst: 'WOS-3 FST TEU', w3_lst: 'WOS-3 LST TEU', bkg_count: 'BKG 건수', bkg_unique: '고유 BKG_NO', shipper_unique: '화주 수', cm1: 'CM1', cm1_per_teu: 'CM1/TEU' },
  },
  en: {
    title: 'Sales Target & Progress',
    backDash: '← -3W Booking Dashboard',
    workbook: 'Target Workbook ↗',
    guide: '📖 Guide',
    fQuarter: 'Quarter', fCountry: 'Origin country', fOrigin: 'Origin port',
    fDestCountry: 'Dest country', fDestPort: 'Dest port',
    fSales: 'Salesperson', fMonth: 'Month',
    fGrade: 'Grade', fProfit: 'Hi-Profit', fWos: 'WOS',
    btnReset: 'Reset filters',
    all: 'All', msAll: 'Select all', msNone: 'Clear', msSearch: 'Search...',
    msPlaceholder: 'All', msSelected: (n) => `${n} selected`,
    msNoOptions: 'No options',
    msPickedAll: (n) => `All ${n}`,
    salesHint: 'All (narrowed when origin selected)',
    salesHintNarrowed: (n) => `${n} (within origin)`,
    monthAll: 'All (quarter sum)',
    profitHi: 'High-profit only', profitNotHi: 'Exclude high-profit',
    q2Label: '2Q 2026 (Progress)',
    cardScope: 'Scope', originCount: 'Origins', salesCount: 'Salespeople', custCount: 'Shippers (A/C)',
    bkLabel: '3W Before Booking Rate (vs BSA)',
    lfLabel: '3W Before Actual Lifting Rate',
    hpLabel: '3W Before High-Profit Rate',
    kT: 'Target', kP: 'Perform',
    vSummary: '① Target Summary (Origin × Salesperson)',
    vDrill: '② Salesperson → Shipper → BKG detail',
    vPivot: '③ Composable Pivot',
    legendOk: 'On target', legendWarn: 'within -2%p', legendNeg: 'Behind',
    panelTitleSummary: 'Origin × Salesperson — Target vs Performance',
    cluePivot: 'Click a cell → BKG_NO list matching that combination',
    clueDrill: 'Row click → drill to that salesperson (jumps to view ②)',
    clueShipper: 'Click a shipper row → expand BKG_NO list',
    pickOriginSales: 'Select an <b>Origin</b> and a <b>Salesperson</b> above, or click a row in view ①.',
    noChunks: 'No monthly data for the selected quarter.',
    noMatches: 'No data matches the filters.',
    noShipper: 'No shippers match the filters. (Check Grade / High-profit / WOS.)',
    loadingDetail: 'Loading detail...',
    panelAllBkg: 'All matching BKG_NO',
    btnCsv: 'Export CSV', btnClose: 'Close',
    pivotScope: 'Scope', pivotRowLabel: 'Row', pivotColLabel: 'Col', pivotMetric: 'Value', pivotNone: '(none)',
    pivotHeavy: (n) => `Current scope is ${n} chunks; response may be slow. Narrow by Origin / Salesperson / Quarter.`,
    pivotCellDetail: 'Pivot cell detail',
    columns: {
      origin: 'Origin', sales: 'Salesperson', share25: "'25 share",
      bk3w: '3W Booking (vs BSA)', lf3w: 'Actual Lifting Rate', hp3w: 'High-Profit Rate',
      ac: 'No. of A/C (Q1)', acTotal: 'Total', ac3w: '3W', acPct: '%',
      target: 'Target', perform: 'Perform', progress: 'Progress', gap: '+/-',
      shipper: 'Shipper', grade: 'Grade', bkgUnique: 'Unique BKG_NO', bkgCnt: 'BKG count',
      fstTeu: 'FST TEU', lstTeu: 'LST TEU', w3fst: 'WOS-3 FST', w3lst: 'WOS-3 LST',
      lstRate: 'LFT% (W3)', hiShare: 'Hi-Profit% (W3)', cm1: 'CM1',
      bkgNo: 'BKG_NO', month: 'Month', polPod: 'POL→POD', vslVoy: 'VSL/VOY',
      booking: 'Booking', wos: 'WOS', hi: 'Hi', status: 'Status', cm1PerTeu: 'CM1/TEU',
      totalLabel: 'Total',
    },
    dimNames: { origin: 'Origin', salesman: 'Salesperson', shipper: 'Shipper', grade: 'Grade', pod_country: 'POD Country', pod: 'POD Port', yyyymm: 'Month', hi: 'Hi-profit', wos: 'WOS' },
    metricNames: { fst: 'FST TEU', lst: 'LST TEU', w3_fst: 'WOS-3 FST', w3_lst: 'WOS-3 LST', bkg_count: 'BKG count', bkg_unique: 'Unique BKG_NO', shipper_unique: 'Shipper count', cm1: 'CM1', cm1_per_teu: 'CM1/TEU' },
  },
};
function tr(key) {
  const dict = I18N[STATE.lang] || I18N.ko;
  return (dict && dict[key] !== undefined) ? dict[key] : key;
}
function trCol(key) {
  return I18N[STATE.lang].columns[key] || I18N.ko.columns[key] || key;
}
function toggleLang() {
  STATE.lang = STATE.lang === 'ko' ? 'en' : 'ko';
  try { localStorage.setItem('sales_target_lang', STATE.lang); } catch {}
  applyLang();
  render();
}
function applyLang() {
  const dict = I18N[STATE.lang];
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = STATE.lang === 'ko' ? 'EN' : 'KO';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = dict[key];
    if (typeof val === 'string') el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.dataset.i18nAttr;  // e.g. "text:all"
    const [attr, key] = spec.split(':');
    if (attr === 'text' && dict[key]) el.textContent = dict[key];
  });
  // Refresh multi-selects (re-render to use new locale-aware labels)
  Object.values(STATE.multiSelect).forEach(ms => { try { ms.render(); } catch {} });
  // Refresh dynamic salesperson + month options once manifest is loaded
  if (STATE.manifest) {
    refreshSalesOptions();
    refreshMonthOptions();
  }
  const monthSel = document.getElementById('fMonth');
  if (monthSel && monthSel.options[0]) monthSel.options[0].textContent = dict.monthAll;
  const qSel = document.getElementById('fQuarter');
  if (qSel && qSel.options[1]) qSel.options[1].textContent = dict.q2Label;
}

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
    try { STATE.lang = localStorage.getItem('sales_target_lang') || 'ko'; } catch {}
    applyLang();
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
    applyLang();
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
  // Include legacy single-value keys, multi-select keys, and the destination filters.
  for (const k of ['origin', 'origins', 'country', 'countries', 'dest_country', 'dest_countries', 'dest_port', 'dest_ports', 'sales', 'quarter', 'month', 'grade', 'profit', 'wos', 'view']) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function applyInitialParams() {
  const params = STATE.initialUrlParams || {};
  if (params.quarter) STATE.filters.quarter = params.quarter;
  if (params.month) STATE.filters.month = params.month;
  if (params.grade) {
    // Old links may pass A/B/C/D individually; collapse to AB/CD.
    const g = params.grade.toUpperCase();
    if (g === 'A' || g === 'B') STATE.filters.grade = 'AB';
    else if (g === 'C' || g === 'D') STATE.filters.grade = 'CD';
    else if (['ALL','AB','CD'].includes(g)) STATE.filters.grade = g;
  }
  if (params.profit) STATE.filters.profit = params.profit;
  if (params.wos) STATE.filters.wos = params.wos;
  // Support both new (?origins=A,B&country=CN) and legacy (?origin=CN_SHA) param shapes.
  const originList = (params.origins || params.origin || '').split(',').map(s => s.trim()).filter(Boolean);
  if (originList.length) {
    STATE.filters.origins = originList.filter(p => ALL_WHITELIST_PORTS.includes(p));
  }
  const countryList = (params.country || params.countries || '').split(',').map(s => s.trim()).filter(Boolean);
  if (countryList.length) {
    STATE.filters.countries = countryList;
  } else if (STATE.filters.origins.length) {
    // Auto-derive countries from the selected ports so the country dropdown reflects context.
    STATE.filters.countries = [...new Set(STATE.filters.origins.map(p => COUNTRY_OF_PORT.get(p)).filter(Boolean))];
  }
  const salesList = (params.sales || '').split(',').map(s => s.trim()).filter(Boolean);
  if (salesList.length) STATE.filters.sales = salesList;
  const destCountryList = (params.dest_country || params.dest_countries || '').split(',').map(s => s.trim()).filter(Boolean);
  if (destCountryList.length) STATE.filters.destCountries = destCountryList;
  const destPortList = (params.dest_port || params.dest_ports || '').split(',').map(s => s.trim()).filter(Boolean);
  if (destPortList.length) STATE.filters.destPorts = destPortList;
  if (params.view && ['summary', 'drill', 'pivot'].includes(params.view)) STATE.view = params.view;
  document.getElementById('fQuarter').value = STATE.filters.quarter;
  document.getElementById('fMonth').value = STATE.filters.month;
  document.getElementById('fGrade').value = STATE.filters.grade;
  document.getElementById('fProfit').value = STATE.filters.profit;
  document.getElementById('fWos').value = STATE.filters.wos;
  // Sync multi-selects (they were already built but selections may have updated).
  if (STATE.multiSelect.msCountry) STATE.multiSelect.msCountry.setSelected(STATE.filters.countries);
  refreshPortOptions();
  if (STATE.multiSelect.msPort) STATE.multiSelect.msPort.setSelected(STATE.filters.origins);
  if (STATE.multiSelect.msDestCountry) STATE.multiSelect.msDestCountry.setSelected(STATE.filters.destCountries);
  refreshDestPortOptions();
  if (STATE.multiSelect.msDestPort) STATE.multiSelect.msDestPort.setSelected(STATE.filters.destPorts);
  refreshSalesOptions();
  if (STATE.multiSelect.msSales) STATE.multiSelect.msSales.setSelected(STATE.filters.sales);
  $$('.view-tabs .vtab').forEach(el => el.classList.toggle('active', el.dataset.view === STATE.view));
}

// ─── Multi-select widget ─────────────────────────────────────────
function buildMultiSelect(id, opts) {
  // opts: { options:[{value,label,group?,groupLabel?}], selected:[], onChange:(values)=>void }
  const root = document.getElementById(id);
  if (!root) return null;
  const state = {
    selected: new Set(opts.selected || []),
    options: opts.options || [],
    onChange: opts.onChange || (() => {}),
    name: root.dataset.msname || id,
  };
  STATE.multiSelect[id] = state;

  const render = () => {
    const dict = I18N[STATE.lang];
    const total = state.options.length;
    const selCount = state.selected.size;
    let label;
    if (selCount === 0) label = dict.msPickedAll(total);
    else if (selCount === total && total > 0) label = dict.msPickedAll(total);
    else if (selCount === 1) {
      const v = [...state.selected][0];
      const opt = state.options.find(o => o.value === v);
      label = opt ? opt.label : v;
    } else label = dict.msSelected(selCount);
    root.classList.toggle('dirty', selCount > 0 && selCount < total);
    root.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-toggle';
    btn.title = label;
    btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</span><span class="ms-caret">▾</span>`;
    btn.addEventListener('click', e => { e.stopPropagation(); toggleOpen(); });
    root.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'ms-panel';
    panel.addEventListener('click', e => e.stopPropagation());
    panel.innerHTML = `
      <div class="ms-actions">
        <button type="button" data-action="all">${escapeHtml(dict.msAll)}</button>
        <button type="button" data-action="none">${escapeHtml(dict.msNone)}</button>
      </div>
      <div class="ms-search-wrap"><input class="ms-search" placeholder="${escapeHtml(dict.msSearch)}"></div>
      <div class="ms-options"></div>
    `;
    const optsEl = panel.querySelector('.ms-options');
    const renderOpts = (filter) => {
      const q = (filter || '').trim().toLowerCase();
      optsEl.innerHTML = '';
      let lastGroup = null;
      const visible = state.options.filter(o => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
      if (!visible.length) {
        optsEl.innerHTML = `<div class="ms-empty">${escapeHtml(dict.msNoOptions)}</div>`;
        return;
      }
      visible.forEach(o => {
        if (o.group && o.group !== lastGroup) {
          lastGroup = o.group;
          const g = document.createElement('div');
          g.className = 'ms-group-head';
          g.textContent = o.groupLabel || o.group;
          optsEl.appendChild(g);
        }
        const row = document.createElement('label');
        row.className = 'ms-opt' + (o.group ? ' ms-opt-sub' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.value;
        cb.checked = state.selected.has(o.value);
        cb.addEventListener('change', () => {
          if (cb.checked) state.selected.add(o.value); else state.selected.delete(o.value);
          state.onChange([...state.selected]);
          render();
          // Keep panel open after pick — user can multi-select
          state._keepOpen = true;
          requestAnimationFrame(() => { state._keepOpen = false; });
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' ' + o.label));
        optsEl.appendChild(row);
      });
    };
    renderOpts('');
    panel.querySelector('[data-action="all"]').addEventListener('click', () => {
      state.options.forEach(o => state.selected.add(o.value));
      state.onChange([...state.selected]); render();
    });
    panel.querySelector('[data-action="none"]').addEventListener('click', () => {
      state.selected.clear();
      state.onChange([...state.selected]); render();
    });
    const search = panel.querySelector('.ms-search');
    search.addEventListener('input', () => renderOpts(search.value));
    root.appendChild(panel);
  };

  const toggleOpen = () => {
    const willOpen = !root.classList.contains('open');
    document.querySelectorAll('.ms.open').forEach(el => el.classList.remove('open'));
    if (willOpen) root.classList.add('open');
  };
  state.render = render;
  state.setOptions = (newOptions) => {
    state.options = newOptions;
    // Prune selected values that no longer exist
    const valid = new Set(newOptions.map(o => o.value));
    state.selected = new Set([...state.selected].filter(v => valid.has(v)));
    render();
  };
  state.setSelected = (vals) => {
    state.selected = new Set(vals || []);
    render();
  };
  state.getSelected = () => [...state.selected];
  render();
  return state;
}

document.addEventListener('click', () => {
  document.querySelectorAll('.ms.open').forEach(el => {
    const st = STATE.multiSelect[el.id];
    if (st && st._keepOpen) return;
    el.classList.remove('open');
  });
});

function fillSelect(id, list, currentValue, allLabel) {
  const sel = document.getElementById(id);
  if (!sel) return;
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

// ─── Filter setup ────────────────────────────────────────────────
function setupFilters() {
  // Country options: only whitelist countries that have any data in manifest.
  const manifestOrigins = new Set(STATE.manifest.origins || []);
  const countryOpts = WHITELIST_ORIGINS
    .filter(c => c.ports.some(p => manifestOrigins.has(p)))
    .map(c => ({ value: c.country, label: `${c.country} — ${c.label[STATE.lang] || c.label.ko}` }));
  buildMultiSelect('msCountry', {
    options: countryOpts,
    selected: STATE.filters.countries,
    onChange: vals => {
      STATE.filters.countries = vals;
      refreshPortOptions();
      refreshSalesOptions();
      render();
    },
  });
  refreshPortOptions();
  refreshSalesOptions();
  refreshMonthOptions();
  setupDestFilters();
}

function setupDestFilters() {
  const dests = STATE.manifest.dest_countries || [];
  const countryOpts = dests.map(c => ({ value: c, label: c }));
  buildMultiSelect('msDestCountry', {
    options: countryOpts,
    selected: STATE.filters.destCountries,
    onChange: vals => {
      STATE.filters.destCountries = vals;
      refreshDestPortOptions();
      render();
    },
  });
  refreshDestPortOptions();
}

function refreshDestPortOptions() {
  const byCountry = STATE.manifest.dest_ports_by_country || {};
  let activeCountries = STATE.filters.destCountries;
  if (!activeCountries.length) activeCountries = Object.keys(byCountry);
  const portOpts = [];
  activeCountries.sort().forEach(c => {
    (byCountry[c] || []).forEach(p => {
      portOpts.push({ value: `${c}/${p}`, label: p, group: c, groupLabel: c });
    });
  });
  const existing = STATE.multiSelect.msDestPort;
  if (existing) {
    const desired = STATE.filters.destPorts || [];
    const validSet = new Set(portOpts.map(o => o.value));
    const preserved = desired.filter(v => validSet.has(v));
    existing.setOptions(portOpts);
    existing.setSelected(preserved);
    STATE.filters.destPorts = preserved;
  } else {
    buildMultiSelect('msDestPort', {
      options: portOpts,
      selected: STATE.filters.destPorts,
      onChange: vals => {
        STATE.filters.destPorts = vals;
        render();
      },
    });
  }
}

function refreshPortOptions() {
  const manifestOrigins = new Set(STATE.manifest.origins || []);
  const countries = STATE.filters.countries.length
    ? new Set(STATE.filters.countries)
    : new Set(WHITELIST_ORIGINS.map(c => c.country));
  const portOpts = [];
  WHITELIST_ORIGINS.forEach(c => {
    if (!countries.has(c.country)) return;
    c.ports.forEach(p => {
      if (!manifestOrigins.has(p)) return;
      portOpts.push({ value: p, label: p, group: c.country, groupLabel: c.label[STATE.lang] || c.label.ko });
    });
  });
  const existing = STATE.multiSelect.msPort;
  if (existing) {
    const desired = STATE.filters.origins || [];
    const validSet = new Set(portOpts.map(o => o.value));
    const preserved = desired.filter(v => validSet.has(v));
    existing.setOptions(portOpts);
    existing.setSelected(preserved);
    STATE.filters.origins = preserved;
  } else {
    buildMultiSelect('msPort', {
      options: portOpts,
      selected: STATE.filters.origins,
      onChange: vals => {
        STATE.filters.origins = vals;
        refreshSalesOptions();
        render();
      },
    });
  }
}

function refreshSalesOptions() {
  // Collect salespeople for the current origin scope.
  const scope = effectiveOrigins();
  const map = STATE.manifest.salespeople_by_origin || {};
  const set = new Set();
  Object.entries(map).forEach(([origin, names]) => {
    if (!scope.has(origin)) return;
    names.forEach(n => set.add(n));
  });
  const opts = [...set].sort().map(n => ({ value: n, label: n }));
  const existing = STATE.multiSelect.msSales;
  if (existing) {
    // Preserve currently desired selection (STATE.filters.sales) across an options refresh.
    const desired = STATE.filters.sales || [];
    const validSet = new Set(opts.map(o => o.value));
    const preserved = desired.filter(v => validSet.has(v));
    existing.setOptions(opts);
    existing.setSelected(preserved);
    STATE.filters.sales = preserved;
  } else {
    buildMultiSelect('msSales', {
      options: opts,
      selected: STATE.filters.sales,
      onChange: vals => { STATE.filters.sales = vals; render(); },
    });
  }
}

function refreshMonthOptions() {
  const months = STATE.manifest.months || [];
  const q = STATE.filters.quarter;
  const inQuarter = months.filter(m => (QUARTER_MONTHS[q] || []).includes(m));
  fillSelect('fMonth', inQuarter, STATE.filters.month, I18N[STATE.lang].monthAll);
}

function setupListeners() {
  document.getElementById('fQuarter').addEventListener('change', e => {
    STATE.filters.quarter = e.target.value;
    STATE.filters.month = 'ALL';
    refreshMonthOptions();
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
    STATE.filters = { quarter: 'q1', countries: [], origins: [], destCountries: [], destPorts: [], sales: [], month: 'ALL', grade: 'ALL', profit: 'ALL', wos: 'W3' };
    STATE.expandedKey = null;
    STATE.expandedShipperKey = null;
    document.getElementById('fQuarter').value = 'q1';
    document.getElementById('fMonth').value = 'ALL';
    document.getElementById('fGrade').value = 'ALL';
    document.getElementById('fProfit').value = 'ALL';
    document.getElementById('fWos').value = 'W3';
    if (STATE.multiSelect.msCountry) STATE.multiSelect.msCountry.setSelected([]);
    refreshPortOptions();
    if (STATE.multiSelect.msPort) STATE.multiSelect.msPort.setSelected([]);
    if (STATE.multiSelect.msDestCountry) STATE.multiSelect.msDestCountry.setSelected([]);
    refreshDestPortOptions();
    if (STATE.multiSelect.msDestPort) STATE.multiSelect.msDestPort.setSelected([]);
    refreshSalesOptions();
    if (STATE.multiSelect.msSales) STATE.multiSelect.msSales.setSelected([]);
    refreshMonthOptions();
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
  const scope = effectiveOrigins();
  const salesSel = STATE.filters.sales;
  const salesSet = salesSel.length ? new Set(salesSel) : null;
  const rows = STATE.index?.rows || [];
  return rows.filter(r => {
    if (!scope.has(r.tab)) return false;
    if (r.row_type === 'TOTAL') return !salesSet;
    if (salesSet && !salesSet.has(r.name)) return false;
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
  const cols = I18N[STATE.lang].columns;
  const performLabel = q === 'q1' ? cols.perform : cols.progress;
  const rows = filteredSummaryRows();
  if (!rows.length) {
    return `<div class="empty">${tr('noMatches')}</div>`;
  }
  let h = `<div class="panel-header">
    <div class="panel-title">${tr('panelTitleSummary')} (${q.toUpperCase()})</div>
    <div class="panel-actions"><span class="legend">
      <span><span class="swatch" style="background:#e6f4ea"></span>${tr('legendOk')}</span>
      <span><span class="swatch" style="background:#fef7e0"></span>${tr('legendWarn')}</span>
      <span><span class="swatch" style="background:#fce8e6"></span>${tr('legendNeg')}</span>
    </span></div>
  </div>`;
  h += `<table class="dt"><thead><tr>
    <th rowspan="2">${cols.origin}</th>
    <th rowspan="2">${cols.sales}</th>
    <th rowspan="2">${cols.share25}</th>
    <th colspan="3">${cols.bk3w}</th>
    <th colspan="3">${cols.lf3w}</th>
    <th colspan="3">${cols.hp3w}</th>
    <th colspan="3">${cols.ac}</th>
  </tr><tr>
    <th>${cols.target}</th><th>${performLabel}</th><th>${cols.gap}</th>
    <th>${cols.target}</th><th>${performLabel}</th><th>${cols.gap}</th>
    <th>${cols.target}</th><th>${performLabel}</th><th>${cols.gap}</th>
    <th>${cols.acTotal}</th><th>${cols.ac3w}</th><th>${cols.acPct}</th>
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
  h += `<p style="margin-top:10px;font-size:11px;color:#80868b">${tr('clueDrill')}</p>`;
  return h;
}

// View 2: Drill — uses ALL selected origin/salesman pairs; loads chunks for the quarter/month, shows shipper table; click shipper -> BKG_NO list
function renderDrillView() {
  const scope = effectiveOrigins();
  const salesSel = STATE.filters.sales;
  if (!salesSel.length) {
    return `<div class="empty">${tr('pickOriginSales')}</div>`;
  }
  const months = monthsForFilter();
  if (!months.length) return `<div class="empty">${tr('noChunks')}</div>`;

  // Build the (origin, sales, month) targets from the selection x scope
  const pairs = [];
  Object.entries(STATE.manifest.salespeople_by_origin || {}).forEach(([origin, names]) => {
    if (!scope.has(origin)) return;
    names.forEach(name => {
      if (salesSel.includes(name)) pairs.push([origin, name]);
    });
  });
  if (!pairs.length) {
    return `<div class="empty">${tr('noMatches')}</div>`;
  }
  const containerId = `drill-${safeToken(pairs.map(p => p.join('|')).join(','))}-${safeToken(STATE.filters.quarter)}`;
  queueMicrotask(() => loadDrillDataMulti(pairs, months, containerId));
  const originLabels = [...new Set(pairs.map(p => p[0]))].join(', ');
  const salesLabels = [...new Set(pairs.map(p => p[1]))].join(', ');
  return `<div class="crumbs">
      <span class="crumb active">${escapeHtml(originLabels)}</span>
      <span class="sep">›</span>
      <span class="crumb active">${escapeHtml(salesLabels)}</span>
      <span class="sep">›</span>
      <span class="crumb">${escapeHtml(monthLabel(months))}</span>
    </div>
    <div id="${containerId}"><div class="loading">${tr('loadingDetail')}</div></div>`;
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

async function loadDrillDataMulti(pairs, months, containerId) {
  const tasks = [];
  pairs.forEach(([origin, sales]) => {
    months.forEach(m => tasks.push(loadChunk(origin, sales, m)));
  });
  const chunks = await Promise.all(tasks);
  const valid = chunks.filter(Boolean);
  const elContainer = document.getElementById(containerId);
  if (!elContainer) return;
  if (!valid.length) {
    elContainer.innerHTML = `<div class="empty">${tr('noMatches')}</div>`;
    return;
  }
  valid.forEach(chunk => {
    (chunk.bookings || []).forEach(b => {
      b.__origin = chunk.origin;
      b.__salesman = chunk.salesman;
      b.__yyyymm = chunk.yyyymm;
    });
  });
  const merged = mergeChunks(valid);
  const filtered = applyBookingFilters(merged.bookings);
  const shippers = aggregateShippers(filtered);
  STATE.drillBookings = filtered;
  const scopeLabel = pairs.map(p => `${p[0]}/${p[1]}`).join(',');
  const scopeKey = safeToken(scopeLabel);
  elContainer.innerHTML =
    renderShipperTable(scopeLabel, '', shippers, filtered) +
    renderAllMatchingBkgPanel(filtered, scopeKey);
  attachShipperHandlers(scopeLabel, '', filtered);
  attachAllBkgPanelHandlers(filtered, scopeKey);
}

function mergeChunks(chunks) {
  const bookings = [];
  chunks.forEach(c => bookings.push(...(c.bookings || [])));
  return { bookings };
}

function applyBookingFilters(bookings) {
  const { grade, profit, wos, destCountries, destPorts } = STATE.filters;
  const destCountrySet = destCountries.length ? new Set(destCountries) : null;
  const destPortSet = destPorts.length ? new Set(destPorts) : null;
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
    if (destCountrySet && !destCountrySet.has(b.pod_country)) return false;
    if (destPortSet && !destPortSet.has(`${b.pod_country}/${b.pod}`)) return false;
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
  const cols = I18N[STATE.lang].columns;
  if (!shippers.length) {
    return `<div class="empty">${tr('noShipper')}</div>`;
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

  // The breadcrumbs above already display origin + salesperson scope, so the
  // panel title only needs the month range to avoid the long comma-separated repeat.
  let h = `<div class="panel-header">
    <div class="panel-title">${cols.shipper} (${escapeHtml(monthLabel(monthsForFilter()))})</div>
    <div class="panel-actions">${cols.shipper} ${shippers.length} · BKG ${fmtNum(totals.bkg)} · ${cols.bkgUnique} ${fmtNum(totals.bkgU)}</div>
  </div>
  <table class="dt"><thead><tr>
    <th>${cols.shipper}</th><th>${cols.grade}</th><th>${cols.bkgUnique}</th><th>${cols.bkgCnt}</th><th>${cols.fstTeu}</th><th>${cols.lstTeu}</th><th>${cols.w3fst}</th><th>${cols.w3lst}</th><th>${cols.lstRate}</th><th>${cols.hiShare}</th><th>${cols.cm1}</th>
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
      <td class="txt">${I18N[STATE.lang].columns.totalLabel}</td><td></td>
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
    <p style="margin-top:10px;font-size:11px;color:#80868b">${tr('clueShipper')}</p>`;
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
        <span style="font-weight:600;color:#202124">${tr('panelAllBkg')}</span>
        <span style="margin-left:10px;font-size:12px;color:#5f6368">${fmtNum(total)} · ${escapeHtml(filterDesc)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="reset" data-action="export-all-bkg" type="button" style="padding:4px 10px">${tr('btnCsv')}</button>
        <span class="chev" style="font-size:14px;color:#5f6368">▾</span>
      </div>
    </div>
    <div class="all-bkg-body" style="display:none;padding:10px 14px"></div>
  </div>`;
}

function describeActiveFilters() {
  const parts = [];
  const f = STATE.filters;
  const lang = STATE.lang;
  parts.push(`${tr('fQuarter')} ${f.quarter.toUpperCase()}`);
  if (f.month !== 'ALL') parts.push(`${tr('fMonth')} ${formatMonth(f.month)}`);
  if (f.countries.length) parts.push(`${tr('fCountry')} ${f.countries.join(',')}`);
  if (f.origins.length) parts.push(`${tr('fOrigin')} ${f.origins.join(',')}`);
  if (f.destCountries.length) parts.push(`${tr('fDestCountry')} ${f.destCountries.join(',')}`);
  if (f.destPorts.length) parts.push(`${tr('fDestPort')} ${f.destPorts.join(',')}`);
  if (f.sales.length) parts.push(`${tr('fSales')} ${f.sales.join(',')}`);
  if (f.grade !== 'ALL') parts.push(`${tr('fGrade')} ${f.grade}`);
  if (f.profit !== 'ALL') parts.push(f.profit === 'HI' ? tr('profitHi') : tr('profitNotHi'));
  parts.push(f.wos === 'W3' ? 'WOS-3' : (lang === 'en' ? 'WOS all' : 'WOS 전체'));
  return parts.join(' · ');
}

function buildFlatBkgTable(bookings) {
  const cols = I18N[STATE.lang].columns;
  if (!bookings.length) return `<div class="empty">${tr('noMatches')}</div>`;
  const sorted = bookings.slice().sort((a, b) => (b.fst_teu || 0) - (a.fst_teu || 0));
  const cap = 1000;
  const limited = sorted.slice(0, cap);
  let h = '';
  if (sorted.length > cap) {
    h += `<div style="font-size:11px;color:#b06000;margin-bottom:8px">${STATE.lang === 'en' ? `Showing top ${fmtNum(cap)} of ${fmtNum(sorted.length)} rows. Use CSV export for the full set.` : `대용량(${fmtNum(sorted.length)}건)이라 상위 ${fmtNum(cap)}건만 표시합니다. 전체는 CSV 내보내기를 사용하세요.`}</div>`;
  }
  h += `<table class="dt"><thead><tr>
    <th>${cols.bkgNo}</th><th>${cols.origin}</th><th>${cols.sales}</th><th>${cols.month}</th>
    <th>${cols.shipper}</th><th>${cols.grade}</th><th>${cols.polPod}</th><th>${cols.vslVoy}</th>
    <th>${cols.booking}</th><th>${cols.fstTeu}</th><th>${cols.lstTeu}</th><th>${cols.cm1}</th><th>${cols.cm1PerTeu}</th>
    <th>${cols.wos}</th><th>${cols.hi}</th><th>${cols.status}</th>
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
  const cols = I18N[STATE.lang].columns;
  const bks = allBookings.filter(b => (b.shipper_no || b.shipper_name) === shipperKey);
  if (!bks.length) return `<div class="detail-box"><div class="empty">${tr('noMatches')}</div></div>`;
  bks.sort((a, b) => (b.week_start_date || '').localeCompare(a.week_start_date || ''));
  let h = `<div class="detail-box"><h4>${cols.bkgNo} (${bks.length})</h4>
    <table class="dt"><thead><tr>
      <th>${cols.bkgNo}</th><th>${cols.polPod}</th><th>${cols.vslVoy}</th><th>${cols.booking}</th><th>${cols.fstTeu}</th><th>${cols.lstTeu}</th><th>${cols.cm1}</th><th>${cols.cm1PerTeu}</th><th>${cols.wos}</th><th>${cols.grade}</th><th>${cols.hi}</th><th>${cols.status}</th>
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
  const scope = effectiveOrigins();
  const salesSel = STATE.filters.sales;
  const salesSet = salesSel.length ? new Set(salesSel) : null;
  const chunkEstimate = (STATE.manifest.chunks || []).filter(c => {
    if (!scope.has(c.origin)) return false;
    if (salesSet && !salesSet.has(c.salesman)) return false;
    return months.includes(c.yyyymm);
  }).length;
  const containerId = 'pivot-body';
  const dim = I18N[STATE.lang].dimNames;
  const met = I18N[STATE.lang].metricNames;
  let h = `<div class="pivot-config">
    <span>${tr('pivotRowLabel')}:</span>
    <select id="pivotRow">
      <option value="origin">${dim.origin}</option>
      <option value="salesman">${dim.salesman}</option>
      <option value="shipper">${dim.shipper}</option>
      <option value="grade">${dim.grade}</option>
      <option value="pod_country">${dim.pod_country}</option>
      <option value="pod">${dim.pod}</option>
      <option value="yyyymm">${dim.yyyymm}</option>
    </select>
    <span style="margin-left:8px">${tr('pivotColLabel')}:</span>
    <select id="pivotCol">
      <option value="-">${tr('pivotNone')}</option>
      <option value="yyyymm">${dim.yyyymm}</option>
      <option value="origin">${dim.origin}</option>
      <option value="salesman">${dim.salesman}</option>
      <option value="grade">${dim.grade}</option>
      <option value="pod_country">${dim.pod_country}</option>
      <option value="hi">${dim.hi}</option>
      <option value="wos">${dim.wos}</option>
    </select>
    <span style="margin-left:8px">${tr('pivotMetric')}:</span>
    <select id="pivotMetric">
      <option value="fst">${met.fst}</option>
      <option value="lst">${met.lst}</option>
      <option value="w3_fst">${met.w3_fst}</option>
      <option value="w3_lst">${met.w3_lst}</option>
      <option value="bkg_count">${met.bkg_count}</option>
      <option value="bkg_unique">${met.bkg_unique}</option>
      <option value="shipper_unique">${met.shipper_unique}</option>
      <option value="cm1">${met.cm1}</option>
      <option value="cm1_per_teu">${met.cm1_per_teu}</option>
    </select>
    <span style="margin-left:auto;color:#80868b">${tr('pivotScope')}: ${chunkEstimate} chunks</span>
  </div>`;
  if (chunkEstimate > 200) {
    h += `<div class="error-banner">${I18N[STATE.lang].pivotHeavy(chunkEstimate)}</div>`;
  }
  h += `<div id="${containerId}"><div class="loading">${tr('loadingDetail')}</div></div>`;
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
  const scope = effectiveOrigins();
  const salesSel = STATE.filters.sales;
  const salesSet = salesSel.length ? new Set(salesSel) : null;
  const chunkList = (STATE.manifest.chunks || []).filter(c => {
    if (!scope.has(c.origin)) return false;
    if (salesSet && !salesSet.has(c.salesman)) return false;
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

  const totalLabel = I18N[STATE.lang].columns.totalLabel;
  let h = `<div style="font-size:11px;color:#80868b;margin-bottom:6px">${tr('cluePivot')}</div>`;
  h += `<table class="dt"><thead><tr><th>${escapeHtml(rowLabel(row))}</th>`;
  colOrder.forEach(ck => h += `<th>${ck === '__total__' ? totalLabel : escapeHtml(ck)}</th>`);
  if (col !== '-') h += `<th>${totalLabel}</th>`;
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
  h += `<tr class="row-total"><td class="txt">${totalLabel}</td>`;
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
      const totalLbl = I18N[STATE.lang].columns.totalLabel;
      const label = `${tr('pivotRowLabel')} ${rk === '__col_total__' ? totalLbl : rk} · ${tr('pivotColLabel')} ${ck === '__row_total__' || ck === '__total__' ? totalLbl : ck}`;
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
      <div><b>${tr('pivotCellDetail')}</b> <span style="color:#5f6368;font-size:12px;margin-left:8px">${escapeHtml(label)} · ${fmtNum(subset.length)}</span></div>
      <div style="display:flex;gap:6px">
        <button class="reset" data-action="export-pivot-cell" type="button">${tr('btnCsv')}</button>
        <button class="reset" data-action="close-pivot-cell" type="button">${tr('btnClose')}</button>
      </div>
    </div>
    <div style="padding:10px 14px">${buildFlatBkgTable(subset)}</div>
  </div>`;
}

function rowLabel(dim) {
  return I18N[STATE.lang].dimNames[dim] || dim;
}

function attachRowHandlers() {
  document.querySelectorAll('[data-action="drill"]').forEach(row => {
    row.addEventListener('click', () => {
      const origin = row.dataset.origin;
      const sales = row.dataset.sales;
      const country = COUNTRY_OF_PORT.get(origin);
      STATE.filters.countries = country ? [country] : [];
      STATE.filters.origins = [origin];
      if (STATE.multiSelect.msCountry) STATE.multiSelect.msCountry.setSelected(STATE.filters.countries);
      refreshPortOptions();
      if (STATE.multiSelect.msPort) STATE.multiSelect.msPort.setSelected(STATE.filters.origins);
      // refreshSalesOptions resets STATE.filters.sales from the multi-select state, so re-apply afterwards.
      refreshSalesOptions();
      STATE.filters.sales = [sales];
      if (STATE.multiSelect.msSales) STATE.multiSelect.msSales.setSelected(STATE.filters.sales);
      STATE.view = 'drill';
      $$('.view-tabs .vtab').forEach(el => el.classList.toggle('active', el.dataset.view === 'drill'));
      render();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
