(function (root) {
  'use strict';
  const columns = ['DLY_PORT','POR_PORT','WW','YYYYMM','dest','origin','team','blTeu','blCm1','blFreight','blCm1BasisTeu'];
  function read(data) {
    const source = data && data.independent_bl;
    if (!source) return null;
    if (/^\d{8}$/.test(String(data.data_date)) && source.sourceDate < data.data_date) return null;
    if (source.format !== 'independent-bl-v1' || !/^\d{8}$/.test(source.sourceDate) || source.bookingRequired !== false || !source.manifestSha256 || !source.verifiedAt) throw new Error('B/L 실적 독립 검증 근거가 없습니다.');
    const table = source.table;
    if (!table || JSON.stringify(table.c) !== JSON.stringify(columns) || !Array.isArray(table.r)) throw new Error('B/L 실적 표 형식이 올바르지 않습니다.');
    const totals = {};
    for (const row of table.r) {
      if (row.length !== columns.length || typeof row[7] !== 'number' || !Number.isFinite(row[7]) || row[7] < 0 || row.slice(8).some(v=>typeof v!=='number'||!Number.isFinite(v)) || row[10]<0 || !source.scopeMonths.includes(row[3])) throw new Error('B/L 실적 결측 또는 기간 오류입니다.');
      totals[row[3]] = (totals[row[3]] || 0) + row[7];
    }
    for (const month of source.scopeMonths) {
      const proof = source.monthlyChecks[month];
      if (!proof || !Number.isFinite(proof.manifestTeu) || Math.abs((totals[month] || 0) - proof.manifestTeu) > .01) throw new Error('B/L 실적 월별 합계 검증에 실패했습니다.');
    }
    for (const month of source.scopeMonths) {
      const rows=table.r.filter(row=>row[3]===month), proof=source.monthlyChecks[month];
      for (const [index,key] of [[8,'manifestCm1'],[9,'manifestFreight'],[10,'manifestCm1BasisTeu']]) {
        if (!Number.isFinite(proof[key]) || Math.abs(rows.reduce((n,row)=>n+row[index],0)-proof[key])>.01) throw new Error('B/L 실적 월별 합계 검증 실패');
      }
    }
    return source;
  }
  function select(source, filters) {
    return source.table.r.filter(row => columns.every((key, i) => !filters[key] || String(row[i]) === filters[key]));
  }
  function mount(data, host, fixedTeam) {
    if (!host) return;
    let panel = host.querySelector('[data-independent-bl]');
    if (!data || (!data.independent_bl && !data.independent_bl_error)) { if (panel) panel.remove(); return; }
    if (panel && panel._source === data.independent_bl) return;
    if (panel) panel.remove();
    panel = document.createElement('details'); panel.dataset.independentBl = '1'; panel.open = true;
    panel.style.cssText = 'margin:12px;padding:12px;border:1px solid #c1d5ee;border-radius:8px;background:#f5f9ff;color:#172b4d;font:14px/1.5 sans-serif';
    host.prepend(panel);
    function element(tag, text, parent) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (parent) parent.appendChild(el); return el; }
    if (data.independent_bl_error) { panel.setAttribute('role','alert'); panel.textContent='최신 B/L 실적 독립 원천 로드 실패: '+data.independent_bl_error+' · 기존 계산 기준일 '+data.data_date+' 유지'; return; }
    let source;
    try { source = read(data); } catch (error) { panel.setAttribute('role','alert'); panel.textContent = error.message; return; }
    if (!source) { panel.remove(); return; }
    panel._source = data.independent_bl;
    element('summary', '최신 B/L 실적 단독 조회 · 원천 기준일 ' + source.sourceDate, panel);
    element('p', 'B/L 실적는 Booking 없이 독립 검증·갱신했습니다. 아래 필터와 표는 최신 B/L 실적입니다. 기존 Booking·WOS 및 이들과 결합된 활용률/비율 화면은 검증된 ' + data.data_date + ' 묶음을 유지합니다. 서로 다른 날짜의 수치를 같은 기준일로 합산하지 않습니다.', panel);
    element('p', '원천 생성 ' + source.generatedAt + ' · 검증 ' + source.verifiedAt + ' · 월별 합계 대조 통과', panel);
    const controls = element('div', undefined, panel); controls.style.cssText='display:flex;gap:10px;flex-wrap:wrap';
    const filters = fixedTeam ? {team:fixedTeam} : {}; let page=0;
    const labels={team:'팀',YYYYMM:'월',WW:'주차',origin:'출발국',POR_PORT:'출발지',dest:'도착국',DLY_PORT:'도착지'};
    for (const key of Object.keys(labels)) {
      if (key === 'team' && fixedTeam) continue;
      const label=element('label', labels[key]+' ', controls); const input=element('select', undefined, label); input.setAttribute('aria-label', '독립 B/L 실적 '+labels[key]);
      element('option','전체',input).value='';
      const index=columns.indexOf(key);
      const rows=fixedTeam ? source.table.r.filter(row=>row[6]===fixedTeam) : source.table.r;
      [...new Set(rows.map(row=>String(row[index])))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).forEach(value=>{element('option',value,input).value=value;});
      input.onchange=()=>{filters[key]=input.value;page=0;draw();};
    }
    const status=element('p',undefined,panel); status.setAttribute('role','status');
    const wrap=element('div',undefined,panel);wrap.style.cssText='overflow:auto;max-height:380px';
    const table=element('table',undefined,wrap); table.style.cssText='border-collapse:collapse;width:100%;background:white';
    const head=element('tr',undefined,element('thead',undefined,table));
    ['팀','월','주차','출발국','출발지','도착국','도착지','B/L TEU','CM1 (원천 단위)','운임 (원천 단위)','CM1 기준 TEU'].forEach(value=>element('th',value,head));
    const body=element('tbody',undefined,table);const nav=element('div',undefined,panel);
    const prev=element('button','이전 100행',nav), next=element('button','다음 100행',nav);prev.type=next.type='button';
    prev.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};
    function draw() {
      const rows=select(source,filters),total=rows.reduce((sum,row)=>sum+row[7],0);
      status.textContent='선택 B/L 실적 '+total.toLocaleString('ko-KR',{maximumFractionDigits:3})+' TEU · '+rows.length.toLocaleString()+'행 · '+(rows.length ? (page*100+1)+'–'+Math.min((page+1)*100,rows.length) : '0')+'행 표시';
      const cm1=rows.reduce((n,row)=>n+row[8],0), basis=rows.reduce((n,row)=>n+row[10],0);
      status.textContent+=' · CM1 '+cm1.toLocaleString('ko-KR',{maximumFractionDigits:2})+' · CM1/TEU '+(basis>0?(cm1/basis).toLocaleString('ko-KR',{maximumFractionDigits:2}):'미확인 (기준 TEU 0)');
      body.replaceChildren();
      for(const row of rows.slice(page*100,(page+1)*100)) {const tr=element('tr',undefined,body); for(const i of [6,3,2,5,1,4,0,7,8,9,10]){const td=element('td',i>=7 ? row[i].toLocaleString('ko-KR',{maximumFractionDigits:3}) : String(row[i]),tr);td.style.cssText='padding:4px;border-bottom:1px solid #eee';}}
      prev.disabled=page===0;next.disabled=(page+1)*100>=rows.length;
    }
    draw();
  }
  const api={read,select,mount};
  if (typeof module !== 'undefined') module.exports=api;
  else root.IndependentBL=api;
})(typeof window === 'undefined' ? globalThis : window);
