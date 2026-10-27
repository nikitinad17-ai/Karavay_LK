const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MANAGER_CHROME,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto(settings.url+'/manager/');await page.locator('#test-login').click();await page.locator('#workspace').waitFor({state:'visible'});
  const plan=settings.plan,point=plan.payers[0].clients[0];
  let row=page.locator('.user-line').filter({hasText:plan.accounts[1].email});
  assert.equal(await row.locator('.role-badge').innerText(),'Оформление заказов');
  assert.equal(await row.locator('.scope-label').innerText(),'Получатель · одна точка');
  await row.locator('[data-recipients]').click();await row.locator('.recipient-address').filter({hasText:point.address}).waitFor();
  assert(!(await row.innerText()).includes(plan.payers[0].clients[1].code));
  const buyerRow=page.locator('.user-line').filter({hasText:plan.accounts[0].email});
  if(await buyerRow.locator('[data-recipients]').isVisible())await buyerRow.locator('[data-recipients]').click();await buyerRow.locator('.recipient-name').nth(1).waitFor();
  assert((await buyerRow.innerText()).includes(plan.payers[0].clients[1].address));
  await page.locator('[data-tab=demos]').click();await page.locator('.demo-card').nth(5).waitFor();assert.equal(await page.locator('.demo-card').count(),6);
  assert.equal(await page.getByRole('button',{name:'Войти как покупатель',exact:true}).count(),2);
  assert.equal(await page.getByRole('button',{name:'Войти как получатель',exact:true}).count(),4);
  await page.evaluate(()=>scrollTo(0,0));if(settings.screenshot)await page.screenshot({path:settings.screenshot,fullPage:true});
  for(let i=0;i<plan.accounts.length;i++){
   const a=plan.accounts[i],p=plan.payers[Math.floor(i/3)],popupEvent=page.context().waitForEvent('page',{timeout:10000});
   await page.locator(`[data-demo-login="${a.id}"]`).click();const popup=await popupEvent.catch(async e=>{console.error('OPEN_DIAGNOSTIC',JSON.stringify({message:await page.locator('#message').innerText(),errors,pages:page.context().pages().map(p=>p.url()),requests:requests.slice(-4),state:await page.evaluate(()=>({accounts:demoAccounts.length,private:!!privateAccess}))}));throw e;});
   await popup.waitForURL(settings.url+'/');await popup.getByRole('link',{name:'Мои точки',exact:true}).waitFor();
   const session=await popup.evaluate(()=>JSON.parse(sessionStorage.getItem('karavay_classic_session_v1')));assert.equal(session.id,a.id);
   await popup.getByRole('link',{name:'Мои точки',exact:true}).click();
   if(i%3){await popup.locator('.classic-outlet').waitFor();assert.equal(await popup.locator('.classic-outlet').count(),1);assert((await popup.locator('.classic-outlet').innerText()).includes(p.clients[i%3-1].address));}
   else{await popup.locator('.classic-outlet').nth(1).waitFor();assert((await popup.locator('.classic-outlet').allInnerTexts()).join(' ').includes(p.clients[1].code));}
   await popup.getByRole('link',{name:'Профиль',exact:true}).click();await popup.locator('.classic-profile').filter({hasText:a.email}).waitFor();
   await popup.reload();await popup.getByRole('link',{name:'Мои точки',exact:true}).waitFor();
   assert.equal((await popup.evaluate(()=>JSON.parse(sessionStorage.getItem('karavay_classic_session_v1')))).id,a.id);
   await popup.getByRole('button',{name:'Выйти',exact:true}).click();await popup.locator('.login__title').waitFor();
   assert.equal(await popup.evaluate(()=>sessionStorage.getItem('karavay_classic_session_v1')),null);await popup.close();
   assert(await page.locator('#workspace').isVisible());
  }
  // Creating a new point user preselects exactly that point in the second step.
  await page.locator('[data-tab=clients]').click();await page.locator('#buyer').selectOption(plan.payers[0].id);
  const pointRow=page.locator('.buyer-line').filter({hasText:point.code});await pointRow.getByRole('button',{name:'Создать вход получателя',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'visible'});assert((await page.locator('#dialog-title').innerText()).includes('получателя'));
  assert((await page.locator('#fields').innerText()).includes(point.address));assert.equal(await page.locator('#fields .assignment').count(),0);
  assert.equal(await page.locator('[name=role_code] option[value=owner]').innerText(),'Оформление заказов');
  await page.locator('[name=name]').fill('Новый получатель браузера');await page.locator('[name=email]').fill('browser.point@example.test');await page.locator('[name=login]').fill('browser_point');
  await page.locator('#editor [name=password]').fill('Browser-fixture-independent-123!');await page.locator('#save').click();await page.locator('#rights-list').waitFor();
  await page.locator(`.rc[value="${point.kid}"]:checked`).waitFor();assert.equal(await page.locator('.payer-check:checked').count(),1);assert.equal(await page.locator('.rc:checked').count(),1);
  await page.locator('#save').click();await page.locator('#dialog').waitFor({state:'hidden'});
  await page.locator('[data-tab=users]').click();row=page.locator('.user-line').filter({hasText:'browser.point@example.test'});await row.waitFor();
  assert.equal(await row.locator('.scope-label').innerText(),'Получатель · одна точка');
  await page.setViewportSize({width:390,height:844});await page.locator('#menu').click();await page.locator('[data-tab=demos]').click();await page.locator('.demo-card').nth(5).waitFor();
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(settings.screenshot){await page.locator('#message').waitFor({state:'hidden'});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:settings.screenshot.replace('.png','-mobile.png'),fullPage:true});}
  assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(r=>r.url.includes('/api/v1')));assert(!requests.some(r=>r.method==='POST'&&r.url.includes('/service/orders')));
  console.log('PASS: Chromium + real PB + client 3.8: six popup logins, account/point isolation, F5/logout, manager session preserved, addresses/scope labels, contextual recipient creation, mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
