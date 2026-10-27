// Six explicitly configured test accounts. Ordinary manager scope checks apply.
const rid=v=>typeof v==='string'&&/^[a-z0-9]{15}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
function fail(status,code){throw {status,code};}
function config(app){
  let c;try{c=JSON.parse(toString($os.readFile(app.dataDir()+'/manager-recipient-demos.json')));}catch(_){fail(404,'DEMO_NOT_CONFIGURED');}
  if(c.version!==1||c.enabled!==true||!rid(c.manager_id)||!rid(c.owner_role)||!Array.isArray(c.payers)||c.payers.length!==2||!Array.isArray(c.accounts)||c.accounts.length!==6)fail(404,'DEMO_NOT_CONFIGURED');
  const ids=[c.manager_id,c.owner_role],kids=new Set();
  c.payers.forEach(p=>{
    const mappings=app.findRecordsByFilter('payers','id_pay={:kid} || kod_pay={:code}','id',2,0,{kid:p.kid,code:p.code});
    if(mappings.some(r=>r.id!==p.id))throw Error('Payer identity conflict');
    if(!rid(p.id)||!positive(p.kid)||[2,3,299271,300182].includes(p.kid)||kids.has(p.kid)||typeof p.name!=='string'||typeof p.code!=='string'||!Array.isArray(p.clients)||p.clients.length!==2||typeof p.new!=='boolean'||!rid(p.manager_right))fail(503,'INVALID_DEMO_CONFIG');
    kids.add(p.kid);ids.push(p.id,p.manager_right);
    p.clients.forEach(x=>{if(!rid(x.id)||!positive(x.kid)||typeof x.name!=='string'||typeof x.code!=='string'||typeof x.address!=='string')fail(503,'INVALID_DEMO_CONFIG');ids.push(x.id);});
    if(new Set(p.clients.map(x=>x.kid)).size!==2)fail(503,'INVALID_DEMO_CONFIG');
  });
  c.accounts.forEach((a,i)=>{if(!rid(a.id)||!rid(a.right)||a.email!=='demo.manager.'+['buyer1','point11','point12','buyer2','point21','point22'][i]+'.v090@example.test'||typeof a.name!=='string'||typeof a.login!=='string')fail(503,'INVALID_DEMO_CONFIG');ids.push(a.id,a.right);});
  if(new Set(ids).size!==ids.length)fail(503,'INVALID_DEMO_CONFIG');return c;
}
function expected(c,i){const p=c.payers[Math.floor(i/3)],point=i%3?p.clients[i%3-1]:null;return {payer:p.id,scope:point?'client':'all',kis_client_id:point?point.kid:0,client:point?point.id:''};}
const same=(record,values)=>Object.keys(values).every(k=>record.get(k)===values[k]);
function check(app,c,i,m){
  const a=c.accounts[i],wanted=expected(c,i),p=c.payers[Math.floor(i/3)];
  const allowed=m.map.get(p.id);if(m.user.id!==c.manager_id||!allowed?.all||allowed.record.get('active')!==true||allowed.record.get('id_pay')!==p.kid)fail(403,'ACCESS_DENIED');
  const u=app.findRecordById('users',a.id),role=app.findRecordById('roles',c.owner_role);
  if(!same(u,{email:a.email,login:a.login,name:a.name,role:c.owner_role,role_code:'owner',active:true,must_change_password:false,manager_owner:c.manager_id})||!same(role,{code_role:'owner',active:true}))fail(403,'DEMO_ACCOUNT_CHANGED');
  const rs=app.findRecordsByFilter('rights','user={:uid}','id',3,0,{uid:a.id});
  if(rs.length!==1||rs[0].id!==a.right||!same(rs[0],{...wanted,active:true}))fail(403,'DEMO_ACCOUNT_CHANGED');
  for(const point of p.clients){const x=app.findRecordById('clients',point.id);if(!same(x,{payer:p.id,id_clt:point.kid,active:true}))fail(403,'DEMO_ACCOUNT_CHANGED');}
  return u;
}
module.exports.route=(e,login)=>{
  e.response.header().set('Cache-Control','no-store');
  try{
    if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');
    const m=require(__hooks+'/karavay-manager.js').manager(e.app,e.auth.id),c=config(e.app);
    if(m.user.id!==c.manager_id)fail(403,'ACCESS_DENIED');
    if(!login){const accounts=c.accounts.map((a,i)=>{check(e.app,c,i,m);const p=c.payers[Math.floor(i/3)],point=i%3?p.clients[i%3-1]:null;return {id:a.id,name:a.name,email:a.email,scope:point?'recipient':'buyer',payer:{id:p.id,code:p.code,name:p.name},clients:(point?[point]:p.clients).map(x=>({id:x.kid,code:x.code,name:x.name,address:x.address}))};});return e.json(200,{accounts});}
    const origin=e.request.header.get('Origin');if(origin!=='http://'+e.request.host&&origin!=='https://'+e.request.host)fail(403,'ACCESS_DENIED');
    const b=e.requestInfo().body;if(!b||Object.keys(b).join(',')!=='id')fail(400,'INVALID_PARAMETERS');
    const i=c.accounts.findIndex(a=>a.id===b.id);if(i<0)fail(403,'ACCESS_DENIED');
    return $apis.recordAuthResponse(e,check(e.app,c,i,m),'manager-demo');
  }catch(err){return e.json(err&&[400,403,404,503].includes(err.status)?err.status:403,{code:err?.code||'ACCESS_DENIED'});}
};
module.exports.bootstrap=app=>{
  const c=config(app),m=require(__hooks+'/karavay-manager.js').manager(app,c.manager_id);
  const role=app.findRecordById('roles',c.owner_role);if(!same(role,{active:true,code_role:'owner'}))throw Error('Active owner role required');
  function ensure(collection,id,values,identityOnly=false){
    let r;try{r=app.findRecordById(collection,id);}catch(_){}
    if(r){if(!same(r,values))throw Error('Existing '+collection+' changed');return r;}
    if(identityOnly)throw Error('Existing mapping missing');
    r=new Record(app.findCollectionByNameOrId(collection));r.set('id',id);for(const k of Object.keys(values))r.set(k,values[k]);app.save(r);return r;
  }
  c.payers.forEach(p=>{
    let record;try{record=app.findRecordById('payers',p.id);}catch(_){}
    if(record){if(!same(record,{id_pay:p.kid,kod_pay:p.code,active:true}))throw Error('Payer mapping changed');}
    else ensure('payers',p.id,{id_pay:p.kid,kod_pay:p.code,name_pay:p.name,active:true},!p.new);
    const allowed=m.map.get(p.id);
    if(!allowed?.all){
      if(!p.new||app.findRecordsByFilter('rights','payer={:pid}','id',1,0,{pid:p.id}).length)throw Error('Manager scope changed');
      ensure('rights',p.manager_right,{user:c.manager_id,payer:p.id,client:'',scope:'all',kis_client_id:0,active:true});
    }
    p.clients.forEach(x=>{
      const mappings=app.findRecordsByFilter('clients','id_clt={:kid} || (payer={:pid} && kod_clt={:code})','id',2,0,{kid:x.kid,pid:p.id,code:x.code});
      if(mappings.some(r=>r.id!==x.id))throw Error('Recipient identity conflict');
      let r;try{r=app.findRecordById('clients',x.id);}catch(_){}
      if(r){if(!same(r,{id_clt:x.kid,kod_clt:x.code,payer:p.id,active:true}))throw Error('Recipient mapping changed');}
      else ensure('clients',x.id,{id_clt:x.kid,kod_clt:x.code,name_clt:x.name,payer:p.id,active:true});
    });
  });
  c.accounts.forEach((a,i)=>{
    const values={name:a.name,email:a.email,login:a.login,role:c.owner_role,role_code:'owner',active:true,must_change_password:false,manager_owner:c.manager_id};
    let u;try{u=app.findRecordById('users',a.id);}catch(_){}
    if(u){if(!same(u,values))throw Error('Existing demo account changed');}
    else{u=new Record(app.findCollectionByNameOrId('users'));u.set('id',a.id);for(const k of Object.keys(values))u.set(k,values[k]);u.setPassword($security.randomString(48));app.save(u);}
    ensure('rights',a.right,{user:a.id,...expected(c,i),active:true});
    check(app,c,i,require(__hooks+'/karavay-manager.js').manager(app,c.manager_id));
  });
};
