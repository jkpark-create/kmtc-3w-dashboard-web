// Google Drive folders used by the authenticated dashboard data loaders.
// Runtime files are updated in place, so these folder IDs remain stable.
window.DASHBOARD_DRIVE_CONFIG = Object.freeze({
  rootFolderId: "1qwcpaBcfwSpT9UTTLukajuSrxtjTRqYC",
  mainFolderId: "1lDyEaYHhvkMw6BoTJxSNgkWG0-BbMtpY",
  mainHistoryFolderId: "1q8XdzDbYHGL6aObw0cGik8xOQgNkNgmg",
  mainSourceFolderId: "1zUm2P3VbwkRR6Up_zK111PV5moApKT65",
  obtFolderId: "1ChAP3LiukrM3_GFDBL-kfgC8S4ejJ66P",
  salesFolderId: "1pfGPPjtbQN7daHfeJ2vPY2blJYPTw0jl",
  salesDataFolderId: "1vwXvhaxItQ00E3u5pxFebuX1d3v6t31-"
});

// Candidate global barrier. Added verbatim to the existing drive-config.js.
(function (host) {
  'use strict';
  const POINTER='1guOCSjoi-vy0iJD-savw4uMlkE_K7fTn';
  const INTEGRATED='1EF5MH1jQziPzZC2FNj_J7z0_03TsMP0f';
  function fail(message) { const error=new Error(message);error.code='PUBLICATION_NOT_READY';throw error; }
  async function response(id,token) {
    if (!token) fail('Authenticated publication read required');
    const value=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
      {cache:'no-store',headers:{Authorization:'Bearer '+token}});
    if (!value.ok) fail('Publication read failed: HTTP '+value.status);
    return value;
  }
  function publishedSourceDates(publication) {
    const protectedHead=publication?.sourceHeadDescriptor;
    const heads=protectedHead?.heads;
    if (!heads || protectedHead.sourceDate!==publication.sourceDate
        || protectedHead.headDigest!==publication.sourceHeadDigest) return null;
    const dates={
      booking:String(heads.canonicalBooking?.loadDtm||'').slice(0,10).replaceAll('-',''),
      preparedBooking:heads.readiness?.sandboxPreparedBookingLatestBascDt,
      bsa:heads.bsa?.bascDt,
      bl:heads.readiness?.sandboxBlLatestBascDt,
      schedule:String(heads.schedule?.closDtm||'').slice(0,10).replaceAll('-','')
    };
    if (!Object.values(dates).every(day=>typeof day==='string' && /^\d{8}$/.test(day))) return null;
    const declared=publication.sourceDates;
    if (declared && Object.keys(dates).some(name=>dates[name]!==declared[name])) return null;
    return Object.freeze(dates);
  }
  async function check(token) {
    const gate=await (await response(POINTER,token)).json(),p=gate.publication;
    const compatibleFormat=gate._format==='sales-target-release-v3' ||
      (['sales-target-release-v1','sales-target-release-v2'].includes(gate._format) && p?.mode==='verified-existing-body-bootstrap');
    if (!compatibleFormat || p?.protocol!=='latest-global-gate-v1' || p.state!=='ready'
        || !p.runId || !['main','obt','sales'].every(k=>/^[a-f0-9]{64}$/.test(p.components?.[k]?.sha256||''))
        || p.integrated?.controlFileId!==INTEGRATED || !p.integrated.generation) fail('Dashboard publication is updating or unverified');
    const integrated=await (await response(INTEGRATED,token)).json();
    if (integrated.protocol!=='stable-id-latest-v1' || integrated.state!=='ready'
        || integrated.generation!==p.integrated.generation) fail('Integrated publication is updating or mismatched');
    return {gate,identity:JSON.stringify(gate),integratedIdentity:JSON.stringify(integrated)};
  }
  async function assertSame(before,token) {
    const after=await check(token);
    if (before.identity!==after.identity || before.integratedIdentity!==after.integratedIdentity) fail('Dashboard generation changed while loading; refresh');
  }
  async function within(token,task) {
    const before=await check(token),result=await task(before);
    await assertSame(before,token);return result;
  }
  async function readJson(id,name,token) {
    return within(token,async before=>{
      if (['independent_bsa.json.gz','independent_bl.json.gz'].includes(name) && before.gate.publication.unavailableOptional?.includes(name)) {
        const error=new Error('Optional independent data is not provided for this verified publication');
        error.code='OPTIONAL_UNAVAILABLE';throw error;
      }
      const entries=Object.values(before.gate.publication.assets||{}).concat(Object.values(before.gate.objects||{}));
      const descriptor=entries.find(x=>x.id===id && x.name===name && !x.member);
      const immutableHistory=/^dashboard_summary_(?:\d{4}|\d{8})\.json$/.test(name);
      if (!descriptor && !immutableHistory) fail('Current data descriptor missing from publication gate');
      const bytes=await (await response(id,token)).arrayBuffer();
      if (descriptor) {
        const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
        if (bytes.byteLength!==descriptor.size || actual!==descriptor.sha256) fail('Publication body proof differs');
      }
      let body=new Response(bytes);
      if (name.endsWith('.gz')) {
        if (!('DecompressionStream' in host)) fail('Gzip support is required');
        body=new Response(body.body.pipeThrough(new DecompressionStream('gzip')));
      }
      const value=await body.json();
      if (value && typeof value==='object') {
        Object.defineProperty(value,'__latestPublicationRunId',{value:before.gate.publication.runId,enumerable:false});
        if (name==='data.json.gz' && descriptor && value.data_date===before.gate.data_date) {
          Object.defineProperty(value,'__publishedSourceDates',{value:publishedSourceDates(before.gate.publication),enumerable:false});
        }
      }
      return value;
    });
  }
  function showOptionalNotice(data) {
    const labels=['bsa','bl'].filter(k=>data['independent_'+k+'_unavailable']).map(k=>k.toUpperCase());
    const doc=host.document;
    if (!doc) return;
    let panel=doc.getElementById('latest-optional-notice');
    if (!labels.length) { if(panel) panel.remove(); return; }
    if (!panel) { panel=doc.createElement('div'); panel.id='latest-optional-notice'; panel.setAttribute('role','status'); (doc.querySelector('main')||doc.body).prepend(panel); }
    panel.textContent='별도 '+labels.join(' / ')+' 보정 자료는 이번 게시에서 제공되지 않습니다. 기본 대시보드의 원본 집계는 유지됩니다.';
  }
  host.KMTCGlobalGate=Object.freeze({check,assertSame,within,readJson,publishedSourceDates,showOptionalNotice,pointerId:POINTER,integratedControlId:INTEGRATED});
})(globalThis);
