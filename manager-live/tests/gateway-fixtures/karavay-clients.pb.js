/// <reference path="../pb_data/types.d.ts" />
// ТОЛЬКО ТЕСТ: /service/clients?payer=<PocketBase payer ID>.
// Rights: active=true, scope=all или scope=client + kis_client_id.
// KIS: GET /api/v1/payers/{id_pay}/clients + GET /api/v1/clients/{id}.
// ВАЖНО: state=1 временно рассматривается как активный (требует подтверждения КИС).
routerAdd('GET', '/service/clients', (e) => {
  const begin = Date.now();
  let responseStatus = 200;
  const requestId = $security.randomString(18);
  e.response.header().set('Cache-Control', 'no-store');
  e.response.header().set('X-Request-ID', requestId);

  function fail(status, code) {
    throw {status: status, code: code};
  }
  function positiveId(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  }
  function kisGet(path) {
    // Fixed internal host + strictly numeric path values. Never use user input as host/path.
    const target = 'http://serv15db:55580/api/v1' + path;
    const args = ['--disable', '--silent', '--show-error', '--noproxy', '*',
      '--proto', '=http', '--max-redirs', '0', '--connect-timeout', '3',
      '--max-time', '10', '--max-filesize', '2097152',
      '-H', 'Accept: application/json', '-w', '\n__KIS_HTTP__:%{http_code}',
      '--url', target];
    let text;
    try { text = toString($os.cmd('curl', ...args).output()); }
    catch (err) {
      const s = String(err);
      if (s.indexOf('exit status 28') !== -1) fail(504, 'UPSTREAM_TIMEOUT');
      fail(502, 'UPSTREAM_NETWORK');
    }
    const match = /\n__KIS_HTTP__:(\d{3})$/.exec(text);
    if (!match || match[1] !== '200') fail(502, 'UPSTREAM_HTTP');
    const body = text.slice(0, match.index);
    if (body.length > 2097152) fail(502, 'UPSTREAM_OVERSIZE');
    let obj;
    try { obj = JSON.parse(body); }
    catch (_) { fail(502, 'UPSTREAM_INVALID_JSON'); }
    if (!obj || obj.success !== true) fail(502, 'UPSTREAM_INVALID_ENVELOPE');
    return obj.data;
  }

  try {
    const raw = e.request.url.rawQuery || '';

    const q = /^payer=([a-z0-9]{15})(?:&cursor=([1-9][0-9]{0,15}))?(?:&perPage=([1-9]|1[0-9]|20))?$/.exec(raw);
    if (!q) fail(400, 'INVALID_PARAMETERS');
    const payerPbId = q[1];
    const cursor = q[2] ? Number(q[2]) : 0;
    const perPage = q[3] ? Number(q[3]) : 20;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      fail(400, 'INVALID_PARAMETERS');

    const uid = e.auth ? e.auth.id : '';
    if (!uid) fail(401, 'AUTH_REQUIRED');

    let user, payer;
    try {
      user = e.app.findRecordById('users', uid);
      payer = e.app.findRecordById('payers', payerPbId);
    } catch (_) { fail(403, 'ACCESS_DENIED'); }

    if (!user.get('active') || user.get('must_change_password') ||
        !['owner','manager','viewer'].includes(user.get('role_code')) ||
        !payer.get('active')) fail(403, 'ACCESS_DENIED');

    const kisPayerId = payer.get('id_pay');
    if (!positiveId(kisPayerId)) fail(502, 'INVALID_PAYER_MAPPING');

    let globalRight, specificRights;
    try {
      globalRight = e.app.findRecordsByFilter('rights',
        'user = {:uid} && payer = {:pid} && active = true && scope = "all" && kis_client_id = 0',
        '', 1, 0, {uid: uid, pid: payerPbId}).length > 0;
      specificRights = new Set();
      if (!globalRight) {
        for (let offset=0; offset<=10000; offset+=200) {
          const rows=e.app.findRecordsByFilter('rights',
            'user = {:uid} && payer = {:pid} && active = true && scope = "client"',
            '', 200, offset, {uid: uid, pid: payerPbId});
          for (const r of rows) {
            const id = r.get('kis_client_id');
            if (!positiveId(id)) fail(403, 'INVALID_RIGHT');
            specificRights.add(id);
          }
          if (rows.length < 200) break;
          if (offset === 10000) fail(502, 'TOO_MANY_RIGHTS');
        }
      }
    } catch (err) {
      if (err && err.status) throw err;
      fail(502, 'RIGHTS_QUERY_FAILED');
    }
    if (!globalRight && !specificRights.size) fail(403, 'ACCESS_DENIED');

    const list = kisGet('/payers/' + kisPayerId + '/clients');
    if (!Array.isArray(list) || list.length > 2000) fail(502, 'UNSUPPORTED_KIS_LIST_SIZE');
    const found=new Set();
    const permitted=[];
    for (const item of list) {
      if (!item || !positiveId(item.id) || found.has(item.id)) fail(502, 'INVALID_KIS_CLIENT');
      found.add(item.id);
      if (globalRight || specificRights.has(item.id)) permitted.push(item);
    }

    permitted.sort((a, b) => a.id - b.id);
    const result = [];
    let nextCursor = cursor;
    let scanned = 0;

    for (const item of permitted) {
      if (item.id <= cursor) continue;
      if (result.length >= perPage ||
          scanned >= perPage * 3 ||
          Date.now() - begin > 30000) break;

      const detail = kisGet('/clients/' + item.id);

      if (!detail || detail.id !== item.id ||
          detail.payer_id !== kisPayerId ||
          typeof detail.state !== 'number')
        fail(502, 'INVALID_KIS_CLIENT_DETAILS');

      scanned++;
      nextCursor = item.id;

      if (detail.state !== 1) continue;

      result.push({
        id: item.id,
        code: typeof item.kod === 'string' ? item.kod : '',
        name: typeof item.name === 'string' ? item.name : '',
        address: typeof item.adres === 'string' ? item.adres : ''
      });
    }

    const hasMore = permitted.some(item => item.id > nextCursor);
    if (hasMore && nextCursor === cursor)
      fail(504, 'UPSTREAM_TIMEOUT');

    // Recheck user and payer after KIS calls.
    let freshUser, freshPayer;
    try {
      freshUser = e.app.findRecordById('users', uid);
      freshPayer = e.app.findRecordById('payers', payerPbId);
    } catch (_) { fail(403, 'ACCESS_DENIED'); }

    if (!freshUser.get('active') ||
        freshUser.get('must_change_password') ||
        !['owner','manager','viewer'].includes(freshUser.get('role_code')) ||
        !freshPayer.get('active') ||
        freshPayer.get('id_pay') !== kisPayerId)
      fail(403, 'ACCESS_CHANGED');

    let nowAll = false;
    const nowSpecific = new Set();

    try {
      nowAll = e.app.findRecordsByFilter('rights',
        'user = {:uid} && payer = {:pid} && active = true && scope = "all" && kis_client_id = 0',
        '', 1, 0, {uid:uid, pid:payerPbId}).length > 0;

      if (!nowAll) {
        let done = false;
        for (let offset = 0; offset < 10000; offset += 200) {
          const rows = e.app.findRecordsByFilter('rights',
            'user = {:uid} && payer = {:pid} && active = true && scope = "client"',
            'id', 200, offset, {uid:uid, pid:payerPbId});

          for (const r of rows) {
            const id = r.get('kis_client_id');
            if (!positiveId(id)) fail(403, 'ACCESS_CHANGED');
            nowSpecific.add(id);
          }

          if (rows.length < 200) {
            done = true;
            break;
          }
        }
        if (!done) fail(502, 'TOO_MANY_RIGHTS');
      }
    } catch (err) {
      if (err && err.status) throw err;
      fail(502, 'RIGHTS_QUERY_FAILED');
    }

    if (nowAll !== globalRight) fail(403, 'ACCESS_CHANGED');

    if (!globalRight) {
      if (nowSpecific.size !== specificRights.size)
        fail(403, 'ACCESS_CHANGED');

      for (const id of specificRights)
        if (!nowSpecific.has(id))
          fail(403, 'ACCESS_CHANGED');
    }

    return e.json(200, {
      payer: payerPbId,
      perPage: perPage,
      nextCursor: hasMore ? nextCursor : null,
      hasMore: hasMore,
      count: result.length,
      clients: result
    });
  } catch (err) {
    responseStatus = err && [400,401,403,502,504].includes(err.status) ? err.status : 502;
    const codes={400:'INVALID_PARAMETERS',401:'AUTH_REQUIRED',403:'ACCESS_DENIED',
      502:'UPSTREAM_UNAVAILABLE',504:'UPSTREAM_TIMEOUT'};
    return e.json(responseStatus, {code:codes[responseStatus], requestId:requestId});
  } finally {
    e.app.logger().info('service.clients', 'requestId', requestId,
      'status', responseStatus, 'durationMs', Date.now()-begin);
  }
}, $apis.requireAuth('users'));
