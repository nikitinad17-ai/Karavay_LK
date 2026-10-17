const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'../pb_public/manager'),key='karavay.manager.token',logoutKey='karavay.manager.logout';
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script=fs.readFileSync(path.join(root,'app.js'),'utf8');
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Session UI timeout');};
function browser({local={},session={},fetcher}={}){
 const dom=new JSDOM(html,{url:'http://localhost/manager/',runScripts:'outside-only'}),w=dom.window,requests=[];
 for(const [k,v] of Object.entries(local))w.localStorage.setItem(k,v);
 for(const [k,v] of Object.entries(session))w.sessionStorage.setItem(k,v);
 const response=(status,body)=>Promise.resolve({ok:status<400,status,json:async()=>body});
 w.fetch=(url,options)=>{requests.push({url,body:options.body&&JSON.parse(options.body),auth:options.headers.Authorization});
  const custom=fetcher?.(url,options,response);if(custom)return custom;
  if(url.includes('/auth-with-password'))return response(200,{token:'issued-token',record:{must_change_password:false}});
  if(url.includes('/auth-refresh'))return response(200,{token:'refreshed-token',record:{must_change_password:false}});
  if(url==='/service/manager/state')return response(200,{manager:{name:'Manager'},payers:[],users:[]});
  if(url==='/service/manager/directory')return response(200,{buyers:[]});
  if(url==='/service/manager/test-login')return response(200,{enabled:false});
  throw Error('Unexpected URL '+url);
 };
 w.AbortController=AbortController;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 const q=s=>w.document.querySelector(s);
 function login(remember){q('[name=identity]').value='manager@example.test';q('[name=password]').value='temporary-fixture-password';q('[name=remember]').checked=remember;q('#login-form').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:q('#login-form button[type=submit]')}));}
 w.eval(script);return {w,q,login,requests,close:()=>w.close()};
}
(async()=>{
 let count=0,b=browser();b.login(true);await wait(()=>!b.q('#workspace').hidden);
 assert.equal(b.w.localStorage.getItem(key),'issued-token');assert.equal(b.w.sessionStorage.getItem(key),null);
 assert.equal(b.q('[name=password]').value,'');assert.deepEqual(Object.keys(b.w.localStorage),[key]);assert(!('remember' in b.requests.find(r=>r.url.includes('auth-with-password')).body));count++;b.close();

 b=browser({local:{[key]:'issued-token'}});await wait(()=>!b.q('#workspace').hidden);
 assert.equal(b.requests[0].url,'/api/collections/users/auth-refresh');assert.equal(b.requests[0].auth,'issued-token');assert.equal(b.w.localStorage.getItem(key),'refreshed-token');assert(!b.requests.some(r=>r.url.includes('auth-with-password')));count++;
 b.q('#logout').click();assert.equal(b.w.localStorage.getItem(key),null);assert.equal(b.w.sessionStorage.getItem(key),null);assert(b.q('#workspace').hidden);count++;
 b.login(false);await wait(()=>!b.q('#workspace').hidden);assert(b.q('#create'));b.q('#create').click();await wait(()=>b.q('#dialog').open);assert(b.q('[name=login]'));count++;b.close();

 b=browser();b.login(false);await wait(()=>!b.q('#workspace').hidden);assert.equal(b.w.localStorage.getItem(key),null);assert.equal(b.w.sessionStorage.getItem(key),'issued-token');count++;b.close();
 b=browser();assert.equal(b.requests.length,1);assert.equal(b.requests[0].url,'/service/manager/test-login');assert(b.q('#workspace').hidden);count++;b.close();
 b=browser({session:{[key]:'issued-token'}});await wait(()=>!b.q('#workspace').hidden);assert.equal(b.w.sessionStorage.getItem(key),'refreshed-token');assert.equal(b.w.localStorage.getItem(key),null);count++;b.close();

 b=browser({local:{[key]:'expired'},fetcher:(url,opt,res)=>url.includes('auth-refresh')&&res(401,{})});await wait(()=>!b.w.localStorage.getItem(key));assert(b.q('#workspace').hidden);assert(!b.requests.some(r=>r.url==='/service/manager/state'));count++;b.close();

 let offline=true;b=browser({local:{[key]:'issued-token'},fetcher:url=>offline&&url.includes('auth-refresh')&&Promise.reject(Error('Network offline'))});await wait(()=>!b.q('#retry-session').hidden);
 assert.equal(b.w.localStorage.getItem(key),'issued-token');assert(b.q('#workspace').hidden);offline=false;b.q('#retry-session').click();await wait(()=>!b.q('#workspace').hidden);count++;b.close();

 b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'&&res(403,{code:'MANAGER_REQUIRED'})});await wait(()=>!b.w.localStorage.getItem(key));assert(b.q('#workspace').hidden);count++;b.close();

 b=browser({local:{[key]:'issued-token'}});await wait(()=>!b.q('#workspace').hidden);b.w.localStorage.removeItem(key);b.w.dispatchEvent(new b.w.StorageEvent('storage',{key:logoutKey,newValue:'another-tab-logout'}));assert(b.q('#workspace').hidden);assert.equal(b.w.sessionStorage.getItem(key),null);count++;b.close();

 let finish;b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url.includes('auth-refresh')&&new Promise(resolve=>{finish=()=>resolve({ok:true,status:200,json:async()=>({token:'late-token',record:{must_change_password:false}})});})});
 b.q('#logout').click();finish();await new Promise(r=>setTimeout(r,20));assert.equal(b.w.localStorage.getItem(key),null);assert(b.q('#workspace').hidden);count++;b.close();

 b=browser({local:{[key]:'temporary-token'},fetcher:(url,opt,res)=>url.includes('auth-refresh')&&res(200,{token:'temporary-refreshed',record:{must_change_password:true}})});await wait(()=>b.q('#dialog').open);assert(b.q('#dialog-title').textContent.includes('Смена временного пароля'));assert(b.q('#workspace').hidden);assert(!b.requests.some(r=>r.url==='/service/manager/state'));count++;b.close();

 const detailState={manager:{name:'Manager'},payers:[{id:'payer1',code:'P1',name:'Buyer 1'}],users:[{id:'user1',name:'Point user',email:'point@example.test',login:'point',role_code:'viewer',active:true,editable:true,rights:[{active:true,payer:'payer1',scope:'client',kis_client_id:11}]}]};
 let unavailable=true;b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?res(unavailable?502:200,unavailable?{code:'KIS_UNAVAILABLE'}:{clients:[{id:11,code:'CL11',name:'Assigned recipient'},{id:12,code:'CL12',name:'Unassigned recipient'}]}):null});
 await wait(()=>b.q('[data-recipients]'));assert(!b.requests.some(r=>r.url.includes('/clients?')));b.q('[data-recipients]').click();await wait(()=>b.q('.unavailable'));assert(!b.q('[data-recipients]').disabled);unavailable=false;b.q('[data-recipients]').click();await wait(()=>b.q('.user-line').textContent.includes('Assigned recipient'));assert(!b.q('.user-line').textContent.includes('Unassigned recipient'));count++;b.close();

 let completeDetails;b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?new Promise(resolve=>{completeDetails=()=>resolve({ok:true,status:200,json:async()=>({clients:[{id:11,code:'LATE',name:'Late recipient'}]})});}):null});
 await wait(()=>b.q('[data-recipients]'));b.q('[data-recipients]').click();b.q('#logout').click();completeDetails();await new Promise(r=>setTimeout(r,20));assert.equal(b.q('#content').textContent,'');assert(b.q('#workspace').hidden);count++;b.close();

 b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?new Promise(resolve=>{completeDetails=()=>resolve({ok:true,status:200,json:async()=>({clients:[{id:11,code:'STALE',name:'Outdated recipient'}]})});}):null});
 await wait(()=>b.q('[data-recipients]'));b.q('[data-recipients]').click();b.q('#refresh').click();await wait(()=>b.requests.filter(r=>r.url==='/service/manager/state').length===2);await new Promise(r=>setTimeout(r,20));completeDetails();await new Promise(r=>setTimeout(r,20));assert(!b.q('#content').textContent.includes('Outdated recipient'));assert(!b.q('[data-recipients]').disabled);count++;b.close();
 console.log('PASS:',count,'session UI checks (isolated jsdom/fetch fixtures).');
})().catch(e=>{console.error(e.stack);process.exit(1);});
