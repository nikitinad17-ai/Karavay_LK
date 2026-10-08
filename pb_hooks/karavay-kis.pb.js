/// <reference path="../pb_data/types.d.ts" />
routerAdd('GET', '/service/catalog', (e) => {
  const gateway = require(__hooks + '/lib/catalog.cjs');
  const started = Date.now();
  const requestId = $security.randomString(20);
  let status = 200;
  e.response.header().set('Cache-Control', 'no-store');
  e.response.header().set('X-Request-ID', requestId);
  const repo = {
    get: (collection, id) => {
      const r = e.app.findRecordById(collection,id);
      const fields = {users:['active','must_change_password','role'], roles:['active','code_role'], clients:['active','payer','id_clt'], payers:['active','id_pay']}[collection];
      const out = {};
      for (const f of fields) out[f] = r.get(f);
      return out;
    },
    // Existence query: covers all rights, including grants after the first 200.
    hasRight: (user,payer,client) => {
      const rows = e.app.findRecordsByFilter('rights', 'user = {:user} && payer = {:payer} && active = true && (client = "" || client = {:client})', '', 1, 0, {user,payer,client});
      return rows.length > 0;
    }
  };
  try {
    const auth = e.auth ? {id:e.auth.id, collection:e.auth.collection().name} : null;
    const values = gateway.parseRawQuery(e.request.url.rawQuery);
    const data = gateway.catalog(repo,auth,values,args => toString($os.cmd('curl', ...args).output()));
    return e.json(200,data);
  } catch (err) {
    status = [400,401,403,502,504].includes(err.status) ? err.status : 502;
    const messages = {400:'Некорректные параметры запроса.',401:'Требуется вход.',403:'Доступ запрещён.',502:'Каталог временно недоступен.',504:'Истекло время ожидания каталога.'};
    return e.json(status,{code:['INVALID_PARAMETERS','AUTH_REQUIRED','ACCESS_DENIED','INVALID_CONFIGURATION','INVALID_UPSTREAM','UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE'].includes(err.code) ? err.code : 'CATALOG_UNAVAILABLE',message:messages[status],requestId});
  } finally {
    e.app.logger().info('service.catalog','requestId',requestId,'status',status,'durationMs',Date.now()-started);
  }
}, $apis.requireAuth('users'));
