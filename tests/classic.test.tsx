import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App from '../src/classic/App';
import * as api from '../src/classic/api';
const p1='aaaaaaaaaaaaaaa',p2='bbbbbbbbbbbbbbb';
let requests:string[]=[];
let minimum:number|null=4,packing:number|null=8;
const response=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
function mockFetch(input:RequestInfo|URL,init?:RequestInit){
 const path=String(input);requests.push(path);
 if(path==='/service/test-access')return response({code:'TEST_ACCESS_DISABLED'},404);
 if(path.endsWith('auth-with-password'))return response({token:'test-only',record:{id:'uuuuuuuuuuuuuuu',email:'demo@karavay.example',active:true,must_change_password:false}});
 if(path==='/service/context')return response({user:{name:'Покупатель (демо)',role:'owner'},payers:[{id:p1,name:'Первый покупатель',access:'all'},{id:p2,name:'Второй покупатель',access:'limited'}]});
 if(path.startsWith('/service/clients'))return response({payer:path.includes(p1)?p1:p2,clients:[{id:path.includes(p1)?11:21,code:'T01',name:'Получатель из КИС',address:'Адрес из КИС'}],count:1,hasMore:false,nextCursor:null});
 if(path.startsWith('/service/catalog')){const q=new URL(path,'http://localhost').searchParams;return response({payer:q.get('payer'),client:Number(q.get('client')),DateOrd:Number(q.get('DateOrd')),Group:Number(q.get('Group')),count:1,products:[{id:66,kod:'1263',name:'Хлеб из КИС',kol_sht:packing,kolshtordmin:minimum,cenaotp:34.9,basecenaotp:43.49,procskd:19.76,weight:0.5,shelf_life:72}]});}
 if(path.startsWith('/service/order-options'))return response({payer:p1,client:11,create:false,details:false,minimumSum:null,reason:'ORDER_CONTRACT_PENDING'});
 if(path.startsWith('/service/orders/7'))return response({payer:p1,client:11,order:{id:7,order_number:948,kol_sht:15,sum_all:917.4,state:0},items:[{id:66,code:'1263',name:'Хлеб из заказа',quantity:15,price:61.16,sum:917.4}],itemsAvailable:true});
 if(path.startsWith('/service/orders?'))return response({payer:p1,client:11,count:1,orders:[{id:7,order_number:948,kol_sht:15,sum_all:917.4,state:0}]});
 throw new Error('Unexpected request '+path+' '+init?.method);
}
beforeEach(()=>{requests=[];minimum=4;packing=8;sessionStorage.clear();localStorage.clear();api.clearSession();vi.stubGlobal('fetch',vi.fn(mockFetch));vi.spyOn(window,'confirm').mockReturnValue(true);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();api.clearSession();});
async function signIn(){render(<App/>);await screen.findByLabelText('Email');fireEvent.change(screen.getByLabelText('Email'),{target:{value:'demo@karavay.example'}});fireEvent.change(screen.getByLabelText('Пароль'),{target:{value:'test-only-password'}});fireEvent.click(screen.getByRole('button',{name:'Войти'}));await screen.findByText('Добро пожаловать, Покупатель (демо)');fireEvent.change(screen.getByLabelText('Покупатель'),{target:{value:p1}});await waitFor(()=>expect((screen.getByLabelText('Получатель') as HTMLSelectElement).value).toBe('11'));}
describe('Classic service mode',()=>{
 it('offers test buttons without password fields and restores the account across browser sessions',async()=>{
  const account={id:'uuuuuuuuuuuuuuu',name:'Один получатель (тест)',email:'demo.test.point@example.test',description:'Каравай · получатель из КИС',preferredPayer:p1,preferredClient:11,preferredDate:'2026-10-18',preferredGroup:1};
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path==='/service/test-access'&&init?.method!=='POST')return response({environment:'test-kis',accounts:[account]});
   if(path==='/service/test-access'||path.endsWith('/auth-refresh'))return response({token:'test-session',record:{...account,active:true,must_change_password:false}});
   if(path.startsWith('/service/clients')&&path.includes(p1))return response({payer:p1,clients:[{id:12,code:'EMPTY',name:'Empty first client',address:''},{id:11,code:'HISTORY',name:'Client with history',address:''}],count:2,hasMore:false,nextCursor:null});
   return mockFetch(input,init);
  }));
  render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/Один получатель/}));
  await screen.findByText('Добро пожаловать, Покупатель (демо)');expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByLabelText('Покупатель')).toHaveValue(p1));await waitFor(()=>expect(screen.getByLabelText('Получатель')).toHaveValue('11'));
  expect(api.getSession()?.preferredDate).toBe('2026-10-18');
  const body:api.OrderDraft={payer:p1,client:11,DateOrd:api.timestamp('2026-10-16'),Group:1,products:[{id:66,quantity:8,price:34.9}]};
  const pending=api.savePending(body);cleanup();sessionStorage.clear();
  render(<App/>);await screen.findByText('Добро пожаловать, Покупатель (демо)');expect(api.getSession()?.test).toBe(true);expect(api.pending()?.key).toBe(pending.key);
  fireEvent.click(screen.getByRole('button',{name:'Выйти'}));await screen.findByRole('button',{name:/Один получатель/});expect(localStorage.getItem('karavay_classic_session_v1')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([path])=>String(path).endsWith('/auth-with-password'))).toBe(false);
 });
 it('uses midnight Saint Petersburg independently of host timezone and rejects invalid dates',()=>{expect(api.timestamp('2026-10-14')).toBe(Date.parse('2026-10-13T21:00:00Z')/1000);expect(()=>api.timestamp('2026-02-30')).toThrow();});
 it('shows both real scoped recipients in the multiple-recipient demo, switches their histories, and restores the login',async()=>{
  const account={id:'test385buyer001',name:'Несколько получателей (от 2)',email:'demo.test.buyer.v385@example.test',description:'Точки C21 и C22',preferredPayer:p2,preferredClient:22,preferredDate:api.tomorrow(),preferredGroup:1};
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path==='/service/test-access'&&init?.method!=='POST')return response({environment:'test-kis',accounts:[account]});
   if(path==='/service/test-access'||path.endsWith('/auth-refresh'))return response({token:'many-points-session',record:{...account,active:true,must_change_password:false}});
   if(path==='/service/context')return response({user:{name:'Покупатель с двумя точками',role:'owner'},payers:[{id:p2,name:'Другой покупатель',access:'all'}]});
   if(path.startsWith('/service/clients'))return response({payer:p2,clients:[{id:21,code:'C21',name:'Первый получатель',address:''},{id:22,code:'C22',name:'Второй получатель',address:''}],count:2,hasMore:false,nextCursor:null});
   if(path.startsWith('/service/orders?')){const cid=Number(new URL(path,'http://localhost').searchParams.get('client'));return response({payer:p2,client:cid,count:1,orders:[{id:cid+900,order_number:cid+900}],hasMore:false,nextOffset:null});}
   return mockFetch(input,init);
  }));
  render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/Несколько получателей/}));
  await waitFor(()=>expect(screen.getByLabelText('Получатель')).toHaveValue('22'));
  const select=screen.getByLabelText('Получатель');expect(within(select).getByRole('option',{name:'C21 · Первый получатель'})).toBeInTheDocument();expect(within(select).getByRole('option',{name:'C22 · Второй получатель'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link',{name:'История заказов'}));await screen.findByRole('button',{name:'№922'});
  fireEvent.change(select,{target:{value:'21'}});await screen.findByRole('button',{name:'№921'});expect(screen.queryByRole('button',{name:'№922'})).not.toBeInTheDocument();
  cleanup();sessionStorage.clear();render(<App/>);await waitFor(()=>expect(screen.getByLabelText('Получатель')).toHaveValue('22'));expect(within(screen.getByLabelText('Получатель')).getAllByRole('option')).toHaveLength(3);
 });
 it('opens the distinct test buyer and its history, restores it, and preserves a later manual buyer choice',async()=>{
  const account={id:'test384multi001',name:'Другие покупатели',email:'demo.test.multi.v384@example.test',description:'Второй покупатель и первый',preferredPayer:p2,preferredClient:21,preferredDate:'2026-10-28',preferredGroup:1};
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);
   if(path==='/service/test-access'&&init?.method!=='POST')return response({environment:'test-kis',accounts:[account]});
   if(path==='/service/test-access'||path.endsWith('/auth-refresh'))return response({token:'multi-session',record:{...account,active:true,must_change_password:false}});
   if(path.startsWith('/service/orders?')&&path.includes(p2))return response({payer:p2,client:21,count:1,orders:[{id:27,order_number:927,client_id:21}],hasMore:false,nextOffset:null});
   return mockFetch(input,init);
  }));
  render(<App/>);fireEvent.click(await screen.findByRole('button',{name:/Другие покупатели/}));
  await waitFor(()=>expect(screen.getByLabelText('Покупатель')).toHaveValue(p2));await waitFor(()=>expect(screen.getByLabelText('Получатель')).toHaveValue('21'));
  fireEvent.click(screen.getByRole('link',{name:'История заказов'}));await screen.findByRole('button',{name:'№927'});
  cleanup();sessionStorage.clear();render(<App/>);await waitFor(()=>expect(screen.getByLabelText('Покупатель')).toHaveValue(p2));
  fireEvent.change(screen.getByLabelText('Покупатель'),{target:{value:p1}});await waitFor(()=>expect(screen.getByLabelText('Получатель')).toHaveValue('11'));
  const contexts=requests.filter(p=>p==='/service/context').length;
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+31000);fireEvent(document,new Event('visibilitychange'));
  await waitFor(()=>expect(requests.filter(p=>p==='/service/context').length).toBeGreaterThan(contexts));expect(screen.getByLabelText('Покупатель')).toHaveValue(p1);
 });
 it('keeps price absence distinct from zero and validates the KIS minimum',()=>{const p={id:1,cenaotp:12,kolshtordmin:4} as api.Product;expect(api.quantityError(p,3)).toContain('4');expect(api.quantityError(p,4)).toBe('');expect(api.quantityError({...p,cenaotp:null},4)).toContain('цена');});
 it('treats an empty KIS minimum as whole trays, distinct from an explicit minimum or zero',()=>{
  const p={id:1,cenaotp:12,kol_sht:8,kolshtordmin:null} as api.Product;
  expect(api.quantityError(p,7)).toContain('целыми лотками по 8');expect(api.quantityError(p,8)).toBe('');expect(api.quantityError(p,9)).toContain('целыми лотками');expect(api.quantityError(p,16)).toBe('');
  expect(api.quantityError({...p,kolshtordmin:4},11)).toBe('');expect(api.quantityError({...p,kolshtordmin:0},1)).toBe('');
  for(const kol_sht of [null,0,2.5])expect(api.quantityError({...p,kol_sht},8)).toContain('не указано число штук');
 });
 it('hides piece input for tray-only positions and reviews the converted total in pieces',async()=>{
  minimum=null;await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');
  expect(screen.queryByLabelText('Штуки 1263')).not.toBeInTheDocument();expect(screen.getByText(/только целыми лотками по 8/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Лотки 1263'),{target:{value:'2'}});fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('16 шт.');
 });
 it('retains mixed trays and pieces where KIS specifies a piece minimum',async()=>{
  await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');
  fireEvent.change(screen.getByLabelText('Лотки 1263'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('Штуки 1263'),{target:{value:'3'}});
  fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('11 шт.');
 });
 it('loads real gateway data, converts a tray to pieces, preserves edits on cancelling scope change',async()=>{await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('8 шт.');expect(screen.getByRole('button',{name:'Отправить заказ'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Вернуться к заказу'}));vi.mocked(window.confirm).mockReturnValue(false);fireEvent.change(screen.getByLabelText('Покупатель'),{target:{value:p2}});expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');expect(requests.some(p=>p.startsWith('/api/v1'))).toBe(false);});
 it('opens real order line items',async()=>{await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));await screen.findByRole('button',{name:'№948'});fireEvent.click(screen.getByRole('button',{name:'№948'}));await waitFor(()=>expect(screen.queryByText('Загружаем состав…')).not.toBeInTheDocument());expect(screen.getByRole('dialog')).toHaveTextContent('917');expect(screen.getByRole('dialog')).toHaveTextContent('Хлеб из заказа');expect(screen.getByRole('dialog')).toHaveTextContent('15 шт.');});
 it('opens the entire history row with mouse/keyboard and removes raw KIS state from list and detail',async()=>{
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));const row=await screen.findByRole('row',{name:'Заказ №948'});
  expect(screen.queryByText('Статус КИС')).not.toBeInTheDocument();fireEvent.click(within(row).getAllByRole('cell')[4]);
  await screen.findByText('Хлеб из заказа');expect(screen.queryByText('Статус КИС')).not.toBeInTheDocument();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Повторить заказ'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));fireEvent.keyDown(screen.getByRole('row',{name:'Заказ №948'}),{key:'Enter'});await screen.findByRole('dialog',{name:'Заказ №948'});
 });
 it('repeats from the row into a new draft using fresh prices, exact pieces and the selected date without POST',async()=>{
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));
  expect(screen.queryByRole('dialog',{name:'Заказ №948'})).not.toBeInTheDocument();const dialog=screen.getByRole('dialog',{name:'Повторить заказ №948'});
  const date=api.tomorrow();fireEvent.change(within(dialog).getByLabelText('Дата нового заказа'),{target:{value:date}});fireEvent.change(within(dialog).getByLabelText('Продукция повторного заказа'),{target:{value:'0'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Перенести в новый заказ'}));
  await screen.findByText(/Заказ №948 перенесён/);expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');expect(screen.getByLabelText('Штуки 1263')).toHaveValue('7');expect(screen.getByLabelText('Дата заказа')).toHaveValue(date);expect(screen.getByLabelText('Группа продукции')).toHaveValue('0');
  expect(requests.some(p=>p.includes('DateOrd='+api.timestamp(date)+'&Group=0'))).toBe(true);
  fireEvent.click(screen.getAllByRole('button',{name:'Проверить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('15 шт.');expect(screen.getByRole('dialog')).toHaveTextContent('523,50');
  expect(vi.mocked(fetch).mock.calls.some(([url,init])=>String(url)==='/service/orders'&&init?.method==='POST')).toBe(false);expect(api.pending()).toBeNull();
 });
 it('offers the same repeat action inside order details',async()=>{
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'№948'}));await screen.findByText('Хлеб из заказа');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Повторить заказ'}));expect(screen.getByRole('dialog',{name:'Повторить заказ №948'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Перенести в новый заказ'}));await screen.findByText(/Заказ №948 перенесён/);expect(screen.getByLabelText('Штуки 1263')).toHaveValue('7');
 });
 it('requires explicit partial transfer when a historical product is absent from the current matrix',async()=>{
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('/service/orders/7')?response({payer:p1,client:11,order:{id:7,order_number:948},itemsAvailable:true,items:[{id:700,code:'1263',name:'Хлеб из заказа',quantity:16,price:90,sum:1440},{id:701,code:'999',name:'Снятый товар',quantity:3,price:50,sum:150}]}):mockFetch(input,init)));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));fireEvent.click(screen.getByRole('button',{name:'Перенести в новый заказ'}));
  await screen.findByText(/Эти позиции не будут перенесены/);expect(screen.getByRole('dialog')).toHaveTextContent('Снятый товар');expect(screen.getByRole('dialog')).toHaveTextContent('Нет в прайсе');
  expect(screen.queryByText(/Заказ №948 перенесён/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Перенести доступные позиции'}));await screen.findByText(/Не перенесено позиций: 1/);expect(screen.getByLabelText('Лотки 1263')).toHaveValue('2');
 });
 it('does not round incompatible trays into a different quantity',async()=>{
  minimum=null;await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));fireEvent.click(screen.getByRole('button',{name:'Перенести в новый заказ'}));
  await screen.findByText(/Эти позиции не будут перенесены/);expect(screen.getByRole('dialog')).toHaveTextContent('15 шт.');expect(screen.getByRole('dialog')).toHaveTextContent('целыми лотками по 8');expect(screen.getByRole('button',{name:'Перенести доступные позиции'})).toBeDisabled();
 });
 it('keeps an existing cart when the fresh catalog fails and repeat is cancelled',async()=>{
  let catalogs=0;vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{if(String(input).startsWith('/service/catalog')&&++catalogs>1)return response({code:'UPSTREAM_HTTP'},502);return mockFetch(input,init);}));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));
  fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));fireEvent.click(screen.getByRole('button',{name:'Перенести в новый заказ'}));await screen.findByText(/UPSTREAM_HTTP/);fireEvent.click(screen.getByRole('button',{name:'Отмена'}));fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');
 });
 it('asks before replacing an existing cart and retains it if replacement is declined',async()=>{
  await signIn();fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));fireEvent.click(screen.getByRole('button',{name:'Показать прайс-лист'}));await screen.findByText('Хлеб из КИС');fireEvent.click(screen.getByRole('button',{name:'Добавить лоток 1263'}));
  fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));vi.mocked(window.confirm).mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'Перенести в новый заказ'}));await screen.findByText(/Доступно для переноса/);
  expect(window.confirm).toHaveBeenCalledWith('Заменить текущую корзину составом повторяемого заказа?');fireEvent.click(screen.getByRole('button',{name:'Отмена'}));fireEvent.click(screen.getByRole('link',{name:'Оформить заказ'}));expect(screen.getByLabelText('Лотки 1263')).toHaveValue('1');expect(screen.getByLabelText('Штуки 1263')).toHaveValue('0');
 });
 it('ignores a late repeat response after cancellation and does not start duplicate preparations',async()=>{
  let release:((r:Response)=>void)|undefined,catalogs=0;
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{if(String(input).startsWith('/service/catalog')){catalogs++;return new Promise<Response>(resolve=>{release=resolve;});}return mockFetch(input,init);}));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));fireEvent.click(await screen.findByRole('button',{name:'Повторить заказ №948'}));const button=screen.getByRole('button',{name:'Перенести в новый заказ'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(catalogs).toBe(1));fireEvent.click(screen.getByRole('button',{name:'Отмена'}));
  await act(async()=>{release?.(new Response(JSON.stringify({payer:p1,client:11,DateOrd:api.timestamp(api.today()),Group:1,count:0,products:[]}),{headers:{'Content-Type':'application/json'}}));});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText(/Заказ №948 перенесён/)).not.toBeInTheDocument();expect(screen.getByRole('row',{name:'Заказ №948'})).toBeInTheDocument();
 });
 it('disables repeat for a viewer and for an unresolved submission',async()=>{
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/service/context'?response({user:{name:'Покупатель (демо)',role:'viewer'},payers:[{id:p1,name:'Первый покупатель',access:'all'},{id:p2,name:'Второй покупатель',access:'limited'}]}):mockFetch(input,init)));
  await signIn();fireEvent.click(screen.getByRole('link',{name:'История заказов'}));expect(await screen.findByRole('button',{name:'Повторить заказ №948'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'№948'}));await screen.findByText('Хлеб из заказа');expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Повторить заказ'})).toBeDisabled();cleanup();api.clearSession();vi.stubGlobal('fetch',vi.fn(mockFetch));
  await signIn();api.savePending({payer:p1,client:11,DateOrd:api.timestamp(api.today()),Group:1,products:[{id:66,quantity:8,price:34.9}]});fireEvent.click(screen.getByRole('link',{name:'История заказов'}));expect(await screen.findByRole('button',{name:'Повторить заказ №948'})).toBeDisabled();
 });
 it('rejects foreign or corrupt historical detail before creating a repeat draft',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>response({payer:p2,client:11,order:{id:7},itemsAvailable:true,items:[]})));
  await expect(api.orderDetail(p1,11,7)).rejects.toMatchObject({code:'INVALID_ORDER_ITEMS'});
 });
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
