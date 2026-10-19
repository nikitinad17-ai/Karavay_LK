// Real browser + PB; every fixture KIS matrix returns the observed price error.
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const [base,serialized]=process.argv.slice(2),config=JSON.parse(serialized);
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'karavay-buyers-no-price-'));
 const launch=()=>chromium.launchPersistentContext(profile,{executablePath:process.env.QUICK_CHROME,headless:true,args:['--no-sandbox']});
 let context=await launch();const errors=[];let passwordRequests=0,orderPosts=0;
 async function open(){const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/auth-with-password'))passwordRequests++;if(r.url().endsWith('/service/orders')&&r.method()==='POST')orderPosts++;});await page.goto(base);return page;}
 try{
  let page=await open();
  if(process.env.PREVIOUS_TEST_SESSION){await page.evaluate(s=>localStorage.setItem('karavay_classic_session_v1',s),process.env.PREVIOUS_TEST_SESSION);await page.reload();await page.waitForFunction(()=>localStorage.getItem('karavay_classic_session_v1')===null);}
  for(let i=0;i<3;i++){
   const account=config.accounts[i];
   await page.getByRole('button',{name:new RegExp(account.name.replace(/[()]/g,'\\$&'))}).click();
   await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
   if(await page.locator('input[type=password]').count())throw Error('Password requested');
   if(i<2)await page.waitForFunction(cid=>document.querySelector('select[aria-label="Получатель"]')?.value===String(cid),config.point.kid);
   if(i===0){
    await page.getByRole('link',{name:'Оформить заказ',exact:true}).click();
    const waiting=page.waitForResponse(r=>r.url().includes('/service/catalog?'));
    await page.getByRole('button',{name:'Показать прайс-лист'}).click();
    const response=await waiting;if(response.status()!==502)throw Error('Catalog error replaced by fake success');
    await page.getByRole('alert').waitFor();
    if(await page.getByText('Хлеб из КИС',{exact:true}).count())throw Error('Fake catalog after upstream error');
    await page.reload();await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
    await context.close();context=await launch();page=await open();
    await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
   }else if(i===2){
    await page.getByLabel('Покупатель',{exact:true}).selectOption(config.payers[1].id);
    await page.waitForFunction(()=>document.querySelectorAll('select[aria-label="Получатель"] option').length===3);
   }else await page.waitForFunction(()=>document.querySelectorAll('select[aria-label="Получатель"] option').length===3);
   await page.getByRole('button',{name:'Выйти',exact:true}).click();
  }
  if(passwordRequests||orderPosts||errors.length)throw Error('Unexpected auth/POST/page error: '+JSON.stringify(errors));
  console.log('PASS: Chromium: all three passwordless scopes, old-session reset, F5/restart/logout while all KIS prices fail; catalog error retained, no fake data or order POST.');
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
