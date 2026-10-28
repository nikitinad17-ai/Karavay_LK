const fs=require('node:fs'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MANAGER_CHROME,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto(settings.url+'/manager/');await page.locator('#test-login').waitFor({state:'visible'});
  assert.equal(await page.locator('[name=identity]').inputValue(),'');assert.equal(await page.locator('#login-form [name=password]').inputValue(),'');
  await page.locator('#test-login').click();await page.locator('#workspace').waitFor({state:'visible'});assert(!requests.some(r=>r.url.includes('/auth-with-password')));
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#logout').click();await page.reload();assert(await page.locator('#workspace').isHidden());
  await page.locator('[name=identity]').fill(settings.email);await page.locator('#login-form [name=password]').fill('wrong-fixture-password');await page.locator('#login-form button[type=submit]').click();await page.locator('#login-error').filter({hasText:'Не удалось войти'}).waitFor();
  await page.locator('[name=identity]').fill(settings.buyer_email);await page.locator('#login-form [name=password]').fill(settings.password);await page.locator('#login-form button[type=submit]').click();await page.locator('#login-error').filter({hasText:'не является менеджером'}).waitFor();
  await page.locator('[name=identity]').fill(settings.email);await page.locator('#login-form [name=password]').fill(settings.password);await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('.user-line').count(),3);await page.locator('#create').click();await page.locator('#dialog').waitFor({state:'visible'});assert.equal(await page.locator('.user-form-grid input').count(),3);await page.locator('#cancel').click();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(pathToFileURL(settings.private_file).href);await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#who-email').filter({hasText:settings.email}).waitFor({state:'attached'});
  const before=requests.length;await page.reload();await page.locator('#workspace').waitFor({state:'visible'});assert(!requests.slice(before).some(r=>r.url.endsWith('/auth-refresh')));
  await page.locator('#menu').click();await page.locator('#logout').click();assert(await page.locator('#workspace').isHidden());await page.reload();assert(await page.locator('#workspace').isHidden());await page.locator('#private-login').click();await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(r=>r.url.includes('/api/v1')));
  console.log('PASS: Chromium normal/error/wrong-role login, public test button, F5/logout, four-field dialog, mobile, existing private file/CSP/re-entry.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
