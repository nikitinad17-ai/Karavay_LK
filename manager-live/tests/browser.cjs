const fs=require('node:fs'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MANAGER_CHROME,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto(settings.url+'/manager/');await page.locator('#test-login').waitFor({state:'visible'});
  assert.equal(await page.locator('[name=identity]').inputValue(),'');assert.equal(await page.locator('#login-form [name=password]').inputValue(),'');
  if(process.env.MANAGER_LOGIN_SCREENSHOT)await page.screenshot({path:process.env.MANAGER_LOGIN_SCREENSHOT});
  await page.locator('#test-login').click();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#who-email').filter({hasText:settings.email}).waitFor();
  assert(!requests.some(r=>r.url.includes('/auth-with-password')));const testBefore=requests.length;await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
  assert(!requests.slice(testBefore).some(r=>r.url.includes('/auth-refresh')||r.url.endsWith('/test-login')&&r.method==='POST'));
  await page.locator('#logout').click();await page.reload();await page.locator('#test-login').waitFor({state:'visible'});assert(await page.locator('#workspace').isHidden());
  await page.setViewportSize({width:390,height:844});assert(await page.locator('#test-login').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
  await page.locator('[name=identity]').fill(settings.email);await page.locator('#login-form [name=password]').fill('wrong-fixture-password');await page.locator('#login-form button[type=submit]').click();await page.locator('#login-error').filter({hasText:'Не удалось войти'}).waitFor();
  await page.locator('[name=identity]').fill(settings.buyer_email);await page.locator('#login-form [name=password]').fill(settings.password);await page.locator('#login-form button[type=submit]').click();await page.locator('#login-error').filter({hasText:'не является менеджером'}).waitFor();assert(await page.locator('#workspace').isHidden());
  await page.locator('[name=identity]').fill(settings.email);await page.locator('#login-form [name=password]').fill(settings.password);await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#who-email').filter({hasText:settings.email}).waitFor();assert.equal(await page.locator('.user-line').count(),3);
  await page.locator('[data-tab=payers]').click();await page.locator('[data-connect-kis="4"]').waitFor();const added=page.locator('[data-connect-kis="4"]');await added.click();await page.locator('.buyer-line').filter({hasText:'Fixture available buyer'}).getByRole('button',{name:'Создать пользователя'}).waitFor();
  await page.locator('.buyer-line').filter({hasText:'Fixture available buyer'}).getByRole('button',{name:'Создать пользователя'}).click();await page.locator('#dialog').waitFor({state:'visible'});assert.equal(await page.locator('.assignment').count(),0);
  await page.locator('#editor [name=name]').fill('Browser customer');await page.locator('#editor [name=email]').fill('browser.customer@example.test');await page.locator('#editor [name=login]').fill('browser_customer');await page.locator('#editor [name=password]').fill(settings.password);await page.locator('#save').click();await page.locator('#rights-list').waitFor();assert.equal(await page.locator('.payer-check:checked').count(),1);assert((await page.locator('.assignment').filter({has:page.locator('.payer-check:checked')}).textContent()).includes('P4'));await page.locator('#close').click();
  await page.setViewportSize({width:390,height:844});await page.locator('#menu').click();await page.locator('[data-tab=overview]').click();assert(await page.locator('#sidebar').evaluate(el=>!el.classList.contains('open')));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(pathToFileURL(settings.private_file).href);await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#who-email').filter({hasText:settings.email}).waitFor({state:'attached'});
  const before=requests.length;await page.reload();await page.locator('#workspace').waitFor({state:'visible'});assert(!requests.slice(before).some(r=>r.url.endsWith('/auth-refresh')),'Nonrefreshable token must use state validation');
  await page.locator('#menu').click();await page.locator('#logout').click();assert(await page.locator('#workspace').isHidden());await page.reload();assert(await page.locator('#workspace').isHidden());await page.locator('#private-login').click();await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(r=>r.url.includes('/api/v1')||r.method==='POST'&&r.url.startsWith(settings.url+'/service/orders')));
  console.log('PASS: Chromium real PB: public test button without password, F5/logout/re-entry/mobile, normal/error/wrong-role login, buyer Add, contextual two-stage creation, private file/CSP.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
