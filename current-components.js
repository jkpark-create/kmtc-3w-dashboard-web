(function (root) {
  'use strict';
  const dims = ['team','origin','ori_port','dest','dst_port','YYYYMM'];
  const detailColumns = [...dims,'week_start_date','BKG_SHPR_CST_NO','BKG_SHPR_CST_ENM','Salesman_POR','norm_bl','norm_lst','cm1_norm','lst_norm'];
  const actual = ['norm_bl','norm_lst','cm1_norm','lst_norm','route_hi_norm_bl','route_hi_norm_lst','route_hi_cm1_norm','hi_norm_bl','hi_norm_lst','hi_cm1_norm','hi_lst_norm'];
  const key = (row, fields) => JSON.stringify(fields.map(field => row[field] ?? ''));
  function objects(table) {
    return table.r.map(row => Object.fromEntries(table.c.map((field, index) => {
      const value = row[index], dictionary = table.d?.[field];
      if (dictionary && (!Number.isInteger(value) || value < 0 || value >= dictionary.length)) throw new Error('B/L 상세 사전 인덱스가 올바르지 않습니다.');
      return [field, dictionary ? dictionary[value] : value];
    })));
  }
  function validateDetail(source) {
    const detail = source.dashboardDetail;
    if (!detail || detail.version !== 1 || JSON.stringify(detail.table?.c) !== JSON.stringify(detailColumns) || !Array.isArray(detail.table.r)) {
      throw new Error('최신 B/L 상세 원천이 기존 표와 연결되지 않았습니다.');
    }
    const rows = objects(detail.table), months = new Set(source.scopeMonths);
    const totals = new Map();
    for (const row of rows) {
      if (!months.has(row.YYYYMM) || !dims.every(field => typeof row[field] === 'string' && row[field]) ||
          !/^\d{4}년 \d{2}월 \d{2}일$/.test(row.week_start_date) ||
          ['norm_bl','norm_lst','cm1_norm','lst_norm'].some(field => typeof row[field] !== 'number' || !Number.isFinite(row[field])) ||
          !Number.isInteger(row.norm_bl) || row.norm_bl < 1 || row.norm_lst < 0 || row.lst_norm < 0) throw new Error('B/L 상세 원천 값 또는 기간이 올바르지 않습니다.');
      if (!totals.has(row.YYYYMM)) totals.set(row.YYYYMM, [0,0,0]);
      const sum = totals.get(row.YYYYMM);
      sum[0] += row.norm_lst; sum[1] += row.cm1_norm; sum[2] += row.lst_norm;
    }
    for (const month of months) {
      const sum = totals.get(month) || [0,0,0], proof = source.monthlyChecks[month];
      if (['manifestTeu','manifestCm1','manifestCm1BasisTeu'].some((field,index) => Math.abs(sum[index] - proof[field]) > .01)) throw new Error('B/L 상세와 월별 검증 합계가 일치하지 않습니다.');
    }
    if (rows.reduce((sum,row) => sum + row.norm_bl,0) !== detail.identifierCount) throw new Error('B/L 상세 건수 검증에 실패했습니다.');
    return rows;
  }
  function apply(data, readers) {
    if (data._currentComponentsApplied) return;
    if (data.independent_bsa_error || data.independent_bl_error) throw new Error('최신 원천 로드 실패: ' + (data.independent_bsa_error || data.independent_bl_error));
    const bsa = readers.bsa(data), bl = readers.bl(data);
    // Validate every candidate before changing any published measure.
    const blRows = bl ? validateDetail(bl) : null;
    const bsaRows = bsa ? objects(bsa.table) : null;
    if (bsaRows?.some(row => !/^2026\d{2}$/.test(row.YYYYMM) || !Number.isInteger(Number(row.WW)) || Number(row.WW)<1 || Number(row.WW)>53)) throw new Error('BSA 회계 주차 매핑이 없습니다.');
    const dates = {booking:data.data_date, wos:data.data_date, bsa:data.data_date, bl:data.data_date};
    if (blRows) {
      const months = new Set(bl.scopeMonths);
      const metadata = new Map();
      for (const row of data.shipper || []) {
        const k = key(row,['BKG_SHPR_CST_NO','origin','ori_port']);
        if (!metadata.has(k)) metadata.set(k, {grades:new Set(), tags:new Set(), owners:new Set()});
        const item = metadata.get(k);
        if (row.grade) item.grades.add(row.grade);
        if (row.tag) item.tags.add(row.tag);
        if (row.Salesman_POR) item.owners.add(row.Salesman_POR);
      }
      // Rebuild the existing whole-period route/shipper CM1 basis with current
      // own-B/L facts, keeping the historical and WOS cohorts intact.
      const basisRows = [...(data.shipper || []).filter(row => !months.has(row.YYYYMM)), ...blRows];
      const routes = new Map(), shippers = new Map();
      for (const row of basisRows) {
        if (!(row.norm_lst > 0) || !row.cm1_norm) continue;
        for (const [map, fields] of [[routes,['ori_port','dst_port']],[shippers,['BKG_SHPR_CST_NO','ori_port','dst_port']]]) {
          const k = key(row,fields), entry = map.get(k) || {cm1:0,lst:0};
          entry.cm1 += row.cm1_norm; entry.lst += row.norm_lst; map.set(k,entry);
        }
      }
      for (const section of ['monthly','weekly','shipper']) {
        for (const row of data[section] || []) {
          if (months.has(row.YYYYMM)) for (const field of actual) row[field] = 0;
        }
      }
      const monthly = new Map((data.monthly || []).map(row => [key(row,dims),row]));
      const weekly = new Map((data.weekly || []).map(row => [key(row,[...dims,'week_start_date']),row]));
      const highOrigin = row => {
        const info = metadata.get(key(row,['BKG_SHPR_CST_NO','origin','ori_port']));
        row.grade = info?.grades.size === 1 ? [...info.grades][0] : '';
        row.tag = info?.tags.size === 1 ? [...info.tags][0] : '';
        if (info?.owners.size === 1) row.Salesman_POR = [...info.owners][0];
        return row.tag === '고수익화주';
      };
      for (const source of blRows) {
        const row = {...source};
        const hi = highOrigin(row), basis = shippers.get(key(row,['BKG_SHPR_CST_NO','ori_port','dst_port']));
        const route = routes.get(key(row,['ori_port','dst_port']));
        const routeHi = basis && route && basis.cm1 / basis.lst >= route.cm1 / route.lst;
        row.route_hi_norm_bl = routeHi ? row.norm_bl : 0;
        row.route_hi_norm_lst = routeHi ? row.norm_lst : 0;
        row.route_hi_cm1_norm = routeHi ? row.cm1_norm : 0;
        row.hi_norm_bl = hi ? row.norm_bl : 0; row.hi_norm_lst = hi ? row.norm_lst : 0;
        row.hi_cm1_norm = hi ? row.cm1_norm : 0; row.hi_lst_norm = hi ? row.lst_norm : 0;
        row.basis_cm1 = basis?.cm1 || 0; row.basis_lst = basis?.lst || 0;
        data.shipper.push(row);
        for (const [section, map, fields] of [['monthly',monthly,dims],['weekly',weekly,[...dims,'week_start_date']]]) {
          const k = key(row,fields);
          let target = map.get(k);
          if (!target) { target = Object.fromEntries(fields.map(field => [field,row[field]])); map.set(k,target); data[section].push(target); }
          for (const field of actual) target[field] = (target[field] || 0) + (row[field] || 0);
        }
      }
      // The drilldown deduplicates this basis by shipper/port pair. Update old
      // Booking rows too so row order cannot select an outdated basis.
      for (const row of data.shipper) {
        const basis = shippers.get(key(row,['BKG_SHPR_CST_NO','ori_port','dst_port']));
        row.basis_cm1 = basis?.cm1 || 0; row.basis_lst = basis?.lst || 0;
      }
      data.route_profit_basis = {version:1,routes:[...routes].map(([k,value]) => {const [ori_port,dst_port] = JSON.parse(k);return {ori_port,dst_port,...value};})};
      dates.bl = bl.sourceDate;
    }
    if (bsaRows) {
      const months = new Set(bsa.scopeMonths);
      data.bsa = [...data.bsa.filter(row => !months.has(row.YYYYMM)), ...bsaRows];
      // Keep BSA-only lanes selectable through the existing shared filters.
      const monthly = new Set(data.monthly.map(row => key(row,dims)));
      const weekly = new Set(data.weekly.map(row => key(row,[...dims,'week_start_date'])));
      for (const source of bsaRows) {
        const row = {...source,ori_port:source.POR_PORT,dst_port:source.DLY_PORT};
        const year = Number(source.YYYYMM.slice(0,4));
        if (year !== 2026) throw new Error('BSA 회계 주차 연도 매핑이 없습니다.');
        const start = new Date(Date.UTC(year,0,4 + (Number(source.WW)-1)*7));
        row.week_start_date = `${year}년 ${String(start.getUTCMonth()+1).padStart(2,'0')}월 ${String(start.getUTCDate()).padStart(2,'0')}일`;
        for (const [section,seen,fields] of [['monthly',monthly,dims],['weekly',weekly,[...dims,'week_start_date']]]) {
          const k = key(row,fields);
          if (!seen.has(k)) { data[section].push(Object.fromEntries(fields.map(field => [field,row[field]]))); seen.add(k); }
        }
      }
      dates.bsa = bsa.sourceDate;
    }
    data.current_component_dates = dates;
    data._currentComponentsApplied = true;
  }
  const api = {apply,validateDetail};
  if (typeof module !== 'undefined') module.exports = api;
  else root.CurrentComponents = api;
})(typeof window === 'undefined' ? globalThis : window);
