const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../pb_hooks/karavay-test-access.js'),'utf8');
function run(now,kind){
 const config={version:1,enabled:true,environment:'test-kis',ownerRole:'owner0000000001',payers:[{id:'payer0000000001',kid:100,code:'A100',name:'Fixture buyer A'},{id:'payer0000000002',kid:200,code:'A200',name:'Fixture buyer B'}],point:{id:'point0000000001',kid:110},accounts:['point','buyer','multi'].map(s=>({id:'test383'+s+'001',email:'demo.test.'+s+'.v383@example.test',name:s,description:s}))};
 if(kind)config[kind]={proofs:[{day:'2026-10-20',group:0}]};
 const record=(id,data)=>({id,get:k=>data[k]});
 const app={dataDir:()=>'/fixture',findRecordById:(c,id)=>{
  if(c==='roles')return record(id,{active:true,code_role:'owner'});
  if(c==='users'){const a=config.accounts.find(a=>a.id===id);return record(id,{email:a.email,active:true,must_change_password:false,role:config.ownerRole,role_code:'owner'});}
  if(c==='payers')return record(id,{active:true,id_pay:config.payers.find(p=>p.id===id).kid});
  if(c==='clients')return record(id,{active:true,id_clt:110,payer:config.payers[0].id});
 },findRecordsByFilter:(c,f,s,l,o,b)=>{
  const i=config.accounts.findIndex(a=>a.id===b.u),all=p=>({payer:p.id,scope:'all',kis_client_id:0,client:'',active:true});
  const rs=i===0?[{payer:config.payers[0].id,scope:'client',kis_client_id:110,client:config.point.id,active:true}]:i===1?[all(config.payers[0])]:config.payers.map(all);
  return rs.map((r,j)=>record(String(j),r));
 }};
 class Clock extends Date{static now(){return Date.parse(now);}}
 const context={module:{exports:{}},Date:Clock,$os:{readFile:()=>JSON.stringify(config)},toString:x=>x};
 vm.runInNewContext(source,context);
 let status,result;context.module.exports.handle({app,request:{url:{}},response:{header:()=>({set(){}})},json:(s,d)=>{status=s;result=d;}},false);
 assert.equal(status,200);assert.equal(result.accounts.length,3);
 assert.equal(config[kind]?.proofs[0].day,kind?'2026-10-20':undefined);
 return result.accounts;
}
for(const [instant,wanted] of [['2026-10-27T20:59:59Z','2026-10-28'],['2026-10-27T21:00:00Z','2026-10-29'],['2026-10-31T21:00:00Z','2026-11-02'],['2026-12-31T20:59:59Z','2027-01-01'],['2026-12-31T21:00:00Z','2027-01-02']]){
 for(const kind of ['buyers','history',null])for(const account of run(instant,kind)){
  assert.equal(account.preferredDate,wanted);assert.equal(account.preferredGroup,kind?0:1);
 }
}
console.log('PASS: actual helper returns Moscow tomorrow across midnight/month/year; old proof dates retained only as evidence; group/account scopes preserved.');
