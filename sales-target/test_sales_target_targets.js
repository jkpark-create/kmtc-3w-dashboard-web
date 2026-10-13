const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const appPath = process.argv[2] || path.join(__dirname, 'app.js');
const notice = { textContent: '' };
const context = vm.createContext({ console, URLSearchParams, setTimeout, clearTimeout, window: {},
  document: { addEventListener() {}, getElementById: id => id === 'targetAvailability' ? notice : null,
              querySelectorAll: () => [] }, localStorage: { getItem: () => null } });
vm.runInContext(fs.readFileSync(appPath, 'utf8'), context);
const run = code => vm.runInContext(code, context);
run(`
  const testRow = {tab: 'CN_SHA', name: 'S', row_type: 'SALES', kpi: {
    booking: {q3: {target: 0, progress: .4}, q4: {target: .6}},
    lifting: {q3: {target: .7}, q4: {target: null}},
    high_profit: {q3: {target: .3}, q4: {target: ''}}
  }};
`);
assert.equal(run(`finiteTargetOfRow(testRow, 'q3', 'booking')`), 0);
run(`
  const goalRow = {tab: 'TH', name: 'OLD', row_type: 'SALES',
    quarter_metrics: {q3: {w3f: 100, goal_w3f: 100, bsa: 200}},
    kpi: {lifting: {q3: {target: .7, progress: .6, gap: -.1}}}};
  const newActualRow = {tab: 'TH', name: 'NEW', row_type: 'PERFORMANCE_ONLY',
    quarter_metrics: {q3: {w3f: 100, goal_w3f: 0, bsa: 0}},
    kpi: {lifting: {q3: {target: null, progress: 1, gap: null}}}};
`);
assert.equal(run(`aggregateKpi([goalRow, newActualRow], 'q3', 'lifting').target`), .7);
assert.equal(run(`aggregateKpi([goalRow, newActualRow], 'q3', 'lifting').perform`), .8);
assert.ok(Math.abs(run(`aggregateKpi([goalRow, newActualRow], 'q3', 'lifting').gap`) - .1) < 1e-12);
run(`
  STATE.base2025 = {TH: {OLD: {shpr: [{sk:'EXISTING', dlyc:'SG', dly:'SIN', nlst:100}]}}};
  const oldBooking = {__origin:'TH', __salesman:'OLD', shipper_no:'EXISTING', dly_country:'SG', dly_plc:'SIN', norm_lst_teu:50, target_eligible:true};
  const newBooking = {__origin:'TH', __salesman:'OLD', shipper_no:'NEWCLIENT', dly_country:'SG', dly_plc:'SIN', norm_lst_teu:100, target_eligible:false};
  const allocation = [{__origin:'TH', __salesman:'OLD', pod_country:'SG', pod:'SIN', allocated_bsa:200}];
`);
assert.equal(run(`allocateShipperBsa([oldBooking], allocation).get('EXISTING')`), 200);
assert.equal(run(`allocateShipperBsa([oldBooking, newBooking], allocation).get('EXISTING')`), 200);
assert.equal(run(`allocateShipperBsa([oldBooking, newBooking], allocation).has('NEWCLIENT')`), false);
assert.equal(run(`finiteTargetOfRow(testRow, 'q4', 'lifting')`), null);
assert.equal(run(`finiteTargetOfRow(testRow, 'q4', 'high_profit')`), null);
assert.equal(run(`finiteOptionalNumber(false)`), null);
assert.equal(run(`finiteOptionalNumber('   ')`), null);
assert.equal(run(`finiteOptionalNumber('0')`), 0);
run(`STATE.index = {rows: [testRow]}; filteredSummaryRows = () => STATE.index.rows; updatePerformanceLabels('q3');`);
assert.equal(notice.textContent, '');
run(`updatePerformanceLabels('q4')`);
assert.match(notice.textContent, /Some targets/);
run(`STATE.index = {rows: [{kpi: {booking: {q4: {target: null}}}}]}; updatePerformanceLabels('q4');`);
assert.match(notice.textContent, /Targets unavailable/);
const alloc = `[{__origin: 'CN_SHA', __salesman: 'S', allocated_bsa: 100}]`;
assert.equal(run(`weightedTargetFromBsaAllocations([testRow], ${alloc}, 'q3', 'booking')`), 0);
assert.equal(run(`weightedTargetFromBsaAllocations([testRow], ${alloc}, 'q4', 'lifting')`), null);
run(`testRow.month_targets = {
  '202607': {booking: {numerator: 50, denominator: 100}},
  '202608': {booking: {numerator: 90, denominator: 300}},
  '202609': {booking: {numerator: 0, denominator: 100}}
}; STATE.filters.month = 'ALL';`);
assert.equal(run(`finiteTargetOfRow(testRow, 'q3', 'booking')`), .28);
run(`testRow.quarter_metrics = {q3: {bsa: 0, w3f: 0}}`);
assert.equal(run(`aggregateKpi([testRow], 'q3', 'booking').target`), .28);
run(`STATE.filters.month = '202609'`);
assert.equal(run(`finiteTargetOfRow(testRow, 'q3', 'booking')`), 0);
run(`STATE.filters.month = 'ALL'; delete testRow.month_targets['202608'];`);
assert.equal(run(`finiteTargetOfRow(testRow, 'q3', 'booking')`), null);
run(`testRow.kpi.booking.q3.target_source = 'explicit'`);
assert.equal(run(`finiteTargetOfRow(testRow, 'q3', 'booking')`), 0);
run(`
  STATE.manifest = {chunks:[{origin:'TH',salesman:'OLD',yyyymm:'202607',file:'old.json'}],
    capacity_reserve_chunks:[{origin:'TH',salesman:'(no 2025 basis)',yyyymm:'202607',file:'reserve.json'}]};
  effectiveOrigins=()=>new Set(['TH']);STATE.filters.sales=[];
`);
assert.equal(run(`scopedChunkListForMonths(['202607']).length`),2);
run(`STATE.filters.sales=['OLD']`);
assert.equal(run(`scopedChunkListForMonths(['202607']).length`),1);
run(`STATE.filters.sales=[];
  const capacityTestRows=[{tab:'TH',name:'OLD',row_type:'SALES',kpi:{booking:{q3:{target:.4}}}},
    {tab:'TH',name:'Total',row_type:'TOTAL',kpi:{booking:{q3:{target:.9}}}}];
  const capacityTestAllocations=[{__origin:'TH',__salesman:'OLD',allocated_bsa:20},
    {__origin:'TH',__salesman:'(no 2025 basis)',allocated_bsa:80,goal_eligible:false}];
`);
assert.equal(run(`sumAllocatedBsa(capacityTestAllocations)`),100);
assert.equal(run(`weightedTargetFromBsaAllocations(capacityTestRows,capacityTestAllocations,'q3','booking')`),.4);
run(`STATE.index={rows:[{tab:'TH',name:'(미지정)',row_type:'PERFORMANCE_ONLY',target_eligible:false,goal_exclusion_reason:'unassigned_current_owner'}]};updatePerformanceLabels('q3');`);
assert.match(notice.textContent,/Unassigned-owner actuals/);
run(`
  const priorYearRow={tab:'TH',name:'OLD',row_type:'SALES',kpi:{lifting:{q4:{target:null}}},month_targets:{
    '202610':{lifting:{numerator:0,denominator:100,basis_state:'known'}},
    '202611':{lifting:{numerator:null,denominator:null,basis_state:'no_historical_performance',blank_states:{no_historical_performance:1}}},
    '202612':{lifting:{numerator:30,denominator:100,basis_state:'known'}}
  }};STATE.filters.month='ALL';
`);
assert.equal(run(`kpiOfRow(priorYearRow,'q4','lifting').target`),.15);
assert.match(run(`targetStateLabel(kpiOfRow(priorYearRow,'q4','lifting'))`),/No prior-year performance/);
assert.equal(run(`targetDenominatorWeight(priorYearRow,'q4','lifting')`),200);
run(`priorYearRow.month_targets['202611'].lifting.basis_state='source_missing'`);
assert.equal(run(`kpiOfRow(priorYearRow,'q4','lifting').target`),null);
run(`priorYearRow.month_targets['202611'].lifting={numerator:null,denominator:null,basis_state:'zero_baseline_denominator',blank_states:{zero_baseline_denominator:1}};STATE.filters.month='202611';`);
assert.match(run(`targetStateLabel(kpiOfRow(priorYearRow,'q4','lifting'))`),/denominator is zero/);
assert.equal(run(`kpiOfRow(priorYearRow,'q4','lifting').target`),null);
run(`STATE.filters.month='ALL'`);
// Exercise the real loader twice: loaded Q3/Q4 objects must survive refresh.
run(`
  const inputIndex = {rows: [testRow]};
  loadJson = async name => name === 'index.json' ? JSON.parse(JSON.stringify(inputIndex)) : name === 'manifest.json' ? {months: []} : null;
  applyLang = setupFilters = setupListeners = applyInitialParams = render = updateDataInfo = () => {};
  readUrlParams = () => ({});
`);
(async () => {
  await run('init()');
  assert.equal(run(`STATE.index.rows[0].kpi.booking.q4.target`), .6);
  assert.equal(run(`STATE.index.rows[0].kpi.booking.q3.target`), 0);
  await run('init()');
  assert.equal(run(`STATE.index.rows[0].kpi.booking.q4.target`), .6);
  assert.equal(run(`STATE.index.rows[0].kpi.booking.q3.target`), 0);
  console.log('PASS: null/zero, weighted monthly ratio, partial history, availability banner, reload Q3/Q4 preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
