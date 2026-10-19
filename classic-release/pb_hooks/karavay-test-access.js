// Explicitly enabled on the TEST KIS VM only. No stored or browser-visible passwords.
function fail(status,code){throw {status,code};}
function config(app){
  let raw;try{raw=toString($os.readFile(app.dataDir()+'/karavay-test-access.json'));}catch(_){fail(404,'TEST_ACCESS_DISABLED');}
  let c;try{c=JSON.parse(raw);}catch(_){fail(503,'INVALID_TEST_CONFIG');}
  const rid=s=>typeof s==='string'&&/^[a-z0-9]{15}$/.test(s);
  if(c.enabled!==true||c.environment!=='test-kis')fail(404,'TEST_ACCESS_DISABLED');
  if(c.version!==1||!Array.isArray(c.accounts)||c.accounts.length!==3||!Array.isArray(c.payers)||c.payers.length!==2||!rid(c.ownerRole)||!rid(c.point?.id)||!Number.isSafeInteger(c.point.kid)||c.point.kid<1||new Set(c.payers.map(p=>p.kid)).size!==2||c.payers.some(p=>!rid(p.id)||!Number.isSafeInteger(p.kid)||p.kid<1||typeof p.name!=='string'||typeof p.code!=='string')||c.accounts.some(a=>!rid(a.id)||typeof a.name!=='string'||typeof a.description!=='string'||!/^demo\.test\.(point|buyer|multi)(\.v38[23])?@example\.test$/.test(a.email))||new Set(c.accounts.map(a=>a.id)).size!==3||new Set(c.accounts.map(a=>a.email)).size!==3)fail(503,'INVALID_TEST_CONFIG');
  return c;
}
function expected(c,i){const all=p=>({payer:p.id,scope:'all',kis_client_id:0,client:''});return i===0?[{payer:c.payers[0].id,scope:'client',kis_client_id:c.point.kid,client:c.point.id}]:i===1?[all(c.payers[0])]:c.payers.map(all);}
const key=r=>[r.payer,r.scope,r.kis_client_id,r.client||''].join(':');
function fields(r){return {payer:r.get('payer'),scope:r.get('scope'),kis_client_id:r.get('kis_client_id'),client:r.get('client')};}
function check(app,c,i){
  const a=c.accounts[i],u=app.findRecordById('users',a.id),role=app.findRecordById('roles',u.get('role'));
  if(u.get('email')!==a.email||u.get('active')!==true||u.get('must_change_password')===true||u.get('role')!==c.ownerRole||u.get('role_code')!=='owner'||role.get('active')!==true||role.get('code_role')!=='owner')fail(403,'ACCESS_DENIED');
  const wanted=expected(c,i),rs=app.findRecordsByFilter('rights','user={:u}','',10,0,{u:u.id});
  if(rs.length!==wanted.length||rs.some(r=>r.get('active')!==true||!wanted.some(w=>key(w)===key(fields(r)))))fail(403,'ACCESS_DENIED');
  for(const w of wanted){const p=app.findRecordById('payers',w.payer),mapping=c.payers.find(p=>p.id===w.payer);if(p.get('active')!==true||p.get('id_pay')!==mapping.kid)fail(403,'ACCESS_DENIED');}
  if(i===0){const p=app.findRecordById('clients',c.point.id);if(p.get('active')!==true||p.get('id_clt')!==c.point.kid||p.get('payer')!==c.payers[0].id)fail(403,'ACCESS_DENIED');}
  return u;
}
module.exports.handle=(e,login)=>{
  e.response.header().set('Cache-Control','no-store');
  try{
    if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');
    const c=config(e.app);
    if(!login){const accounts=[];c.accounts.forEach((a,i)=>{try{check(e.app,c,i);const proof=(c.buyers||c.history)?.proofs?.[0];accounts.push({id:a.id,name:a.name,email:a.email,description:a.description,preferredPayer:c.payers[0].id,preferredClient:c.point.kid,...(proof?{preferredDate:proof.day,preferredGroup:proof.group}:{})});}catch(_){}});return e.json(200,{environment:c.environment,accounts});}
    const origin=e.request.header.get('Origin');if(origin&&origin!=='http://'+e.request.host&&origin!=='https://'+e.request.host)fail(403,'ACCESS_DENIED');
    const b=e.requestInfo().body;if(!b||Object.keys(b).join(',')!=='id')fail(400,'INVALID_PARAMETERS');
    const i=c.accounts.findIndex(a=>a.id===b.id);if(i<0)fail(403,'ACCESS_DENIED');
    return $apis.recordAuthResponse(e,check(e.app,c,i),'test-access');
  }catch(err){return e.json(err&&[400,403,404,503].includes(err.status)?err.status:403,{code:err?.code||'ACCESS_DENIED'});}
};
module.exports.bootstrap=app=>{
  const c=config(app),role=app.findRecordById('roles',c.ownerRole);
  if(role.get('active')!==true||role.get('code_role')!=='owner')throw Error('Active owner role required');
  function ensure(collection,id,values){
    let record;try{record=app.findRecordById(collection,id);}catch(_){}
    if(record){for(const k of Object.keys(values))if(record.get(k)!==values[k])throw Error('Existing '+collection+' changed: '+k);return record;}
    record=new Record(app.findCollectionByNameOrId(collection));record.set('id',id);for(const k of Object.keys(values))record.set(k,values[k]);app.save(record);return record;
  }
  c.payers.forEach(p=>{
    let existing;try{existing=app.findRecordById('payers',p.id);}catch(_){}
    if(existing){if(existing.get('id_pay')!==p.kid||existing.get('active')!==true)throw Error('Payer mapping changed');}
    else ensure('payers',p.id,{id_pay:p.kid,kod_pay:p.code,name_pay:p.name,active:true});
  });
  let point;try{point=app.findRecordById('clients',c.point.id);}catch(_){}
  if(point){if(point.get('id_clt')!==c.point.kid||point.get('payer')!==c.payers[0].id||point.get('active')!==true)throw Error('Client mapping changed');}
  else ensure('clients',c.point.id,{id_clt:c.point.kid,payer:c.payers[0].id,kod_clt:c.point.code,name_clt:c.point.name,active:true});
  c.accounts.forEach((a,i)=>{
    const values={name:a.name,email:a.email,login:a.login,role:c.ownerRole,role_code:'owner',active:true,must_change_password:false};if(c.managerOwner)values.manager_owner=c.managerOwner;
    let user;try{user=app.findRecordById('users',a.id);}catch(_){}
    if(!user){user=new Record(app.findCollectionByNameOrId('users'));user.set('id',a.id);for(const k of Object.keys(values))user.set(k,values[k]);user.setPassword($security.randomString(48));app.save(user);}
    else for(const k of Object.keys(values))if(user.get(k)!==values[k])throw Error('Test user changed: '+k);
    expected(c,i).forEach((r,j)=>ensure('rights',a.rights[j],{user:a.id,...r,active:true}));check(app,c,i);
  });
};
