// CommonJS helper loaded inside each request. No shared user state.
function fail(status, code) { throw {status, code}; }
function id(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v > 0; }
function text(v, max) { if(typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(400,'INVALID_INPUT'); return v.trim(); }
function pb(v) { if(typeof v !== 'string' || !/^[a-z0-9]{15}$/.test(v)) fail(400,'INVALID_ID'); return v; }
function rows(app, col, filter, params) {
  const all=[];
  for(let offset=0;offset<10000;offset+=200) {
    const page=app.findRecordsByFilter(col,filter,'id',200,offset,params || {});
    all.push(...page); if(page.length<200) return all;
  }
  fail(502,'TOO_MANY_RECORDS');
}
function record(app,col,key) { try { return app.findRecordById(col,key); } catch(_) { fail(403,'ACCESS_DENIED'); } }
function manager(app,uid) {
  const u=record(app,'users',uid);
  if(u.get('active')!==true || u.get('must_change_password')===true || u.get('role_code')!=='manager') fail(403,'MANAGER_REQUIRED');
  const role=record(app,'roles',u.get('role'));
  if(role.get('active')!==true || role.get('code_role')!=='manager') fail(403,'MANAGER_REQUIRED');
  const rights=rows(app,'rights','user = {:uid} && active = true',{uid});
  const map=new Map();
  for(const r of rights) {
    const scope=r.get('scope'), kid=r.get('kis_client_id');
    if(!((scope==='all' && kid===0)||(scope==='client' && id(kid)))) fail(502,'INVALID_RIGHT');
    const p=record(app,'payers',r.get('payer'));
    if(!id(p.get('id_pay'))) fail(502,'INVALID_MAPPING');
    if(!map.has(p.id)) map.set(p.id,{record:p,all:false,ids:new Set()});
    const a=map.get(p.id);if(scope==='all')a.all=true;else a.ids.add(kid);
  }
  return {user:u,map};
}
function area(m,payer,whole,active) {
  const a=m.map.get(pb(payer));if(!a || (whole&&!a.all) || (active&&a.record.get('active')!==true)) fail(403,'ACCESS_DENIED');return a;
}
function validRight(m,r) {
  const a=m.map.get(r.get('payer'));if(!a)return false;
  if(r.get('scope')==='all' && r.get('kis_client_id')===0)return a.all;
  return r.get('scope')==='client' && id(r.get('kis_client_id')) && (a.all||a.ids.has(r.get('kis_client_id')));
}
function target(app,m,uid) {
  const u=record(app,'users',pb(uid));
  if(u.id===m.user.id || !['owner','viewer'].includes(u.get('role_code')))fail(403,'ACCESS_DENIED');
  const rs=rows(app,'rights','user = {:uid}',{uid});
  // Include inactive rights: a disabled assignment outside scope still protects the account.
  if(!rs.length || !rs.every(r=>validRight(m,r)))fail(403,'SHARED_ACCOUNT');
  return {user:u,rights:rs};
}
function kis(path) {
  // Only this module's fixed paths are passed here; never caller supplied URLs.
  const args=['--disable','--silent','--show-error','--noproxy','*','--proto','=http','--max-redirs','0','--connect-timeout','3','--max-time','10','--max-filesize','2097152','-H','Accept: application/json','-w','\n__KIS_HTTP__:%{http_code}','--url','http://serv15db:55580/api/v1'+path];
  let raw;try{raw=toString($os.cmd('curl',...args).output());}catch(e){fail(String(e).includes('exit status 28')?504:502,'KIS_UNAVAILABLE');}
  const match=/\n__KIS_HTTP__:(\d{3})$/.exec(raw);if(!match || match[1]!=='200' || raw.length>2097152)fail(502,'KIS_UNAVAILABLE');
  let doc;try{doc=JSON.parse(normalizeKisNumbers(raw.slice(0,match.index)));}catch(_){fail(502,'INVALID_KIS_JSON');}
  if(!doc || doc.success!==true)fail(502,'INVALID_KIS_RESPONSE');return doc.data;
}
// KIS /payers has been observed to emit .14 numbers. Repair only numeric
// tokens outside JSON strings; JSON.parse still rejects all other invalid syntax.
function normalizeKisNumbers(raw) {
  return raw.replace(/"(?:[^"\\]|\\[\s\S])*"|([:\[,]\s*)(-?)\.(\d+)/g,
    (whole,prefix,sign,digits)=>prefix===undefined?whole:prefix+sign+'0.'+digits);
}
function buyerCandidates(app,m) {
  const list=kis('/payers');
  if(!Array.isArray(list)||list.length>10000)fail(502,'INVALID_KIS_LIST');
  const registered=rows(app,'payers',''),ids=new Set(),codes=new Set(),result=[];
  for(const x of list) {
    if(!x||!id(x.id)||ids.has(x.id)||typeof x.kod!=='string'||!x.kod.trim()||codes.has(x.kod)||typeof x.name!=='string'||!x.name.trim())fail(502,'INVALID_KIS_LIST');
    ids.add(x.id);codes.add(x.kod);
    if(!registered.some(p=>p.get('id_pay')===x.id||p.get('kod_pay')===x.kod))
      result.push({id:x.id,code:x.kod,name:x.name,address:typeof x.adres==='string'?x.adres:''});
  }
  return result;
}
function candidates(a) {
  const list=kis('/payers/'+a.record.get('id_pay')+'/clients');
  if(!Array.isArray(list)||list.length>2000)fail(502,'INVALID_KIS_LIST');
  const seen=new Set();
  for(const x of list){if(!x||!id(x.id)||seen.has(x.id))fail(502,'INVALID_KIS_LIST');seen.add(x.id);}
  return list.filter(x=>a.all||a.ids.has(x.id)).map(x=>({id:x.id,code:typeof x.kod==='string'?x.kod:'',name:typeof x.name==='string'?x.name:'',address:typeof x.adres==='string'?x.adres:''}));
}
function selected(a,kid) {
  if(!id(kid))fail(400,'INVALID_ID');
  const x=candidates(a).find(x=>x.id===kid);if(!x)fail(403,'ACCESS_DENIED');
  const d=kis('/clients/'+kid);
  if(!d || d.id!==kid || d.payer_id!==a.record.get('id_pay') || d.state!==1)fail(403,'CLIENT_UNAVAILABLE');
  text(x.code,100);text(x.name,300);return x;
}
function cacheClient(app,payer,x) {
  const found=rows(app,'clients','id_clt = {:kid}',{kid:x.id});
  if(found.length>1 || (found.length && found[0].get('payer')!==payer))fail(409,'CLIENT_MAPPING_CONFLICT');
  const c=found[0] || new Record(app.findCollectionByNameOrId('clients'));
  c.set('id_clt',x.id);c.set('payer',payer);c.set('kod_clt',x.code);c.set('name_clt',x.name);
  if(!found.length)c.set('active',true);
  app.save(c);return c;
}
function assignments(app,m,input) {
  if(!Array.isArray(input)||!input.length||input.length>100)fail(400,'RIGHTS_REQUIRED');
  const seen=new Set(), result=[];
  for(const r of input) {
    const a=area(m,r.payer,r.scope==='all',true), kid=r.kis_client_id;
    if(!((r.scope==='all'&&kid===0)||(r.scope==='client'&&id(kid))))fail(400,'INVALID_RIGHT');
    const key=r.payer+':'+kid;if(seen.has(key))fail(400,'DUPLICATE_RIGHT');seen.add(key);
    result.push({payer:r.payer,scope:r.scope,kis_client_id:kid,client:r.scope==='client'?selected(a,kid):null});
  }
  return result;
}
function saveRights(app,uid,rs) {
  const old=rows(app,'rights','user = {:uid}',{uid});for(const r of old)app.delete(r);
  for(const r of rs) {
    const x=new Record(app.findCollectionByNameOrId('rights'));
    x.set('user',uid);x.set('payer',r.payer);x.set('scope',r.scope);x.set('kis_client_id',r.kis_client_id);x.set('active',true);
    // Distinct legacy links preserve the existing UNIQUE(user,payer,client) index.
    x.set('client',r.client?cacheClient(app,r.payer,r.client).id:'');app.save(x);
  }
}
function userInput(app,b) {
  const name=text(b.name,200),email=text(b.email,254).toLowerCase(),login=text(b.login,100);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(login)||!/^\S+@\S+\.\S+$/.test(email)||!['owner','viewer'].includes(b.role_code))fail(400,'INVALID_USER');
  const role=rows(app,'roles','code_role = {:code} && active = true',{code:b.role_code});if(role.length!==1)fail(409,'ROLE_UNAVAILABLE');
  return {name,email,login,role:role[0].id,role_code:b.role_code};
}
function state(app,uid) {
  const m=manager(app,uid), payers=[], users=new Map();
  for(const [pid,a] of m.map) {
    const p=a.record;
    payers.push({id:pid,id_pay:p.get('id_pay'),code:p.get('kod_pay'),name:p.get('name_pay'),phone:p.get('phone'),email:p.get('contact_email'),active:p.get('active'),access:a.all?'all':'limited'});
    for(const r of rows(app,'rights','payer = {:pid}',{pid})) {
      if(!validRight(m,r)||r.get('user')===uid)continue;
      const u=record(app,'users',r.get('user'));if(!['owner','viewer'].includes(u.get('role_code')))continue;
      if(!users.has(u.id)) {
        let editable=true;try{target(app,m,u.id);}catch(_){editable=false;}
        users.set(u.id,{id:u.id,name:u.get('name'),email:u.get('email'),login:u.get('login'),role_code:u.get('role_code'),active:u.get('active'),must_change_password:u.get('must_change_password'),editable,rights:[]});
      }
      users.get(u.id).rights.push({id:r.id,payer:pid,scope:r.get('scope'),kis_client_id:r.get('kis_client_id'),active:r.get('active')});
    }
  }
  const now=manager(app,uid);
  const signature=x=>JSON.stringify(Array.from(x.map,([pid,a])=>[pid,a.all,Array.from(a.ids).sort(),a.record.get('id_pay'),a.record.get('active')]).sort());
  if(signature(m)!==signature(now))fail(403,'ACCESS_CHANGED');
  return {version:'0.5.0',manager:{name:m.user.get('name')},payers,users:Array.from(users.values())};
}
function mutate(e,b) {
  const uid=e.auth.id, app=e.app, m=manager(app,uid);
  const allowed=['create_user','edit_user','set_rights','toggle_user','reset_password','create_payer','edit_payer','attach_client'];
  if(!b||!allowed.includes(b.action))fail(400,'INVALID_ACTION');
  let prepared=null, input=null, picked=null;
  if(['create_user','edit_user'].includes(b.action)) input=userInput(app,b);
  if(b.action==='create_user'||b.action==='set_rights')prepared=assignments(app,m,b.rights);
  if(b.action==='create_user' && (typeof b.password!=='string'||b.password.length<12||b.password.length>128))fail(400,'PASSWORD_TOO_SHORT');
  if(b.action==='attach_client')picked=selected(area(m,b.payer,false,true),b.kis_client_id);
  if(b.action==='reset_password'){
    const t=target(app,m,b.user);if(t.user.get('active')!==true)fail(403,'ACCESS_DENIED');
    // SMTP acceptance only; this does not claim delivery or completion.
    try{$mails.sendRecordPasswordReset(app,t.user);}catch(_){fail(502,'MAIL_UNAVAILABLE');}
    app.logger().info('manager.reset_password','actor',uid,'target',t.user.id);return {ok:true,message:'MAIL_SUBMITTED'};
  }
  if(b.action==='create_payer'){
    if(!id(b.id_pay))fail(400,'INVALID_ID');
    const k=buyerCandidates(app,m).find(x=>x.id===b.id_pay);if(!k)fail(409,'PAYER_ALREADY_REGISTERED_OR_UNAVAILABLE');
    b.code=k.code;b.name=k.name;text(b.code,100);text(b.name,300);text(b.email,254);
    if(!/^\S+@\S+\.\S+$/.test(b.email))fail(400,'INVALID_EMAIL');
    if(rows(app,'payers','id_pay = {:kid} || kod_pay = {:code}',{kid:b.id_pay,code:b.code}).length)fail(409,'PAYER_ALREADY_REGISTERED');
    // Onboard only a previously unmapped KIS buyer, never seize an existing PB record.
    const a={record:{get:k=>k==='id_pay'?b.id_pay:null},all:true,ids:new Set()};
    const list=candidates(a);if(!list.length)fail(409,'PAYER_NOT_VERIFIED');picked=selected(a,list[0].id);
  }
  let result;
  app.runInTransaction(tx=>{
    const fresh=manager(tx,uid);
    if(prepared)for(const r of prepared) {
      const a=area(fresh,r.payer,r.scope==='all',true);
      if(r.scope==='client'&&!a.all&&!a.ids.has(r.kis_client_id))fail(403,'ACCESS_CHANGED');
      if(m.map.get(r.payer).record.get('id_pay')!==a.record.get('id_pay'))fail(403,'ACCESS_CHANGED');
    }
    if(b.action==='create_user'){
      const data=userInput(tx,b),u=new Record(tx.findCollectionByNameOrId('users'));
      for(const k of Object.keys(data))u.set(k,data[k]);
      u.setPassword(b.password);u.set('active',true);u.set('must_change_password',true);tx.save(u);saveRights(tx,u.id,prepared);result={id:u.id};
    }else if(['edit_user','toggle_user','set_rights'].includes(b.action)){
      const t=target(tx,fresh,b.user),u=t.user;
      if(b.action==='edit_user'){
        const data=userInput(tx,b);if(u.get('email')!==data.email)u.setVerified(false);for(const k of Object.keys(data))u.set(k,data[k]);u.refreshTokenKey();tx.save(u);
      }else if(b.action==='toggle_user'){
        if(typeof b.active!=='boolean')fail(400,'INVALID_INPUT');u.set('active',b.active);u.refreshTokenKey();tx.save(u);
      }else saveRights(tx,u.id,prepared);
      result={id:u.id};
    }else if(b.action==='create_payer'){
      if(rows(tx,'payers','id_pay = {:kid} || kod_pay = {:code}',{kid:b.id_pay,code:b.code}).length)fail(409,'PAYER_ALREADY_REGISTERED');
      const p=new Record(tx.findCollectionByNameOrId('payers'));
      p.set('id_pay',b.id_pay);p.set('kod_pay',text(b.code,100));p.set('name_pay',text(b.name,300));p.set('contact_email',b.email.trim());p.set('phone',typeof b.phone==='string'?b.phone:'');p.set('active',true);tx.save(p);
      const r=new Record(tx.findCollectionByNameOrId('rights'));r.set('user',uid);r.set('payer',p.id);r.set('scope','all');r.set('kis_client_id',0);r.set('active',true);tx.save(r);result={id:p.id};
    }else if(b.action==='edit_payer'){
      const p=area(fresh,b.payer,true,false).record;
      p.set('name_pay',text(b.name,300));p.set('contact_email',text(b.email,254));p.set('phone',typeof b.phone==='string'?b.phone:'');
      if(typeof b.active!=='boolean')fail(400,'INVALID_INPUT');p.set('active',b.active);tx.save(p);result={id:p.id};
    }else if(b.action==='attach_client'){
      const a=area(fresh,b.payer,false,true);
      if(a.record.get('id_pay')!==m.map.get(b.payer).record.get('id_pay') || (!a.all&&!a.ids.has(picked.id)))fail(403,'ACCESS_CHANGED');
      result={id:cacheClient(tx,b.payer,picked).id};
    }
  });
  app.logger().info('manager.mutation','actor',uid,'action',b.action,'target',result.id);return {ok:true,...result};
}
function route(e,kind) {
  const rid=$security.randomString(18);e.response.header().set('Cache-Control','no-store');e.response.header().set('X-Request-ID',rid);
  try {
    if(!e.auth)fail(401,'AUTH_REQUIRED');
    if(kind==='state'){if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');return e.json(200,state(e.app,e.auth.id));}
    if(kind==='buyers') {
      if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');
      const m=manager(e.app,e.auth.id),list=buyerCandidates(e.app,m);manager(e.app,e.auth.id);
      return e.json(200,{buyers:list});
    }
    if(kind==='clients') {
      const q=/^payer=([a-z0-9]{15})$/.exec(e.request.url.rawQuery||'');if(!q)fail(400,'INVALID_PARAMETERS');
      const m=manager(e.app,e.auth.id),a=area(m,q[1],false,true), list=candidates(a),now=area(manager(e.app,e.auth.id),q[1],false,true);
      if(now.record.get('id_pay')!==a.record.get('id_pay'))fail(403,'ACCESS_CHANGED');
      return e.json(200,{clients:list.filter(x=>now.all||now.ids.has(x.id))});
    }
    if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');
    const b=e.requestInfo().body;
    if(kind==='password'){
      if(!b || typeof b.oldPassword!=='string'||typeof b.password!=='string'||b.password.length<12||b.password.length>128||b.password===b.oldPassword)fail(400,'INVALID_PASSWORD');
      e.app.runInTransaction(tx=>{
        const u=record(tx,'users',e.auth.id);if(u.get('active')!==true || !u.validatePassword(b.oldPassword))fail(403,'ACCESS_DENIED');
        u.setPassword(b.password);u.set('must_change_password',false);u.refreshTokenKey();tx.save(u);
      });return e.json(200,{ok:true,relogin:true});
    }
    return e.json(200,mutate(e,b));
  }catch(err){
    const status=err&&[400,401,403,409,502,504].includes(err.status)?err.status:400;
    return e.json(status,{code:err&&typeof err.code==='string'?err.code:'SAVE_FAILED',requestId:rid});
  }
}
module.exports={route};
