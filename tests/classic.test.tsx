import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from '../src/classic/App';
import * as api from '../src/classic/api';
const p1='aaaaaaaaaaaaaaa',p2='bbbbbbbbbbbbbbb';
let requests:string[]=[];
const response=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
function mockFetch(input:RequestInfo|URL,init?:RequestInit){
 const path=String(input);requests.push(path);
 if(path.endsWith('auth-with-password'))return response({token:'test-only',record:{id:'uuuuuuuuuuuuuuu',email:'demo@karavay.example',active:true,must_change_password:false}});
 if(path==='/service/context')return response({user:{name:'Покупатель (демо)',role:'owner'},payers:[{id:p1,name:'Первый покупатель',access:'all'},{id:p2,name:'Второй покупатель',access:'limited'}]});
 if(path.startsWith('/service/clients'))return response({payer:path.includes(p1)?p1:p2,clients:[{id:path.includes(p1)?11:21,code:'T01',name:'Получатель из КИС',address:'Адрес из КИС'}],count:1,hasMore:false,nextCursor:null});
 if(path.startsWith('/service/catalog')){const q=new URL(path,'http://localhost').searchParams;return response({payer:q.get('payer'),client:Number(q.get('client')),DateOrd:Number(q.get('DateOrd')),Group:Number(q.get('Group')),count:1,products:[{id:66,kod:'1263',name:'Хлеб из КИС',kol_sht:8,kolshtordmin:4,cenaotp:34.9,basecenaotp:43.49,procskd:19.76,weight:0.5,shelf_life:72}]});}
 if(path.startsWith('/service/order-options'))return response({payer:p1,client:11,create:false,details:false,minimumSum:null,reason:'ORDER_CONTRACT_PENDING'});
 if(path.startsWith('/service/orders/7'))return response({payer:p1,client:11,order:{id:7,order_number:948,kol_sht:15,sum_all:917.4,state:0},items:[{id:66,code:'1263',name:'Хлеб из заказа',quantity:15,price:61.16,sum:917.4}],itemsAvailable:true});
 if(path.startsWith('/service/orders?'))return response({payer:p1,client:11,count:1,orders:[{id:7,order_number:948,kol_sht:15,sum_all:917.4,state:0}]});
 throw new Error('Unexpected request '+path+' '+init?.method);
}
beforeEach(()=>{requests=[];sessionStorage.clear();api.clearSession();vi.stubGlobal('fetch',vi.fn(mockFetch));vi.spyOn(window,'confirm').mockReturnValue(true);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();api.clearSession();});
async function signIn(){render(<App/>);await screen.findByLabelText('Email');fireEvent.change(screen.getByLabelText('Email'),{target:{value:'demo@karavay.example'}});fireEvent.change(screen.getByLabelText('Пароль'),{target:{value:'test-only-password'}});fireEvent.click(screen.getByRole('button',{name:'Войти'}));await screen.findByText('Добро пожаловать, Покупатель (демо)');fireEvent.change(screen.getByLabelText('Покупатель'),{target:{value:p1}});await waitFor(()=>expect((screen.getByLabelText('Получатель') as HTMLSelectElement).value).toBe('11'));}
describe('Classic service mode',()=>{
 it('uses midnight Saint Petersburg independently of host timezone and rejects invalid dates',()=>{expect(api.timestamp('2026-10-14')).toBe(Date.parse('2026-10-13T21:00:00Z')/1000);expect(()=>api.timestamp('2026-02-30')).toThrow();});
 it('keeps price absence distinct from zero and validates the KIS minimum',()=>{const p={id:1,cenaotp:12,kolshtordmin:4} as api.Product;expect(api.quantityError(p,3)).toContain('4');expect(api.quantityError(p,4)).toBe('');expect(api.quantityError({...p,cenaotp:null},4)).toContain('цена');});
 it('loads real gateway data, converts a tray to pieces, preserves edits on cancelling scope change',async()=>{await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('8 шт.');expect(screen.getByRole('button',{name:'Отправить заказ'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Вернуться к заказу'}));vi.mocked(window.confirm).mockReturnValue(false);fireEvent.change(screen.getByLabelText('Покупатель'),{target:{value:p2}});expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');expect(requests.some(p=>p.startsWith('/api/v1'))).toBe(false);});
 it('opens real order line items',async()=>{await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));await screen.findByRole('button',{name:'№948'});fireEvent.click(screen.getByRole('button',{name:'№948'}));await waitFor(()=>expect(screen.queryByText('Загружаем состав…')).not.toBeInTheDocument());expect(screen.getByRole('dialog')).toHaveTextContent('917');expect(screen.getByRole('dialog')).toHaveTextContent('Хлеб из заказа');expect(screen.getByRole('dialog')).toHaveTextContent('15 шт.');});
 it('rejects mismatched payer metadata instead of displaying it',async()=>{vi.stubGlobal('fetch',vi.fn(()=>response({payer:p2,client:11,orders:[],count:0})));await expect(api.orders(p1,11,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_ORDERS'});});
 it('handles empty client cursor pages and refuses a non-advancing cursor',async()=>{let i=0;vi.stubGlobal('fetch',vi.fn(()=>response(i++===0?{payer:p1,clients:[],count:0,hasMore:true,nextCursor:10}:{payer:p1,clients:[],count:0,hasMore:true,nextCursor:10})));await expect(api.clients(p1,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_CURSOR'});});
 it('sends one confirmed order and refreshes real history',async()=>{
  let writes=0;
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path.startsWith('/service/order-options'))return response({payer:p1,client:11,create:true,details:true,minimumSum:600,minimumSumIncludesVat:true});
   if(path==='/service/orders'&&init?.method==='POST'){writes++;const data=JSON.parse(String(init.body));expect(data.products).toEqual([{id:66,quantity:8,price:34.9}]);expect((init.headers as Record<string,string>)['Idempotency-Key']).toMatch(/^[a-f0-9]{32}$/);return response({id:7,payer:p1,client:11},201);}
   return mockFetch(input,init);
  }));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Отправить заказ'})).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button',{name:'Отправить заказ'}));
  await screen.findByText('Заказ №7 создан в КИС.');expect(writes).toBe(1);expect(api.pending()).toBeNull();
 });
 it('keeps the same request after an ambiguous network failure and resolves through GET',async()=>{
  let writes=0;
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path.startsWith('/service/order-options'))return response({payer:p1,client:11,create:true,details:true,minimumSum:600});
   if(path==='/service/orders'&&init?.method==='POST'){writes++;return Promise.reject(new Error('network lost'));}
   if(path.startsWith('/service/order-requests/'))return response({state:'success',result:{id:7}});
   return mockFetch(input,init);
  }));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Отправить заказ'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Отправить заказ'}));
  await waitFor(()=>expect(api.pending()).not.toBeNull());await waitFor(()=>expect(screen.getByRole('button',{name:'Вернуться к заказу'})).not.toBeDisabled());expect(screen.getByRole('button',{name:'Отправить заказ'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Вернуться к заказу'}));fireEvent.click(screen.getByRole('button',{name:'Проверить результат'}));await screen.findByText('Заказ №7 подтверждён в КИС.');expect(writes).toBe(1);expect(api.pending()).toBeNull();
 });

});
