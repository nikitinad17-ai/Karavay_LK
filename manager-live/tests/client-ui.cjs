const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const settings=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
 const crypto=require('node:crypto');
 const html=fs.readFileSync(path.join(__dirname,'../pb_public/index.html'),'utf8');
 const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];const digest=crypto.createHash('sha256').update(inline).digest('base64');assert(html.includes("script-src 'sha256-"+digest+"'"),'CSP must match the exact inline script');
 const dom=new JSDOM(html,{url:settings.url+'/',runScripts:'outside-only'}),w=dom.window;
 const calls=[];w.fetch=(url,options)=>{calls.push(url);return fetch(new URL(url,settings.url),options);};w.AbortController=AbortController;w.confirm=()=>true;w.scrollTo=()=>{};
 w.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]);
 const q=s=>w.document.querySelector(s),wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Client UI timed out: '+w.document.body.textContent.slice(-1000));};
 await wait(()=>q('#identity'));q('#identity').value=settings.email;q('#password').value=settings.password;q('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>q('#payer-switch'));assert.equal(q('#payer-switch').options.length,1);assert(q('#payer-switch').textContent.includes('Test buyer 1'));
 await wait(()=>w.document.body.textContent.includes('Test recipient 11'));
 assert(!w.document.body.textContent.includes('Foreign recipient'));
 const before=calls.filter(x=>x==='/service/context').length;Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});const realNow=w.Date.now;w.Date.now=()=>realNow()+31000;w.document.dispatchEvent(new w.Event('visibilitychange'));await wait(()=>calls.filter(x=>x==='/service/context').length>before);await wait(()=>w.document.body.textContent.includes('Test recipient 11'));
 const source=html.match(/const KEY\s*=\s*['"]([^'"]+)/);assert(w.sessionStorage.length>0);
 console.log('PASS: client login, automatic buyer/recipient loading and isolation on real local PB HTTP.');dom.window.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
