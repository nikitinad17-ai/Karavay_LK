export type Role = 'owner' | 'manager' | 'viewer';
export interface Context { user: {name: string; role: Role}; payers: {id:string;name:string;access:'all'|'limited'}[] }
export interface Client { id:number;code:string;name:string;address:string }
export interface Product { id:number;kod:string;name:string;weight:number|null;shelf_life:string|number|null;kol_sht:number|null;cenaotp:number|null;basecenaotp:number|null;procskd:number|null;kolshtordmin:number|null }
export interface Order { id:number;order_number?:string|number;order_date?:string|number;create_date?:string|number;kol_sht?:number;sum_all?:number;state?:string|number }
export interface Item {id:number;code:string;name:string;quantity:number;price:number;sum:number;line?:number;returned?:number|null}
export interface Detail {payer:string;client:number;order:Order;items:Item[]|null;itemsAvailable:boolean}
export interface Options {create:boolean;details:boolean;minimumSum:number|null;minimumSumIncludesVat:boolean|null;reason:string}
export const CLOSED:Options={create:false,details:false,minimumSum:null,minimumSumIncludesVat:null,reason:'Отправка заказа ещё не подключена.'};
const KEY='karavay_classic_session_v1';
export interface TestAccount {id:string;name:string;email:string;description:string;preferredPayer?:string;preferredClient?:number;preferredDate?:string;preferredGroup?:number}
interface Session {token:string;id:string;email:string;test?:boolean;preferredPayer?:string;preferredClient?:number;preferredDate?:string;preferredGroup?:number}
let session:Session|null=null;
export const getSession=()=>session;
export function clearSession(){session=null;for(const storage of [sessionStorage,localStorage])try{storage.removeItem(KEY);}catch{}}
export class ApiError extends Error {constructor(public status:number,public code:string){super(code);}}
const explanations:Record<string,string>={
 PRICE_CHANGED:'Цена изменилась. Обновите прайс-лист и проверьте заказ.',
 PRODUCT_UNAVAILABLE:'Товар больше недоступен для этой даты. Обновите прайс-лист.',
 MINIMUM_QUANTITY:'Количество меньше минимального. Проверьте позиции заказа.',
 LOT_MULTIPLE:'Товар отгружается только целыми лотками. Обновите прайс-лист и проверьте количество.',
 DATE_IN_PAST:'Дата заказа уже прошла. Выберите новую дату.',
 KIS_CONTRACT_MISMATCH:'КИС отклонила создание: ошибка параметра aId_Clt на стороне API. Передайте код KIS_CONTRACT_MISMATCH администратору.',
 KIS_REJECTED:'КИС отклонила заказ. Проверьте дату, ограничения получателя и минимальную сумму; при повторной ошибке обратитесь к менеджеру.',
 SUBMISSION_UNKNOWN:'Результат отправки пока не подтверждён. Проверьте результат и историю; повторная отправка заблокирована.',
 IDEMPOTENCY_CONFLICT:'Содержимое запроса изменилось. Проверьте результат предыдущей отправки.'
};
export const message=(e:unknown)=>e instanceof ApiError ? (explanations[e.code]||{401:'Сессия завершена. Войдите снова.',403:'Доступ изменён или запрещён.',504:'КИС не ответила вовремя. Повторите загрузку.'}[e.status]||'Не удалось получить данные. Код: '+e.code) : e instanceof Error&&e.name==='AbortError'?'Запрос отменён.':'Не удалось выполнить запрос. Попробуйте ещё раз.';
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  if(path!=='/service/account/change-password'&&path!=='/service/test-access'&&!/^\/service\/(context|clients|catalog|orders(?:\/\d+)?|order-requests\/[a-f0-9]{32}|order-options)(\?|$)/.test(path)&&!/^\/api\/collections\/users\/(auth-with-password|auth-refresh|records\/[a-z0-9]{15})$/.test(path))throw new Error('Unexpected route');
  const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),60000);
  const abort=()=>ctrl.abort();options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)ctrl.abort();
  try{
    const r=await fetch(path,{...options,signal:ctrl.signal,cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json',...(session?{Authorization:session.token}:{}),...options.headers}});
    if(!(r.headers.get('content-type')||'').includes('application/json'))throw new ApiError(502,'INVALID_RESPONSE');
    const d=await r.json();if(!r.ok){if(r.status===401)clearSession();throw new ApiError(r.status,typeof d.code==='string'?d.code:'REQUEST_FAILED');}return d as T;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
function accept(d:{token:string;record:{id:string;email:string;active:boolean;must_change_password:boolean}},test=false,account?:TestAccount){
  if(!d.token||!/^\w{15}$/.test(d.record?.id)||d.record.active!==true)throw new ApiError(403,'INVALID_ACCOUNT');
  session={token:d.token,id:d.record.id,email:d.record.email,...(test?{test:true,preferredPayer:account?.preferredPayer,preferredClient:account?.preferredClient,preferredDate:account?.preferredDate,preferredGroup:account?.preferredGroup}:{})};try{(test?localStorage:sessionStorage).setItem(KEY,JSON.stringify(session));}catch{}
  return d.record.must_change_password===true;
}
export async function login(email:string,password:string){clearSession();return accept(await request('/api/collections/users/auth-with-password',{method:'POST',body:JSON.stringify({identity:email,password})}));}
export async function testAccounts(){const d=await request<{environment:string;accounts:TestAccount[]}>('/service/test-access');if(d.environment!=='test-kis'||!Array.isArray(d.accounts)||d.accounts.length>3||d.accounts.some(a=>!/^[a-z0-9]{15}$/.test(a.id)||[a.name,a.email,a.description].some(s=>typeof s!=='string')||(a.preferredPayer!==undefined&&!/^[a-z0-9]{15}$/.test(a.preferredPayer))||(a.preferredClient!==undefined&&!validId(a.preferredClient))||(a.preferredDate!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(a.preferredDate))||(a.preferredGroup!==undefined&&![0,1].includes(a.preferredGroup))))throw new ApiError(502,'INVALID_TEST_ACCESS');return d.accounts;}
export async function testLogin(id:string){if(!/^[a-z0-9]{15}$/.test(id))throw new Error('Invalid test account');clearSession();const account=(await testAccounts()).find(a=>a.id===id);if(!account)throw new ApiError(403,'ACCESS_DENIED');const d=await request<Parameters<typeof accept>[0]>('/service/test-access',{method:'POST',body:JSON.stringify({id})});if(d.record.id!==id||d.record.must_change_password===true)throw new ApiError(403,'INVALID_ACCOUNT');return accept(d,true,account);}
export async function restore(){try{const stored:Session|null=JSON.parse(sessionStorage.getItem(KEY)||localStorage.getItem(KEY)||'null');if(!stored?.token||!stored?.id)return null;session=stored;const account=stored.test?(await testAccounts()).find(a=>a.id===stored.id):undefined;if(stored.test&&!account)throw new ApiError(403,'ACCESS_DENIED');const d=await request<Parameters<typeof accept>[0]>('/api/collections/users/auth-refresh',{method:'POST'});if(d.record.id!==stored.id)throw new ApiError(403,'ACCOUNT_CHANGED');return accept(d,stored.test===true,account);}catch(e){clearSession();throw e;}}
export async function changePassword(oldPassword:string,password:string){if(!session)throw new ApiError(401,'AUTH_REQUIRED');await request('/service/account/change-password',{method:'POST',body:JSON.stringify({oldPassword,password})});clearSession();}
export function validId(n:unknown):n is number{return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;}
export function params(payer:string,client:number){if(!/^[a-z0-9]{15}$/.test(payer)||!validId(client))throw new Error('Invalid context');return 'payer='+payer+'&client='+client;}
export const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
export function timestamp(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid date');const n=Date.parse(date+'T00:00:00+03:00');if(!Number.isFinite(n)||new Date(n+10800000).toISOString().slice(0,10)!==date)throw new Error('Invalid date');return n/1000;}
export const lotOnly=(p:Product)=>p.kolshtordmin===null;
export function quantityError(p:Product,n:number){if(!Number.isSafeInteger(n)||n<1)return 'Укажите целое количество больше нуля.';if(p.cenaotp===null)return 'В КИС не указана цена.';if(lotOnly(p)){if(!validId(p.kol_sht))return 'В КИС не указано число штук в лотке. Заказ позиции недоступен.';if(n%p.kol_sht!==0)return 'Товар отгружается только целыми лотками по '+p.kol_sht+' шт.';}if(p.kolshtordmin!==null&&n<p.kolshtordmin)return 'Минимальное количество: '+p.kolshtordmin+' шт.';return '';}
export async function context(){const d=await request<Context>('/service/context');if(!d?.user||!['owner','manager','viewer'].includes(d.user.role)||!Array.isArray(d.payers)||d.payers.some(p=>!/^[a-z0-9]{15}$/.test(p.id)))throw new ApiError(502,'INVALID_CONTEXT');return d;}
export async function clients(payer:string,signal:AbortSignal){let cursor:number|null=null;const result:Client[]=[];const ids=new Set<number>();for(let page=0;page<501;page++){
  const d: {payer:string;clients:Client[];count:number;hasMore:boolean;nextCursor:number|null}=await request('/service/clients?payer='+payer+(cursor===null?'':'&cursor='+cursor)+'&perPage=20',{signal});
  if(d.payer!==payer||!Array.isArray(d.clients)||d.count!==d.clients.length)throw new ApiError(502,'INVALID_CLIENTS');
  for(const c of d.clients){if(!validId(c.id)||ids.has(c.id))throw new ApiError(502,'INVALID_CLIENT');ids.add(c.id);result.push(c);}
  if(d.hasMore===false)return result;if(d.hasMore!==true||!validId(d.nextCursor)||(cursor!==null&&d.nextCursor<=cursor))throw new ApiError(502,'INVALID_CURSOR');cursor=d.nextCursor;
}throw new ApiError(502,'TOO_MANY_CLIENTS');}
export async function catalog(payer:string,client:number,date:string,group:number,signal:AbortSignal){const t=timestamp(date);const d=await request<{payer:string;client:number;DateOrd:number;Group:number;count:number;products:Product[]}>('/service/catalog?'+params(payer,client)+'&DateOrd='+t+'&Group='+group,{signal});
 if(d.payer!==payer||d.client!==client||d.DateOrd!==t||d.Group!==group||!Array.isArray(d.products)||d.count!==d.products.length)throw new ApiError(502,'INVALID_CATALOG');
 const ids=new Set<number>();for(const p of d.products){if(!validId(p.id)||ids.has(p.id)||typeof p.name!=='string')throw new ApiError(502,'INVALID_PRODUCT');ids.add(p.id);for(const k of ['cenaotp','basecenaotp','procskd','kolshtordmin','kol_sht'] as const){if(p[k]==null)p[k]=null;else if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]!<0)throw new ApiError(502,'INVALID_PRODUCT');}for(const k of ['kol_sht','kolshtordmin'] as const)if(p[k]!==null&&!Number.isSafeInteger(p[k]))throw new ApiError(502,'INVALID_PRODUCT');}
 return d.products;
}
export async function orders(payer:string,client:number,signal:AbortSignal){const d=await request<{payer:string;client:number;count:number;orders:Order[]}>('/service/orders?'+params(payer,client),{signal});if(d.payer!==payer||d.client!==client||!Array.isArray(d.orders)||d.count!==d.orders.length||new Set(d.orders.map(o=>o.id)).size!==d.orders.length||d.orders.some(o=>!validId(o.id)))throw new ApiError(502,'INVALID_ORDERS');return d.orders;}

export interface OrderDraft {payer:string;client:number;DateOrd:number;Group:number;products:{id:number;quantity:number;price:number}[]}
export interface Submission {key:string;body:OrderDraft}
export interface SubmissionStatus {state:'pending'|'unknown'|'success'|'rejected'|'not_found';result:{id?:number;code?:string}|null}
function pendingKey(){if(!session)throw new ApiError(401,'AUTH_REQUIRED');return 'karavay_pending_order_'+session.id;}
function pendingStorage(){return session?.test?localStorage:sessionStorage;}
export function pending():Submission|null {try{return JSON.parse(pendingStorage().getItem(pendingKey())||'null');}catch{return null;}}
export function savePending(body:OrderDraft){const value={key:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),body};pendingStorage().setItem(pendingKey(),JSON.stringify(value));return value;}
export function forgetPending(){pendingStorage().removeItem(pendingKey());}
export function submissionStatus(s:Submission){return request<SubmissionStatus>('/service/order-requests/'+s.key+'?'+params(s.body.payer,s.body.client));}
export async function orderPage(payer:string,client:number,offset:number){
 const d=await request<{payer:string;client:number;count:number;orders:Order[];hasMore?:boolean;nextOffset?:number|null}>('/service/orders?'+params(payer,client)+(offset?'&offset='+offset:''));
 if(d.payer!==payer||d.client!==client||!Array.isArray(d.orders)||d.count!==d.orders.length||d.orders.some(o=>!validId(o.id))||(d.hasMore===true&&(!validId(d.nextOffset)||d.nextOffset<=offset)))throw new ApiError(502,'INVALID_ORDERS');
 return {orders:d.orders,hasMore:d.hasMore===true,nextOffset:d.nextOffset||0};
}
