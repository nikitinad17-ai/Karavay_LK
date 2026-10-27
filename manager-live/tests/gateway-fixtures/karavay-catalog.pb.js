/// <reference path="../pb_data/types.d.ts" />
// 3.7.2: dated KIS matrix; legacy products request remains compatible.
routerAdd('GET', '/service/catalog', (e) => {
  const started = Date.now();
  const requestId = $security.randomString(18);
  let status = 200;
  e.response.header().set('Cache-Control', 'no-store');
  e.response.header().set('X-Request-ID', requestId);

  function fail(http, code) { throw {status:http, code:code}; }
  function posId(v) {
    return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  }

  function repairDecimals(s) {
    let out = '', quoted = false, escaped = false, fixed = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { out += ch; quoted = true; continue; }
      if ((ch === '.' && /[0-9]/.test(s[i+1] || '')) ||
          (ch === '-' && s[i+1] === '.' && /[0-9]/.test(s[i+2] || ''))) {
        const prev = out.trim().slice(-1);
        if (prev === ':' || prev === '[' || prev === ',') {
          if (ch === '-') { out += '-0.'; i++; }
          else out += '0.';
          fixed++;
          continue;
        }
      }
      out += ch;
    }
    return {text:out, count:fixed};
  }

  function kisGet(path, fixProducts) {
    const url = 'http://serv15db:55580/api/v1' + path;
    const args = [
      '--disable','--silent','--show-error','--noproxy','*',
      '--proto','=http','--max-redirs','0',
      '--connect-timeout','3','--max-time','15',
      '--max-filesize','2097152',
      '-H','Accept: application/json',
      '-w','\n__KIS_HTTP__:%{http_code}',
      '--url',url
    ];

    let raw;
    try { raw = toString($os.cmd('curl', ...args).output()); }
    catch (err) {
      if (String(err).includes('exit status 28'))
        fail(504, 'UPSTREAM_TIMEOUT');
      fail(502, 'UPSTREAM_UNAVAILABLE');
    }

    const match = /\n__KIS_HTTP__:(\d{3})$/.exec(raw);
    if (!match || match[1] !== '200')
      fail(502, 'UPSTREAM_HTTP');

    const body = raw.slice(0, match.index);
    if (body.length > 2097152)
      fail(502, 'UPSTREAM_OVERSIZE');

    let doc;
    try { doc = JSON.parse(body); }
    catch (err) {
      if (!fixProducts) fail(502, 'UPSTREAM_INVALID_JSON');
      const r = repairDecimals(body);
      if (!r.count || r.count > 10000)
        fail(502, 'UPSTREAM_INVALID_JSON');
      try { doc = JSON.parse(r.text); }
      catch (err2) { fail(502, 'UPSTREAM_INVALID_JSON'); }
      e.app.logger().info('kis.products.invalid_decimals',
        'count', r.count);
    }

    if (Array.isArray(doc) && path.includes('/matrix?')) return doc;
    if (!doc || doc.success !== true || !('data' in doc))
      fail(502, 'UPSTREAM_INVALID_ENVELOPE');
    return doc.data;
  }

  function authorize(uid, payerPB, kisClient, expectedPayer) {
    let user, payer;
    try {
      user = e.app.findRecordById('users', uid);
      payer = e.app.findRecordById('payers', payerPB);
    } catch (err) { fail(403, 'ACCESS_DENIED'); }

    if (user.get('active') !== true ||
        user.get('must_change_password') === true ||
        !['owner','manager','viewer'].includes(user.get('role_code')) ||
        payer.get('active') !== true)
      fail(403, 'ACCESS_DENIED');

    const kisPayer = payer.get('id_pay');
    if (!posId(kisPayer)) fail(502, 'INVALID_PAYER_MAPPING');
    if (expectedPayer != null && kisPayer !== expectedPayer)
      fail(403, 'ACCESS_DENIED');

    let allowed = false;
    try {
      const common = e.app.findRecordsByFilter('rights',
        'user = {:uid} && payer = {:payer} && active = true && scope = "all" && kis_client_id = 0',
        '', 1, 0, {uid:uid, payer:payerPB});
      allowed = common.length > 0;

      if (!allowed) {
        const specific = e.app.findRecordsByFilter('rights',
          'user = {:uid} && payer = {:payer} && active = true && scope = "client" && kis_client_id = {:client}',
          '', 1, 0,
          {uid:uid, payer:payerPB, client:kisClient});
        allowed = specific.length > 0;
      }
    } catch (err) { fail(502, 'RIGHTS_QUERY_FAILED'); }

    if (!allowed) fail(403, 'ACCESS_DENIED');
    return kisPayer;
  }

  try {
    const raw = e.request.url.rawQuery || '';
    const q = /^payer=([a-z0-9]{15})&client=([1-9][0-9]{0,14})(?:&DateOrd=([0-9]{10})&Group=([01]))?$/.exec(raw);
    if (!q) fail(400, 'INVALID_PARAMETERS');

    const matrixMode = q[3] !== undefined;
    const dateOrd = matrixMode ? Number(q[3]) : null;
    const group = matrixMode ? Number(q[4]) : null;
    // Start of selected calendar day in Saint Petersburg (UTC+3).
    if (matrixMode && (dateOrd < 946674000 || dateOrd > 4102434000 ||
        (dateOrd + 10800) % 86400 !== 0)) fail(400, 'INVALID_PARAMETERS');
    const payerPB = q[1];
    const kisClient = Number(q[2]);
    if (!posId(kisClient)) fail(400, 'INVALID_PARAMETERS');

    const uid = e.auth ? e.auth.id : '';
    if (!uid) fail(401, 'AUTH_REQUIRED');

    const kisPayer = authorize(uid, payerPB, kisClient, null);

    const detail = kisGet('/clients/' + kisClient, false);
    if (!detail || detail.id !== kisClient ||
        detail.payer_id !== kisPayer ||
        detail.state !== 1)
      fail(403, 'ACCESS_DENIED');

    const clients = kisGet('/payers/' + kisPayer + '/clients', false);
    if (!Array.isArray(clients) || clients.length > 2000)
      fail(502, 'INVALID_KIS_CLIENTS');
    if (!clients.some(x => x && x.id === kisClient))
      fail(403, 'ACCESS_DENIED');

    const products = kisGet('/clients/' + kisClient + (matrixMode ? '/matrix?DateOrd=' + dateOrd + '&Group=' + group : '/products'), true);
    if (!Array.isArray(products) || products.length > 10000)
      fail(502, 'INVALID_PRODUCTS');

    const seen = new Set();
    const items = products.map(source => {
      const p = matrixMode && source ? {
        id:source.id_prd != null ? source.id_prd : source.id,
        kod:source.kod_prod, name:source.nameprod, weight:source.vesprod,
        shelf_life:source.srok, kol_sht:source.kolukl
      } : source;
      if (!p || !posId(p.id) || seen.has(p.id) ||
          typeof p.kod !== 'string' ||
          typeof p.name !== 'string')
        fail(502, 'INVALID_PRODUCT');

      seen.add(p.id);
      const out = {id:p.id, kod:p.kod, name:p.name};

      if (typeof p.weight === 'number' && Number.isFinite(p.weight))
        out.weight = p.weight;
      if (typeof p.shelf_life === 'string' ||
          typeof p.shelf_life === 'number')
        out.shelf_life = p.shelf_life;
      if (typeof p.kol_sht === 'number' &&
          Number.isSafeInteger(p.kol_sht))
        out.kol_sht = p.kol_sht;

      if (matrixMode) {
        // Preserve KIS values; never calculate or invent prices.
        for (const key of ['basecenaotp','procskd','cenaotp','kolshtordmin']) {
          const v = source[key];
          if (v == null) out[key] = null;
          else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
          else fail(502, 'INVALID_PRODUCT');
        }
      }
      return out;
    });

    // Check permissions again after reading from KIS.
    authorize(uid, payerPB, kisClient, kisPayer);

    return e.json(200, {
      payer:payerPB,
      client:kisClient,
      DateOrd:dateOrd, Group:group, source:matrixMode ? 'matrix' : 'products',
      count:items.length,
      products:items
    });
  } catch (err) {
    status = err && [400,401,403,502,504].includes(err.status)
      ? err.status : 502;
    const code = err && typeof err.code === 'string'
      ? err.code : 'CATALOG_UNAVAILABLE';
    return e.json(status, {code:code, requestId:requestId});
  } finally {
    e.app.logger().info('service.catalog',
      'requestId',requestId,
      'status',status,
      'durationMs',Date.now()-started);
  }
}, $apis.requireAuth('users'));
