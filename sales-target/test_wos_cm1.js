const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console, URLSearchParams, setTimeout, clearTimeout,
  queueMicrotask() {}, window: {}, localStorage: { getItem: () => null },
  document: { addEventListener() {}, querySelectorAll: () => [] } });
vm.runInContext(fs.readFileSync(process.argv[2] || `${__dirname}/app.js`, 'utf8'), context);
const run = code => vm.runInContext(code, context);
run(`
  STATE.filters.grade = 'CD';
  const booking = {bkg_no:'CN001', shipper_no:'C', grade:'C+D', is_w3:true,
    fst_teu:10, norm_lst_teu:0, norm_cm1:0, wos_norm_lst_teu:8, wos_norm_cm1:800};
  const bl = {bkg_no:'', bl_no:'BL001', shipper_no:'C', grade:'C+D', is_w3:false,
    fst_teu:0, norm_lst_teu:8, norm_cm1:950, wos_norm_lst_teu:0, wos_norm_cm1:0};
  const filtered = applyBookingFilters([booking, bl]);
`);
assert.equal(run('filtered.length'), 1);
assert.equal(run("pivotAggregate(filtered, 'cm1')"), 800);
assert.equal(run("pivotAggregate(filtered, 'lst')"), 8);
assert.equal(run("pivotAggregate(filtered, 'cm1_per_teu')"), 100);
assert.equal(run('aggregateShippers(filtered, new Map(), [])[0].cm1'), 800);
assert.equal(run('normalCm1(bl)'), 950); // canonical physical actual remains intact
assert.equal(run('normalLstTeu(booking)'), 0);
assert.equal(run('detailCm1({...booking, wos_norm_cm1:0})'), 0);
assert.equal(run('detailCm1({lst_status:"Normal", lst_teu:2, cm1:200})'), 200);
assert.match(run('buildFlatBkgTable(filtered)'), /800/);
run('STATE.pivot.metric = "cm1"');
assert.match(run('renderPivotTable([{...booking, __origin:"CN_SHA", wos_norm_cm1:0}])'), />0<\/td>/);
run('STATE.filters.wos = "ALL"');
assert.equal(run("pivotAggregate([booking, bl], 'cm1')"), 950);
assert.equal(run("pivotAggregate([booking, bl], 'lst')"), 8);
console.log('WOS CM1, physical B/L separation, drill totals and valid zero: passed');
