'use strict';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TOKEN_KEY='karavay.manager.token',LOGOUT_KEY='karavay.manager.logout';
const recipientDetails=new Map();
let demoAccounts=[],demoError='',demoLoading=false,demoGeneration=0;
let userRole='',buyerFilter='',pendingUserContext=null,assignmentSeed=[];
const privateAccess=window.__KARAVAY_MANAGER_ACCESS__||null;
function stored(area,key){try{return window[area].getItem(key)||'';}catch(_){return '';}}
function removeStored(area,key){try{window[area].removeItem(key);}catch(_){}}
let remembered=!!stored('localStorage',TOKEN_KEY),token=stored('localStorage',TOKEN_KEY)||stored('sessionStorage',TOKEN_KEY),authGeneration=0,refreshBusy=false, state=null,tab='users',buyer='', clients=[],generation=0,formAction='',editing=null,baseline='',busy=false,kisBuyers=[],editorGeneration=0,directory=[],directoryError='',directoryLoading=false,directoryGeneration=0,assignmentPayers=[];
function saveSession(value,remember){
 token=value;remembered=remember;removeStored(remember?'sessionStorage':'localStorage',TOKEN_KEY);
 try{window[remember?'localStorage':'sessionStorage'].setItem(TOKEN_KEY,token);}catch(_){remembered=false;removeStored('localStorage',TOKEN_KEY);try{sessionStorage.setItem(TOKEN_KEY,token);}catch(_){}notify('Браузер не разрешил сохранить вход. Он действует в текущей вкладке.');}
}
const errors={INVALID_PASSWORD:'Новый пароль должен содержать от 6 до 128 символов и отличаться от текущего.',ACCOUNT_TYPE_SCOPE:'Для получателя выберите конкретные точки, для покупателя — всех получателей выбранной компании.',DEMO_ACCOUNT_CHANGED:'Тестовый пользователь или его доступ изменён. Проверьте назначения.',INVALID_DEMO_CONFIG:'Не удалось проверить настройку тестовых пользователей.',USER_INACTIVE:'Учётная запись отключена. Обратитесь к администратору.',ROLE_INACTIVE:'Роль менеджера отключена. Обратитесь к администратору.',PASSWORD_CHANGE_REQUIRED:'Сначала смените временный пароль.',INVALID_EMAIL:'Проверьте контактный email.',INVALID_MAPPING:'У назначения покупателя некорректная связь с КИС. Нужна проверка настроек.',PAYER_ALREADY_REGISTERED_OR_UNAVAILABLE:'Покупатель уже подключён или недоступен. Обновите список.',INVALID_RIGHT:'Проверьте выбранных покупателей и получателей.',MANAGER_REQUIRED:'Доступ разрешён только активному менеджеру.',ACCESS_DENIED:'Нет доступа к этой записи.',SHARED_ACCOUNT:'У пользователя есть доступы вне вашей области. Изменение выполняет администратор.',PAYER_ALREADY_REGISTERED:'Этот покупатель уже подключён. Назначение доступа выполняет администратор.',CLIENT_UNAVAILABLE:'Получатель недоступен или отключён в КИС.',MAIL_UNAVAILABLE:'Не удалось передать письмо. Проверьте SMTP на сервере.',SAVE_FAILED:'Запись не сохранена. Проверьте поля и уникальность email, логина и кодов.',KIS_UNAVAILABLE:'КИС недоступна. Повторите позже.',PAYER_NOT_VERIFIED:'КИС не подтвердила покупателя с действующим получателем.',ROLE_UNAVAILABLE:'Роль не настроена или отключена.',INVALID_USER:'Проверьте логин, email и роль.',PASSWORD_TOO_SHORT:'Пароль должен содержать не меньше 6 символов.'};
function loginError(message){$('#login-error').textContent=message;}
async function loadTestLogin(){
 if(privateAccess)return;
 const panel=$('#test-access');
 try{const data=await api('/service/manager/test-login',undefined,false);panel.hidden=data.enabled!==true;}
 catch(_){panel.hidden=true;}
}
$('#test-login').onclick=async()=>{
 const button=$('#test-login'),g=++authGeneration;button.disabled=true;loginError('');
 try{const data=await api('/service/manager/test-login',{},false);if(g!==authGeneration)return;
  if(!data.token||!data.record?.id||data.record.role_code!=='manager')throw Error('Тестовый вход недоступен. Обновите страницу.');
  saveSession(data.token,false);$('#login-form').reset();await enterAccount(data.record);
 }catch(error){if(g===authGeneration)loginError(errors[error.code]||(error.code==='TEST_LOGIN_DISABLED'?'Тестовый вход отключён на сервере.':error.code==='TEST_LOGIN_ORIGIN'?'Откройте страницу входа по адресу сервера КАРАВАЯ.':error.message));}
 finally{button.disabled=false;}
};
function staticToken(){try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).refreshable===false;}catch(_){return false;}}
function notify(s){if($('#workspace').hidden)loginError(s);$('#message').textContent=s;$('#message').hidden=false;setTimeout(()=>$('#message').hidden=true,8000);}
async function api(path,body,auth=true){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000),requestToken=token;
 try{const res=await fetch(path,{method:body?'POST':'GET',headers:{...(auth&&requestToken?{Authorization:requestToken}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});
 let data;try{data=await res.json();}catch(_){throw Error('Сервер вернул некорректный ответ.');}
 if(!res.ok){const message=errors[data.code]||(path.includes('/auth-with-password')&&[400,401].includes(res.status)?'Не удалось войти: проверьте email и пароль менеджера.':res.status===404&&path.startsWith('/service/manager/')?'Кабинет менеджера не установлен на сервере или установлен не полностью. Выполните проверку выпуска.':res.status===401?'Вход истёк. Войдите заново.':'Сервер отклонил запрос ('+res.status+'). '+(data.code||'Проверьте данные.'));if(auth&&requestToken===token&&(res.status===401||(res.status===403&&path==='/service/manager/state')||([400,403].includes(res.status)&&path==='/api/collections/users/auth-refresh')))logout(true,false);const error=Error(message);error.status=res.status;error.code=data.code;error.requestId=data.requestId;throw error;}return data;
 }catch(e){if(e instanceof TypeError)throw Error('Сервер недоступен. Проверьте подключение к сети КАРАВАЯ и повторите вход.');if(e.name==='AbortError')throw Error('Время ожидания истекло. Перед повтором обновите списки: действие могло выполниться.');throw e;}finally{clearTimeout(timer);}
}
function logout(broadcast=true,clearIdentity=true){const identity=$('#login-form [name=identity]').value;if(privateAccess)try{sessionStorage.setItem('karavay.manager.private.logout','1');}catch(_){}authGeneration++;generation++;directoryGeneration++;editorGeneration++;directory=[];directoryError='';directoryLoading=false;token='';remembered=false;state=null;clients=[];buyer='';recipientDetails.clear();demoAccounts=[];demoError='';demoGeneration++;userRole='';$('#search').value='';removeStored('sessionStorage',TOKEN_KEY);if(broadcast){removeStored('localStorage',TOKEN_KEY);try{localStorage.setItem(LOGOUT_KEY,String(Date.now())+'-'+Math.random());}catch(_){}}$('#workspace').hidden=true;$('#login').hidden=false;$('#retry-session').hidden=true;if($('#dialog').open)$('#dialog').close();$('#fields').replaceChildren();document.querySelector('.toolbar').appendChild($('#create'));$('#content').replaceChildren();$('#login-form').reset();if(!clearIdentity)$('#login-form [name=identity]').value=identity;closeMenu();}
async function enterAccount(record){
 if(record.active===false){logout(true,false);throw Error(errors.USER_INACTIVE);}if(record.role_code&&record.role_code!=='manager'){logout(true,false);throw Error('Эта учётная запись не является менеджером. Используйте email менеджера, а для покупателя откройте кабинет клиента.');}
 if(record.must_change_password){openEditor('password','Смена временного пароля',field('oldPassword','Временный пароль','password','','required autocomplete="current-password"')+field('password','Новый пароль','password','','required minlength="6" autocomplete="new-password"'));}
 else await load();
}
async function restoreSession(){
 if(!token||refreshBusy)return;refreshBusy=true;const g=authGeneration;$('#retry-session').hidden=true;
 try{if(staticToken()){await load();return;}const data=await api('/api/collections/users/auth-refresh',{});if(g!==authGeneration||!token)return;saveSession(data.token,remembered);await enterAccount(data.record);}
 catch(e){if(g===authGeneration||!token){notify(e.message);$('#retry-session').hidden=!token;}}
 finally{refreshBusy=false;}
}
async function load(){const g=++generation;const data=await api('/service/manager/state');if(g!==generation)return;state=data;recipientDetails.clear();if(!state.payers.some(p=>p.id===buyer))buyer=state.payers[0]?.id||'';$('#who').textContent=state.manager.name;$('#who-email').textContent=state.manager.email||'';$('#avatar').textContent=(state.manager.name||'М').split(/\s+/).filter(x=>/[A-Za-zА-Яа-яЁё]/.test(x)).map(x=>x[0]).slice(0,2).join('');loginError('');$('#login').hidden=true;$('#workspace').hidden=false;render();loadDemos();hydrateRecipients(data,token);}
async function loadDirectory(){const seq=++directoryGeneration,session=token;directory=[];directoryError='';directoryLoading=true;render();try{const data=await api('/service/manager/directory');if(seq!==directoryGeneration||session!==token)return;directory=data.buyers;}catch(e){if(seq===directoryGeneration&&session===token)directoryError=e.message;}finally{if(seq===directoryGeneration&&session===token){directoryLoading=false;render();}}}
function field(name,label,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function status(active){return `<span class="status ${active?'':'off'}">${active?'Активен':'Отключён'}</span>`;}
function accountKind(u){
 if(['client','payer'].includes(u.account_type))return u.account_type;
 const rs=u.rights.filter(r=>r.active);return rs.length?(rs.every(r=>r.scope==='all')?'payer':'client'):'';
}
function roleKind(u){return u.role_code==='viewer'?'viewer':accountKind(u);}
function roleName(u){return {client:'Получатель (Client)',payer:'Покупатель (Payer)',viewer:'Только просмотр'}[roleKind(u)]||'—';}

function userGroups(u){
 const groups=new Map();
 for(const r of u.rights.filter(r=>r.active)){if(!groups.has(r.payer))groups.set(r.payer,{payer:state.payers.find(p=>p.id===r.payer),rights:[]});groups.get(r.payer).rights.push(r);}
 return [...groups.values()];
}
function buyerSummary(u){return userGroups(u).map(g=>g.payer?`<div class="assignment-name"><span class="entity-code">${esc(g.payer.code)}</span> · ${esc(g.payer.name)}</div>`:'<span class="muted">Покупатель недоступен</span>').join('')||'<span class="muted">—</span>';}
function scopeName(u){
 const groups=userGroups(u),rights=groups.flatMap(g=>g.rights);
 if(!rights.length)return 'Доступ ещё не назначен';
 if(groups.length>1)return 'Несколько покупателей';
 if(rights.some(r=>r.scope==='all'))return 'Покупатель · все получатели';
 return new Set(rights.map(r=>r.kis_client_id)).size===1?'Получатель · одна точка':'Выбранные получатели';
}
function recipientLine(c){return `<div class="assignment-name recipient-name"><strong><span class="entity-code">${esc(c.code)}</span> · ${esc(c.name)}</strong><small class="recipient-address">${esc(c.address||'Адрес не передан из КИС')}</small></div>`;}
function recipientSummary(u,controls=true){
 let needsDetails=false,loading=false;
 const html=userGroups(u).map(g=>{
  const all=g.rights.some(r=>r.scope==='all'),detail=g.payer&&recipientDetails.get(g.payer.id);
  loading=loading||detail?.loading;
  if(g.payer&&!detail?.clients)needsDetails=true;
  const list=detail?.clients?.filter(c=>all||g.rights.some(r=>r.kis_client_id===c.id));
  const label=all?`<div class="recipient-scope">Все получатели${list?' · '+list.length:''}${g.payer?` <small>покупателя ${esc(g.payer.code)}</small>`:''}</div>`:'';
  const content=list?(list.length?list.slice(0,3).map(recipientLine).join('')+(list.length>3?`<details class="more-recipients"><summary>Ещё ${list.length-3}</summary>${list.slice(3).map(recipientLine).join('')}</details>`:''):'<small>Получатели не найдены в текущей выдаче КИС</small>'):all?'':g.rights.map(r=>`<div class="muted">Получатель · КИС ID ${esc(r.kis_client_id)}</div>`).join('');
  return label+content+(detail?.error?`<small class="unavailable">${esc(detail.error)}</small>`:'');
 }).join('')||'<span class="muted">—</span>';
 return html+(controls&&needsDetails?`<button class="recipient-details" data-recipients="${u.id}" ${loading?'disabled':''}>${loading?'Загружаем…':'Показать получателей и адреса'}</button>`:'');
}
function userStatus(u){return !u.active?status(false):!u.rights.some(r=>r.active)?'<span class="pending-badge">Ожидает назначения</span>':status(true);}
function renderUsers(matches){
 const all=state.users.filter(u=>tab!=='demos'||isDemo(u)).sort((a,b)=>a.login.localeCompare(b.login,'ru',{numeric:true,sensitivity:'base'}));
 const selected=all.filter(u=>(!userRole||roleKind(u)===userRole)&&matches(u));
 return `<div class="users-panel"><div class="list-caption"><strong>Пользователи <span>· ${selected.length}</span></strong></div><div class="user-table-wrap"><table class="user-list"><caption class="sr-only">Пользователи</caption><thead><tr><th scope="col">Логин</th><th scope="col">Email</th><th scope="col">Роль</th><th scope="col">Подтверждён</th><th scope="col">Покупатели (код)</th><th scope="col">Получатели (код)</th><th scope="col">Действия</th></tr></thead><tbody>${selected.map(u=>`<tr class="user-line"><td data-label="Логин"><strong>${esc(u.login)}</strong></td><td data-label="Email"><span class="contact-email">${esc(u.email)}</span></td><td data-label="Роль"><span class="role-badge ${roleKind(u)}">${esc(roleName(u))}</span></td><td data-label="Подтверждён"><span class="verified-badge ${u.verified?'yes':'no'}">${u.verified?'Да':'Нет'}</span></td><td data-label="Покупатели (код)">${accountKind(u)==='payer'?buyerSummary(u):'—'}</td><td data-label="Получатели (код)">${accountKind(u)==='client'?recipientSummary(u,false):'—'}</td><td data-label="Действия"><div class="user-actions"><button data-info="${u.id}">Инфо</button>${u.editable?`<button data-edit-user="${u.id}">Изменить</button><button class="delete-user" data-delete-user="${u.id}">Удалить</button>`:''}${demoAccounts.some(a=>a.id===u.id)?`<button data-demo-login="${u.id}" ${privateAccess?'disabled':''}>Войти</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>${!selected.length?'<div class="empty">Пользователи не найдены.</div>':''}</div>`;
}
async function hydrateRecipients(context,session){
 const payers=[...new Set(context.users.filter(u=>accountKind(u)==='client').flatMap(u=>u.rights.filter(r=>r.active).map(r=>r.payer)))];
 for(const pid of payers){
  if(state!==context||token!==session)return;
  if(recipientDetails.get(pid)?.clients)continue;
  try{const data=await api('/service/manager/clients?payer='+encodeURIComponent(pid));if(state!==context||token!==session)return;recipientDetails.set(pid,{clients:data.clients});}
  catch(e){if(state!==context||token!==session)return;recipientDetails.set(pid,{error:e.message});}
  render();
 }
}

async function showRecipientDetails(uid){
 const u=state?.users.find(u=>u.id===uid);if(!u)return;
 const session=token,context=state,payers=userGroups(u).filter(g=>g.payer).map(g=>g.payer).filter(p=>!recipientDetails.get(p.id)?.clients&&!recipientDetails.get(p.id)?.loading);
 await Promise.all(payers.map(async p=>{
  recipientDetails.set(p.id,{loading:true});render();
  try{const data=await api('/service/manager/clients?payer='+encodeURIComponent(p.id));if(session!==token||context!==state)return;recipientDetails.set(p.id,{clients:data.clients});}
  catch(e){if(session===token&&context===state)recipientDetails.set(p.id,{error:e.message});}
  finally{if(session===token&&context===state)render();}
 }));
}
function showUserInfo(u){
 openEditor('info','Информация о пользователе',`<dl class="user-info"><dt>Имя</dt><dd>${esc(u.name)}</dd><dt>Логин</dt><dd>${esc(u.login)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd><dt>Возможности</dt><dd>${esc(roleName(u))}</dd><dt>Область доступа</dt><dd>${esc(scopeName(u))}</dd><dt>Статус</dt><dd>${userStatus(u)}</dd><dt>Покупатели</dt><dd>${buyerSummary(u)}</dd><dt>Получатели</dt><dd>${recipientSummary(u,false)}</dd></dl>`,u);
}
function isDemo(u){return /\(демо\)/i.test(u.name)||/^demo[._]/i.test(u.email);}
async function loadDemos(){
 const seq=++demoGeneration,session=token;
 const replies=await Promise.allSettled([api('/service/manager/demo-accounts'),api('/service/test-access',undefined,false)]);
 if(seq!==demoGeneration||session!==token||!state)return;
 const accounts=new Map();
 replies.forEach((r,i)=>{if(r.status!=='fulfilled'||!Array.isArray(r.value.accounts))return;for(const a of r.value.accounts){if(state.users.some(u=>u.id===a.id)&&!accounts.has(a.id))accounts.set(a.id,{...a,source:i?'client':'manager'});}});
 demoAccounts=[...accounts.values()];render();
}
function renderDemos(matches){return renderUsers(matches);}

async function openDemo(id){
 const account=demoAccounts.find(a=>a.id===id),session=token,g=authGeneration;if(!account||privateAccess)return;
 const popup=window.open('about:blank','_blank');if(!popup){notify('Разрешите открытие новой вкладки для входа в кабинет клиента.');return;}
 popup.document.title='КАРАВАЙ · Входим…';popup.document.body.textContent='Открываем кабинет клиента…';
 try{
  const auth=await api(account.source==='client'?'/service/test-access':'/service/manager/demo-login',{id},account.source!=='client');
  if(auth.record?.id!==id||!auth.token||auth.record.active!==true||auth.record.must_change_password===true)throw Error('Тестовый пользователь изменён. Обновите список.');
  if(popup.closed)return;if(session!==token||g!==authGeneration){popup.close();return;}
  popup.sessionStorage.setItem('karavay_classic_session_v1',JSON.stringify({token:auth.token,id,email:auth.record.email,...(account.source==='client'?{test:true,preferredPayer:account.preferredPayer,preferredClient:account.preferredClient,preferredDate:account.preferredDate,preferredGroup:account.preferredGroup}:{})}));
  popup.sessionStorage.removeItem(TOKEN_KEY);popup.opener=null;popup.location.replace(privateAccess?privateAccess.base+'/':'/');
 }catch(e){popup.close();notify(e.message);}
}
function closeMenu(){$('#sidebar').classList.remove('open');$('#menu-backdrop').hidden=true;$('#menu').setAttribute('aria-expanded','false');}
function renderOverview(){
 const pending=state.users.filter(u=>!u.rights.some(r=>r.active)).length;
 return `<div class="welcome"><div><div class="eyebrow">СЕГОДНЯ В РАБОТЕ</div><h2>Клиенты и доступы под контролем.</h2><p>Покупатель из КИС → пользователь → разрешённые получатели.</p></div><button class="btn yellow" data-create-user>Создать пользователя</button></div><div class="kpis">${[['Мои покупатели',state.payers.length,'payers'],['Пользователи',state.users.length,'users'],['Ожидают назначения',pending,'users'],['Тестовые входы',demoAccounts.length,'demos']].map(([label,n,to])=>`<button class="kpi" data-navigate="${to}"><div class="kpi-top">${label}</div><div class="kpi-value">${n}</div><div class="kpi-note">Открыть раздел →</div></button>`).join('')}</div><section class="panel"><div class="panel-head"><h2>Следующий шаг</h2></div><div class="next-step"><h3>${pending?'Завершите назначения пользователей':'Добавьте покупателя из КИС'}</h3><p>${pending?'Пользователи без назначений сохранены, но бизнес-доступ ещё не выдан.':'В списке покупателей найдите нужную компанию и нажмите «Добавить» в её строке.'}</p><button class="btn subtle" data-navigate="${pending?'users':'payers'}">${pending?'Открыть пользователей':'Открыть покупателей'}</button></div></section>`;
}
function renderBuyers(matches){
 const filtered=directory.filter(p=>(!buyerFilter||(buyerFilter==='mine'?p.connection==='assigned':p.connection==='available'))&&matches(p));
 return `<section class="panel"><div class="list-caption"><strong>Покупатели <span>· ${filtered.length}</span></strong><span>Справочник КИС</span></div>${directoryLoading?'<p class="list-status" role="status">Загружаем покупателей…</p>':''}${directoryError?`<div class="list-status"><p role="alert">${esc(directoryError)}</p><button class="btn subtle" id="retry-directory">Повторить</button></div>`:''}<ul class="buyer-list">${filtered.map(p=>{const local=state.payers.find(x=>x.id_pay===p.id&&x.code===p.code);return `<li class="buyer-line"><span class="buyer-code">${esc(p.code)}</span><div class="buyer-info"><strong>${esc(p.name)}</strong>${local?.email?`<span class="contact-email">${esc(local.email)}</span>`:''}<small>${local?'В моей области доступа':p.connection==='available'?'Можно добавить из КИС':'Подключён · доступ не назначен'}</small></div><div class="buyer-actions">${local?`<button class="btn subtle" data-clients="${local.id}">Открыть</button><button class="btn yellow" data-create-for-payer="${local.id}">Создать пользователя</button>${local.access==='all'?`<button class="text-btn" data-edit-payer="${local.id}">Изменить</button>`:''}`:`<button class="btn ${p.connection==='available'?'yellow':'subtle'}" ${p.connection==='available'?`data-connect-kis="${p.id}"`:'disabled title="Назначение доступа выполняет администратор"'}>Добавить</button>`}</div></li>`;}).join('')}</ul>${!filtered.length&&!directoryLoading&&!directoryError?'<div class="empty"><h3>Покупатели не найдены</h3><p>Измените поиск или фильтр.</p></div>':''}</section>`;
}
function render(){
 if(!state)return;$('#list-toolbar').appendChild($('#create'));
 if(!['users','demos'].includes(tab))tab='users';
 const title=tab==='demos'?'Демо-пользователи':'Пользователи';$('#title').textContent=title;$('#crumb').textContent=title;
 $('#user-count').textContent=state.users.length;$('#users-notice').hidden=false;$('#user-filter').hidden=false;
 const all=state.users.filter(u=>tab!=='demos'||isDemo(u));
 const options=[['','Все роли'],['client','Получатель (Client)'],['payer','Покупатель (Payer)']];
 if(all.some(u=>u.role_code==='viewer'))options.push(['viewer','Только просмотр']);
 $('#role-filter').innerHTML=options.map(([code,name])=>`<option value="${code}" ${code===userRole?'selected':''}>${name} · ${all.filter(u=>!code||roleKind(u)===code).length}</option>`).join('');
 document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 const q=$('#search').value.toLocaleLowerCase('ru');$('#content').innerHTML=renderUsers(u=>JSON.stringify(u).toLocaleLowerCase('ru').includes(q));
 document.querySelector('.users-panel .list-caption').appendChild($('#create'));$('#create').textContent='+ Создать пользователя';$('#create').hidden=false;$('#create').disabled=busy;
}

async function loadClients(){const g=++generation,selected=buyer;clients=[];render();if(!buyer)return;try{const data=await api('/service/manager/clients?payer='+encodeURIComponent(buyer));if(g!==generation||selected!==buyer||tab!=='clients')return;clients=data.clients;render();if(!clients.length)notify('Получатели не найдены.');}catch(e){if(g===generation)notify(e.message);}}
function snapshot(){return JSON.stringify({fields:[...new FormData($('#editor')).entries()],rights:[...document.querySelectorAll('.assignment')].filter(r=>r.querySelector('.payer-check').checked).map(r=>[r.dataset.key,r.querySelector('.rs').value,r.querySelector('.rs').value==='client'?[...r.querySelectorAll('.rc:checked')].map(c=>c.value).sort():[]]).sort((a,b)=>a[0].localeCompare(b[0]))});}
function close(){if(busy)return;if(snapshot()!==baseline&&!confirm('Закрыть форму и отменить несохранённые изменения?'))return;$('#dialog').close();}
function openEditor(action,title,html,obj=null){editorGeneration++;formAction=action;editing=obj;$('#dialog-title').textContent=title;$('#fields').innerHTML=html;$('#form-error').textContent='';$('#save').textContent=action==='password'?'Сменить пароль':action==='create_user'?'Создать':'Сохранить';$('#save').hidden=action==='info';$('#cancel').textContent=action==='info'?'Закрыть':'Отмена';$('#dialog').showModal();baseline=snapshot();}
function userForm(u={}){
 const kind=u.id?roleKind(u):'';
 return '<div class="user-form-grid">'+field('login','Логин *','text',u.login||'','required minlength="3" maxlength="100" autocomplete="off" placeholder="например, ivanov" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*"')+field('email','Email *','email',u.email||'','required autocomplete="off" placeholder="user@company.ru"')+`<label>Роль *<select name="account_type" required><option value="">— выберите роль —</option><option value="client" ${kind==='client'?'selected':''}>Получатель (Client)</option><option value="payer" ${kind==='payer'?'selected':''}>Покупатель (Payer)</option>${u.role_code==='viewer'?'<option value="viewer" selected>Только просмотр</option>':''}</select></label>`+(u.id?'':field('password','Пароль *','password','','required minlength="6" autocomplete="new-password" placeholder="не менее 6 символов"'))+'</div>';
}
function editUser(u){
 openEditor('edit_user','Изменить пользователя',userForm(u)+`<details class="edit-access"><summary>${roleKind(u)==='client'?'Получатели (торговые точки)':roleKind(u)==='payer'?'Покупатели':'Покупатели и получатели'}</summary><div id="assignment-fields"></div></details><details class="edit-settings"><summary>Настройки доступа</summary><label class="check-row"><input type="checkbox" name="active" ${u.active?'checked':''}> Активен</label><button type="button" data-reset="${u.id}">Сбросить пароль</button></details>`,u);
 $('#fields .edit-access').addEventListener('toggle',e=>{if(e.target.open&&!$('#assignment-fields').hasChildNodes())fillAssignments();});
}

function assignmentKind(){return $('#editor [name=account_type]')?.value||roleKind(editing||{rights:[]});}
function rightRow(p,rs=[]){
 const chosen=rs.length>0,all=rs.some(x=>x.scope==='all');
 return `<article class="assignment" data-key="${esc(p.key)}" data-search="${esc((p.code+' '+p.name).toLocaleLowerCase())}"><label class="check-row assignment-buyer"><input type="checkbox" class="payer-check" ${chosen?'checked':''}><span><strong>${esc(p.code)} — ${esc(p.name)}</strong>${p.email?`<small>${esc(p.email)}</small>`:''}</span></label><p class="buyer-restriction" hidden>Доступ назначает администратор</p><div class="recipient-area" ${chosen?'':'hidden'}><label class="scope-field">Область доступа<select class="rs"><option value="client" ${!all?'selected':''}>Выбранные получатели</option><option value="all" ${all?'selected':''}>Все получатели покупателя</option></select></label><div class="recipient-options" ${all?'hidden':''}>${rs.filter(x=>x.scope==='client'&&x.kis_client_id>0).map(x=>`<label class="check-row"><input type="checkbox" class="rc" value="${x.kis_client_id}" checked><span>КИС ID ${x.kis_client_id}</span></label>`).join('')}</div><p class="candidate-status" role="status"></p><button type="button" data-candidates>Обновить получателей</button></div></article>`;
}
function rightsForm(rs=[]){
 return '<p id="assignment-hint" class="hint"></p><div id="buyer-controls"><label>Поиск покупателя<input id="rights-search" type="search" autocomplete="off" placeholder="Код или название покупателя"></label></div><div id="point-controls" hidden><label>Поиск покупателя точки<input id="point-buyer-search" type="search" autocomplete="off" placeholder="Код или название покупателя"></label><label>Покупатель точки<select id="point-buyer"><option value="">— выберите покупателя —</option></select></label><label>Поиск точки<input id="point-search" type="search" autocomplete="off" placeholder="Код, название или адрес точки"></label><p id="point-count" role="status"></p><div id="selected-point-buyers" class="selected-point-buyers"></div></div><p id="point-empty" class="hint" hidden>Выберите покупателя — здесь появятся его торговые точки.</p><div id="rights-list" class="rights-list">'+assignmentPayers.map(p=>rightRow(p,rs.filter(x=>x.payer===p.id))).join('')+'</div>';
}
function unavailableBuyer(p){return p.connection==='registered'||p.active===false;}
function pointBuyerOptions(){
 const select=$('#point-buyer'),selected=select.value,q=$('#point-buyer-search').value.trim().toLocaleLowerCase();
 select.innerHTML='<option value="">— выберите покупателя —</option>'+assignmentPayers.filter(p=>p.key===selected||(p.code+' '+p.name).toLocaleLowerCase().includes(q)).map(p=>`<option value="${esc(p.key)}" ${unavailableBuyer(p)?'disabled':''}>${esc(p.code)} — ${esc(p.name)}${unavailableBuyer(p)?' · доступ назначает администратор':''}</option>`).join('');select.value=selected;
}
function pointSelections(){
 const groups=[...document.querySelectorAll('.assignment')].map(r=>({p:assignmentPayers.find(p=>p.key===r.dataset.key),count:r.querySelectorAll('.rc:checked').length})).filter(x=>x.count);
 $('#point-count').textContent='Выбрано точек: '+groups.reduce((n,g)=>n+g.count,0);
 $('#selected-point-buyers').innerHTML=groups.map(g=>`<button type="button" data-point-buyer="${esc(g.p.key)}">${esc(g.p.code)} · точек: ${g.count}</button>`).join('');
}
function filterPoints(){
 const q=$('#point-search').value.trim().toLocaleLowerCase();
 document.querySelectorAll('.recipient-options .check-row').forEach(label=>label.hidden=!label.textContent.toLocaleLowerCase().includes(q));
}
function choosePointBuyer(){
 const key=$('#point-buyer').value;let current;
 document.querySelectorAll('.assignment').forEach(r=>{r.hidden=r.dataset.key!==key;if(!r.hidden){current=r;r.querySelector('.recipient-area').hidden=false;}});
 $('#point-empty').hidden=!!current;
 if(current)loadAssignmentClients(current);filterPoints();
}
function assignmentMode(){
 const kind=assignmentKind(),point=kind==='client',payer=kind==='payer',list=$('#rights-list');if(!list)return;
 const first=[...document.querySelectorAll('.assignment')].find(r=>r.querySelector('.payer-check').checked)?.dataset.key||'',previous=list.dataset.kind;
 list.dataset.kind=kind;$('#point-controls').hidden=!point;$('#buyer-controls').hidden=point;
 const summary=$('.edit-access>summary');if(summary)summary.textContent=point?'Получатели (торговые точки)':payer?'Покупатели':'Покупатели и получатели';
 $('#assignment-hint').textContent=point?'Выберите покупателя, затем отметьте конкретные точки по коду и адресу.':payer?'Отметьте покупателей. Пользователь получит доступ ко всем их действующим точкам.':'Отметьте покупателей и выберите область доступа. Режим «Только просмотр» сохраняется.';
 document.querySelectorAll('.assignment').forEach(r=>{
  const p=assignmentPayers.find(p=>p.key===r.dataset.key),check=r.querySelector('.payer-check'),select=r.querySelector('.rs');r.dataset.request=Number(r.dataset.request||0)+1;
  if(previous==='payer'&&kind!=='payer')r.dataset.payerSelected=check.checked?'1':'0';
  if(payer&&previous&&previous!=='payer'&&r.dataset.payerSelected!==undefined)check.checked=r.dataset.payerSelected==='1';
  select.querySelector('[value=all]').disabled=point||p.access!=='all';select.querySelector('[value=client]').disabled=payer;
  if(point){select.value='client';check.checked=r.querySelectorAll('.rc:checked').length>0;}
  if(payer)select.value='all';
  check.disabled=(unavailableBuyer(p)||(payer&&p.access!=='all'))&&!check.checked;
  r.querySelector('.buyer-restriction').hidden=!check.disabled;
  r.querySelector('.recipient-area').hidden=payer||(!point&&!check.checked);
  r.querySelector('.recipient-options').hidden=select.value==='all';
  r.querySelector('.scope-field').hidden=point||payer;
  r.hidden=point?true:!r.dataset.search.includes($('#rights-search').value.toLocaleLowerCase());
 });
 if(point){pointBuyerOptions();if(!$('#point-buyer').value)$('#point-buyer').value=first;pointSelections();choosePointBuyer();}
 else{$('#point-empty').hidden=true;if(!payer)document.querySelectorAll('.assignment').forEach(loadAssignmentClients);}
}
async function fillAssignments(){
 const gen=editorGeneration,session=token;$('#save').disabled=true;
 try{const data=await api('/service/manager/directory');if(gen!==editorGeneration||session!==token||!$('#dialog').open)return;
 assignmentPayers=data.buyers.map(k=>{const p=state.payers.find(p=>p.id_pay===k.id&&p.code===k.code);return p?{...p,key:p.id,connection:k.connection}:{key:'kis-'+k.id,id:'',id_pay:k.id,code:k.code,name:k.name,email:'',active:true,access:'all',connection:k.connection};});
 // Preserve assigned buyers absent from a temporary KIS directory response.
 for(const r of editing.rights||[]){const p=state.payers.find(p=>p.id===r.payer);if(p&&!assignmentPayers.some(x=>x.id===p.id))assignmentPayers.push({...p,key:p.id,connection:'assigned'});}
 ($('#assignment-fields')||$('#fields')).innerHTML=rightsForm([...(editing.rights||[]).filter(r=>r.active),...assignmentSeed]);assignmentMode();
 {const before=JSON.parse(baseline),now=JSON.parse(snapshot());baseline=JSON.stringify({...before,rights:now.rights});}$('#save').disabled=false;
 }catch(e){if(gen===editorGeneration){($('#assignment-fields')||$('#fields')).innerHTML='<p role="alert">'+esc(e.message)+'</p><button type="button" id="retry-assignments">Повторить загрузку</button>';}}
}
async function openAssignments(u,created=false){assignmentSeed=created&&pendingUserContext?[{payer:pendingUserContext.payer,scope:pendingUserContext.client?'client':state.payers.find(p=>p.id===pendingUserContext.payer)?.access==='all'?'all':'client',kis_client_id:pendingUserContext.client||0,active:true}]:[];openEditor('set_rights',(created?'Пользователь создан · ':'')+'Покупатели и получатели', '<p role="status">Загружаем справочник КИС…</p>',u);$('#save').textContent='Сохранить доступ';await fillAssignments();}
function readRights(){return [...document.querySelectorAll('.assignment')].filter(r=>r.querySelector('.payer-check').checked).flatMap(r=>{
 const p=assignmentPayers.find(p=>p.key===r.dataset.key),scope=r.querySelector('.rs').value,base=p.id?{payer:p.id}:{kis_payer_id:p.id_pay};
 if(!['client','all'].includes(scope))throw Error('Выберите допустимую область доступа для '+p.name+'.');
 if(scope==='all'&&p.access!=='all')throw Error('Доступ ко всему покупателю '+p.code+' недоступен. Выберите роль получателя и конкретные точки.');
 if(scope==='all')return [{...base,scope,kis_client_id:0}];
 const ids=[...r.querySelectorAll('.rc:checked')].map(c=>Number(c.value));if(!ids.length)throw Error('Отметьте хотя бы одного получателя для '+p.name+'.');
 return ids.map(kis_client_id=>({...base,scope,kis_client_id}));
});}
function payerForm(p={}){return (!p.id?field('buyer-search','Поиск покупателя в КИС','search','','autocomplete="off"')+'<label>Покупатель КИС<select id="kis-buyer" required><option value="">Загрузка покупателей…</option></select></label><p id="buyer-status" role="status"></p>':'')+field('name','Название','text',p.name||'','required maxlength="300" '+(!p.id?'readonly':''))+field('email','Контактный email (если есть)','email',p.email||'','autocomplete="off"')+field('phone','Телефон','tel',p.phone||'','maxlength="50"')+(p.id?`<label><input name="active" type="checkbox" ${p.active?'checked':''}> Активен</label>`:'<p class="hint">Выберите покупателя из КИС. Уже подключённые покупатели исключены из списка.</p>');}
function renderBuyerOptions(){
 const select=$('#kis-buyer');if(!select)return;const selected=select.value,q=$('[name=buyer-search]').value.toLocaleLowerCase();
 select.innerHTML='<option value="">Выберите покупателя</option>'+kisBuyers.filter(p=>[p.code,p.name,p.address].some(x=>x.toLocaleLowerCase().includes(q))).map(p=>`<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join('');
 select.value=[...select.options].some(o=>o.value===selected)?selected:'';
 if(!select.value)$('#editor [name=name]').value='';
 $('#buyer-status').textContent=`Найдено: ${select.options.length-1}. Выберите покупателя, затем сохраните.`;
}
async function loadBuyers(preselected=''){const gen=editorGeneration;kisBuyers=[];try{const data=await api('/service/manager/buyers');if(gen!==editorGeneration||!$('#dialog').open||formAction!=='create_payer')return;kisBuyers=data.buyers;renderBuyerOptions();if(preselected){$('#kis-buyer').value=String(preselected);$('#editor [name=name]').value=kisBuyers.find(p=>String(p.id)===String(preselected))?.name||'';}}catch(e){if(gen===editorGeneration){$('#buyer-status').textContent=e.message;$('#kis-buyer').innerHTML='<option value="">Не удалось загрузить покупателей</option>';}}}
async function loadAssignmentClients(r){
 const kind=assignmentKind();if(kind==='payer'||(kind==='client'?r.hidden:!r.querySelector('.payer-check').checked))return;
 const p=assignmentPayers.find(x=>x.key===r.dataset.key),gen=editorGeneration,seq=Number(r.dataset.request||0)+1;r.dataset.request=seq;
 const box=r.querySelector('.recipient-options'),hint=r.querySelector('.candidate-status'),b=r.querySelector('[data-candidates]');
 b.disabled=true;hint.textContent='Загружаем из КИС…';
 try{const data=await api(p.id?'/service/manager/clients?payer='+encodeURIComponent(p.id):'/service/manager/kis-clients?payer='+p.id_pay);if(gen!==editorGeneration||!r.isConnected||!$('#dialog').open||assignmentKind()!==kind||Number(r.dataset.request)!==seq)return;
 const selected=new Set([...r.querySelectorAll('.rc:checked')].map(c=>Number(c.value)));
 const missing=[...selected].filter(id=>!data.clients.some(c=>c.id===id));
 box.innerHTML=data.clients.map(c=>`<label class="check-row"><input type="checkbox" class="rc" value="${c.id}" ${selected.has(c.id)?'checked':''}><span>${esc(c.code)} · ${esc(c.name)}<small>${esc(c.address)}</small></span></label>`).join('')+missing.map(id=>`<label class="check-row unavailable"><input type="checkbox" class="rc" value="${id}" checked><span>КИС ID ${id} · отсутствует в текущей выдаче. Снимите галочку для удаления доступа.</span></label>`).join('');
 if(kind==='client'){pointSelections();filterPoints();}
 hint.textContent=data.clients.length?`Загружено: ${data.clients.length}. ${r.querySelector('.rs').value==='all'?'Доступ ко всем действующим получателям.':'Отметьте нужных получателей.'}`:'Получатели не найдены в КИС.';
 }catch(e){if(gen===editorGeneration&&r.isConnected&&assignmentKind()===kind&&Number(r.dataset.request)===seq)hint.textContent=e.message;}
 finally{if(gen===editorGeneration&&r.isConnected&&assignmentKind()===kind&&Number(r.dataset.request)===seq)b.disabled=false;}
}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter||$('#login-form button[type=submit]'),g=++authGeneration;loginError('');button.disabled=true;try{const f=new FormData(e.target),remember=e.target.elements.remember.checked,data=await api('/api/collections/users/auth-with-password',{identity:f.get('identity'),password:f.get('password')},false);if(g!==authGeneration)return;saveSession(data.token,remember);e.target.reset();$('#retry-session').hidden=true;await enterAccount(data.record);}catch(err){if(g===authGeneration||!token)notify(err.message);}finally{button.disabled=false;}});
$('#logout').onclick=()=>logout();$('#retry-session').onclick=restoreSession;$('#refresh').onclick=()=>load().then(()=>tab==='clients'?loadClients():null).catch(e=>notify(e.message));$('#search').oninput=render;
$('#role-filter').onchange=e=>{userRole=e.target.value;render();};$('#buyer-filter').onchange=e=>{buyerFilter=e.target.value;render();};
$('#menu').onclick=()=>{const shown=$('#sidebar').classList.toggle('open');$('#menu-backdrop').hidden=!shown;$('#menu').setAttribute('aria-expanded',String(shown));};$('#menu-backdrop').onclick=closeMenu;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{generation++;tab=b.dataset.tab;$('#search').value='';closeMenu();render();if(tab==='clients')loadClients();});
async function createUser(){if(busy)return;openEditor('create_user','Новый пользователь',userForm());}

$('#create').onclick=()=>{if(tab==='payers'){buyerFilter='available';render();$('#search').focus();}else if(tab==='clients')loadClients();else createUser();};

$('#content').addEventListener('change',e=>{if(e.target.id==='buyer'){buyer=e.target.value;loadClients();}});
async function action(body){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await api('/service/manager/action',body);notify(body.action==='reset_password'?'Письмо передано почтовому сервису. Доставку нужно проверить.':'Изменения сохранены.');await load();if(tab==='clients')await loadClients();}catch(e){notify(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);render();}}
$('#content').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 if('createUser'in d)createUser();
 if(d.createForPayer)createUser({payer:d.createForPayer,client:d.createForClient?Number(d.createForClient):0});
 if(d.navigate){tab=d.navigate;$('#search').value='';render();}
 if(d.demoLogin)openDemo(d.demoLogin);
 if(b.id==='retry-demos')loadDemos();
 if(d.info){const u=state.users.find(u=>u.id===d.info);if(u)showUserInfo(u);}
 if(d.recipients)showRecipientDetails(d.recipients);
 if(b.id==='retry-directory')loadDirectory();
 if(d.connectKis)action({action:'create_payer',id_pay:Number(d.connectKis),email:'',phone:''});
 if(d.clients){buyer=d.clients;tab='clients';loadClients();}
 if(d.editPayer){const p=state.payers.find(x=>x.id===d.editPayer);openEditor('edit_payer','Редактировать покупателя',payerForm(p),p);}
 if(d.editUser){const u=state.users.find(x=>x.id===d.editUser);if(u)editUser(u);}
 if(d.deleteUser){const u=state.users.find(x=>x.id===d.deleteUser);if(u&&confirm('Удалить пользователя '+u.login+'? Его назначения будут удалены.'))action({action:'delete_user',user:u.id,confirm_login:u.login});}
 if(d.rights){const u=state.users.find(x=>x.id===d.rights);openAssignments(u);}
 if(d.toggle){const u=state.users.find(x=>x.id===d.toggle);if(confirm((u.active?'Отключить':'Включить')+' пользователя '+u.name+'?'))action({action:'toggle_user',user:u.id,active:!u.active});}
 if(d.reset){const u=state.users.find(x=>x.id===d.reset);if(confirm('Отправить ссылку восстановления на '+u.email+'?'))action({action:'reset_password',user:u.id});}
 if(d.attach)action({action:'attach_client',payer:buyer,kis_client_id:Number(d.attach)});
});
$('#close').onclick=close;$('#cancel').onclick=close;$('#dialog').addEventListener('cancel',e=>{e.preventDefault();close();});
$('#fields').addEventListener('input',e=>{if(e.target.name==='buyer-search')renderBuyerOptions();if(e.target.id==='point-buyer-search')pointBuyerOptions();if(e.target.id==='point-search')filterPoints();if(e.target.id==='rights-search'){const q=e.target.value.toLocaleLowerCase();document.querySelectorAll('.assignment').forEach(r=>r.hidden=!r.dataset.search.includes(q));}});
$('#fields').addEventListener('change',e=>{
 if(e.target.name==='account_type'){const summary=$('.edit-access>summary');if(summary)summary.textContent=e.target.value==='client'?'Получатели (торговые точки)':e.target.value==='payer'?'Покупатели':'Покупатели и получатели';if($('#rights-list'))assignmentMode();return;}
 if(e.target.id==='point-buyer'){choosePointBuyer();return;}
 if(e.target.id==='kis-buyer'){$('#editor [name=name]').value=kisBuyers.find(p=>String(p.id)===e.target.value)?.name||'';return;}
 const r=e.target.closest('.assignment');if(!r)return;
 if(e.target.classList.contains('payer-check')){r.querySelector('.recipient-area').hidden=!e.target.checked;if(e.target.checked)loadAssignmentClients(r);else r.dataset.request=Number(r.dataset.request||0)+1;}
 if(e.target.classList.contains('rc')&&assignmentKind()==='client'){r.querySelector('.payer-check').checked=r.querySelectorAll('.rc:checked').length>0;pointSelections();}
 if(e.target.classList.contains('rs'))r.querySelector('.recipient-options').hidden=e.target.value==='all';
});
$('#fields').addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.pointBuyer){$('#point-buyer-search').value='';pointBuyerOptions();$('#point-buyer').value=b.dataset.pointBuyer;choosePointBuyer();return;}if(b?.dataset.reset){const u=editing;if(confirm('Отправить ссылку восстановления на '+u.email+'?'))action({action:'reset_password',user:u.id});return;}if(b?.id==='retry-assignments'){fillAssignments();return;}if(b&&'candidates'in b.dataset)loadAssignmentClients(b.closest('.assignment'));});
$('#editor').addEventListener('submit',async e=>{e.preventDefault();if(busy||formAction==='info')return;busy=true;$('#save').disabled=true;$('#form-error').textContent='';try{const data=Object.fromEntries(new FormData(e.target));if(formAction==='password'){await api('/service/account/change-password',data);logout();notify('Пароль изменён. Войдите заново. Для кабинета клиента откройте основной адрес.');return;}
 if(formAction==='create_payer'){const selected=kisBuyers.find(p=>String(p.id)===$('#kis-buyer').value);if(!selected)throw Error('Выберите покупателя из КИС.');data.id_pay=selected.id;data.code=selected.code;data.name=selected.name;delete data['buyer-search'];}
 if(['create_user','edit_user'].includes(formAction)){
  const kind=data.account_type;if(!['client','payer','viewer'].includes(kind))throw Error('Выберите роль.');
  data.name=editing?.name||data.login;data.role_code=kind==='viewer'?'viewer':'owner';
  data.account_type=kind==='viewer'?(editing?.account_type||''):kind;
  if(editing&&!editing.account_type&&kind===roleKind(editing))data.account_type='';
  if(formAction==='edit_user'){if(!!e.target.elements.active.checked!==editing.active)data.active=!!e.target.elements.active.checked;else delete data.active;if($('#rights-list'))data.rights=readRights();}
 }
 data.action=formAction;if(editing){data.user=editing.id;data.payer=editing.id;}if(data.id_pay)data.id_pay=Number(data.id_pay);if(formAction==='edit_payer')data.active=!!e.target.elements.active.checked;
 if(formAction==='set_rights'){data.rights=readRights();if(!data.rights.length&&editing.rights.some(r=>r.active)&&!confirm('Снять все назначения? Пользователь потеряет доступ к покупателям.'))return;}
 if(formAction==='edit_user'&&data.rights&&!data.rights.length&&editing.rights.some(r=>r.active)&&!confirm('Снять все назначения? Пользователь потеряет доступ.'))return;
 if(data.rights&&data.rights.some(r=>(!r.payer&&!r.kis_payer_id)||(r.scope==='client'&&!r.kis_client_id)))throw Error('Выберите покупателя и получателя для каждого назначения.');
 const saved=await api('/service/manager/action',data),created=formAction==='create_user';$('#dialog').close();e.target.reset();notify(created?'Пользователь создан.':'Изменения сохранены.');if(created){userRole='';tab='users';$('#search').value='';}await load();
 }catch(err){if($('#dialog').open)$('#form-error').textContent=err.message;else notify(err.message);}finally{busy=false;$('#save').disabled=formAction==='set_rights'&&!$('#rights-list');}});
window.addEventListener('beforeunload',e=>{if($('#dialog').open&&snapshot()!==baseline){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===LOGOUT_KEY||(remembered&&e.key===TOKEN_KEY&&!e.newValue))logout(false);});
if(privateAccess){$('#private-access').hidden=false;$('#private-access-note').textContent=(privateAccess.name||'Менеджер')+' · '+privateAccess.email+' · личный доступ действует до '+new Date(privateAccess.expires*1000).toLocaleString('ru-RU');$('#private-login').onclick=()=>{loginError('');saveSession(privateAccess.token,false);restoreSession();};}
if(token)restoreSession();
if(!privateAccess)loadTestLogin();
