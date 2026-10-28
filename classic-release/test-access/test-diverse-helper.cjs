// Actual helper + actual order read handlers, with an in-memory PB ORM/KIS transport.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const ns=process.argv[2]||'384';
const pids=['payer0000000001','payer0000000002','payer0000000003'];
const c={version:2,enabled:true,environment:'test-kis',ownerRole:'owner0000000001',managerOwner:'',
 payers:pids.map((id,i)=>({id,kid:100+i*100,code:'P'+i,name:'Fixture customer '+i})),
 points:pids.map((_,i)=>({id:'point000000000'+(i+1),kid:110+i*100,code:'C'+i,name:'Fixture recipient '+i})),
 accounts:['point','buyer','multi'].map((s,i)=>({id:'test'+ns+s+'001',name:s,email:'demo.test.'+s+'.v'+ns+'@example.test',login:'kis_test_'+s+'_v'+ns,description:s,rights:['t'+ns+s+'000001',...(i===2?['t'+ns+s+'000002']:[])]})),
 history:{proofs:[{group:1},{group:0},{group:1}]}};c.point=c.points[0];if(ns==='385')c.scenario='multi-recipient-v385';
const db={roles:new Map(),payers:new Map(),clients:new Map(),users:new Map(),rights:new Map()};
class Record{constructor(collection){this.collection=collection;this.data={};}get id(){return this.data.id;}get(k){return this.data[k];}set(k,v){this.data[k]=v;}setPassword(v){this.passwordHash='fixture-hash-'+v;}}
function add(collection,id,data){const r=new Record(collection);r.set('id',id);for(const [k,v] of Object.entries(data))r.set(k,v);db[collection].set(id,r);return r;}
add('roles',c.ownerRole,{code_role:'owner',active:true});
const old=add('users','olduser00000001',{email:'keep@example.test',active:true});old.passwordHash='existing-password-hash';
const app={dataDir:()=>'/fixture',findCollectionByNameOrId:x=>x,save:r=>db[r.collection].set(r.id,r),
 findRecordById:(collection,id)=>{const r=db[collection].get(id);if(!r)throw Error('missing');return r;},
 findRecordsByFilter:(collection,f,s,l,o,b)=>[...db[collection].values()].filter(r=>
  collection==='rights'?r.get('user')===b.u&&(!b.p||r.get('payer')===b.p&&r.get('active')&&(r.get('scope')==='all'||r.get('kis_client_id')===b.c)):
  collection==='clients'?r.get('id_clt')===b.c:false).slice(0,l),logger:()=>({info(){}})};
function context(file,extra={}){const ctx={module:{exports:{}},Record,$os:{readFile:()=>JSON.stringify(c)},toString:x=>x,$security:{randomString:n=>'x'.repeat(n)},...extra};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pb_hooks',file),'utf8'),ctx);return ctx.module.exports;}
const helper=context('karavay-test-access.js',{$apis:{recordAuthResponse:(e,u)=>e.json(200,{token:'fixture-'+u.id,record:{id:u.id,email:u.get('email')}})}});
helper.bootstrap(app);const hashes=[...db.users.values()].map(r=>r.passwordHash);helper.bootstrap(app);assert.deepEqual([...db.users.values()].map(r=>r.passwordHash),hashes);assert.equal(old.passwordHash,'existing-password-hash');
function event(user='',query='',body={},id=''){const e={app,auth:db.users.get(user),request:{host:'fixture',url:{rawQuery:query},header:{get:()=>''},pathValue:()=>id},requestInfo:()=>({body}),response:{header:()=>({set(){}})},json:(status,data)=>{e.result={status,data};return e.result;}};return e;}
let e=event();helper.handle(e,false);assert.equal(e.result.status,200);assert.equal(e.result.data.accounts.length,3);assert.deepEqual(e.result.data.accounts.map(a=>a.preferredPayer).join(','),pids.join(','));assert.equal(e.result.data.accounts[1].preferredGroup,0);
const docs={};for(let i=0;i<3;i++){const cid=c.points[i].kid,oid=cid+1000;docs['/clients/'+cid]={id:cid,payer_id:c.payers[i].kid,state:1};docs['/payers/'+c.payers[i].kid+'/clients']=[{id:cid}];docs['/clients/'+cid+'/orders']={id_clt:cid,Orders:[{id:oid}]};docs['/orders/'+oid]={id:oid,client_id:cid,order_number:'FIXTURE-'+oid,products:[{id:66,product_kod:'P66',product_name:'Fixture order item',cena_otp:3,kol_sht:8,sum_all:24}]};}
if(ns==='385'){const cid=211,oid=1211;docs['/clients/'+cid]={id:cid,payer_id:c.payers[1].kid,state:1};docs['/payers/'+c.payers[1].kid+'/clients'].push({id:cid});docs['/clients/'+cid+'/orders']={id_clt:cid,Orders:[{id:oid}]};docs['/orders/'+oid]={id:oid,client_id:cid,products:[{id:66,product_kod:'P66',product_name:'Second recipient item',cena_otp:3,kol_sht:16,sum_all:48}]};}
const checkout=context('karavay-checkout.js',{$os:{cmd:(_,...args)=>({output:()=>{assert(!args.includes('-X'),'Unexpected KIS write');const url=args[args.indexOf('--url')+1],route=url.split('/api/v1')[1];assert(route in docs,'Unexpected KIS read '+route);return JSON.stringify({success:true,data:docs[route]})+'\n__KIS_HTTP__:200';}})}});
for(let i=0;i<3;i++){
 const a=c.accounts[i];e=event('', '',{id:a.id});helper.handle(e,true);assert.equal(e.result.status,200);assert.equal(e.result.data.record.id,a.id);
 const indexes=i===0?[0]:i===1?[1]:[2,1];
 for(const n of indexes){const q='payer='+pids[n]+'&client='+c.points[n].kid;e=event(a.id,q);checkout.handle(e,'list');assert.equal(e.result.status,200);assert.equal(e.result.data.orders.length,1);const oid=e.result.data.orders[0].id;e=event(a.id,q,{},String(oid));checkout.handle(e,'detail');assert.equal(e.result.status,200);assert.equal(e.result.data.items[0].quantity,8);}
 const foreign=i===2?0:2;e=event(a.id,'payer='+pids[foreign]+'&client='+c.points[foreign].kid);checkout.handle(e,'list');assert.equal(e.result.status,403);
}
if(ns==='385'){e=event(c.accounts[1].id,'payer='+pids[1]+'&client=211');checkout.handle(e,'list');assert.equal(e.result.status,200);assert.equal(e.result.data.orders[0].id,1211);e=event(c.accounts[1].id,'payer='+pids[1]+'&client=211',{},'1211');checkout.handle(e,'detail');assert.equal(e.result.status,200);assert.equal(e.result.data.items[0].quantity,16);}
db.rights.get(c.accounts[0].rights[0]).set('payer',pids[2]);e=event('','',{id:c.accounts[0].id});helper.handle(e,true);assert.equal(e.result.status,403);db.rights.get(c.accounts[0].rights[0]).set('payer',pids[0]);
db.clients.get(c.points[2].id).set('active',false);e=event();helper.handle(e,false);assert.equal(e.result.data.accounts.length,2);db.clients.get(c.points[2].id).set('active',true);
const id=c.payers[2].id;c.payers[2].id=c.payers[1].id;e=event();helper.handle(e,false);assert.equal(e.result.status,503);c.payers[2].id=id;
assert.equal(old.passwordHash,'existing-password-hash');
console.log('PASS: actual helper bootstrap/repeat/3 passwordless identities, distinct defaults, exact scopes, disabled/forged grants; actual gateway history+lines and foreign-data denial; no order writes. Fixture ORM/transport, not live PB/KIS.');
