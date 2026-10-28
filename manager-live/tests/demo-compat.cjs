const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const root=path.join(__dirname,'../pb_public/manager'),dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost/manager/',runScripts:'outside-only'}),w=dom.window,requests=[],id='u'.repeat(15),pid='p'.repeat(15),foreign='x'.repeat(15);
 const account={id,name:'Существующее демо',email:'demo.existing@example.test',description:'Существующий сценарий',preferredPayer:pid,preferredClient:11};
 w.fetch=async(url,options)=>{requests.push({url,options});let status=200,body;
  if(url.includes('/auth-refresh'))body={token:'manager-fixture',record:{role_code:'manager',active:true,must_change_password:false}};
  else if(url==='/service/manager/state')body={manager:{name:'Manager',email:'manager@example.test'},payers:[{id:pid,code:'P1',name:'Buyer'}],users:[{id,login:'demo_existing',name:account.name,email:account.email,role_code:'owner',active:true,editable:true,verified:false,rights:[{payer:pid,scope:'all',kis_client_id:0,active:true}]}]};
  else if(url==='/service/manager/demo-accounts'){status=404;body={code:'DEMO_NOT_CONFIGURED'};}
  else if(url==='/service/test-access'&&options.method==='GET')body={environment:'test-kis',accounts:[account,{...account,id:foreign}]};
  else if(url==='/service/test-access'&&options.method==='POST')body={token:'client-fixture',record:{id,email:account.email,role_code:'owner',active:true,must_change_password:false}};
  else throw Error('Unexpected route '+url);
  return {ok:status<400,status,json:async()=>body};
 };
 w.AbortController=AbortController;w.sessionStorage.setItem('karavay.manager.token','manager-fixture');const saved=new Map();let destination;
 w.open=()=>({closed:false,document:{body:{},title:''},sessionStorage:{setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},location:{replace:url=>destination=url},close(){this.closed=true;}});
 w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
 const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Demo compatibility timeout');};
 await wait(()=>w.document.querySelector('[data-demo-login]'));assert.equal(w.document.querySelectorAll('[data-demo-login]').length,1);w.document.querySelector('[data-demo-login]').click();await wait(()=>saved.has('karavay_classic_session_v1'));
 const session=JSON.parse(saved.get('karavay_classic_session_v1'));assert.equal(session.id,id);assert.equal(session.test,true);assert.equal(session.preferredPayer,pid);assert.equal(destination,'/');assert.equal(w.sessionStorage.getItem('karavay.manager.token'),'manager-fixture');
 const request=requests.find(r=>r.url==='/service/test-access'&&r.options.method==='POST');assert.equal(request.options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(request.options.body),{id});
 console.log('PASS: existing client demo retained without manager reseeding, correct test session/endpoint, outside-scope account excluded, manager session unchanged.');w.close();
})().catch(e=>{console.error(e);process.exit(1);});
