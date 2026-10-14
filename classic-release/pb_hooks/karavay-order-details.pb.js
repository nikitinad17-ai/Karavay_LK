// Additional read-only routes; write contract is deliberately not enabled.
routerAdd('GET', '/service/order-options', e=>{
  e.response.header().set('Cache-Control','no-store');
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

    let role;
    try { role=e.app.findRecordById('roles',user.get('role')); } catch (_) { fail(403,'ACCESS_DENIED'); }
    if(role.get('active')!==true || role.get('code_role')!==user.get('role_code'))fail(403,'ACCESS_DENIED');
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
    const q=/^payer=([a-z0-9]{15})&client=([1-9][0-9]{0,14})$/.exec(e.request.url.rawQuery||'');
    if(!q)fail(400,'INVALID_PARAMETERS');
    const payer=q[1],client=Number(q[2]),uid=e.auth.id;
    if(!posId(client))fail(400,'INVALID_PARAMETERS');
    const kid=authorize(uid,payer,client,null);
    const c=kisGet('/clients/'+client,false);
    if(!c||c.id!==client||c.payer_id!==kid||c.state!==1)fail(403,'ACCESS_DENIED');
    const list=kisGet('/payers/'+kid+'/clients',false);
    if(!Array.isArray(list)||!list.some(x=>x&&x.id===client))fail(403,'ACCESS_DENIED');
    let result;
    if('options'==='options') {
      const min=c.ord_min_sum;
      result={create:false,details:false,minimumSum:typeof min==='number'&&Number.isFinite(min)&&min>=0?min:null,minimumSumIncludesVat:c.ord_min_sum_flg_nds===1?true:c.ord_min_sum_flg_nds===0?false:null,reason:'ORDER_CONTRACT_PENDING'};
    } else {
      const raw=e.request.pathValue('id');
      if(!/^[1-9][0-9]{0,14}$/.test(raw)||!posId(Number(raw)))fail(400,'INVALID_ORDER_ID');
      const d=kisGet('/orders/'+Number(raw),false);
      if(!d||d.id!==Number(raw)||d.client_id!==client)fail(403,'ACCESS_DENIED');
      const order={id:d.id};
      for(const key of ['order_number','order_date','kol_sht','sum_all','create_date','state']){
        const v=d[key];if(v==null)continue;
        if(!((typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.length<=200)))fail(502,'INVALID_ORDER');
        order[key]=v;
      }
      result={payer,client,order,items:null,itemsAvailable:false};
    }
    authorize(uid,payer,client,kid);
    return e.json(200,result);
  } catch(err){
    const status=err&&[400,403,502,504].includes(err.status)?err.status:502;
    return e.json(status,{code:err&&typeof err.code==='string'?err.code:'ORDER_UNAVAILABLE'});
  }
},$apis.requireAuth('users'));
routerAdd('GET', '/service/orders/{id}', e=>{
  e.response.header().set('Cache-Control','no-store');
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

    let role;
    try { role=e.app.findRecordById('roles',user.get('role')); } catch (_) { fail(403,'ACCESS_DENIED'); }
    if(role.get('active')!==true || role.get('code_role')!==user.get('role_code'))fail(403,'ACCESS_DENIED');
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
    const q=/^payer=([a-z0-9]{15})&client=([1-9][0-9]{0,14})$/.exec(e.request.url.rawQuery||'');
    if(!q)fail(400,'INVALID_PARAMETERS');
    const payer=q[1],client=Number(q[2]),uid=e.auth.id;
    if(!posId(client))fail(400,'INVALID_PARAMETERS');
    const kid=authorize(uid,payer,client,null);
    const c=kisGet('/clients/'+client,false);
    if(!c||c.id!==client||c.payer_id!==kid||c.state!==1)fail(403,'ACCESS_DENIED');
    const list=kisGet('/payers/'+kid+'/clients',false);
    if(!Array.isArray(list)||!list.some(x=>x&&x.id===client))fail(403,'ACCESS_DENIED');
    let result;
    if('detail'==='options') {
      const min=c.ord_min_sum;
      result={create:false,details:false,minimumSum:typeof min==='number'&&Number.isFinite(min)&&min>=0?min:null,minimumSumIncludesVat:c.ord_min_sum_flg_nds===1?true:c.ord_min_sum_flg_nds===0?false:null,reason:'ORDER_CONTRACT_PENDING'};
    } else {
      const raw=e.request.pathValue('id');
      if(!/^[1-9][0-9]{0,14}$/.test(raw)||!posId(Number(raw)))fail(400,'INVALID_ORDER_ID');
      const d=kisGet('/orders/'+Number(raw),false);
      if(!d||d.id!==Number(raw)||d.client_id!==client)fail(403,'ACCESS_DENIED');
      const order={id:d.id};
      for(const key of ['order_number','order_date','kol_sht','sum_all','create_date','state']){
        const v=d[key];if(v==null)continue;
        if(!((typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.length<=200)))fail(502,'INVALID_ORDER');
        order[key]=v;
      }
      result={payer,client,order,items:null,itemsAvailable:false};
    }
    authorize(uid,payer,client,kid);
    return e.json(200,result);
  } catch(err){
    const status=err&&[400,403,502,504].includes(err.status)?err.status:502;
    return e.json(status,{code:err&&typeof err.code==='string'?err.code:'ORDER_UNAVAILABLE'});
  }
},$apis.requireAuth('users'));
