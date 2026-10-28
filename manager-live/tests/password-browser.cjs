// Actual browser forms and HTTP/PocketBase; the integration harness supplies isolated accounts.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MANAGER_CHROME,args:['--no-sandbox']});
 try{
  for(const kind of ['client','manager']){
   const context=await browser.newContext(),page=await context.newPage(),changes=[];
   page.on('request',request=>{if(request.url().endsWith('/service/account/change-password'))changes.push(request);});
   await page.goto(settings.url+(kind==='manager'?'/manager/':'/'));
   const email='browser'+kind+'@example.test';
   await page.locator(kind==='manager'?'#login-form [name=identity]':'#email').fill(email);
   await page.locator(kind==='manager'?'#login-form [name=password]':'#password').fill(settings.password);
   await page.getByRole('button',{name:'Войти',exact:true}).click();
   const next=page.locator(kind==='manager'?'#editor [name=password]':'#new-password');
   await next.waitFor({state:'visible'});
   assert.equal(await next.getAttribute('minlength'),'6');
   await page.locator(kind==='manager'?'#editor [name=oldPassword]':'#password').fill(settings.password);
   await next.fill('Five5');
   if(kind==='client')await page.locator('#confirm-password').fill('Five5');
   const save=page.locator(kind==='manager'?'#save':'.login__submit');
   await save.click();
   assert.equal(await next.evaluate(input=>input.validity.tooShort),true);
   assert.equal(changes.length,0,'Five-character password must not leave the form');
   await next.fill('Next66');
   if(kind==='client')await page.locator('#confirm-password').fill('Next66');
   const changed=page.waitForResponse(r=>r.url().endsWith('/service/account/change-password'));
   await save.click();assert.equal((await changed).status(),200);
   const login=page.locator(kind==='manager'?'#login-form [name=identity]':'#email');
   await login.waitFor({state:'visible'});await login.fill(email);
   await page.locator(kind==='manager'?'#login-form [name=password]':'#password').fill('Next66');
   const authenticated=page.waitForResponse(r=>r.url().endsWith('/api/collections/users/auth-with-password'));
   await page.getByRole('button',{name:'Войти',exact:true}).click();
   const response=await authenticated;assert.equal(response.status(),200);assert.equal((await response.json()).record.must_change_password,false);
   if(kind==='manager')await page.locator('#workspace').waitFor({state:'visible'});
   else await page.getByLabel('Покупатель',{exact:true}).waitFor({state:'visible'});
   await context.close();
  }
  console.log('PASS: Chromium + real PB: both cabinets reject five characters, save six, and log in with the new six-character password.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exit(1);});
