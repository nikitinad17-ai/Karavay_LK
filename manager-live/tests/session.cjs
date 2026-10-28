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
  if(url==='/service/manager/demo-accounts')return response(200,{accounts:[]});
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

 b=browser({local:{[key]:'temporary-token'},fetcher:(url,opt,res)=>url.includes('auth-refresh')&&res(200,{token:'temporary-refreshed',record:{must_change_password:true}})});await wait(()=>b.q('#dialog').open);assert(b.q('#dialog-title').textContent.includes('Смена временного пароля'));assert.equal(b.q('#editor [name=password]').minLength,6);assert(b.q('#workspace').hidden);assert(!b.requests.some(r=>r.url==='/service/manager/state'));count++;b.close();

 const detailState={manager:{name:'Manager'},payers:[{id:'payer1',code:'P1',name:'Buyer 1'}],users:[{id:'user1',name:'Point user',email:'point@example.test',login:'point',role_code:'viewer',active:true,editable:true,rights:[{active:true,payer:'payer1',scope:'client',kis_client_id:11}]}]};
 let unavailable=true;b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?res(unavailable?502:200,unavailable?{code:'KIS_UNAVAILABLE'}:{clients:[{id:11,code:'CL11',name:'Assigned recipient'},{id:12,code:'CL12',name:'Unassigned recipient'}]}):null});
 await wait(()=>b.q('.unavailable'));unavailable=false;b.q('#refresh').click();await wait(()=>b.q('.user-line').textContent.includes('Assigned recipient'));assert(!b.q('.user-line').textContent.includes('Unassigned recipient'));assert(b.q('.user-line').textContent.includes('Только просмотр'));count++;b.close();

 let completeDetails;b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?new Promise(resolve=>{completeDetails=()=>resolve({ok:true,status:200,json:async()=>({clients:[{id:11,code:'LATE',name:'Late recipient'}]})});}):null});
 await wait(()=>typeof completeDetails==='function');b.q('#logout').click();completeDetails();await new Promise(r=>setTimeout(r,20));assert.equal(b.q('#content').textContent,'');assert(b.q('#workspace').hidden);count++;b.close();

 const pending=[];b=browser({local:{[key]:'issued-token'},fetcher:(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(detailState)):url.startsWith('/service/manager/clients?')?new Promise(resolve=>pending.push(resolve)):null});
 await wait(()=>pending.length===1);b.q('#refresh').click();await wait(()=>pending.length===2);
 pending[0]({ok:true,status:200,json:async()=>({clients:[{id:11,code:'STALE',name:'Outdated recipient'}]})});await new Promise(r=>setTimeout(r,20));assert(!b.q('#content').textContent.includes('Outdated recipient'));
 pending[1]({ok:true,status:200,json:async()=>({clients:[{id:11,code:'CURRENT',name:'Current recipient'}]})});await wait(()=>b.q('#content').textContent.includes('Current recipient'));count++;b.close();
 const accessState={manager:{name:'Manager'},payers:[{id:'payer1',id_pay:1,code:'P1',name:'Buyer 1',active:true,access:'all'},{id:'payer2',id_pay:2,code:'P2',name:'Buyer 2',active:true,access:'all'}],users:[{id:'user1',login:'user',name:'User',email:'user@example.test',role_code:'owner',account_type:'payer',active:true,editable:true,rights:[{payer:'payer1',scope:'all',kis_client_id:0,active:true}]}]};
 let delayPoints=false,finishPoints;
 const accessFetcher=(url,opt,res)=>url==='/service/manager/state'?res(200,structuredClone(accessState)):url==='/service/manager/directory'?res(200,{buyers:[{id:1,code:'P1',name:'Buyer 1',connection:'assigned'},{id:2,code:'P2',name:'Buyer 2',connection:'assigned'},{id:3,code:'P3',name:'Foreign buyer',connection:'registered'}]}):url.startsWith('/service/manager/clients?')?(delayPoints?new Promise(resolve=>{finishPoints=()=>resolve({ok:true,status:200,json:async()=>({clients:[{id:11,code:'LATE',name:'Late point'}]})});}):res(200,{clients:url.includes('payer1')?[{id:11,code:'POINT11',name:'Point 11',address:'Address 11'},{id:12,code:'POINT12',name:'Point 12',address:'Address 12'}]:[{id:21,code:'POINT21',name:'Point 21',address:'Address 21'}]})):null;
 b=browser({local:{[key]:'issued-token'},fetcher:accessFetcher});await wait(()=>!b.q('#workspace').hidden);b.q('[data-edit-user]').click();b.q('.edit-access').open=true;await wait(()=>b.q('#rights-list'));
 const rows=()=>[...b.w.document.querySelectorAll('.assignment')],row=id=>rows().find(r=>r.dataset.key===id),role=kind=>{b.q('[name=account_type]').value=kind;b.q('[name=account_type]').dispatchEvent(new b.w.Event('change',{bubbles:true}));},choose=id=>{b.q('#point-buyer').value=id;b.q('#point-buyer').dispatchEvent(new b.w.Event('change',{bubbles:true}));};
 assert.equal(b.q('#rights-list').dataset.kind,'payer');assert(b.q('#point-controls').hidden);assert(rows().every(r=>r.querySelector('.recipient-area').hidden));row('payer2').querySelector('.payer-check').click();
 role('client');await wait(()=>row('payer1').querySelector('.rc[value="11"]'));assert(b.q('#buyer-controls').hidden&&!b.q('#point-controls').hidden);assert(b.q('#point-buyer option[value="kis-3"]').disabled);assert(!row('payer1').querySelector('.rc[value="11"]').checked);row('payer1').querySelector('.rc[value="11"]').click();choose('payer2');await wait(()=>row('payer2').querySelector('.rc[value="21"]'));row('payer2').querySelector('.rc[value="21"]').click();assert(b.q('#point-count').textContent.includes('2'));
 role('payer');assert(row('payer1').querySelector('.payer-check').checked&&row('payer2').querySelector('.payer-check').checked);role('client');assert(row('payer1').querySelector('.rc[value="11"]').checked&&row('payer2').querySelector('.rc[value="21"]').checked);assert.equal(rows().filter(r=>!r.hidden).length,1);count++;
 delayPoints=true;choose('payer1');await wait(()=>typeof finishPoints==='function');row('payer1').querySelector('.rc[value="12"]').click();finishPoints();await new Promise(r=>setTimeout(r,20));assert(row('payer1').querySelector('.rc[value="12"]').checked);count++;delayPoints=false;choose('payer1');await wait(()=>row('payer1').textContent.includes('POINT11'));
 delayPoints=true;choose('payer1');await wait(()=>typeof finishPoints==='function');role('payer');finishPoints();await new Promise(r=>setTimeout(r,20));assert(!b.q('#rights-list').textContent.includes('LATE'));assert(b.q('#point-controls').hidden);count++;b.close();

 accessState.users[0].account_type='client';accessState.users[0].rights=[{payer:'payer1',scope:'client',kis_client_id:11,active:true},{payer:'payer2',scope:'client',kis_client_id:21,active:true}];delayPoints=false;
 b=browser({local:{[key]:'issued-token'},fetcher:accessFetcher});await wait(()=>!b.q('#workspace').hidden);b.q('[data-edit-user]').click();b.q('.edit-access').open=true;await wait(()=>b.q('#rights-list'));choose('payer2');await wait(()=>row('payer2').textContent.includes('POINT21'));let closePrompts=0;b.w.confirm=()=>{closePrompts++;return false;};b.q('#close').click();assert(!b.q('#dialog').open);assert.equal(closePrompts,0);count++;b.close();
 console.log('PASS:',count,'session/assignment UI checks (isolated jsdom/fetch fixtures).');
})().catch(e=>{console.error(e.stack);process.exit(1);});
