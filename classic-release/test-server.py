"""Isolated PB 0.40.3 + a local curl stub; never contacts the live KIS/VM."""
import importlib.util,os,json,pathlib,secrets,shutil,subprocess,tempfile,time,urllib.request,urllib.error,sys,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parent
BINARY=os.environ.get('PB_BINARY','/tmp/karavay-pb-test/pocketbase');BASE='http://127.0.0.1:18945'
def request(path,body=None,token='',method=None,expected=200,key=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':token} if token else {}),**({'Idempotency-Key':key} if key else {})})
    try:
        with urllib.request.urlopen(req,timeout=40) as r:status=r.status;raw=r.read();d=json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:status=e.code;d=json.load(e)
    assert status==expected,(path,status,d,expected)
    return d
with tempfile.TemporaryDirectory(prefix='karavay-classic-test-') as temp:
    d=pathlib.Path(temp);shutil.copytree(ROOT/'pb_hooks',d/'pb_hooks');shutil.copytree(ROOT/'pb_migrations',d/'pb_migrations');(d/'bin').mkdir();(d/'mode').write_text('success');(d/'count').write_text('0')
    (d/'bin/curl').write_text('''#!/usr/bin/env python3
import sys,json,pathlib,time,fcntl
root=pathlib.Path(__file__).resolve().parents[1]
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
mode=(root/'mode').read_text();status=200
if '--data-raw' in sys.argv:
 assert p=='/orders' and not any('Authorization' in x for x in sys.argv)
 body=json.loads(sys.argv[sys.argv.index('--data-raw')+1]);assert set(body)=={'Id_clt','DateOrd','Product'}
 assert body['Id_clt']==300183 and set(body['Product'][0])=={'Id_prd','KolSht'}
 with (root/'count').open('r+') as f:
  fcntl.flock(f,fcntl.LOCK_EX);n=int(f.read());f.seek(0);f.write(str(n+1));f.truncate()
 if mode=='timeout':sys.exit(28)
 if mode=='slow':time.sleep(.5)
 if mode=='reject':print(json.dumps({'success':False,'message':'Не задан aId_Clt'}),end='\\n__KIS_HTTP__:400');sys.exit(0)
 (root/'last.json').write_text(json.dumps(body))
 data={'Id_ord':7};status=201
elif p=='/clients/300183':data={'id':300183,'payer_id':300182,'state':1,'ord_min_sum':600,'ord_min_sum_flg_nds':1}
elif p=='/clients/299300':data={'id':299300,'payer_id':299271,'state':1}
elif p=='/payers/300182':data={'id':300182,'kod':'A120','name':'Payer A','state':1}
elif p=='/payers/299271':data={'id':299271,'kod':'A016','name':'Payer B','state':1}
elif p=='/payers/300182/clients':data=[{'id':300183,'kod':'A12000','name':'Recipient A'}]
elif p=='/payers/299271/clients':data=[{'id':299300,'kod':'A01600','name':'Recipient B'}]
elif p.startswith('/clients/300183/matrix?'):
 data=[{'id_prd':425162,'cenaotp':61.16,'kolshtordmin':5}]
 if (root/'lot-only').exists():data[0].update(kolshtordmin=None,kolukl=json.loads((root/'lot-only').read_text()))
elif p=='/clients/300183/orders':data=[{'id':7}]
elif p=='/orders/7':
 data={'id':7,'client_id':300183,'order_number':948,'order_date':'2026-10-03T00:00:00','kol_sht':15,'sum_all':917.4,'create_date':'2026-10-02T14:17:34','state':0,'products':[{'id':425162,'product_kod':'7485','product_name':'Хлеб из КИС','cena_otp':61.16,'kol_sht':15,'kol_vzv':0,'sum_all':917.4}],'private_field':'must not leave server'}
 if (root/'last.json').exists():
  import datetime
  last=json.loads((root/'last.json').read_text());qty=last['Product'][0]['KolSht'];data['products'][0]['kol_sht']=qty;data['kol_sht']=qty;data['order_date']=datetime.datetime.fromtimestamp(last['DateOrd']+10800,datetime.timezone.utc).strftime('%Y-%m-%dT00:00:00')
 if mode=='foreign':data['client_id']=299300
elif p=='/orders/8':data={'id':8,'client_id':299300,'products':[]}
else:data=None
print(json.dumps({'success':True,'data':data}),end='\\n__KIS_HTTP__:'+str(status))
''');(d/'bin/curl').chmod(0o755)
    env={**os.environ,'PATH':str(d/'bin')+':'+os.environ['PATH']};pw='test-'+secrets.token_urlsafe(24)
    subprocess.run([BINARY,'superuser','upsert','admin@example.test',pw,'--dir',str(d/'data'),'--migrationsDir',str(d/'pb_migrations')],cwd=d,env=env,stdout=subprocess.DEVNULL,check=True)
    with open(d/'log','w+') as log:
        proc=subprocess.Popen([BINARY,'serve','--http=127.0.0.1:18945','--dir',str(d/'data'),'--hooksDir',str(d/'pb_hooks'),'--migrationsDir',str(d/'pb_migrations')],cwd=d,env=env,stdout=log,stderr=log)
        try:
            for _ in range(80):
                try:request('/api/health');break
                except Exception:time.sleep(.1)
            admin=request('/api/collections/_superusers/auth-with-password',{'identity':'admin@example.test','password':pw})['token']
            request('/api/collections/import',{'collections':json.loads((ROOT/'schema-test.json').read_text()),'deleteMissing':False},admin,'PUT',204)
            def create(col,body):return request('/api/collections/'+col+'/records',body,admin)['id']
            role=create('roles',{'code_role':'owner','name_role':'Owner','active':True})
            viewer=create('roles',{'code_role':'viewer','name_role':'Viewer','active':True})
            u=create('users',{'name':'Isolated tester','email':'test@example.test','login':'testuser','password':pw,'passwordConfirm':pw,'active':True,'role':role,'role_code':'owner','must_change_password':False})
            p1=create('payers',{'id_pay':300182,'kod_pay':'A120','name_pay':'Payer A','active':True});p2=create('payers',{'id_pay':299271,'kod_pay':'A016','name_pay':'Payer B','active':True})
            rid=create('rights',{'user':u,'payer':p1,'scope':'all','kis_client_id':0,'active':True})
            token=request('/api/collections/users/auth-with-password',{'identity':'test@example.test','password':pw})['token'];q='?payer='+p1+'&client=300183'
            request('/service/order-options'+q,expected=401)
            opts=request('/service/order-options'+q,token=token);assert opts['create'] is True and opts['minimumSum']==600
            result=request('/service/orders/7'+q,token=token);assert result['items'][0]['quantity']==15 and result['items'][0]['price']==61.16 and 'private_field' not in result['order']
            assert request('/service/orders'+q,token=token)['orders'][0]['id']==7
            request('/service/orders/8'+q,token=token,expected=403)
            request('/service/order-options?payer='+p2+'&client=299300',token=token,expected=403)
            request('/service/order-options'+q+'&extra=1',token=token,expected=400)
            tomorrow=(int(time.time()+10800)//86400+1)*86400-10800
            body={'payer':p1,'client':300183,'DateOrd':tomorrow,'Group':1,'products':[{'id':425162,'quantity':15,'price':61.16}]}
            count=lambda:int((d/'count').read_text())
            def post(body=body,key=None,expected=201):return request('/service/orders',body,token,'POST',expected,key or secrets.token_hex(16))
            request('/service/orders',body,expected=401,method='POST');assert count()==0
            for updates,code in [({'price':1},'PRICE_CHANGED'),({'quantity':1},'MINIMUM_QUANTITY'),({'id':1},'PRODUCT_UNAVAILABLE')]:
                b={**body,'products':[{**body['products'][0],**updates}]};assert post(b,expected=400 if code=='MINIMUM_QUANTITY' else 409)['code']==code
            assert count()==0
            (d/'lot-only').write_text('8')
            assert post(expected=400)['code']=='LOT_MULTIPLE'  # 15 pieces is not a whole tray.
            for bad_packing in ('null','0','2.5','-8'):
                (d/'lot-only').write_text(bad_packing)
                assert post(expected=502)['code']=='INVALID_MATRIX'
            (d/'lot-only').unlink()
            assert count()==0
            assert request('/api/collections/lk_order_requests/records?perPage=1',token=admin)['totalItems']==0
            request('/api/collections/users/records/'+u,{'role_code':'viewer','role':viewer},admin,'PATCH');post(expected=403);assert count()==0
            request('/api/collections/users/records/'+u,{'role_code':'owner','role':role},admin,'PATCH')
            key=secrets.token_hex(16);assert post(key=key)['id']==7;assert count()==1;assert post(key=key)['id']==7;assert count()==1
            post(key=key,body={**body,'Group':0},expected=409);assert count()==1
            assert request('/service/order-requests/'+key+q,token=token)['state']=='success'
            # Two tabs with separate keys and identical cart replay the recent result.
            post();assert count()==1
            request('/api/collections/lk_order_requests/records',token=token,expected=403)
            # Ambiguous POST is never repeated, including a new key for the same content.
            (d/'mode').write_text('timeout');b={**body,'products':[{**body['products'][0],'quantity':16}]};key=secrets.token_hex(16)
            assert post(b,key,503)['code']=='SUBMISSION_UNKNOWN';assert count()==2
            proc.terminate();proc.wait(timeout=10)
            proc=subprocess.Popen([BINARY,'serve','--http=127.0.0.1:18945','--dir',str(d/'data'),'--hooksDir',str(d/'pb_hooks'),'--migrationsDir',str(d/'pb_migrations')],cwd=d,env=env,stdout=log,stderr=log)
            for _ in range(80):
                try:request('/api/health');break
                except Exception:time.sleep(.1)
            post(b,key,409);post(b,expected=409);assert count()==2
            assert request('/service/order-requests/'+key+q,token=token)['state']=='unknown'
            (d/'mode').write_text('reject');b={**body,'products':[{**body['products'][0],'quantity':17}]};key=secrets.token_hex(16)
            assert post(b,key,502)['code']=='KIS_CONTRACT_MISMATCH';post(b,key,502);assert count()==3
            assert request('/service/order-requests/'+key+q,token=token)['state']=='rejected'
            (d/'mode').write_text('foreign');b={**body,'products':[{**body['products'][0],'quantity':18}]};assert post(b,expected=503)['code']=='SUBMISSION_UNKNOWN'
            (d/'mode').write_text('slow');b={**body,'products':[{**body['products'][0],'quantity':19}]};before=count()
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                a=pool.submit(post,b,secrets.token_hex(16));time.sleep(.1);c=pool.submit(post,b,secrets.token_hex(16),409);a.result();c.result()
            assert count()==before+1
            (d/'lot-only').write_text('8');before=count()
            b={**body,'products':[{**body['products'][0],'quantity':24}]}
            post(b);assert count()==before+1
            assert json.loads((d/'last.json').read_text())['Product']==[{'Id_prd':425162,'KolSht':24}]
            (d/'lot-only').unlink()
            request('/api/collections/roles/records/'+role,{'active':False},admin,'PATCH');request('/service/order-options'+q,token=token,expected=403)
            request('/api/collections/roles/records/'+role,{'active':True},admin,'PATCH')
            request('/api/collections/rights/records/'+rid,{'active':False},admin,'PATCH');request('/service/orders/7'+q,token=token,expected=403)
            request('/api/collections/payers/records/'+p2,token=admin,method='DELETE',expected=204)
            # Provisioning is exercised against the real local PB; only KIS is stubbed.
            spec=importlib.util.spec_from_file_location('seed',ROOT/'scripts/Seed-Demo-Users.py');seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed);seed.PB=BASE;original=seed.Api.call
            seed.STATE=d/'demo-plan.json'
            # Test fixtures are deliberately NOT the two earlier KIS examples.
            buyers=[{'id':300182,'name':'ПРОМТЕХСБЫТ'}, {'id':299271,'name':'НЕВА-М'},
                    {'id':700001,'name':'ООО ПРОМТЕХСБЫТ филиал'},
                    {'id':700050,'kod':'FIX0','name':'Inactive fixture','state':0},
                    {'id':700101,'kod':'FIX1','name':'Fixture buyer one','state':1},
                    {'id':700201,'kod':'FIX2','name':'Fixture buyer two','state':1}]
            points={700101:[{'id':700102,'payer_id':700101,'kod':'FIX100','name':'Fixture point one','state':1}],
                    700201:[{'id':700202,'payer_id':700201,'kod':'FIX200','name':'Fixture point two','state':1},
                            {'id':700203,'payer_id':700201,'kod':'FIX201','name':'Fixture point three','state':1}]}
            calls=[];interrupt=[False]
            def stub(self,path,body=None,method=None,kis=False):
                calls.append((kis,path,method))
                if kis:
                    assert body is None and method in (None,'GET')
                    assert path not in ['/payers/300182','/payers/299271','/payers/700001']
                    if path=='/payers':return buyers
                    parts=path.strip('/').split('/');num=int(parts[1])
                    if parts[0]=='payers':return points.get(num,[]) if len(parts)==3 else next(v for v in buyers if v['id']==num)
                    if parts[0]=='clients':return next(p for group in points.values() for p in group if p['id']==num)
                    raise AssertionError(path)
                if interrupt[0] and path=='/api/collections/rights/records' and method=='POST':
                    interrupt[0]=False
                    raise seed.Failure('Simulated lost connection before grant')
                return original(self,path,body,method,False)
            seed.Api.call=stub
            import unittest.mock as mock
            api=seed.Api();api.token=admin
            seed.run(api,False)
            assert not seed.STATE.exists() and not any(method in ('POST','PATCH','DELETE') for _,_,method in calls)
            full=buyers[:];buyers[:]=buyers[:3]
            try:seed.run(api,True);raise AssertionError('Excluded buyers selected')
            except seed.Failure:pass
            buyers[:]=full
            # Partly provisioned accounts remain inactive and can resume the exact saved plan.
            interrupt[0]=True
            with mock.patch.object(seed.getpass,'getpass',return_value=pw):
                try:seed.run(api,True);raise AssertionError('Expected interrupted provisioning')
                except seed.Failure:pass
            plan=json.loads(seed.STATE.read_text());assert plan['payers']==[700201,700101] and plan['client']==700202
            first=request('/api/collections/users/records/'+plan['users'][0]['id'],token=admin)
            assert first['active'] is False and not plan['users'][0]['done']
            with mock.patch.object(seed.getpass,'getpass',return_value=pw):seed.run(api,True)
            plan=json.loads(seed.STATE.read_text());assert all(v['done'] for v in plan['users'])
            snapshot=lambda:{col:request('/api/collections/'+col+'/records?perPage=200',token=admin)['items'] for col in ('users','payers','clients','rights')}
            before=snapshot()
            with mock.patch.object(seed.getpass,'getpass',side_effect=AssertionError('Rerun must not ask/reset passwords')):seed.run(api,True)
            assert snapshot()==before and pw not in seed.STATE.read_text()
            demos=[v for v in before['users'] if '(демо)' in v['name']];assert len(demos)==2 and all(v['active'] and v['must_change_password'] for v in demos)
            multi=next(v for v in demos if v['email']==seed.ACCOUNTS[0]['email']);point=next(v for v in demos if v['email']==seed.ACCOUNTS[1]['email'])
            multi_rights=[v for v in before['rights'] if v['user']==multi['id']];point_rights=[v for v in before['rights'] if v['user']==point['id']]
            assert len(multi_rights)==2 and all(v['scope']=='all' and v['kis_client_id']==0 for v in multi_rights)
            assert len(point_rights)==1 and point_rights[0]['scope']=='client' and point_rights[0]['kis_client_id']==700202 and point_rights[0]['client']
            mapped={p['id']:p['id_pay'] for p in before['payers']}
            assert {mapped[r['payer']] for r in multi_rights}=={700101,700201}
            request('/api/collections/users/auth-with-password',{'identity':seed.ACCOUNTS[0]['email'],'password':pw})
            # Do not turn on an account disabled after successful provisioning.
            request('/api/collections/users/records/'+point['id'],{'active':False},admin,'PATCH')
            before=snapshot()
            try:seed.run(api,True);raise AssertionError('Disabled account reactivated')
            except seed.Failure:pass
            assert snapshot()==before
            print('PASS: actual PB 0.40.3 + stub KIS: details/list, rights/role isolation, exact POST, prices/minimums, idempotency/restart-persistent journal, concurrency, timeout/rejection, demo accounts')
        except Exception:
            log.flush();log.seek(0);print(log.read()[-6000:]);raise
        finally:proc.terminate();proc.wait(timeout=10)
