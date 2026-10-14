import importlib.util,os,json,pathlib,secrets,shutil,subprocess,tempfile,time,urllib.request,urllib.error,sys
ROOT=pathlib.Path(__file__).resolve().parent
BINARY=os.environ.get('PB_BINARY','/tmp/karavay-pb-test/pocketbase')
BASE='http://127.0.0.1:18945'
def request(path,body=None,token='',method=None,expected=200):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':token} if token else {})})
    try:
        with urllib.request.urlopen(req,timeout=15) as r:status=r.status;raw=r.read();d=json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:status=e.code;d=json.load(e)
    assert status==expected,(path,status,d)
    return d
with tempfile.TemporaryDirectory(prefix='karavay-classic-test-') as temp:
    d=pathlib.Path(temp);shutil.copytree(ROOT/'pb_hooks',d/'pb_hooks');(d/'bin').mkdir()
    (d/'bin/curl').write_text('''#!/usr/bin/env python3
import sys,json
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
if p=='/clients/300183':d={'id':300183,'payer_id':300182,'state':1,'ord_min_sum':1000,'ord_min_sum_flg_nds':1}
elif p=='/clients/299300':d={'id':299300,'payer_id':299271,'state':1}
elif p=='/payers/300182/clients':d=[{'id':300183,'kod':'A12000','name':'Recipient A'}]
elif p=='/payers/299271/clients':d=[{'id':299300,'kod':'A01600','name':'Recipient B'}]
elif p=='/orders/7':d={'id':7,'client_id':300183,'order_number':948,'sum_all':917.4,'private_field':'must not leave server'}
elif p=='/orders/8':d={'id':8,'client_id':299300}
else:d=None
print(json.dumps({'success':True,'data':d}),end='\\n__KIS_HTTP__:200')
''');(d/'bin/curl').chmod(0o755)
    env={**os.environ,'PATH':str(d/'bin')+':'+os.environ['PATH']}
    pw='test-'+secrets.token_urlsafe(24)
    subprocess.run([BINARY,'superuser','upsert','admin@example.test',pw,'--dir',str(d/'data')],cwd=d,env=env,stdout=subprocess.DEVNULL,check=True)
    with open(d/'log','w+') as log:
        proc=subprocess.Popen([BINARY,'serve','--http=127.0.0.1:18945','--dir',str(d/'data'),'--hooksDir',str(d/'pb_hooks')],cwd=d,env=env,stdout=log,stderr=log)
        try:
            for _ in range(80):
                try:request('/api/health');break
                except Exception:time.sleep(.1)
            admin=request('/api/collections/_superusers/auth-with-password',{'identity':'admin@example.test','password':pw})['token']
            request('/api/collections/import',{'collections':json.loads((ROOT/'schema-test.json').read_text()),'deleteMissing':False},admin,'PUT',204)
            def create(col,body):return request('/api/collections/'+col+'/records',body,admin)['id']
            role=create('roles',{'code_role':'owner','name_role':'Owner','active':True})
            u=create('users',{'name':'Isolated tester','email':'test@example.test','login':'testuser','password':pw,'passwordConfirm':pw,'active':True,'role':role,'role_code':'owner','must_change_password':False})
            p1=create('payers',{'id_pay':300182,'kod_pay':'A120','name_pay':'Payer A','active':True})
            p2=create('payers',{'id_pay':299271,'kod_pay':'A016','name_pay':'Payer B','active':True})
            rid=create('rights',{'user':u,'payer':p1,'scope':'all','kis_client_id':0,'active':True})
            token=request('/api/collections/users/auth-with-password',{'identity':'test@example.test','password':pw})['token']
            query='?payer='+p1+'&client=300183'
            request('/service/order-options'+query,expected=401)
            opts=request('/service/order-options'+query,token=token);assert opts['create'] is False and opts['minimumSum']==1000
            result=request('/service/orders/7'+query,token=token);assert result['order']['id']==7 and result['items'] is None and 'private_field' not in result['order']
            request('/service/orders/8'+query,token=token,expected=403)
            request('/service/order-options?payer='+p2+'&client=299300',token=token,expected=403)
            request('/service/order-options'+query+'&extra=1',token=token,expected=400)
            request('/api/collections/roles/records/'+role,{'active':False},admin,'PATCH')
            request('/service/order-options'+query,token=token,expected=403)
            request('/api/collections/roles/records/'+role,{'active':True},admin,'PATCH')
            request('/api/collections/rights/records/'+rid,{'active':False},admin,'PATCH')
            request('/service/orders/7'+query,token=token,expected=403)
            # Exercise the exact seeder twice against real PB; KIS adapter returns isolated stub data.
            spec=importlib.util.spec_from_file_location('seed',ROOT/'scripts/Seed-Demo-Users.py');seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed);seed.PB=BASE
            original=seed.Api.call
            def stub(self,path,body=None,method=None,kis=False):
                if kis:
                    raw=subprocess.check_output([str(d/'bin/curl'),'--url','http://stub/api/v1'+path]).decode().split('\n__KIS_HTTP__')[0]
                    return json.loads(raw)['data']
                return original(self,path,body,method,False)
            seed.Api.call=stub
            import unittest.mock as mock
            for _ in range(2):
                with mock.patch.object(sys.stdin,'isatty',return_value=True),mock.patch('builtins.input',return_value='admin@example.test'),mock.patch.object(seed.getpass,'getpass',return_value=pw),mock.patch.object(sys,'argv',['seed','--apply']):seed.main()
            users=request('/api/collections/users/records?perPage=200',token=admin)['items']
            demos=[v for v in users if '(демо)' in v['name']];assert len(demos)==2 and all(v['active'] and v['must_change_password'] for v in demos)
            rights=request('/api/collections/rights/records?perPage=200',token=admin)['items'];assert sum(r['user'] in {v['id'] for v in demos} for r in rights)==3
            print('PASS: real PocketBase 0.40.3 — auth, foreign order, payer isolation, revoked role/right, fields allowlist; two demo users and idempotent second run')
        finally:
            proc.terminate();proc.wait(timeout=10)
