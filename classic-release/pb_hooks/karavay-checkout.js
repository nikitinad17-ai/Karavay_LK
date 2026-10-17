// KIS contract captured 2026-10-14. No alternate/guessed POST formats or automatic retries.
function fail(status,code){throw {status,code};}
function id(n){return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;}
function number(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0;}
function keys(o,expected){return o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===expected.slice().sort().join(',');}
function repair(s){let out='',quoted=false,escaped=false;for(let i=0;i<s.length;i++){const ch=s[i];if(quoted){out+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='"'){quoted=true;out+=ch;continue;}if((ch==='.'&&/[0-9]/.test(s[i+1]||''))||(ch==='-'&&s[i+1]==='.'&&/[0-9]/.test(s[i+2]||''))){if(/[:\[,]$/.test(out.trim())){if(ch==='-'){out+='-0.';i++;}else out+='0.';continue;}}out+=ch;}return out;}
function transport(path,body){
  const args=['--disable','--silent','--show-error','--noproxy','*','--proto','=http','--max-redirs','0','--connect-timeout','3','--max-time','20','--max-filesize','2097152','-H','Accept: application/json','-w','\n__KIS_HTTP__:%{http_code}','--url','http://serv15db:55580/api/v1'+path];
  if(body!==undefined)args.push('-X','POST','-H','Content-Type: application/json','--data-raw',JSON.stringify(body));
  let raw;try{raw=toString($os.cmd('curl',...args).output());}catch(_){fail(body===undefined?504:503,body===undefined?'UPSTREAM_TIMEOUT':'SUBMISSION_UNKNOWN');}
  const m=/\n__KIS_HTTP__:(\d{3})$/.exec(raw);if(!m||raw.length>2097200)fail(502,body===undefined?'UPSTREAM_INVALID_RESPONSE':'SUBMISSION_UNKNOWN');
  let doc;try{doc=JSON.parse(repair(raw.slice(0,m.index)));}catch(_){fail(502,body===undefined?'UPSTREAM_INVALID_JSON':'SUBMISSION_UNKNOWN');}
  return {status:Number(m[1]),doc};
}
function get(path){const r=transport(path);if(r.status!==200||!r.doc||r.doc.success!==true||!('data' in r.doc))fail(502,'UPSTREAM_INVALID_RESPONSE');return r.doc.data;}
function clientOrders(data,cid){
  if(Array.isArray(data))return data;
  if(!data||typeof data!=='object'||!Object.prototype.hasOwnProperty.call(data,'Orders'))fail(502,'INVALID_ORDERS');
  if(data.id_clt!==cid)fail(403,'ACCESS_DENIED');
  if(data.Orders===null)return [];
  if(!Array.isArray(data.Orders))fail(502,'INVALID_ORDERS');
  return data.Orders;
}
function authorize(app,uid,payer,client,write,expected){
  let u,p,role;try{u=app.findRecordById('users',uid);p=app.findRecordById('payers',payer);role=app.findRecordById('roles',u.get('role'));}catch(_){fail(403,'ACCESS_DENIED');}
  const allowedRoles=write?['owner','manager']:['owner','manager','viewer'];
  if(u.get('active')!==true||u.get('must_change_password')===true||!allowedRoles.includes(u.get('role_code'))||role.get('active')!==true||role.get('code_role')!==u.get('role_code')||p.get('active')!==true)fail(403,'ACCESS_DENIED');
  const kid=p.get('id_pay');if(!id(kid)||(expected!=null&&kid!==expected))fail(403,'ACCESS_DENIED');
  const rights=app.findRecordsByFilter('rights','user={:u} && payer={:p} && active=true && ((scope="all" && kis_client_id=0) || (scope="client" && kis_client_id={:c}))','',1000,0,{u:uid,p:payer,c:client});
  if(!rights.length)fail(403,'ACCESS_DENIED');
  // A cached client is never the source of KIS membership, but an explicit local disable is honored.
  const local=app.findRecordsByFilter('clients','id_clt={:c}','',10,0,{c:client});
  if(local.some(c=>c.get('payer')!==payer||c.get('active')!==true))fail(403,'ACCESS_DENIED');
  return kid;
}
function membership(kid,cid){
  const c=get('/clients/'+cid);if(!c||c.id!==cid||c.payer_id!==kid||c.state!==1)fail(403,'ACCESS_DENIED');
  const rows=get('/payers/'+kid+'/clients');if(!Array.isArray(rows)||rows.length>10000)fail(502,'INVALID_KIS_CLIENTS');
  if(!rows.some(r=>r&&r.id===cid))fail(403,'ACCESS_DENIED');return c;
}
function query(e){const q=/^payer=([a-z0-9]{15})&client=([1-9][0-9]{0,14})$/.exec(e.request.url.rawQuery||'');if(!q||!id(Number(q[2])))fail(400,'INVALID_PARAMETERS');return {payer:q[1],client:Number(q[2])};}
function header(d,oid,cid){
  if(!d||d.id!==oid||d.client_id!==cid)fail(403,'ACCESS_DENIED');
  const o={id:oid};for(const k of ['order_number','order_date','create_date','state'])if(typeof d[k]==='string'||typeof d[k]==='number')o[k]=d[k];
  for(const k of ['kol_sht','sum_all'])if(number(d[k]))o[k]=d[k];return o;
}
function detail(e){
  const q=query(e),raw=e.request.pathValue('id');if(!/^[1-9][0-9]{0,14}$/.test(raw)||!id(Number(raw)))fail(400,'INVALID_ORDER_ID');
  const kid=authorize(e.app,e.auth.id,q.payer,q.client,false);membership(kid,q.client);
  const d=get('/orders/'+raw),order=header(d,Number(raw),q.client);
  if(!Array.isArray(d.products)||d.products.length>1000)fail(502,'INVALID_ORDER_ITEMS');
  const items=d.products.map((p,index)=>{
    if(!p||!id(p.id)||typeof p.product_kod!=='string'||typeof p.product_name!=='string'||!number(p.cena_otp)||!Number.isSafeInteger(p.kol_sht)||p.kol_sht<0||!number(p.sum_all))fail(502,'INVALID_ORDER_ITEM');
    return {id:p.id,line:index,code:p.product_kod,name:p.product_name,quantity:p.kol_sht,price:p.cena_otp,sum:p.sum_all,returned:Number.isSafeInteger(p.kol_vzv)&&p.kol_vzv>=0?p.kol_vzv:null};
  });
  authorize(e.app,e.auth.id,q.payer,q.client,false,kid);return {status:200,body:{...q,order,items,itemsAvailable:true}};
}
function list(e){
  const q=/^payer=([a-z0-9]{15})&client=([1-9][0-9]{0,14})(?:&offset=([0-9]{1,5}))?$/.exec(e.request.url.rawQuery||'');
  if(!q||!id(Number(q[2])))fail(400,'INVALID_PARAMETERS');
  const payer=q[1],client=Number(q[2]),offset=Number(q[3]||0),kid=authorize(e.app,e.auth.id,payer,client,false);membership(kid,client);
  const rows=clientOrders(get('/clients/'+client+'/orders'),client);if(rows.length>10000)fail(502,'INVALID_ORDERS');
  const ids=new Set();for(const row of rows){if(!row||!id(row.id)||ids.has(row.id))fail(502,'INVALID_ORDER');ids.add(row.id);}
  const selected=rows.slice(offset,offset+20),orders=selected.map(row=>header(get('/orders/'+row.id),row.id,client));
  authorize(e.app,e.auth.id,payer,client,false,kid);
  return {status:200,body:{payer,client,count:orders.length,orders,total:rows.length,hasMore:offset+20<rows.length,nextOffset:offset+20<rows.length?offset+20:null}};
}
function options(e){const q=query(e),kid=authorize(e.app,e.auth.id,q.payer,q.client,false),c=membership(kid,q.client);authorize(e.app,e.auth.id,q.payer,q.client,false,kid);return {status:200,body:{...q,create:e.auth.get('role_code')!=='viewer',details:true,minimumSum:number(c.ord_min_sum)?c.ord_min_sum:null,minimumSumIncludesVat:c.ord_min_sum_flg_nds===1?true:c.ord_min_sum_flg_nds===0?false:null,reason:''}};}
function validate(b){
  if(!keys(b,['payer','client','DateOrd','Group','products'])||typeof b.payer!=='string'||!/^[a-z0-9]{15}$/.test(b.payer)||!id(b.client)||!id(b.DateOrd)||(b.DateOrd+10800)%86400!==0||b.DateOrd<946674000||b.DateOrd>4102434000||![0,1].includes(b.Group)||!Array.isArray(b.products)||b.products.length<1||b.products.length>500)fail(400,'INVALID_ORDER');
  const seen=new Set();for(const p of b.products){if(!keys(p,['id','quantity','price'])||!id(p.id)||seen.has(p.id)||!id(p.quantity)||p.quantity>1000000||!number(p.price))fail(400,'INVALID_ORDER');seen.add(p.id);}
  return {payer:b.payer,client:b.client,DateOrd:b.DateOrd,Group:b.Group,products:b.products.map(p=>({id:p.id,quantity:p.quantity,price:p.price})).sort((a,b)=>a.id-b.id)};
}
function replay(record,hash){
  if(record.get('request_hash')!==hash)fail(409,'IDEMPOTENCY_CONFLICT');
  if(['pending','unknown'].includes(record.get('state')))fail(409,'SUBMISSION_UNKNOWN');
  let body;try{body=JSON.parse(record.get('result_json'));}catch(_){fail(503,'SUBMISSION_UNKNOWN');}
  return {status:record.get('http_status'),body};
}
function create(e){
  if(e.request.url.rawQuery)fail(400,'INVALID_PARAMETERS');
  const b=validate(e.requestInfo().body),uid=e.auth.id,key=e.request.header.get('Idempotency-Key');
  if(!/^[a-f0-9]{32}$/.test(key||''))fail(400,'INVALID_IDEMPOTENCY_KEY');
  const kid=authorize(e.app,uid,b.payer,b.client,true);membership(kid,b.client);
  const hash=$security.sha256(JSON.stringify(b)),tag=uid+':'+$security.sha256(JSON.stringify({...b,products:b.products.map(p=>({id:p.id,quantity:p.quantity}))}));
  const previous=e.app.findRecordsByFilter('lk_order_requests','user_id={:u} && request_key={:k}','',1,0,{u:uid,k:key});
  if(previous.length){authorize(e.app,uid,b.payer,b.client,true,kid);return replay(previous[0],hash);}
  if(b.DateOrd<Math.floor((Date.now()/1000+10800)/86400)*86400-10800)fail(400,'DATE_IN_PAST');
  const matrix=get('/clients/'+b.client+'/matrix?DateOrd='+b.DateOrd+'&Group='+b.Group);
  if(!Array.isArray(matrix)||matrix.length>10000)fail(502,'INVALID_MATRIX');
  const byId=new Map();for(const p of matrix){if(!p||!id(p.id_prd)||byId.has(p.id_prd))fail(502,'INVALID_MATRIX');byId.set(p.id_prd,p);}
  for(const line of b.products){
    const p=byId.get(line.id);if(!p)fail(409,'PRODUCT_UNAVAILABLE');
    if(!number(p.cenaotp)||p.cenaotp!==line.price)fail(409,'PRICE_CHANGED');
    if(p.kolshtordmin!=null&&(!Number.isSafeInteger(p.kolshtordmin)||p.kolshtordmin<0))fail(502,'INVALID_MATRIX');
    // Empty minimum means full trays only; KolSht sent to KIS is always pieces.
    if(p.kolshtordmin==null){
      if(!id(p.kolukl))fail(502,'INVALID_MATRIX');
      if(line.quantity%p.kolukl!==0)fail(400,'LOT_MULTIPLE');
    }
    if(p.kolshtordmin!=null&&line.quantity<p.kolshtordmin)fail(400,'MINIMUM_QUANTITY');
  }
  // One short DB transaction claims a durable intent; network I/O is outside the transaction.
  let recordId='',cached=null;
  e.app.runInTransaction(tx=>{
    authorize(tx,uid,b.payer,b.client,true,kid);
    const same=tx.findRecordsByFilter('lk_order_requests','user_id={:u} && request_key={:k}','',1,0,{u:uid,k:key});
    if(same.length){cached=replay(same[0],hash);return;}
    const locked=tx.findRecordsByFilter('lk_order_requests','lock_tag={:t}','',1,0,{t:tag});if(locked.length)fail(409,'SUBMISSION_UNKNOWN');
    const recent=tx.findRecordsByFilter('lk_order_requests','user_id={:u} && request_hash={:h} && state="success" && updated_ms>{:since}','-updated_ms',1,0,{u:uid,h:hash,since:Date.now()-120000});
    if(recent.length)cached=replay(recent[0],hash);
    const r=new Record(tx.findCollectionByNameOrId('lk_order_requests'));r.set('user_id',uid);r.set('payer_id',b.payer);r.set('client_id',b.client);r.set('request_key',key);r.set('request_hash',hash);r.set('lock_tag',tag);r.set('state','pending');r.set('created_ms',Date.now());r.set('updated_ms',Date.now());if(cached){r.set('state','success');r.set('lock_tag','');r.set('http_status',cached.status);r.set('result_json',JSON.stringify(cached.body));}tx.save(r);recordId=r.id;
  });
  if(cached)return cached;
  function save(state,result,unlock){const r=e.app.findRecordById('lk_order_requests',recordId);r.set('state',state);r.set('http_status',result.status);r.set('result_json',JSON.stringify(result.body));r.set('updated_ms',Date.now());if(unlock)r.set('lock_tag','');e.app.save(r);return result;}
  let sent=false;
  try{
    // Recheck after claiming, before the only POST. Never send PB token or supplied prices to KIS.
    authorize(e.app,uid,b.payer,b.client,true,kid);sent=true;
    const r=transport('/orders',{Id_clt:b.client,DateOrd:b.DateOrd,Product:b.products.map(p=>({Id_prd:p.id,KolSht:p.quantity}))});
    if(r.status===400&&r.doc&&r.doc.success===false){
      const mismatch=JSON.stringify(r.doc).includes('aId_Clt');
      return save('rejected',{status:mismatch?502:422,body:{code:mismatch?'KIS_CONTRACT_MISMATCH':'KIS_REJECTED'}},true);
    }
    if(![200,201].includes(r.status)||r.doc?.success!==true)fail(503,'SUBMISSION_UNKNOWN');
    const result=r.doc.data,oid=result?.id??result?.Id_ord;if(!id(oid))fail(503,'SUBMISSION_UNKNOWN');
    // Do not report success based solely on an unscoped POST body.
    const actual=get('/orders/'+oid);header(actual,oid,b.client);
    const wanted=new Map(b.products.map(p=>[p.id,p.quantity]));
    if(!Array.isArray(actual.products)||actual.products.length!==wanted.size||actual.products.some(p=>!p||wanted.get(p.id)!==p.kol_sht)||new Set(actual.products.map(p=>p.id)).size!==wanted.size)fail(503,'SUBMISSION_UNKNOWN');
    const expectedDay=new Date(b.DateOrd*1000+10800000).toISOString().slice(0,10);
    if(typeof actual.order_date!=='string'||actual.order_date.slice(0,10)!==expectedDay)fail(503,'SUBMISSION_UNKNOWN');
    authorize(e.app,uid,b.payer,b.client,true,kid);
    return save('success',{status:201,body:{id:oid,payer:b.payer,client:b.client,order_number:actual.order_number??oid}},true);
  }catch(err){
    if(!sent){save('rejected',{status:403,body:{code:'ACCESS_DENIED'}},true);throw err;}
    try{save('unknown',{status:503,body:{code:'SUBMISSION_UNKNOWN'}},false);}catch(_){}
    fail(503,'SUBMISSION_UNKNOWN');
  }
}
function submissionStatus(e){
  const q=query(e),key=e.request.pathValue('key');if(!/^[a-f0-9]{32}$/.test(key))fail(400,'INVALID_IDEMPOTENCY_KEY');
  const kid=authorize(e.app,e.auth.id,q.payer,q.client,false);membership(kid,q.client);
  const rows=e.app.findRecordsByFilter('lk_order_requests','user_id={:u} && request_key={:k}','',1,0,{u:e.auth.id,k:key});
  if(!rows.length)return {status:200,body:{state:'not_found'}};
  const r=rows[0];if(r.get('payer_id')!==q.payer||r.get('client_id')!==q.client)fail(403,'ACCESS_DENIED');
  authorize(e.app,e.auth.id,q.payer,q.client,false,kid);
  const state=r.get('state');let result=null;if(['success','rejected'].includes(state))result=JSON.parse(r.get('result_json'));
  return {status:200,body:{state,result}};
}
module.exports.handle=(e,operation)=>{
  e.response.header().set('Cache-Control','no-store');const rid=$security.randomString(18);e.response.header().set('X-Request-ID',rid);let status=200;
  try{const r=operation==='list'?list(e):operation==='options'?options(e):operation==='detail'?detail(e):operation==='status'?submissionStatus(e):create(e);status=r.status;return e.json(r.status,r.body);}
  catch(err){status=err&&[400,401,403,409,422,502,503,504].includes(err.status)?err.status:502;return e.json(status,{code:typeof err?.code==='string'?err.code:'ORDER_SERVICE_UNAVAILABLE',requestId:rid});}
  finally{e.app.logger().info('service.checkout','operation',operation,'status',status,'requestId',rid);}
};
