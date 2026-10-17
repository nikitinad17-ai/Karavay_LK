'use strict';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TOKEN_KEY='karavay.manager.token',LOGOUT_KEY='karavay.manager.logout';
const recipientDetails=new Map();
let userRole='',buyerFilter='',pendingUserContext=null,assignmentSeed=[];
const privateAccess=window.__KARAVAY_MANAGER_ACCESS__||null;
function stored(area,key){try{return window[area].getItem(key)||'';}catch(_){return '';}}
function removeStored(area,key){try{window[area].removeItem(key);}catch(_){}}
let remembered=!!stored('localStorage',TOKEN_KEY),token=stored('localStorage',TOKEN_KEY)||stored('sessionStorage',TOKEN_KEY),authGeneration=0,refreshBusy=false, state=null,tab='users',buyer='', clients=[],generation=0,formAction='',editing=null,baseline='',busy=false,kisBuyers=[],editorGeneration=0,directory=[],directoryError='',directoryLoading=false,directoryGeneration=0,assignmentPayers=[];
function saveSession(value,remember){
 token=value;remembered=remember;removeStored(remember?'sessionStorage':'localStorage',TOKEN_KEY);
 try{window[remember?'localStorage':'sessionStorage'].setItem(TOKEN_KEY,token);}catch(_){remembered=false;removeStored('localStorage',TOKEN_KEY);try{sessionStorage.setItem(TOKEN_KEY,token);}catch(_){}notify('Браузер не разрешил сохранить вход. Он действует в текущей вкладке.');}
}
const errors={USER_INACTIVE:'Учётная запись отключена. Обратитесь к администратору.',ROLE_INACTIVE:'Роль менеджера отключена. Обратитесь к администратору.',PASSWORD_CHANGE_REQUIRED:'Сначала смените временный пароль.',INVALID_EMAIL:'Проверьте контактный email.',INVALID_MAPPING:'У назначения покупателя некорректная связь с КИС. Нужна проверка настроек.',PAYER_ALREADY_REGISTERED_OR_UNAVAILABLE:'Покупатель уже подключён или недоступен. Обновите список.',INVALID_RIGHT:'Проверьте выбранных покупателей и получателей.',MANAGER_REQUIRED:'Доступ разрешён только активному менеджеру.',ACCESS_DENIED:'Нет доступа к этой записи.',SHARED_ACCOUNT:'У пользователя есть доступы вне вашей области. Изменение выполняет администратор.',PAYER_ALREADY_REGISTERED:'Этот покупатель уже подключён. Назначение доступа выполняет администратор.',CLIENT_UNAVAILABLE:'Получатель недоступен или отключён в КИС.',MAIL_UNAVAILABLE:'Не удалось передать письмо. Проверьте SMTP на сервере.',SAVE_FAILED:'Запись не сохранена. Проверьте поля и уникальность email, логина и кодов.',KIS_UNAVAILABLE:'КИС недоступна. Повторите позже.',PAYER_NOT_VERIFIED:'КИС не подтвердила покупателя с действующим получателем.',ROLE_UNAVAILABLE:'Роль не настроена или отключена.',INVALID_USER:'Проверьте логин, email и роль.',PASSWORD_TOO_SHORT:'Пароль должен содержать не меньше 12 символов.'};
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
function logout(broadcast=true,clearIdentity=true){const identity=$('#login-form [name=identity]').value;if(privateAccess)try{sessionStorage.setItem('karavay.manager.private.logout','1');}catch(_){}authGeneration++;generation++;directoryGeneration++;editorGeneration++;directory=[];directoryError='';directoryLoading=false;token='';remembered=false;state=null;clients=[];buyer='';recipientDetails.clear();userRole='';$('#search').value='';removeStored('sessionStorage',TOKEN_KEY);if(broadcast){removeStored('localStorage',TOKEN_KEY);try{localStorage.setItem(LOGOUT_KEY,String(Date.now())+'-'+Math.random());}catch(_){}}$('#workspace').hidden=true;$('#login').hidden=false;$('#retry-session').hidden=true;if($('#dialog').open)$('#dialog').close();$('#fields').replaceChildren();document.querySelector('.toolbar').appendChild($('#create'));$('#content').replaceChildren();$('#login-form').reset();if(!clearIdentity)$('#login-form [name=identity]').value=identity;closeMenu();}
async function enterAccount(record){
 if(record.active===false){logout(true,false);throw Error(errors.USER_INACTIVE);}if(record.role_code&&record.role_code!=='manager'){logout(true,false);throw Error('Эта учётная запись не является менеджером. Используйте email менеджера, а для покупателя откройте кабинет клиента.');}
 if(record.must_change_password){open('password','Смена временного пароля',field('oldPassword','Временный пароль','password','','required autocomplete="current-password"')+field('password','Новый пароль','password','','required minlength="12" autocomplete="new-password"'));}
 else await load();
}
async function restoreSession(){
 if(!token||refreshBusy)return;refreshBusy=true;const g=authGeneration;$('#retry-session').hidden=true;
 try{if(staticToken()){await load();return;}const data=await api('/api/collections/users/auth-refresh',{});if(g!==authGeneration||!token)return;saveSession(data.token,remembered);await enterAccount(data.record);}
 catch(e){if(g===authGeneration||!token){notify(e.message);$('#retry-session').hidden=!token;}}
 finally{refreshBusy=false;}
}
async function load(){const g=++generation;const data=await api('/service/manager/state');if(g!==generation)return;state=data;recipientDetails.clear();if(!state.payers.some(p=>p.id===buyer))buyer=state.payers[0]?.id||'';$('#who').textContent=state.manager.name;$('#who-email').textContent=state.manager.email||'';$('#avatar').textContent=(state.manager.name||'М').split(/\s+/).filter(x=>/[A-Za-zА-Яа-яЁё]/.test(x)).map(x=>x[0]).slice(0,2).join('');loginError('');$('#login').hidden=true;$('#workspace').hidden=false;render();loadDirectory();}
async function loadDirectory(){const seq=++directoryGeneration,session=token;directory=[];directoryError='';directoryLoading=true;render();try{const data=await api('/service/manager/directory');if(seq!==directoryGeneration||session!==token)return;directory=data.buyers;}catch(e){if(seq===directoryGeneration&&session===token)directoryError=e.message;}finally{if(seq===directoryGeneration&&session===token){directoryLoading=false;render();}}}
function field(name,label,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function status(active){return `<span class="status ${active?'':'off'}">${active?'Активен':'Отключён'}</span>`;}
function roleName(u){return u.role_code==='owner'?'Покупатель':u.role_code==='viewer'?'Только просмотр':'Роль недоступна';}
function userGroups(u){
 const groups=new Map();
 for(const r of u.rights.filter(r=>r.active)){if(!groups.has(r.payer))groups.set(r.payer,{payer:state.payers.find(p=>p.id===r.payer),rights:[]});groups.get(r.payer).rights.push(r);}
 return [...groups.values()];
}
function buyerSummary(u){return userGroups(u).map(g=>g.payer?`<div class="assignment-name"><span class="entity-code">${esc(g.payer.code)}</span> · ${esc(g.payer.name)}</div>`:'<span class="muted">Покупатель недоступен</span>').join('')||'<span class="muted">—</span>';}
function recipientSummary(u,controls=true){
 const groups=userGroups(u);let needsDetails=false,loading=false;
 const html=groups.map(g=>{
  if(g.rights.some(r=>r.scope==='all'))return `<div class="assignment-name">Все получатели${g.payer?` <small>· ${esc(g.payer.code)}</small>`:''}</div>`;
  const detail=g.payer&&recipientDetails.get(g.payer.id);loading=loading||detail?.loading;
  const recipients=[...new Set(g.rights.map(r=>r.kis_client_id))].map(id=>{
   const c=detail?.clients?.find(c=>c.id===id);if(c)return `<div class="assignment-name"><span class="entity-code">${esc(c.code)}</span> · ${esc(c.name)}</div>`;
   if(g.payer&&!detail?.clients)needsDetails=true;
   return `<div class="assignment-name muted">КИС ID ${esc(id)}${detail?.clients?' · нет в текущей выдаче':''}</div>`;
  }).join('');
  return recipients+(detail?.error?`<small class="unavailable">${esc(detail.error)}</small>`:'');
 }).join('')||'<span class="muted">—</span>';
 return html+(controls&&needsDetails?`<button class="recipient-details" data-recipients="${u.id}" ${loading?'disabled':''}>${loading?'Загружаем…':'Показать коды и названия'}</button>`:'');
}
function userStatus(u){return !u.active?status(false):!u.rights.some(r=>r.active)?'<span class="pending-badge">Ожидает назначения</span>':status(true);}
function renderUsers(matches){
 const selected=state.users.filter(u=>(tab!=='demos'||isDemo(u))&&(!userRole||u.role_code===userRole)&&matches({user:u,buyers:userGroups(u).map(g=>g.payer),recipients:userGroups(u).flatMap(g=>recipientDetails.get(g.payer?.id)?.clients?.filter(c=>g.rights.some(r=>r.scope==='all'||r.kis_client_id===c.id))||[])}));
 return `<div class="users-panel"><div class="list-caption"><strong>Пользователи <span>· ${selected.length}${selected.length!==state.users.length?' из '+state.users.length:''}</span></strong></div><div class="user-table-wrap"><table class="user-list"><caption class="sr-only">Пользователи и назначенные им покупатели и получатели</caption><thead><tr class="user-head"><th scope="col">Логин / имя</th><th scope="col">Email</th><th scope="col">Роль</th><th scope="col">Статус</th><th scope="col">Покупатели (код)</th><th scope="col">Получатели (код)</th><th scope="col">Действия</th></tr></thead><tbody>${selected.map(u=>`<tr class="user-line"><td data-label="Логин / имя"><div class="user-identity"><strong>${esc(u.login)}</strong><small>${esc(u.name)}</small></div></td><td data-label="Email"><span class="contact-email">${esc(u.email)}</span>${typeof u.verified==='boolean'?`<small class="email-verification ${u.verified?'verified':''}">${u.verified?'Email подтверждён':'Email не подтверждён'}</small>`:''}</td><td data-label="Роль"><span class="role-badge ${u.role_code==='viewer'?'viewer':''}">${esc(roleName(u))}</span></td><td data-label="Статус">${userStatus(u)}${u.must_change_password?'<small class="first-login">Смена пароля при входе</small>':''}</td><td data-label="Покупатели (код)">${buyerSummary(u)}</td><td data-label="Получатели (код)">${recipientSummary(u)}</td><td data-label="Действия"><div class="user-actions"><button data-info="${u.id}">Инфо</button>${u.editable?`<button data-edit-user="${u.id}">Изменить</button><button class="${u.active?'danger-button':'enable-button'}" data-toggle="${u.id}">${u.active?'Отключить':'Включить'}</button><button class="access-button" data-rights="${u.id}">${u.rights.some(r=>r.active)?'Покупатели и получатели':'Назначить доступ'}</button><button class="reset-button" data-reset="${u.id}" ${u.active?'':'disabled'}>Сбросить пароль</button>`:'<small>Изменяет администратор</small>'}</div></td></tr>`).join('')}</tbody></table></div></div>`;
}
async function showRecipientDetails(uid){
 const u=state?.users.find(u=>u.id===uid);if(!u)return;
 const session=token,context=state,payers=userGroups(u).filter(g=>g.payer&&!g.rights.some(r=>r.scope==='all')).map(g=>g.payer).filter(p=>!recipientDetails.get(p.id)?.clients&&!recipientDetails.get(p.id)?.loading);
 await Promise.all(payers.map(async p=>{
  recipientDetails.set(p.id,{loading:true});render();
  try{const data=await api('/service/manager/clients?payer='+encodeURIComponent(p.id));if(session!==token||context!==state)return;recipientDetails.set(p.id,{clients:data.clients});}
  catch(e){if(session===token&&context===state)recipientDetails.set(p.id,{error:e.message});}
  finally{if(session===token&&context===state)render();}
 }));
}
function showUserInfo(u){
 open('info','Информация о пользователе',`<dl class="user-info"><dt>Имя</dt><dd>${esc(u.name)}</dd><dt>Логин</dt><dd>${esc(u.login)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd><dt>Роль</dt><dd>${esc(roleName(u))}</dd><dt>Статус</dt><dd>${userStatus(u)}</dd><dt>Покупатели</dt><dd>${buyerSummary(u)}</dd><dt>Получатели</dt><dd>${recipientSummary(u,false)}</dd></dl>`,u);
}
function isDemo(u){return /\(демо\)/i.test(u.name)||/^demo[._]/i.test(u.email);}
function closeMenu(){$('#sidebar').classList.remove('open');$('#menu-backdrop').hidden=true;$('#menu').setAttribute('aria-expanded','false');}
function renderOverview(){
 const pending=state.users.filter(u=>!u.rights.some(r=>r.active)).length;
 return `<div class="welcome"><div><div class="eyebrow">СЕГОДНЯ В РАБОТЕ</div><h2>Клиенты и доступы под контролем.</h2><p>Покупатель из КИС → пользователь → разрешённые получатели.</p></div><button class="btn yellow" data-create-user>Создать пользователя</button></div><div class="kpis">${[['Мои покупатели',state.payers.length,'payers'],['Пользователи',state.users.length,'users'],['Ожидают назначения',pending,'users'],['Демо-пользователи',state.users.filter(isDemo).length,'demos']].map(([label,n,to])=>`<button class="kpi" data-navigate="${to}"><div class="kpi-top">${label}</div><div class="kpi-value">${n}</div><div class="kpi-note">Открыть раздел →</div></button>`).join('')}</div><section class="panel"><div class="panel-head"><h2>Следующий шаг</h2></div><div class="next-step"><h3>${pending?'Завершите назначения пользователей':'Добавьте покупателя из КИС'}</h3><p>${pending?'Пользователи без назначений сохранены, но бизнес-доступ ещё не выдан.':'В списке покупателей найдите нужную компанию и нажмите «Добавить» в её строке.'}</p><button class="btn subtle" data-navigate="${pending?'users':'payers'}">${pending?'Открыть пользователей':'Открыть покупателей'}</button></div></section>`;
}
function renderBuyers(matches){
 const filtered=directory.filter(p=>(!buyerFilter||(buyerFilter==='mine'?p.connection==='assigned':p.connection==='available'))&&matches(p));
 return `<section class="panel"><div class="list-caption"><strong>Покупатели <span>· ${filtered.length}</span></strong><span>Справочник КИС</span></div>${directoryLoading?'<p class="list-status" role="status">Загружаем покупателей…</p>':''}${directoryError?`<div class="list-status"><p role="alert">${esc(directoryError)}</p><button class="btn subtle" id="retry-directory">Повторить</button></div>`:''}<ul class="buyer-list">${filtered.map(p=>{const local=state.payers.find(x=>x.id_pay===p.id&&x.code===p.code);return `<li class="buyer-line"><span class="buyer-code">${esc(p.code)}</span><div class="buyer-info"><strong>${esc(p.name)}</strong>${local?.email?`<span class="contact-email">${esc(local.email)}</span>`:''}<small>${local?'В моей области доступа':p.connection==='available'?'Можно добавить из КИС':'Подключён · доступ не назначен'}</small></div><div class="buyer-actions">${local?`<button class="btn subtle" data-clients="${local.id}">Открыть</button><button class="btn yellow" data-create-for-payer="${local.id}">Создать пользователя</button>${local.access==='all'?`<button class="text-btn" data-edit-payer="${local.id}">Изменить</button>`:''}`:`<button class="btn ${p.connection==='available'?'yellow':'subtle'}" ${p.connection==='available'?`data-connect-kis="${p.id}"`:'disabled title="Назначение доступа выполняет администратор"'}>Добавить</button>`}</div></li>`;}).join('')}</ul>${!filtered.length&&!directoryLoading&&!directoryError?'<div class="empty"><h3>Покупатели не найдены</h3><p>Измените поиск или фильтр.</p></div>':''}</section>`;
}
function render(){
 if(!state)return;$('#list-toolbar').appendChild($('#create'));
 const titles={overview:'Обзор',payers:'Покупатели',users:'Пользователи',clients:'Получатели',demos:'Демо-пользователи'},subtitles={overview:'Рабочее пространство менеджера КАРАВАЯ',payers:'Найдите компанию в КИС и добавьте её одним действием.',users:'Учётные записи и назначения покупателей и получателей.',clients:'Торговые точки выбранного покупателя из КИС.',demos:'Тестовые аккаунты с реальными назначениями из КИС.'};
 $('#title').textContent=titles[tab];$('#crumb').textContent=titles[tab];$('#subtitle').textContent=subtitles[tab];$('#create').textContent=tab==='payers'?'+ Найти покупателя':tab==='clients'?'Обновить получателей':'+ Создать пользователя';$('#create').disabled=tab==='clients'&&!buyer;$('#create').hidden=tab==='demos';$('#list-toolbar').hidden=tab==='overview';$('#buyer-filter').hidden=tab!=='payers';$('#buyer-filter').value=buyerFilter;
 $('#payer-count').textContent=state.payers.length;$('#user-count').textContent=state.users.length;$('#users-notice').hidden=tab!=='users';$('#user-filter').hidden=!['users','demos'].includes(tab);document.querySelector('main').classList.toggle('users-view',['users','demos'].includes(tab));
 $('#role-filter').innerHTML=[['','Все роли'],['owner','Покупатель'],['viewer','Только просмотр']].map(([code,name])=>`<option value="${code}" ${code===userRole?'selected':''}>${name} · ${state.users.filter(u=>(tab!=='demos'||isDemo(u))&&(!code||u.role_code===code)).length}</option>`).join('');
 document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 const search=$('#search').value.toLocaleLowerCase('ru'),matches=o=>JSON.stringify(o).toLocaleLowerCase('ru').includes(search);
 if(tab==='overview')$('#content').innerHTML=renderOverview();
 if(tab==='payers')$('#content').innerHTML=renderBuyers(matches);
 if(['users','demos'].includes(tab)){$('#content').innerHTML=renderUsers(matches);if(tab==='users')document.querySelector('.users-panel .list-caption').appendChild($('#create'));if(tab==='demos'&&!state.users.some(isDemo))$('#content').insertAdjacentHTML('beforeend','<div class="empty"><h3>Демо ещё не настроено</h3><p>После настройки демонстрационных аккаунтов на VM здесь появятся три сценария: одна точка, один покупатель и два покупателя.</p></div>');}
 if(tab==='clients')$('#content').innerHTML=`<section class="panel"><div class="panel-head"><h2>Получатели покупателя</h2></div><div class="client-picker"><label>Покупатель<select id="buyer">${state.payers.map(p=>`<option value="${p.id}" ${p.id===buyer?'selected':''}>${esc(p.name)}${p.active?'':' · отключён'}</option>`).join('')}</select></label></div><ul class="buyer-list">${clients.filter(matches).map(c=>`<li class="buyer-line"><span class="buyer-code">${esc(c.code)}</span><div class="buyer-info"><strong>${esc(c.name)}</strong><small>${esc(c.address)} · КИС ID ${c.id}</small></div><div class="buyer-actions"><button class="btn subtle" data-create-for-payer="${buyer}" data-create-for-client="${c.id}">Создать пользователя</button></div></li>`).join('')}</ul>${!clients.length?'<div class="empty"><h3>Нет загруженных получателей</h3><p>Выберите покупателя и нажмите «Обновить получателей».</p></div>':''}</section>`;
 if(tab==='users'&&!$('#content').querySelector('.user-line'))$('#content').insertAdjacentHTML('beforeend','<div class="empty">Нет записей для выбранных условий</div>');
}

async function loadClients(){const g=++generation,selected=buyer;clients=[];render();if(!buyer)return;try{const data=await api('/service/manager/clients?payer='+encodeURIComponent(buyer));if(g!==generation||selected!==buyer||tab!=='clients')return;clients=data.clients;render();if(!clients.length)notify('Получатели не найдены.');}catch(e){if(g===generation)notify(e.message);}}
function snapshot(){return JSON.stringify({fields:[...new FormData($('#editor')).entries()],rights:[...document.querySelectorAll('.assignment')].map(r=>[r.querySelector('.payer-check').checked,r.dataset.key,r.querySelector('.rs').value,[...r.querySelectorAll('.rc:checked')].map(c=>c.value)])});}
function close(){if(busy)return;if(snapshot()!==baseline&&!confirm('Закрыть форму и отменить несохранённые изменения?'))return;$('#dialog').close();}
function open(action,title,html,obj=null){editorGeneration++;formAction=action;editing=obj;$('#dialog-title').textContent=title;$('#fields').innerHTML=html;$('#form-error').textContent='';$('#save').textContent=action==='password'?'Сменить пароль':'Сохранить';$('#save').hidden=action==='info';$('#cancel').textContent=action==='info'?'Закрыть':'Отмена';$('#dialog').showModal();baseline=snapshot();}
function userForm(u={}){return field('name','Имя','text',u.name||'','required maxlength="200"')+field('email','Email','email',u.email||'','required autocomplete="off"')+field('login','Технический логин','text',u.login||'','required minlength="3" maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*"')+`<label>Роль<select name="role_code"><option value="owner" ${u.role_code==='owner'?'selected':''}>Покупатель</option><option value="viewer" ${u.role_code==='viewer'?'selected':''}>Только просмотр</option></select></label>`;}
function rightRow(p,rs=[]){
 const chosen=rs.length>0,all=rs.some(x=>x.scope==='all'),disabled=p.connection==='registered'||p.active===false;
 return `<article class="assignment" data-key="${esc(p.key)}" data-search="${esc((p.code+' '+p.name).toLocaleLowerCase())}"><label class="check-row"><input type="checkbox" class="payer-check" ${chosen?'checked':''} ${disabled?'disabled':''}><span><strong>${esc(p.code)} — ${esc(p.name)}</strong>${p.email?`<small>${esc(p.email)}</small>`:''}</span><small class="kis-id">${p.id_pay}</small></label>${disabled?'<small>Доступ назначает администратор</small>':''}<div class="recipient-area" ${chosen?'':'hidden'}><label>Область доступа<select class="rs"><option value="client" ${!all?'selected':''}>Выбранные получатели</option>${p.access==='all'?`<option value="all" ${all?'selected':''}>Все получатели покупателя</option>`:''}</select></label><div class="recipient-options" ${all?'hidden':''}>${rs.filter(x=>x.scope==='client'&&x.kis_client_id>0).map(x=>`<label class="check-row"><input type="checkbox" class="rc" value="${x.kis_client_id}" checked>КИС ID ${x.kis_client_id}</label>`).join('')}</div><p class="candidate-status" role="status"></p><button type="button" data-candidates>Обновить получателей</button></div></article>`;
}
function rightsForm(rs=[]){return '<p class="hint">Отметьте покупателей, затем выберите получателей. Сохранение назначит доступ этому пользователю.</p><label>Поиск покупателя<input id="rights-search" type="search" autocomplete="off" placeholder="Код или название покупателя"></label><div id="rights-list" class="rights-list">'+assignmentPayers.map(p=>rightRow(p,rs.filter(x=>x.payer===p.id))).join('')+'</div>';}
async function fillAssignments(){
 const gen=editorGeneration,session=token;$('#save').disabled=true;
 try{const data=await api('/service/manager/directory');if(gen!==editorGeneration||session!==token||!$('#dialog').open)return;
 assignmentPayers=data.buyers.map(k=>{const p=state.payers.find(p=>p.id_pay===k.id&&p.code===k.code);return p?{...p,key:p.id,connection:k.connection}:{key:'kis-'+k.id,id:'',id_pay:k.id,code:k.code,name:k.name,email:'',active:true,access:'all',connection:k.connection};});
 // Preserve assigned buyers absent from a temporary KIS directory response.
 for(const r of editing.rights||[]){const p=state.payers.find(p=>p.id===r.payer);if(p&&!assignmentPayers.some(x=>x.id===p.id))assignmentPayers.push({...p,key:p.id,connection:'assigned'});}
 $('#fields').innerHTML=rightsForm([...(editing.rights||[]).filter(r=>r.active),...assignmentSeed]);baseline=snapshot();$('#save').disabled=false;
 document.querySelectorAll('.assignment').forEach(loadAssignmentClients);
 }catch(e){if(gen===editorGeneration){$('#fields').innerHTML='<p role="alert">'+esc(e.message)+'</p><button type="button" id="retry-assignments">Повторить загрузку</button>';}}
}
async function openAssignments(u,created=false){assignmentSeed=created&&pendingUserContext?[{payer:pendingUserContext.payer,scope:pendingUserContext.client?'client':state.payers.find(p=>p.id===pendingUserContext.payer)?.access==='all'?'all':'client',kis_client_id:pendingUserContext.client||0,active:true}]:[];open('set_rights',(created?'Пользователь создан · ':'')+'Покупатели и получатели', '<p role="status">Загружаем справочник КИС…</p>',u);$('#save').textContent='Сохранить доступ';await fillAssignments();}
function readRights(){return [...document.querySelectorAll('.assignment')].filter(r=>r.querySelector('.payer-check').checked).flatMap(r=>{
 const p=assignmentPayers.find(p=>p.key===r.dataset.key),scope=r.querySelector('.rs').value,base=p.id?{payer:p.id}:{kis_payer_id:p.id_pay};
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
 if(!r.querySelector('.payer-check').checked)return;
 const p=assignmentPayers.find(x=>x.key===r.dataset.key),gen=editorGeneration,seq=Number(r.dataset.request||0)+1;r.dataset.request=seq;
 const box=r.querySelector('.recipient-options'),hint=r.querySelector('.candidate-status'),b=r.querySelector('[data-candidates]');
 const selected=new Set([...r.querySelectorAll('.rc:checked')].map(c=>Number(c.value)));b.disabled=true;hint.textContent='Загружаем из КИС…';
 try{const data=await api(p.id?'/service/manager/clients?payer='+encodeURIComponent(p.id):'/service/manager/kis-clients?payer='+p.id_pay);if(gen!==editorGeneration||!r.isConnected||!r.querySelector('.payer-check').checked||Number(r.dataset.request)!==seq)return;
 const missing=[...selected].filter(id=>!data.clients.some(c=>c.id===id));
 box.innerHTML=data.clients.map(c=>`<label class="check-row"><input type="checkbox" class="rc" value="${c.id}" ${selected.has(c.id)?'checked':''}><span>${esc(c.code)} · ${esc(c.name)}<small>${esc(c.address)} · ID ${c.id}</small></span></label>`).join('')+missing.map(id=>`<label class="check-row unavailable"><input type="checkbox" class="rc" value="${id}" checked><span>КИС ID ${id} · отсутствует в текущей выдаче. Снимите галочку для удаления доступа.</span></label>`).join('');
 hint.textContent=data.clients.length?`Загружено: ${data.clients.length}. ${r.querySelector('.rs').value==='all'?'Доступ ко всем действующим получателям.':'Отметьте нужных получателей.'}`:'Получатели не найдены в КИС.';
 }catch(e){if(gen===editorGeneration&&r.isConnected&&Number(r.dataset.request)===seq)hint.textContent=e.message;}
 finally{if(gen===editorGeneration&&r.isConnected&&Number(r.dataset.request)===seq)b.disabled=false;}
}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter||$('#login-form button[type=submit]'),g=++authGeneration;loginError('');button.disabled=true;try{const f=new FormData(e.target),remember=e.target.elements.remember.checked,data=await api('/api/collections/users/auth-with-password',{identity:f.get('identity'),password:f.get('password')},false);if(g!==authGeneration)return;saveSession(data.token,remember);e.target.reset();$('#retry-session').hidden=true;await enterAccount(data.record);}catch(err){if(g===authGeneration||!token)notify(err.message);}finally{button.disabled=false;}});
$('#logout').onclick=()=>logout();$('#retry-session').onclick=restoreSession;$('#refresh').onclick=()=>load().then(()=>tab==='clients'?loadClients():null).catch(e=>notify(e.message));$('#search').oninput=render;
$('#role-filter').onchange=e=>{userRole=e.target.value;render();};$('#buyer-filter').onchange=e=>{buyerFilter=e.target.value;render();};
$('#menu').onclick=()=>{const shown=$('#sidebar').classList.toggle('open');$('#menu-backdrop').hidden=!shown;$('#menu').setAttribute('aria-expanded',String(shown));};$('#menu-backdrop').onclick=closeMenu;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{generation++;tab=b.dataset.tab;$('#search').value='';closeMenu();render();if(tab==='clients')loadClients();});
async function createUser(context=null){if(busy)return;try{await load();}catch(e){notify(e.message);return;}pendingUserContext=context;open('create_user','Добавить пользователя',userForm()+field('password','Временный пароль','password','','required minlength="12" autocomplete="new-password"')+'<p class="hint">После создания откроется отдельное окно покупателей и получателей. При первом входе пользователь сменит временный пароль.</p>');}
$('#create').onclick=()=>{if(tab==='payers'){buyerFilter='available';render();$('#search').focus();}else if(tab==='clients')loadClients();else createUser();};

$('#content').addEventListener('change',e=>{if(e.target.id==='buyer'){buyer=e.target.value;loadClients();}});
async function action(body){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await api('/service/manager/action',body);notify(body.action==='reset_password'?'Письмо передано почтовому сервису. Доставку нужно проверить.':'Изменения сохранены.');await load();if(tab==='clients')await loadClients();}catch(e){notify(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);render();}}
$('#content').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 if('createUser'in d)createUser();
 if(d.createForPayer)createUser({payer:d.createForPayer,client:d.createForClient?Number(d.createForClient):0});
 if(d.navigate){tab=d.navigate;$('#search').value='';render();}
 if(d.info){const u=state.users.find(u=>u.id===d.info);if(u)showUserInfo(u);}
 if(d.recipients)showRecipientDetails(d.recipients);
 if(b.id==='retry-directory')loadDirectory();
 if(d.connectKis)action({action:'create_payer',id_pay:Number(d.connectKis),email:'',phone:''});
 if(d.clients){buyer=d.clients;tab='clients';loadClients();}
 if(d.editPayer){const p=state.payers.find(x=>x.id===d.editPayer);open('edit_payer','Редактировать покупателя',payerForm(p),p);}
 if(d.editUser){const u=state.users.find(x=>x.id===d.editUser);open('edit_user','Редактировать пользователя',userForm(u),u);}
 if(d.rights){const u=state.users.find(x=>x.id===d.rights);openAssignments(u);}
 if(d.toggle){const u=state.users.find(x=>x.id===d.toggle);if(confirm((u.active?'Отключить':'Включить')+' пользователя '+u.name+'?'))action({action:'toggle_user',user:u.id,active:!u.active});}
 if(d.reset){const u=state.users.find(x=>x.id===d.reset);if(confirm('Отправить ссылку восстановления на '+u.email+'?'))action({action:'reset_password',user:u.id});}
 if(d.attach)action({action:'attach_client',payer:buyer,kis_client_id:Number(d.attach)});
});
$('#close').onclick=close;$('#cancel').onclick=close;$('#dialog').addEventListener('cancel',e=>{e.preventDefault();close();});
$('#fields').addEventListener('input',e=>{if(e.target.name==='buyer-search')renderBuyerOptions();if(e.target.id==='rights-search'){const q=e.target.value.toLocaleLowerCase();document.querySelectorAll('.assignment').forEach(r=>r.hidden=!r.dataset.search.includes(q));}});
$('#fields').addEventListener('change',e=>{
 if(e.target.id==='kis-buyer'){$('#editor [name=name]').value=kisBuyers.find(p=>String(p.id)===e.target.value)?.name||'';return;}
 const r=e.target.closest('.assignment');if(!r)return;
 if(e.target.classList.contains('payer-check')){r.querySelector('.recipient-area').hidden=!e.target.checked;if(e.target.checked)loadAssignmentClients(r);else r.dataset.request=Number(r.dataset.request||0)+1;}
 if(e.target.classList.contains('rs'))r.querySelector('.recipient-options').hidden=e.target.value==='all';
});
$('#fields').addEventListener('click',e=>{const b=e.target.closest('button');if(b?.id==='retry-assignments'){fillAssignments();return;}if(b&&'candidates'in b.dataset)loadAssignmentClients(b.closest('.assignment'));});
$('#editor').addEventListener('submit',async e=>{e.preventDefault();if(busy||formAction==='info')return;busy=true;$('#save').disabled=true;$('#form-error').textContent='';try{const data=Object.fromEntries(new FormData(e.target));if(formAction==='password'){await api('/service/account/change-password',data);logout();notify('Пароль изменён. Войдите заново. Для кабинета клиента откройте основной адрес.');return;}
 if(formAction==='create_payer'){const selected=kisBuyers.find(p=>String(p.id)===$('#kis-buyer').value);if(!selected)throw Error('Выберите покупателя из КИС.');data.id_pay=selected.id;data.code=selected.code;data.name=selected.name;delete data['buyer-search'];}
 data.action=formAction;if(editing){data.user=editing.id;data.payer=editing.id;}if(data.id_pay)data.id_pay=Number(data.id_pay);if(formAction==='edit_payer')data.active=!!e.target.elements.active.checked;
 if(formAction==='set_rights'){data.rights=readRights();if(!data.rights.length&&editing.rights.some(r=>r.active)&&!confirm('Снять все назначения? Пользователь потеряет доступ к покупателям.'))return;}
 if(data.rights&&data.rights.some(r=>(!r.payer&&!r.kis_payer_id)||(r.scope==='client'&&!r.kis_client_id)))throw Error('Выберите покупателя и получателя для каждого назначения.');
 const saved=await api('/service/manager/action',data),created=formAction==='create_user';$('#dialog').close();e.target.reset();notify(created?'Пользователь создан. Теперь назначьте покупателей и получателей.':'Изменения сохранены.');await load();if(created)await openAssignments(state.users.find(u=>u.id===saved.id)||{id:saved.id,name:data.name,rights:[]},true);
 }catch(err){if($('#dialog').open)$('#form-error').textContent=err.message;else notify(err.message);}finally{busy=false;$('#save').disabled=formAction==='set_rights'&&!$('#rights-list');}});
window.addEventListener('beforeunload',e=>{if($('#dialog').open&&snapshot()!==baseline){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===LOGOUT_KEY||(remembered&&e.key===TOKEN_KEY&&!e.newValue))logout(false);});
if(privateAccess){$('#private-access').hidden=false;$('#private-access-note').textContent=(privateAccess.name||'Менеджер')+' · '+privateAccess.email+' · личный доступ действует до '+new Date(privateAccess.expires*1000).toLocaleString('ru-RU');$('#private-login').onclick=()=>{loginError('');saveSession(privateAccess.token,false);restoreSession();};}
if(token)restoreSession();
if(!privateAccess)loadTestLogin();
