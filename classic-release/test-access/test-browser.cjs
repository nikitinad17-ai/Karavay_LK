const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const [base,serialized]=process.argv.slice(2),config=JSON.parse(serialized),profile=fs.mkdtempSync(path.join(os.tmpdir(),'karavay-browser-'));
 const launch=()=>chromium.launchPersistentContext(profile,{executablePath:process.env.QUICK_CHROME,headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000}});
 let context=await launch();const errors=[];
 async function open(){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);return p;}
 try{
  let page=await open();let passwordRequests=0;page.on('request',r=>{if(r.url().endsWith('/auth-with-password'))passwordRequests++;});
  const account=config.accounts[0];await page.getByRole('button',{name:new RegExp(account.name.replace(/[()]/g,'\\$&'))}).click();
  await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
  if(await page.locator('input[type=password]').count())throw Error('Password field visible');
  await page.waitForFunction(cid=>document.querySelector('select[aria-label="Получатель"]')?.value===String(cid),config.point.kid);
  if(config.history){await page.getByRole('link',{name:'История заказов',exact:true}).click();await page.getByRole('button',{name:'№8008',exact:true}).waitFor();}
  await page.getByRole('link',{name:'Оформить заказ',exact:true}).click();
  await page.getByRole('button',{name:'Показать прайс-лист'}).click();await page.getByText('Хлеб из КИС',{exact:true}).waitFor();
  if(await page.getByLabel('Штуки LOT8',{exact:true}).count())throw Error('Tray-only item allows pieces');
  if(!await page.getByLabel('Штуки 1263',{exact:true}).isEnabled())throw Error('Piece-allowed item blocked');
  await page.getByRole('button',{name:'Добавить лоток LOT8',exact:true}).click();
  if(await page.getByLabel('Лотки LOT8',{exact:true}).inputValue()!=='1')throw Error('Tray count not updated');
  await page.setViewportSize({width:390,height:844});
  if(await page.getByLabel('Штуки LOT8',{exact:true}).count()||await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile tray-only input/layout failure');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Уменьшить лотки LOT8',exact:true}).click();
  await page.getByRole('button',{name:'Добавить лоток 1263',exact:true}).click();
  await page.getByRole('button',{name:'Проверить заказ',exact:true}).first().click();
  await page.getByRole('dialog').getByText('8 шт.',{exact:true}).waitFor();
  const sent=page.waitForResponse(r=>r.url()===base+'/service/orders'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Отправить заказ',exact:true}).click();
  const response=await sent;if(response.status()!==201)throw Error('Checkout '+response.status()+': '+await response.text());
  await page.getByText('Заказ №7 создан в КИС.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'№948',exact:true}).click();
  await page.getByRole('dialog').getByText('Хлеб из КИС',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.reload();await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
  await context.close();context=await launch();page=await open();
  await page.getByText('Добро пожаловать, '+account.name,{exact:true}).waitFor();
  await page.getByRole('link',{name:'История заказов',exact:true}).click();await page.getByRole('button',{name:'№948',exact:true}).waitFor();
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  for(let i=1;i<3;i++){
   await page.getByRole('button',{name:new RegExp(config.accounts[i].name.replace(/[()]/g,'\\$&'))}).click();
   await page.getByText('Добро пожаловать, '+config.accounts[i].name,{exact:true}).waitFor();
   if(i===2){await page.getByLabel('Покупатель',{exact:true}).selectOption(config.payers[1].id);await page.waitForFunction(()=>document.querySelectorAll('select[aria-label="Получатель"] option').length===3);}
   else {await page.waitForFunction(()=>document.querySelectorAll('select[aria-label="Получатель"] option').length===3);await page.waitForFunction(cid=>document.querySelector('select[aria-label="Получатель"]')?.value===String(cid),config.point.kid);}
   await page.getByRole('button',{name:'Выйти',exact:true}).click();
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:new RegExp('Один получатель')}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile login overflows');
  if(passwordRequests||errors.length)throw Error('Password requests/page errors: '+JSON.stringify(errors));
  console.log('PASS: Chromium hosted client: no password, catalog/cart/review/POST/history/detail, F5, full browser restart, all three scopes, logout, mobile. KIS is a fixture.');
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
