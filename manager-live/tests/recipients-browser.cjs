const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MANAGER_CHROME,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1824,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('dialog',d=>d.accept());
  await page.goto(settings.url+'/manager/');await page.locator('#test-login').click();await page.locator('#workspace').waitFor({state:'visible'});
  const plan=settings.plan;await page.locator('[data-demo-login]').nth(5).waitFor();assert.equal(await page.locator('.user-line').count(),6);assert.equal(await page.locator('[data-tab]').count(),1);
  assert.equal(await page.locator('.role-badge.client').count(),4);assert.equal(await page.locator('.role-badge.payer').count(),2);assert.equal(await page.locator('.user-list th').allTextContents().then(x=>x.join('|')),'Логин|Email|Роль|Подтверждён|Покупатели (код)|Получатели (код)|Действия');
  await page.locator('.user-line').filter({hasText:plan.accounts[1].email}).filter({hasText:plan.payers[0].clients[0].code}).waitFor();
  if(settings.screenshot)await page.screenshot({path:settings.screenshot,fullPage:true});
  for(let i=0;i<plan.accounts.length;i++){
   const a=plan.accounts[i],p=plan.payers[Math.floor(i/3)],popupEvent=page.context().waitForEvent('page');
   await page.locator(`[data-demo-login="${a.id}"]`).click();const popup=await popupEvent;await popup.waitForURL(settings.url+'/');await popup.getByRole('link',{name:'Мои точки',exact:true}).waitFor();
   assert.equal((await popup.evaluate(()=>JSON.parse(sessionStorage.getItem('karavay_classic_session_v1')))).id,a.id);
   await popup.getByRole('link',{name:'Мои точки',exact:true}).click();
   if(i%3){await popup.locator('.classic-outlet').waitFor();assert.equal(await popup.locator('.classic-outlet').count(),1);assert((await popup.locator('.classic-outlet').innerText()).includes(p.clients[i%3-1].code));}
   else await popup.locator('.classic-outlet').nth(1).waitFor();
   await popup.reload();await popup.getByRole('link',{name:'Мои точки',exact:true}).waitFor();await popup.getByRole('button',{name:'Выйти',exact:true}).click();await popup.locator('.login__title').waitFor();await popup.close();assert(await page.locator('#workspace').isVisible());
  }
  for(const kind of ['client','payer']){
   await page.locator('#create').click();await page.locator('#dialog').waitFor({state:'visible'});
   assert.equal(await page.locator('#dialog-title').innerText(),'Новый пользователь');assert.equal(await page.locator('.user-form-grid input').count(),3);assert.equal(await page.locator('.user-form-grid select').count(),1);assert.equal(await page.locator('[name=account_type]').inputValue(),'');
   assert(await page.locator('option[value=admin]').evaluate(e=>e.disabled));assert(await page.locator('option[value=manager]').evaluate(e=>e.disabled));
   if(settings.screenshot&&kind==='client')await page.screenshot({path:settings.screenshot.replace('.png','-form.png')});
   await page.locator('[name=login]').fill('browser_'+kind);await page.locator('[name=email]').fill('browser.'+kind+'@example.test');await page.locator('[name=account_type]').selectOption(kind);await page.locator('#editor [name=password]').fill('Independent-test-password-123!');await page.locator('#save').click();await page.locator('#dialog').waitFor({state:'hidden'});
   let row=page.locator('.user-line').filter({hasText:'browser.'+kind+'@example.test'});await row.waitFor();assert.equal(await row.locator('.role-badge').innerText(),kind==='client'?'Получатель (Client)':'Покупатель (Payer)');
   assert.equal(await page.locator('#rights-list').count(),0);await page.reload();await row.waitFor();assert((await row.innerText()).includes(kind==='client'?'Получатель (Client)':'Покупатель (Payer)'));
   await row.locator('[data-edit-user]').click();assert.equal(await page.locator('[name=account_type]').inputValue(),kind);await page.locator('.edit-access>summary').click();await page.locator('#rights-list').waitFor();
   const assignment=page.locator(`.assignment[data-key="${plan.payers[0].id}"]`);await assignment.locator('.payer-check').check();
   if(kind==='client'){await assignment.locator(`.rc[value="${plan.payers[0].clients[0].kid}"]`).check();assert.equal(await assignment.locator('.rs').inputValue(),'client');}
   else assert.equal(await assignment.locator('.rs').inputValue(),'all');
   await page.locator('#save').click();await page.locator('#dialog').waitFor({state:'hidden'});
   await row.locator('[data-info]').click();await page.locator('#dialog').waitFor({state:'visible'});assert(await page.locator('#save').isHidden());await page.locator('#cancel').click();
   if(kind==='payer'){await row.locator('[data-delete-user]').click();await row.waitFor({state:'hidden'});}
  }
  // All six demo records and login buttons survive creating/editing/deleting ordinary users.
  assert.equal(await page.locator('[data-demo-login]').count(),6);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#create').click();await page.locator('#dialog').waitFor({state:'visible'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#cancel').click();
  if(settings.screenshot){await page.locator('#message').waitFor({state:'hidden'});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:settings.screenshot.replace('.png','-mobile.png'),fullPage:true});}
  assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(r=>r.url.includes('/api/v1')));assert(!requests.some(r=>r.method==='POST'&&r.url.includes('/service/orders')));
  console.log('PASS: Chromium reference table/four-field form, Client/Payer saved across F5, edit rights/Info/Delete, six existing demo logins/isolation/logout, mobile and unchanged manager session.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
