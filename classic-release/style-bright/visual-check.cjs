// Real browser verification against local HTTP fixtures, never the user's KIS.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const html=fs.readFileSync(process.argv[2]),output=process.argv[3];fs.mkdirSync(output,{recursive:true});
const payer='bbbbbbbbbbbbbbb',clients=[{id:21,code:'B021',name:'Магазин на Невском',address:'Санкт-Петербург'},{id:22,code:'B022',name:'Магазин на Литейном',address:'Санкт-Петербург'}];
const accounts=['point','buyer','multi'].map((s,i)=>({id:'test385'+s+'001',name:['Один получатель · Покупатель А','Несколько получателей (от 2) · Покупатель Б','Два покупателя · Покупатели Б и В'][i],description:i===1?'Проверены точки: B021 — Магазин на Невском; B022 — Магазин на Литейном':'Реальные области доступа · локальная проверка интерфейса',email:'demo.test.'+s+'.v385@example.test',preferredPayer:payer,preferredClient:22,preferredDate:'2026-10-29',preferredGroup:1}));
const products=[{id:66,kod:'1263',name:'Хлеб Дарницкий формовой, 0,65 кг',kol_sht:8,kolshtordmin:null,cenaotp:42.5,basecenaotp:50,procskd:15,weight:.65,shelf_life:72},{id:67,kod:'2040',name:'Батон Нарезной высший сорт, 0,35 кг',kol_sht:12,kolshtordmin:0,cenaotp:36.9,basecenaotp:42,procskd:12,weight:.35,shelf_life:48}];
const calls=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');calls.push({path:url.pathname,method:req.method});
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
 if(url.pathname==='/service/test-access'){
  if(req.method==='POST'){let raw='';for await(const piece of req)raw+=piece;const a=accounts.find(a=>a.id===JSON.parse(raw).id);return send({token:'fixture-token',record:{...a,active:true,must_change_password:false}});}
  return send({environment:'test-kis',accounts});
 }
 if(url.pathname.endsWith('/auth-refresh'))return send({token:'fixture-token',record:{...accounts[1],active:true,must_change_password:false}});
 if(url.pathname==='/service/context')return send({user:{name:'Демо-покупатель',role:'owner'},payers:[{id:payer,name:'Покупатель Б',access:'all'}]});
 if(url.pathname==='/service/clients')return send({payer,clients,count:clients.length,hasMore:false,nextCursor:null});
 const client=Number(url.searchParams.get('client'));
 if(url.pathname==='/service/catalog')return send({payer,client,DateOrd:Number(url.searchParams.get('DateOrd')),Group:Number(url.searchParams.get('Group')),products,count:products.length});
 if(url.pathname==='/service/order-options')return send({payer,client,create:true,details:true,minimumSum:500,minimumSumIncludesVat:true});
 if(url.pathname==='/service/orders')return send({payer,client,orders:[{id:101,order_number:1001,create_date:1793048400,order_date:1793134800,kol_sht:24,sum_all:1020},{id:102,order_number:1002,create_date:1792962000,order_date:1793048400,kol_sht:12,sum_all:442.8}],count:2,total:2,hasMore:false,nextOffset:null});
 if(url.pathname.startsWith('/service/orders/'))return send({payer,client,order:{id:Number(url.pathname.split('/').pop()),order_number:1001,order_date:1793134800,kol_sht:24,sum_all:1020},itemsAvailable:true,items:[{id:66,code:'1263',name:products[0].name,quantity:24,price:42.5,sum:1020}]});
 return send({code:'NOT_FOUND'},404);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const options=process.env.BROWSER_CONFIG?JSON.parse(fs.readFileSync(process.env.BROWSER_CONFIG,'utf8')):{};
 const browser=await chromium.launch({headless:true,...options});
 try{
  const page=await browser.newPage({viewport:{width:1216,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.getByRole('button',{name:/Несколько получателей/}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(output,'login.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('button',{name:/Несколько получателей/}).click();await page.getByLabel('Получатель').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Получатель"]').value==='22');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.getByLabel('Получатель').locator('option').count(),3);
  assert.equal(await page.locator('.content > .card:has(>h2) .btn--primary').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 223, 0)');
  assert.equal(await page.evaluate(()=>document.fonts.check('16px Ubuntu')),true);
  await page.screenshot({path:path.join(output,'dashboard.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('link',{name:'Оформить заказ',exact:true}).click();await page.getByRole('button',{name:'Показать прайс-лист'}).waitFor();await page.screenshot({path:path.join(output,'order-settings.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('button',{name:'Показать прайс-лист'}).click();await page.getByLabel('Лотки 1263',{exact:true}).waitFor();await page.getByRole('button',{name:'Добавить лоток 1263'}).click();await page.screenshot({path:path.join(output,'catalog.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('link',{name:'История заказов',exact:true}).click();await page.getByRole('row',{name:'Заказ №1001'}).waitFor();await page.screenshot({path:path.join(output,'history.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('button',{name:'Повторить заказ №1001'}).click();await page.getByRole('dialog',{name:'Повторить заказ №1001'}).waitFor();await page.screenshot({path:path.join(output,'repeat.png'),fullPage:true,animations:"disabled"});await page.getByRole('button',{name:'Отмена'}).click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile-history.png'),fullPage:true,animations:"disabled"});
  await page.getByRole('button',{name:'Меню',exact:true}).click();await page.getByRole('link',{name:'Оформить заказ',exact:true}).click();await page.screenshot({path:path.join(output,'mobile-order.png'),fullPage:true,animations:"disabled"});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Unexpected page-wide horizontal overflow');
  assert.equal(calls.filter(c=>c.path==='/service/orders'&&c.method==='POST').length,0);assert.deepEqual(errors,[]);
  console.log('BROWSER_STYLE_OK: Ubuntu loaded, yellow CTA, two recipients, dashboard/order/catalog/history/repeat and mobile; no writes or browser errors. Local fixtures only.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
