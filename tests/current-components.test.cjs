const {test} = require('node:test');
const assert = require('node:assert/strict');
const {apply} = require('../current-components.js');
const columns = ['team','origin','ori_port','dest','dst_port','YYYYMM','week_start_date','BKG_SHPR_CST_NO','BKG_SHPR_CST_ENM','Salesman_POR','norm_bl','norm_lst','cm1_norm','lst_norm'];
const dims = {team:'OBT',origin:'CN',ori_port:'TAO',dest:'IN',dst_port:'MAA',YYYYMM:'202610',week_start_date:'2026년 10월 04일'};
function fixture() {
  const row = {...dims,BKG_SHPR_CST_NO:'A',BKG_SHPR_CST_ENM:'Shipper',Salesman_POR:'Owner',grade:'C+D',tag:'고수익화주',fst:20,w3_fst:12,w3_norm_lst:5,norm_lst:7,norm_bl:2,cm1_norm:14,lst_norm:7};
  const source = {sourceDate:'20261024',scopeMonths:['202610'],monthlyChecks:{202610:{manifestTeu:10,manifestCm1:40,manifestCm1BasisTeu:10}},dashboardDetail:{version:1,identifierCount:1,table:{c:columns,r:[['OBT','CN','TAO','IN','MAA','202610','2026년 10월 04일','A','Shipper','Source owner',1,10,40,10]]}}};
  const data = {data_date:'20261022',monthly:[{...row}],weekly:[{...row}],shipper:[{...row}],bsa:[{YYYYMM:'202610',teu_bsa:9},{YYYYMM:'202606',teu_bsa:2}],independent_bl:source};
  return {data,source,readers:{bl:d=>d.independent_bl,bsa:()=>({sourceDate:'20261024',scopeMonths:['202610'],table:{c:['DLY_PORT','POR_PORT','WW','YYYYMM','dest','origin','team','teu_bsa'],r:[['MAA','TAO','40','202610','IN','CN','OBT',30]]}})}};
}
test('latest actuals replace old facts in all three existing grains, preserving Booking/WOS',()=>{
  const {data,readers}=fixture();apply(data,readers);
  for(const section of ['monthly','weekly','shipper']) {
    assert.equal(data[section].reduce((n,r)=>n+(r.norm_lst||0),0),10);
    assert.equal(data[section].reduce((n,r)=>n+(r.cm1_norm||0),0),40);
    assert.equal(data[section].reduce((n,r)=>n+(r.w3_fst||0),0),12);
    assert.equal(data[section].reduce((n,r)=>n+(r.w3_norm_lst||0),0),5);
  }
  assert.equal(data.bsa.reduce((n,r)=>n+r.teu_bsa,0),32);
  assert.equal(data.current_component_dates.booking,'20261022');
  assert.equal(data.current_component_dates.bl,'20261024');
  assert.equal(data.shipper.at(-1).grade,'C+D');
  assert.equal(data.shipper.at(-1).Salesman_POR,'Owner');
  apply(data,readers);assert.equal(data.shipper.length,2);
});
test('unknown grade remains unknown, new actual-only lane appears in existing filters',()=>{
  const {data,source,readers}=fixture();source.dashboardDetail.table.r[0][7]='NEW';source.dashboardDetail.table.r[0][2]='SHA';
  apply(data,readers);assert.equal(data.shipper.at(-1).grade,'');assert(data.monthly.some(r=>r.ori_port==='SHA'));
});
test('confirmed zero replaces prior positive actuals for a complete source month',()=>{
  const {data,source,readers}=fixture();source.dashboardDetail.table.r=[];source.dashboardDetail.identifierCount=0;
  source.monthlyChecks['202610']={manifestTeu:0,manifestCm1:0,manifestCm1BasisTeu:0};
  apply(data,readers);assert.equal(data.monthly[0].norm_lst,0);assert.equal(data.shipper[0].w3_fst,12);
});
test('unreconciled or unknown latest actuals fail before any measure changes',()=>{
  for (const bad of [null,NaN,11]) {
    const {data,source,readers}=fixture();source.dashboardDetail.table.r[0][11]=bad;
    assert.throws(()=>apply(data,readers));assert.equal(data.monthly[0].norm_lst,7);assert.equal(data.bsa[0].teu_bsa,9);
  }
});
test('aggregate-only B/L cannot silently replace detailed existing tables',()=>{
  const {data,source,readers}=fixture();delete source.dashboardDetail;
  assert.throws(()=>apply(data,readers),/상세/);assert.equal(data.monthly[0].norm_lst,7);
});
