#!/usr/bin/env python3
"""Compatibility entry point for the 0.9 recipient demo setup.

Private manager HTML utilities are retained for existing operator workflows.
The CLI delegates to Setup-Recipient-Demos.py and needs no PB admin password.
"""
import argparse
import base64
import datetime
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('karavay_quick_setup',ROOT/'setup/quick-access/Create-Quick-Users.py')
quick=importlib.util.module_from_spec(spec)
spec.loader.exec_module(quick)
Failure=quick.Failure

def resolve_manager(api,name='Менеджер Каравай',email=None):
    candidates=api.rows('users','role_code = "manager"')
    chosen=[u for u in candidates if u.get('email','').casefold()==email.casefold()] if email else [u for u in candidates if u.get('name','').strip().casefold()==name.strip().casefold()]
    if len(chosen)!=1:
        raise Failure('Менеджер не найден однозначно. Укажите --manager-email с email существующего менеджера. Пароли и роли не изменены.')
    user=chosen[0]
    role=api.call('/api/collections/roles/records/'+user['role'])
    if user.get('active') is not True:
        raise Failure('Менеджер '+user['email']+' отключён (active=false). Автоматическое включение отменено.')
    if role.get('active') is not True or role.get('code_role')!='manager':
        raise Failure('У менеджера '+user['email']+' отключена или неверно назначена роль. Настройку должен проверить администратор.')
    if user.get('must_change_password') is True:
        raise Failure('Менеджеру '+user['email']+' назначена обязательная смена пароля. Завершите её обычным входом; обход не создаётся.')
    return user

def public_origin(value):
    parsed=urllib.parse.urlsplit(value)
    if parsed.scheme not in ('http','https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or not re.fullmatch(r'https?://[a-zA-Z0-9.:-]+',value):
        raise Failure('Некорректный origin кабинета.')
    return value

def private_manager_html(manager,auth,base):
    """The ordinary manager UI with a private, time-limited user token.

    It is NOT a superuser token. Every business request keeps ordinary checks.
    Static PB tokens cannot be refreshed; app.js validates them via manager/state.
    """
    base=public_origin(base)
    if auth.get('record',{}).get('id')!=manager['id']:
        raise Failure('PocketBase вернул доступ другого пользователя.')
    try:
        encoded=auth['token'].split('.')[1]
        claim=json.loads(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)))
        if claim['id']!=manager['id'] or claim.get('refreshable') is not False:
            raise ValueError('Unexpected token type')
        expires=int(claim['exp'])
    except (KeyError,ValueError,IndexError,TypeError):
        raise Failure('Неожиданный формат временного доступа PocketBase.') from None
    payload=json.dumps({'token':auth['token'],'id':manager['id'],'name':manager['name'],'email':manager['email'],'expires':expires,'base':base},ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    bootstrap="""(()=>{'use strict';const access=__ACCESS__;window.__KARAVAY_MANAGER_ACCESS__=Object.freeze(access);const original=window.fetch.bind(window);window.fetch=(input,options)=>original(typeof input==='string'&&input.startsWith('/')?new URL(input,access.base).href:input,{...options,credentials:'omit'});try{if(!sessionStorage.getItem('karavay.manager.private.logout')){localStorage.removeItem('karavay.manager.token');sessionStorage.setItem('karavay.manager.token',access.token);}}catch(_){}document.addEventListener('DOMContentLoaded',()=>{document.getElementById('client-link').href=access.base+'/';},{once:true});})();""".replace('__ACCESS__',payload)
    folder=ROOT/'pb_public/manager'
    source=(folder/'index.html').read_text()
    source=re.sub(r'<link rel="stylesheet"[^>]+>','',source)
    source=re.sub(r'<script src="app.js[^>]+></script>','',source)
    image='data:image/svg+xml;base64,'+base64.b64encode((folder/'logo.svg').read_bytes()).decode()
    source=source.replace('"logo.svg"','"'+image+'"')
    style=(folder/'theme.css').read_text()+'\n'+(folder/'styles.css').read_text()+'\n'+(folder/'users.css').read_text()
    app=(folder/'app.js').read_text()
    for script in (bootstrap,app):
        if '</script' in script.lower():
            raise Failure('Неподдерживаемое содержимое исходного скрипта.')
    hashes=[base64.b64encode(hashlib.sha256(script.encode()).digest()).decode() for script in (bootstrap,app)]
    policy="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src "+' '.join("'sha256-"+digest+"'" for digest in hashes)+"; connect-src "+base+"; base-uri 'none'; form-action 'none'; object-src 'none'"
    source=source.replace('</head>','<meta http-equiv="Content-Security-Policy" content="'+policy+'"><style>'+style+'</style><script>'+bootstrap+'</script></head>')
    source=source.replace('</body>','<script>'+app+'</script></body>')
    return source,expires

def check_private_entry(api):
    request=urllib.request.Request(quick.seed.PB+'/manager/',headers={'Accept':'text/html'})
    with api.opener.open(request,timeout=20) as response:html=response.read(4*1024*1024)
    expected=(ROOT/'pb_public/manager/index.html').read_bytes()
    if hashlib.sha256(html).digest()!=hashlib.sha256(expected).digest():
        raise Failure('На сервере другой HTML менеджера. Сначала установите весь выпуск 0.9.1.')
    request=urllib.request.Request(quick.seed.PB+'/service/manager/state',method='OPTIONS',headers={'Origin':'null','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
    with api.opener.open(request,timeout=20) as response:
        if response.headers.get('Access-Control-Allow-Origin') not in ('*','null'):
            raise Failure('Сервер не разрешает вход из личного файла. Настройки CORS автоматически не меняются.')

def configure(api,apply=False,manager_name='Менеджер Каравай',manager_email=None,public_url='http://192.168.25.98:8090',output_dir=None,payer_ids=None,client_id=None,run_id='manual'):
    if payer_ids is None or client_id is None:raise Failure('Для новых демо используйте scripts/Setup-Recipient-Demos.py --apply. Старые назначения не меняются.')
    public_url=public_origin(public_url)
    output=Path(output_dir or Path.home())
    if not output.is_dir() or output.is_symlink():
        raise Failure('Каталог личных файлов отсутствует или является ссылкой.')
    manager=resolve_manager(api,manager_name,manager_email)
    print('Менеджер:',manager['name'],'|',manager['email'])
    print('Роль активна; обязательная смена пароля не назначена.')
    # Use the exact existing plan/identities; no parallel demo-account namespace.
    old_state,old_output=quick.STATE,quick.OUTPUT
    quick.STATE=output/'.karavay-quick-users-20261016.json'
    quick.OUTPUT=output/'Karavay-Test-Login.html'
    try:
        if not apply:
            quick.provision(api,False,public_url,payer_ids=list(payer_ids),client_id=client_id,manager_name=manager['name'])
            return {'status':'read_only','manager':manager['id']}
        check_private_entry(api)
        auth=api.call('/api/collections/users/impersonate/'+manager['id'],{'duration':8*3600},'POST')
        private=quick.seed.Api();private.token=auth['token']
        try:
            state=private.call('/service/manager/state')
        finally:
            private.token=''
        if state.get('version')!='0.9.1' or state.get('manager',{}).get('id')!=manager['id']:
            raise Failure('Менеджер 0.9.1 на сервере не подтверждён. Старые файлы и пароли не изменены.')
        page,expires=private_manager_html(manager,auth,public_url)
        manager_file=output/'Karavay-Manager-Access.html'
        quick.private_save(manager_file,page)
        auth=None;page=None
        report={'version':'0.9.1','run_id':run_id,'manager':{'id':manager['id'],'name':manager['name'],'email':manager['email']},'manager_access':'ready','expires':expires,'demo':'pending','buyers':list(payer_ids),'single_client':client_id,'time':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        report_path=output/'Karavay-Manager-Setup-Report.json'
        quick.private_save(report_path,json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('MANAGER_ACCESS_READY:',manager_file)
        print('Личный вход действует 8 часов; пароль менеджера не изменён.')
        original_manager=quick.manager
        def selected_manager(current_api,wanted=None,preferred_name=None):
            if wanted and wanted!=manager['id']:
                raise Failure('Сохранённые демо относятся к другому менеджеру. Перенос назначений отменён.')
            return original_manager(current_api,manager['id'],manager['name'])
        quick.manager=selected_manager
        try:
            quick.provision(api,True,public_url,payer_ids=list(payer_ids),client_id=client_id,manager_name=manager['name'])
        except Failure as error:
            report['demo']='not_ready';report['error']=str(error)
            quick.private_save(report_path,json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            raise Failure('Личный вход менеджера подготовлен. Демо не завершено: '+str(error)) from None
        finally:
            quick.manager=original_manager
        report['demo']='ready'
        quick.private_save(report_path,json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('MANAGER_WORKSPACE_READY: 0.9.1')
        print('DEMO_USERS_READY: 3; реальные КИС-покупатели',*payer_ids)
        return report
    finally:
        quick.STATE,quick.OUTPUT=old_state,old_output

def main():
    # Preserve this entry point for older operator commands. New setup uses local
    # PB migrations and independent recipient accounts, without admin passwords.
    spec=importlib.util.spec_from_file_location('recipient_setup',ROOT/'scripts/Setup-Recipient-Demos.py')
    setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
    setup.main()

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,ValueError) as error:raise SystemExit('ОСТАНОВЛЕНО: '+str(error)) from None
