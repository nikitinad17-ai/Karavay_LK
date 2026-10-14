#!/usr/bin/env python3
"""Create two explicitly requested (демо) users through PocketBase API.
No schema changes, no KIS writes. Existing accounts and payer records are not modified.
Run on the VM in an SSH TTY. Credentials are entered locally and never printed.
"""
import argparse,getpass,json,re,sys,urllib.request,urllib.error,urllib.parse
PB='http://127.0.0.1:8090'; KIS='http://serv15db:55580/api/v1'
class Failure(Exception): pass
class Api:
    def __init__(self):
        self.token='';self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def call(self,path,body=None,method=None,kis=False):
        base=KIS if kis else PB
        req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':self.token} if self.token and not kis else {})})
        try:
            with self.opener.open(req,timeout=25) as r: raw=r.read(2097153)
            if len(raw)>2097152: raise Failure('Ответ слишком большой.')
            parts=re.split(r'("(?:\\.|[^"\\])*")',raw.decode())
            if kis:
                for i in range(0,len(parts),2):parts[i]=re.sub(r'([:\[,]\s*)(-?)\.(\d)',r'\g<1>\g<2>0.\3',parts[i])
            doc=json.loads(''.join(parts))
            if kis:
                if doc.get('success') is not True: raise Failure('КИС отклонила чтение.')
                return doc['data']
            return doc
        except urllib.error.HTTPError as e: raise Failure('HTTP '+str(e.code)+': операция не подтверждена; повторный запуск сначала сверит существующие записи.') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError): raise Failure('Нет корректного ответа. Повторный запуск сначала сверит существующие записи.') from None
    def rows(self,col,expression):
        data=self.call('/api/collections/'+col+'/records?'+urllib.parse.urlencode({'filter':expression,'perPage':200}))
        if data.get('totalPages',1)>1:raise Failure('Слишком много совпадений.')
        return data['items']
    def create(self,col,data):return self.call('/api/collections/'+col+'/records',data,'POST')
def only(rows,description):
    if len(rows)!=1:raise Failure(description+' отсутствует или неоднозначен.')
    return rows[0]
def prepare(api):
    role=only(api.rows('roles','active = true && code_role = "owner"'),'Активная роль owner')
    payers={};recipients={}
    for pid,cid in [(300182,300183),(299271,299300)]:
        p=only(api.rows('payers','id_pay = '+str(pid)+' && active = true'),'Покупатель КИС '+str(pid)+' в PocketBase')
        rows=api.call('/payers/'+str(pid)+'/clients',kis=True)
        if not isinstance(rows,list):raise Failure('Неверный список получателей КИС.')
        c=only([r for r in rows if r.get('id')==cid],'Получатель '+str(cid))
        detail=api.call('/clients/'+str(cid),kis=True)
        if detail.get('id')!=cid or detail.get('payer_id')!=pid or detail.get('state')!=1:raise Failure('Связь покупателя/получателя или его активность не подтверждена КИС.')
        if not c.get('kod') or not c.get('name'):raise Failure('КИС не вернула код/название получателя.')
        payers[pid]=p;recipients[cid]=(c,p)
    return role,payers,recipients
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not sys.stdin.isatty():raise Failure('Запускайте через ssh -t. Не передавайте пароль в аргументах.')
    api=Api();email=input('Email администратора PocketBase: ').strip();password=getpass.getpass('Пароль администратора: ')
    api.token=api.call('/api/collections/_superusers/auth-with-password',{'identity':email,'password':password},'POST')['token'];password=None
    role,payers,recipients=prepare(api)
    scenarios=[
      {'name':'Покупатель двух организаций (демо)','email':'demo.buyer@karavay.example','login':'demo_buyer_classic','grants':[(300182,0),(299271,0)]},
      {'name':'Получатель одной точки (демо)','email':'demo.outlet@karavay.example','login':'demo_outlet_classic','grants':[(300182,300183)]}
    ]
    for s in scenarios:
        print(s['name'],'|',s['email'])
        for pid,cid in s['grants']: print('  ',payers[pid]['name_pay'],'→',recipients[cid][0]['name'] if cid else 'все активные получатели из КИС')
    if not args.apply: print('READ_ONLY_PLAN: для создания запустите с --apply');return
    new_password=getpass.getpass('Временный пароль для двух демо-пользователей (от 12 символов): ')
    if len(new_password)<12 or len(new_password)>128 or getpass.getpass('Повторите временный пароль: ')!=new_password:raise Failure('Пароли не совпали или неверная длина.')
    # Preflight both names before writing anything. Never adopt unrelated existing accounts.
    for s in scenarios:
        existing=api.rows('users','email = '+json.dumps(s['email'])+' || login = '+json.dumps(s['login']))
        if existing:
            u=only(existing,'Демо-пользователь')
            if any(u.get(k)!=s[k] for k in ['name','email','login']) or u.get('role_code')!='owner' or u.get('role')!=role['id']:raise Failure('Email или login уже заняты другой записью. Она не изменена.')
            rs=api.rows('rights','user = '+json.dumps(u['id']))
            expected={(payers[p]['id'],'all' if not c else 'client',c) for p,c in s['grants']}
            if {(r['payer'],r['scope'],r['kis_client_id']) for r in rs}!=expected or any(r.get('active') is not True for r in rs):raise Failure('У существующего демо-пользователя другой или неполный набор прав. Автоматическое изменение отменено.')
            if not u.get('active'):raise Failure('Существующий демо-пользователь отключён. Автоматическое включение отменено.')
            s['existing']=True
    for s in scenarios:
        if s.get('existing'): print('ALREADY_EXISTS:',s['email']);continue
        # New user remains inactive until every grant has been saved and verified.
        u=api.create('users',{k:s[k] for k in ['name','email','login']}|{'password':new_password,'passwordConfirm':new_password,'role':role['id'],'role_code':'owner','active':False,'must_change_password':True})
        for pid,cid in s['grants']:
            p=payers[pid];legacy=''
            if cid:
                c=recipients[cid][0];existing=api.rows('clients','id_clt = '+str(cid))
                if existing:
                    lc=only(existing,'Локальный получатель')
                    if lc.get('payer')!=p['id'] or lc.get('active') is not True:raise Failure('Локальный получатель связан иначе или отключён. Новый пользователь остаётся отключённым.')
                else:lc=api.create('clients',{'id_clt':cid,'payer':p['id'],'kod_clt':c['kod'],'name_clt':c['name'],'active':True})
                legacy=lc['id']
            api.create('rights',{'user':u['id'],'payer':p['id'],'scope':'all' if not cid else 'client','kis_client_id':cid,'client':legacy,'active':True})
        rs=api.rows('rights','user = '+json.dumps(u['id']))
        expected={(payers[p]['id'],'all' if not c else 'client',c) for p,c in s['grants']}
        if {(r['payer'],r['scope'],r['kis_client_id']) for r in rs}!=expected:raise Failure('Права не подтверждены. Новый пользователь остаётся отключённым.')
        api.call('/api/collections/users/records/'+u['id'],{'active':True},'PATCH')
        print('DEMO_USER_CREATED:',s['email'],'| при входе обязательная смена пароля')
    api.token='';new_password=None
    print('Демо — только названия учётных записей. Данные покупателей/получателей реальные, из КИС. Заказы не создавались.')
if __name__=='__main__':
    try:main()
    except Failure as e:print('ОСТАНОВЛЕНО:',e,file=sys.stderr);sys.exit(1)
    except KeyboardInterrupt:sys.exit(130)
