#!/usr/bin/env python3
"""Grant one existing manager access to one existing buyer through the PB API.
Run on the VM with an SSH TTY. Password is prompted; never stored or printed.
No SQLite writes, schema changes, user edits or service restarts.
"""
import argparse,getpass,json,sys,urllib.request,urllib.error,urllib.parse
BASE='http://127.0.0.1:8090'
class Failure(Exception):pass
class Api:
    def __init__(self):
        self.token=''
        # Loopback traffic must not go through an environment-configured proxy.
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(self,path,body=None,method=None):
        req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':self.token} if self.token else {})})
        try:
            with self.opener.open(req,timeout=15) as response:
                raw=response.read();return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            # Do not print upstream bodies, credentials or tokens.
            if error.code in (401,403):raise Failure('PocketBase отклонил вход/доступ. Нужна учётная запись админки (_superusers).') from None
            raise Failure('PocketBase отклонил операцию: HTTP '+str(error.code)+'. Обнови кабинет перед повтором; новая запись могла уже сохраниться.') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
            raise Failure('Нет корректного ответа PocketBase. Обнови кабинет перед повтором: операция могла выполниться.') from None
    def rows(self,col,expression):
        result=[]
        for page in range(1,51):
            query=urllib.parse.urlencode({'filter':expression,'page':page,'perPage':200,'sort':'id'})
            data=self.request('/api/collections/'+col+'/records?'+query)
            result.extend(data['items'])
            if page>=data['totalPages']:return result
        raise Failure('Слишком много записей. Изменения не выполнялись.')
def one(api,col,expression,message):
    result=api.rows(col,expression)
    if len(result)!=1:raise Failure(message)
    return result[0]
def grant(api,login,payer_code):
    user=one(api,'users','login = '+json.dumps(login),'Пользователь с логином '+login+' не найден или неоднозначен. Проверь login в users и повтори с --manager-login НУЖНЫЙ_ЛОГИН.')
    if user.get('active') is not True or user.get('role_code')!='manager':raise Failure('У выбранного пользователя должны быть active=true и role_code=manager. Скрипт сам роль не меняет.')
    role=api.request('/api/collections/roles/records/'+user['role'])
    if role.get('active') is not True or role.get('code_role')!='manager':raise Failure('Связанная role должна быть активной ролью manager. Изменения не выполнялись.')
    payer=one(api,'payers','kod_pay = '+json.dumps(payer_code),'Покупатель с кодом '+payer_code+' не найден или неоднозначен.')
    kid=payer.get('id_pay')
    if payer.get('active') is not True or not isinstance(kid,(int,float)) or isinstance(kid,bool) or kid<=0 or kid%1 or kid>9007199254740991:raise Failure('Покупатель должен быть активен и иметь положительный целочисленный id_pay КИС.')
    expression='user = '+json.dumps(user['id'])+' && payer = '+json.dumps(payer['id'])
    before=api.rows('rights',expression)
    common=[r for r in before if r.get('scope')=='all' and r.get('kis_client_id')==0]
    if len(common)>1:raise Failure('Найдено несколько общих прав. Автоматическое исправление отменено; пришли скриншот этих прав.')
    print('Менеджер:',user.get('name') or login,'| login:',login)
    print('Покупатель:',payer.get('name_pay') or payer_code,'| код:',payer_code)
    if common:
        r=common[0]
        if r.get('active') is True:print('Право all уже активно. Дубликат не создаётся.')
        else:
            api.request('/api/collections/rights/records/'+r['id'],{'active':True},'PATCH')
            print('Существующее право all включено.')
        rid=r['id']
    else:
        if any(not r.get('client') for r in before):raise Failure('Найдена другая старая запись с пустым client. Из-за уникального индекса новое право не создано. Пришли скриншот прав этого менеджера.')
        result=api.request('/api/collections/rights/records',{'user':user['id'],'payer':payer['id'],'client':'','scope':'all','kis_client_id':0,'active':True},'POST')
        rid=result['id'];print('Создано отдельное право all.')
    check=api.request('/api/collections/rights/records/'+rid)
    if check.get('user')!=user['id'] or check.get('payer')!=payer['id'] or check.get('scope')!='all' or check.get('kis_client_id')!=0 or check.get('active') is not True:raise Failure('Повторная проверка права не прошла. Не повторяй запись вслепую; пришли результат.')
    print('MANAGER_ACCESS_VERIFIED:',rid)
    print('Открой /manager/, очисти поиск и нажми «Обновить».')
    if user.get('must_change_password'):print('При входе потребуется сменить временный пароль.')
    return rid

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manager-login',default='manager_test');parser.add_argument('--payer-code',default='A120');args=parser.parse_args()
    if not sys.stdin.isatty():raise Failure('Нужен интерактивный терминал: запускай через ssh -t. Не передавай пароль в командной строке.')
    print('Назначение доступа:',args.manager_login,'→',args.payer_code)
    print('Введи учётные данные АДМИНКИ PocketBase, не пароль менеджера. Пароль при вводе не отображается.')
    email=input('Email админки PocketBase: ').strip();password=getpass.getpass('Пароль админки PocketBase: ')
    api=Api();result=api.request('/api/collections/_superusers/auth-with-password',{'identity':email,'password':password},'POST');password=None
    api.token=result['token'];result=None
    try:grant(api,args.manager_login,args.payer_code)
    finally:api.token=''
if __name__=='__main__':
    try:main()
    except (Failure,KeyError) as error:
        print('ОСТАНОВЛЕНО:',str(error) if isinstance(error,Failure) else 'Неожиданный формат ответа PocketBase.',file=sys.stderr);sys.exit(1)
    except KeyboardInterrupt:print('\nОтменено пользователем.',file=sys.stderr);sys.exit(130)
