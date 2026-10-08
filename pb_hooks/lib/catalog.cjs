'use strict';
// CommonJS shared by PocketBase JSVM and the Node test harness. No cached records.
function fail(status, code) { const e = new Error(code); e.status = status; e.code = code; throw e; }
function integer(n, min) { return typeof n === 'number' && Number.isSafeInteger(n) && n >= min; }
function pbId(s) { return typeof s === 'string' && /^[a-z0-9]{15}$/.test(s); }
function parseRawQuery(raw) {
  const values = Object.create(null);
  if (typeof raw !== 'string' || raw.length > 2048) fail(400,'INVALID_PARAMETERS');
  if (!raw) return values;
  for (const part of raw.split('&')) {
    const at = part.indexOf('=');
    if (at < 1) fail(400,'INVALID_PARAMETERS');
    let key, value;
    try { key = decodeURIComponent(part.slice(0,at).replace(/\+/g,' ')); value = decodeURIComponent(part.slice(at+1).replace(/\+/g,' ')); } catch (_) { fail(400,'INVALID_PARAMETERS'); }
    if (!values[key]) values[key] = [];
    values[key].push(value);
  }
  return values;
}
function query(values) {
  const allowed = ['client', 'payer', 'DateOrd', 'Group'];
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key) || !Array.isArray(values[key]) || values[key].length !== 1) fail(400, 'INVALID_PARAMETERS');
  }
  const v = (k) => values[k] && values[k][0];
  if (!pbId(v('client')) || (v('payer') !== undefined && !pbId(v('payer')))) fail(400, 'INVALID_PARAMETERS');
  if (!/^[1-9][0-9]{0,9}$/.test(v('DateOrd') || '') || Number(v('DateOrd')) > 4102444800 || !/^[01]$/.test(v('Group') || '')) fail(400, 'INVALID_PARAMETERS');
  return {client: v('client'), payer: v('payer'), date: Number(v('DateOrd')), group: Number(v('Group'))};
}
function authorize(repo, auth, q) {
  if (!auth || auth.collection !== 'users') fail(401, 'AUTH_REQUIRED');
  let user, role, client, payer;
  try {
    user = repo.get('users', auth.id);
    if (!user || user.active !== true || user.must_change_password !== false || !pbId(user.role)) fail(403, 'ACCESS_DENIED');
    role = repo.get('roles', user.role);
    if (!role || role.active !== true || !['owner','manager','viewer'].includes(role.code_role)) fail(403, 'ACCESS_DENIED');
    client = repo.get('clients', q.client);
    if (!client || client.active !== true || !pbId(client.payer)) fail(403, 'ACCESS_DENIED');
    payer = repo.get('payers', client.payer);
    if (!payer || payer.active !== true || (q.payer && q.payer !== client.payer)) fail(403, 'ACCESS_DENIED');
    if (!repo.hasRight(auth.id, client.payer, q.client)) fail(403, 'ACCESS_DENIED');
  } catch (e) { if (e.status) throw e; fail(403, 'ACCESS_DENIED'); }
  if (!integer(client.id_clt, 1) || !integer(payer.id_pay, 1)) fail(502, 'INVALID_CONFIGURATION');
  return {payer: client.payer, kisClient: client.id_clt, kisPayer: payer.id_pay};
}
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v) && !/https?:\/\/|serv15db|192\.168\./i.test(v); }
function matrix(raw, scope, q) {
  let m; try { m = JSON.parse(raw); } catch (_) { fail(502, 'INVALID_UPSTREAM'); }
  if (!object(m) || m.id_clt !== scope.kisClient || m.DateOrd !== q.date || m.Group !== q.group || !Array.isArray(m.Product) || m.Product.length > 10000) fail(502, 'INVALID_UPSTREAM');
  if (m.Id_pay !== undefined && m.Id_pay !== scope.kisPayer) fail(502, 'INVALID_UPSTREAM');
  const seen = Object.create(null);
  const products = m.Product.map(p => {
    if (!object(p) || !integer(p.id_prd, 1) || seen[p.id_prd] || !text(p.KodProd, 100) || !text(p.NameProd, 500) || !integer(p.KolUkl, 1) || typeof p.CenaOTP !== 'number' || !Number.isFinite(p.CenaOTP) || p.CenaOTP < 0 || p.Group !== q.group) fail(502, 'INVALID_UPSTREAM');
    if ((p.id_clt !== undefined && p.id_clt !== scope.kisClient) || (p.Id_pay !== undefined && p.Id_pay !== scope.kisPayer)) fail(502, 'INVALID_UPSTREAM');
    seen[p.id_prd] = true;
    const out = {id_prd:p.id_prd, KodProd:p.KodProd, NameProd:p.NameProd, KolUkl:p.KolUkl, CenaOTP:p.CenaOTP, Group:p.Group};
    for (const k of ['BaseCenaOTP','Vesprod','ProcSkd']) if (p[k] !== undefined) {
      if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0 || (k === 'ProcSkd' && p[k] > 100)) fail(502, 'INVALID_UPSTREAM'); out[k] = p[k];
    }
    if (p.KolshtOrdmin !== undefined) { if (p.KolshtOrdmin !== null && !integer(p.KolshtOrdmin,1)) fail(502,'INVALID_UPSTREAM'); out.KolshtOrdmin = p.KolshtOrdmin; }
    for (const k of ['MarketingGroup','Srok']) if (p[k] !== undefined) { if (!text(p[k],200)) fail(502,'INVALID_UPSTREAM'); out[k] = p[k]; }
    return out;
  });
  return {client:q.client, payer:scope.payer, DateOrd:q.date, Group:q.group, Product:products};
}
function curlArgs(scope, q) {
  return ['--disable','--silent','--show-error','--request','GET','--proto','=http','--noproxy','*','--connect-timeout','3','--max-time','10','--max-filesize','2097152','--max-redirs','0','--header','Accept: application/json','--write-out','\n%{http_code}','--url','http://serv15db:55580/api/v1/clients/'+scope.kisClient+'/matrix?DateOrd='+q.date+'&Group='+q.group];
}
function fetchMatrix(run, scope, q) {
  let result;
  try { result = run(curlArgs(scope,q)); } catch(e) { fail(/exit status 28\b/.test(String(e)) ? 504 : 502, /exit status 28\b/.test(String(e)) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'); }
  if (typeof result !== 'string' || result.length > 2097160) fail(502,'INVALID_UPSTREAM');
  const match = /\n([0-9]{3})$/.exec(result);
  if (!match || match[1] !== '200') fail(502,'UPSTREAM_UNAVAILABLE');
  return matrix(result.slice(0,match.index),scope,q);
}
function catalog(repo, auth, values, run) {
  if (!auth || auth.collection !== 'users') fail(401,'AUTH_REQUIRED');
  const q = query(values), before = authorize(repo,auth,q);
  const data = fetchMatrix(run,before,q);
  const after = authorize(repo,auth,q);
  if (after.payer !== before.payer || after.kisClient !== before.kisClient || after.kisPayer !== before.kisPayer) fail(403,'ACCESS_DENIED');
  return data;
}
module.exports = {parseRawQuery, catalog, query, authorize, matrix, curlArgs, fetchMatrix};
