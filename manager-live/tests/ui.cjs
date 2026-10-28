const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const root=path.join(__dirname,'../pb_public/manager'),dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:settings.url+'/manager/',runScripts:'outside-only'}),w=dom.window,requests=[];
 w.fetch=(url,options)=>{requests.push({url,body:options.body?JSON.parse(options.body):null});return fetch(new URL(url,settings.url),options);};w.AbortController=AbortController;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const q=s=>w.document.querySelector(s),all=s=>[...w.document.querySelectorAll(s)],wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout: '+q('#message').textContent+' / '+q('#form-error').textContent);},submit=()=>q('#editor').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:q('#save')}));
 w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
 q('#login-form [name=identity]').value=settings.email;q('#login-form [name=password]').value=settings.password;q('#login-form [name=remember]').checked=true;
 q('#login-form').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:q('#login-form button[type=submit]')}));
 await wait(()=>!q('#workspace').hidden);assert.equal(all('[data-tab]').length,1);assert.equal(q('#title').textContent,'Пользователи');assert.equal(all('.user-list th').length,7);
 q('#create').click();assert.equal(q('#dialog-title').textContent,'Новый пользователь');assert.equal(all('.user-form-grid input').length,3);assert.equal(all('.user-form-grid select').length,1);assert.equal(q('[name=account_type]').value,'');assert.equal(all('.assignment').length,0);
 assert(q('[name=account_type] option[value=admin]').disabled&&q('[name=account_type] option[value=manager]').disabled);
 q('[name=login]').value='uicustomer';q('[name=email]').value='uicustomer@example.test';q('[name=account_type]').value='client';q('#editor [name=password]').value=settings.password;submit();
 await wait(()=>!q('#dialog').open);const row=()=>all('.user-line').find(r=>r.textContent.includes('uicustomer@example.test'));await wait(()=>row());assert(row().textContent.includes('Получатель (Client)'));assert(!q('#rights-list'));
 const created=requests.find(r=>r.body?.action==='create_user').body;assert.equal(created.name,'uicustomer');assert.equal(created.role_code,'owner');assert.equal(created.account_type,'client');assert(!requests.some(r=>r.body?.action==='set_rights'));
 row().querySelector('[data-edit-user]').click();assert.equal(q('[name=account_type]').value,'client');assert(!q('#rights-list'));q('.edit-access').open=true;await wait(()=>q('#rights-list'));
 const a=all('.assignment').find(r=>r.textContent.includes('P1 —'));a.querySelector('.payer-check').click();await wait(()=>a.querySelector('.rc[value="11"]'));a.querySelector('.rc[value="11"]').click();a.querySelector('.rc[value="12"]').click();submit();
 await wait(()=>!q('#dialog').open);await wait(()=>row()?.textContent.includes('CL11')&&row()?.textContent.includes('CL12'));assert.equal(row().querySelector('[data-label="Покупатели (код)"]').textContent,'—');
 // Change the type after assignments are loaded: regenerate valid scopes without losing checked recipients.
 for(const kind of ['payer','client']){
  row().querySelector('[data-edit-user]').click();q('.edit-access').open=true;await wait(()=>q('#rights-list'));
  q('[name=account_type]').value=kind;q('[name=account_type]').dispatchEvent(new w.Event('change',{bubbles:true}));
  const assigned=all('.assignment').find(r=>r.querySelector('.payer-check').checked);
  assert.equal(assigned.querySelector('.rs').value,kind==='payer'?'all':'client');
  await wait(()=>assigned.querySelector('.rc[value="11"]')&&!assigned.querySelector('[data-candidates]').disabled);
  if(kind==='client')assigned.querySelector('.rc[value="11"]').checked=true;
  submit();await wait(()=>!q('#dialog').open);
  await wait(()=>row()?.textContent.includes(kind==='payer'?'Покупатель (Payer)':'Получатель (Client)'));
  const saved=requests.filter(r=>r.body?.action==='edit_user').at(-1).body;
  assert.equal(saved.account_type,kind);assert(saved.rights.every(r=>r.scope===(kind==='payer'?'all':'client')));
 }
 row().querySelector('[data-info]').click();assert(q('#save').hidden);assert(q('#dialog').textContent.includes('Получатель (Client)'));q('#cancel').click();
 q('#role-filter').value='client';q('#role-filter').dispatchEvent(new w.Event('change'));assert(row());q('#role-filter').value='payer';q('#role-filter').dispatchEvent(new w.Event('change'));assert(!row());q('#role-filter').value='';q('#role-filter').dispatchEvent(new w.Event('change'));
 row().querySelector('[data-edit-user]').click();q('[name=email]').value='not-saved@example.test';let prompted=false;w.confirm=()=>{prompted=true;return false;};q('#close').click();assert(prompted&&q('#dialog').open);w.confirm=()=>true;q('#close').click();assert(!q('#dialog').open);
 row().querySelector('[data-delete-user]').click();await wait(()=>!row());assert(requests.some(r=>r.body?.action==='delete_user'&&r.body.confirm_login==='uicustomer'));
 q('#logout').click();assert.equal(w.sessionStorage.getItem('karavay.manager.token'),null);assert.equal(w.localStorage.getItem('karavay.manager.token'),null);
 console.log('PASS: simple reference UI on real PB: four fields, Client/Payer persistence, close after Create, edit assignments, role filter, Info/Delete/cancel/logout.');dom.window.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
