#!/usr/bin/env python3
"""Run on the VM after manager 0.7 installation. Only LK users/rights are written.
KIS IDs and recipient names are discovered live. No demo order is sent to KIS.
Credentials are kept in a private file outside the project, never printed.
"""
import getpass,json,os,pathlib,secrets,sys,urllib.request,urllib.error
BASE='http://127.0.0.1:8090'
class Failure(Exception):pass
class Api:
    def __init__(self):
        self.token='';self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def call(self,path,body=None):
        req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':self.token} if self.token else {})})
        try:
            with self.opener.open(req,timeout=50) as response:return json.load(response)
        except urllib.error.HTTPError as e:
            try:code=json.load(e).get('code','HTTP_'+str(e.code))
            except Exception:code='HTTP_'+str(e.code)
            raise Failure('Операция отклонена: '+str(code)+'. Обновите список пользователей перед повтором.') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):raise Failure('Нет корректного ответа. Операция могла выполниться: проверьте список перед повтором.') from None

def save_private(path,data):
    flags=os.O_WRONLY|os.O_CREAT|os.O_TRUNC|getattr(os,'O_NOFOLLOW',0)
    fd=os.open(path,flags,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:
        os.fchmod(f.fileno(),0o600);json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())

def provision(api,output_dir):
    state=api.call('/service/manager/state')
    if state.get('version') not in ('0.7.0','0.7.1','0.8.1'):raise Failure('Сначала установите менеджер 0.7.0.')
    mid=state['manager']['id'];path=pathlib.Path(output_dir)/('karavay-demo-access-'+mid+'.json')
    specs=[{'login':'demo_single_'+mid[:6],'email':'demo.single.'+mid+'@example.test','name':'Один покупатель (демо)','role_code':'owner'}, {'login':'demo_multi_'+mid[:6],'email':'demo.multi.'+mid+'@example.test','name':'Несколько покупателей (демо)','role_code':'viewer'}]
    data={'manager':mid,'accounts':[]}
    if path.exists():
        if path.is_symlink() or path.stat().st_uid!=os.getuid():raise Failure('Файл доступа принадлежит другому пользователю или является ссылкой.')
        data=json.loads(path.read_text())
        if data.get('manager')!=mid:raise Failure('Файл доступа относится к другому менеджеру.')
    pending=[]
    for spec in specs:
        existing=[u for u in state['users'] if u['email']==spec['email']]
        if existing and (len(existing)!=1 or existing[0]['name']!=spec['name'] or existing[0]['login']!=spec['login'] or existing[0]['role_code']!=spec['role_code'] or not existing[0]['editable']):raise Failure('Демо email уже занят другой записью. Ничего не перезаписываем.')
        if existing and existing[0]['rights']:
            print('Уже настроен:',spec['email'],'— пароль и права сохранены.');continue
        pending.append((spec,existing[0] if existing else None))
    if not pending:return path if path.exists() else None
    directory=api.call('/service/manager/directory')['buyers']
    local={p['id_pay']:p for p in state['payers'] if p['active']}
    choices=sorted([k for k in directory if k['connection']=='available' or k['id'] in local],key=lambda k:(k['connection']!='available',k['code']))
    selected=[]
    for k in choices[:12]:
        p=local.get(k['id']);url='/service/manager/clients?payer='+p['id'] if p else '/service/manager/kis-clients?payer='+str(k['id'])
        clients=api.call(url)['clients']
        if not clients:continue
        selected.append({'buyer':k,'client':clients[0],'right':{**({'payer':p['id']} if p else {'kis_payer_id':k['id']}),'scope':'client','kis_client_id':clients[0]['id']}})
        if len(selected)==2:break
    if len(selected)<2:raise Failure('Не найдены два доступных покупателя с получателями. Пользователи не созданы; выберите их в интерфейсе.')
    for index,(spec,existing) in enumerate(pending):
        access=selected[:1] if spec['role_code']=='owner' else selected
        entry=next((x for x in data['accounts'] if x['email']==spec['email']),None)
        if entry is None:
            entry={**spec,'password':None if existing else secrets.token_urlsafe(18),'status':'pending'};data['accounts'].append(entry)
        if not existing and not entry.get('password'):entry['password']=secrets.token_urlsafe(18)
        save_private(path,data) # Persist the generated password before the uncertain HTTP operation.
        if existing:uid=existing['id']
        else:uid=api.call('/service/manager/action',{'action':'create_user',**spec,'password':entry['password']})['id']
        entry['id']=uid;entry['status']='created_without_access';save_private(path,data)
        api.call('/service/manager/action',{'action':'set_rights','user':uid,'rights':[x['right'] for x in access]})
        current=next(u for u in api.call('/service/manager/state')['users'] if u['id']==uid)
        if len(current['rights'])!=len(access):raise Failure('Проверка назначений не прошла.')
        entry['assignments']=[{'buyer_id':x['buyer']['id'],'buyer_code':x['buyer']['code'],'buyer_name':x['buyer']['name'],'client_id':x['client']['id'],'client_code':x['client']['code'],'client_name':x['client']['name']} for x in access]
        entry['status']='ready';save_private(path,data)
        print('Готов:',spec['name'],'|',spec['email'])
        for x in access:print(' ',x['buyer']['code'],'→',x['client']['code'],'(КИС ID',x['client']['id'],')')
    return path

def main():
    if not sys.stdin.isatty():raise Failure('Запускайте через ssh -t, чтобы ввод пароля был скрыт.')
    api=Api();email=input('Email менеджера: ').strip();password=getpass.getpass('Пароль менеджера: ')
    auth=api.call('/api/collections/users/auth-with-password',{'identity':email,'password':password});password=None;api.token=auth['token'];auth=None
    try:path=provision(api,pathlib.Path.home())
    finally:api.token=''
    if path:print('DEMO_USERS_READY. Данные входа сохранены только на VM:',path)
    else:print('DEMO_USERS_READY. Учётные записи уже были настроены. Их существующие пароли не изменены.')
    print('Вымышленная почта example.test не принимает письма. Первый вход и смена пароля: /manager/, затем кабинет клиента /.')
if __name__=='__main__':
    try:raise Failure('Для менеджера 0.8.1 используйте scripts/Configure-Workspace.py --apply. Старые отдельные демо больше не создаются.')
    except (Failure,KeyError,ValueError,OSError) as e:print('ОСТАНОВЛЕНО:',str(e) if isinstance(e,Failure) else 'Проверьте ответ сервера и приватный файл доступа.',file=sys.stderr);sys.exit(1)
    except KeyboardInterrupt:print('\nОтменено.',file=sys.stderr);sys.exit(130)
