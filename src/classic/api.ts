export type Role = 'owner' | 'manager' | 'viewer';
export interface Context { user: {name: string; role: Role}; payers: {id:string;name:string;access:'all'|'limited'}[] }
export interface Client { id:number;code:string;name:string;address:string }
export interface Product { id:number;kod:string;name:string;weight:number|null;shelf_life:string|number|null;kol_sht:number|null;cenaotp:number|null;basecenaotp:number|null;procskd:number|null;kolshtordmin:number|null }
export interface Order { id:number;order_number?:string|number;order_date?:string|number;create_date?:string|number;kol_sht?:number;sum_all?:number;state?:string|number }
export interface Item {id:number;code:string;name:string;quantity:number;price:number;sum:number}
export interface Detail {payer:string;client:number;order:Order;items:Item[]|null;itemsAvailable:boolean}
export interface Options {create:boolean;details:boolean;minimumSum:number|null;minimumSumIncludesVat:boolean|null;reason:string}
export const CLOSED:Options={create:false,details:false,minimumSum:null,minimumSumIncludesVat:null,reason:'Отправка заказа ещё не подключена.'};
const KEY='karavay_classic_session_v1';
let session:{token:string;id:string;email:string}|null=null;
export const getSession=()=>session;
export function clearSession(){session=null;try{sessionStorage.removeItem(KEY);}catch{}}
export class ApiError extends Error {constructor(public status:number,public code:string){super(code);}}
export const message=(e:unknown)=>e instanceof ApiError ? ({401:'Сессия завершена. Войдите снова.',403:'Доступ изменён или запрещён.',501:'Отправка ожидает подключения к КИС.',504:'КИС не ответила вовремя. Повторите загрузку.'}[e.status]||'Не удалось получить данные. Код: '+e.code) : e instanceof Error&&e.name==='AbortError'?'Запрос отменён.':'Не удалось выполнить запрос. Попробуйте ещё раз.';
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  if(path!=='/service/account/change-password'&&!/^\/service\/(context|clients|catalog|orders(?:\/\d+)?|order-options)(\?|$)/.test(path)&&!/^\/api\/collections\/users\/(auth-with-password|auth-refresh|records\/[a-z0-9]{15})$/.test(path))throw new Error('Unexpected route');
  const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),60000);
  const abort=()=>ctrl.abort();options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)ctrl.abort();
  try{
    const r=await fetch(path,{...options,signal:ctrl.signal,cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json',...(session?{Authorization:session.token}:{}),...options.headers}});
    if(!(r.headers.get('content-type')||'').includes('application/json'))throw new ApiError(502,'INVALID_RESPONSE');
    const d=await r.json();if(!r.ok){if(r.status===401)clearSession();throw new ApiError(r.status,typeof d.code==='string'?d.code:'REQUEST_FAILED');}return d as T;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
function accept(d:{token:string;record:{id:string;email:string;active:boolean;must_change_password:boolean}}){
  if(!d.token||!/^\w{15}$/.test(d.record?.id)||d.record.active!==true)throw new ApiError(403,'INVALID_ACCOUNT');
  session={token:d.token,id:d.record.id,email:d.record.email};try{sessionStorage.setItem(KEY,JSON.stringify(session));}catch{}
  return d.record.must_change_password===true;
}
export async function login(email:string,password:string){clearSession();return accept(await request('/api/collections/users/auth-with-password',{method:'POST',body:JSON.stringify({identity:email,password})}));}
export async function restore(){try{const stored=JSON.parse(sessionStorage.getItem(KEY)||'null');if(!stored?.token||!stored?.id)return null;session=stored;const d=await request<Parameters<typeof accept>[0]>('/api/collections/users/auth-refresh',{method:'POST'});if(d.record.id!==stored.id)throw new ApiError(403,'ACCOUNT_CHANGED');return accept(d);}catch(e){clearSession();throw e;}}
export async function changePassword(oldPassword:string,password:string){if(!session)throw new ApiError(401,'AUTH_REQUIRED');await request('/service/account/change-password',{method:'POST',body:JSON.stringify({oldPassword,password})});clearSession();}
export function validId(n:unknown):n is number{return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;}
export function params(payer:string,client:number){if(!/^[a-z0-9]{15}$/.test(payer)||!validId(client))throw new Error('Invalid context');return 'payer='+payer+'&client='+client;}
export const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
export function timestamp(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid date');const n=Date.parse(date+'T00:00:00+03:00');if(!Number.isFinite(n)||new Date(n+10800000).toISOString().slice(0,10)!==date)throw new Error('Invalid date');return n/1000;}
export function quantityError(p:Product,n:number){if(!Number.isSafeInteger(n)||n<1)return 'Укажите целое количество больше нуля.';if(p.cenaotp===null)return 'В КИС не указана цена.';if(p.kolshtordmin!==null&&n<p.kolshtordmin)return 'Минимальное количество: '+p.kolshtordmin+' шт.';return '';}
export async function context(){const d=await request<Context>('/service/context');if(!d?.user||!['owner','manager','viewer'].includes(d.user.role)||!Array.isArray(d.payers)||d.payers.some(p=>!/^[a-z0-9]{15}$/.test(p.id)))throw new ApiError(502,'INVALID_CONTEXT');return d;}
export async function clients(payer:string,signal:AbortSignal){let cursor:number|null=null;const result:Client[]=[];const ids=new Set<number>();for(let page=0;page<501;page++){
  const d: {payer:string;clients:Client[];count:number;hasMore:boolean;nextCursor:number|null}=await request('/service/clients?payer='+payer+(cursor===null?'':'&cursor='+cursor)+'&perPage=20',{signal});
  if(d.payer!==payer||!Array.isArray(d.clients)||d.count!==d.clients.length)throw new ApiError(502,'INVALID_CLIENTS');
  for(const c of d.clients){if(!validId(c.id)||ids.has(c.id))throw new ApiError(502,'INVALID_CLIENT');ids.add(c.id);result.push(c);}
  if(d.hasMore===false)return result;if(d.hasMore!==true||!validId(d.nextCursor)||(cursor!==null&&d.nextCursor<=cursor))throw new ApiError(502,'INVALID_CURSOR');cursor=d.nextCursor;
}throw new ApiError(502,'TOO_MANY_CLIENTS');}
export async function catalog(payer:string,client:number,date:string,group:number,signal:AbortSignal){const t=timestamp(date);const d=await request<{payer:string;client:number;DateOrd:number;Group:number;count:number;products:Product[]}>('/service/catalog?'+params(payer,client)+'&DateOrd='+t+'&Group='+group,{signal});
 if(d.payer!==payer||d.client!==client||d.DateOrd!==t||d.Group!==group||!Array.isArray(d.products)||d.count!==d.products.length)throw new ApiError(502,'INVALID_CATALOG');
 const ids=new Set<number>();for(const p of d.products){if(!validId(p.id)||ids.has(p.id)||typeof p.name!=='string')throw new ApiError(502,'INVALID_PRODUCT');ids.add(p.id);for(const k of ['cenaotp','basecenaotp','procskd','kolshtordmin','kol_sht'] as const){if(p[k]==null)p[k]=null;else if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]!<0)throw new ApiError(502,'INVALID_PRODUCT');}}
 return d.products;
}
export async function orders(payer:string,client:number,signal:AbortSignal){const d=await request<{payer:string;client:number;count:number;orders:Order[]}>('/service/orders?'+params(payer,client),{signal});if(d.payer!==payer||d.client!==client||!Array.isArray(d.orders)||d.count!==d.orders.length||new Set(d.orders.map(o=>o.id)).size!==d.orders.length||d.orders.some(o=>!validId(o.id)))throw new ApiError(502,'INVALID_ORDERS');return d.orders;}
