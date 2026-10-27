"""Full 0.8 setup on isolated PB 0.40.3 + fixture KIS, with optional Chromium.
Never contacts the VM. No KIS writes. All generated credentials are temporary.
"""
import base64
import hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('workspace_setup',ROOT/'scripts/Configure-Workspace.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
quick=setup.quick;seed=quick.seed
BASE='http://127.0.0.1:18947'
BINARY=os.environ['PB_BINARY']

def call(path,body=None,token='',method=None,expected=200,headers=None):
 req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':token} if token else {}),**(headers or {})})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:status=response.status;raw=response.read()
 except urllib.error.HTTPError as error:status=error.code;raw=error.read()
 assert status==expected,(path,status,raw)
 return json.loads(raw) if raw else {}

with tempfile.TemporaryDirectory(prefix='manager-workspace-08-') as temp:
 folder=Path(temp);hooks=folder/'hooks';public=folder/'public';bindir=folder/'bin'
 for p in (hooks,public,bindir):p.mkdir()
 for source in [*(ROOT/'pb_hooks').glob('*'),*(ROOT/'tests/gateway-fixtures').glob('*.pb.js')]:shutil.copy2(source,hooks/source.name)
 shutil.copytree(ROOT/'pb_public/manager',public/'manager')
 # A controlled standalone client shell exercises provisioning/CSP while the
 # complete manager UI is used verbatim. Client 3.8 UI is tested in its branch.
 client='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; connect-src \'self\'; style-src \'unsafe-inline\'"></head><body><h1>Fixture client</h1></body></html>'
 (public/'index.html').write_text(client);quick.CLIENT_SHA=hashlib.sha256(client.encode()).hexdigest()
 buyers=[{'id':i,'kod':'P'+str(i),'name':name,'state':1} for i,name in [(22,'Fixture buyer 22'),(23,'Fixture buyer 23'),(4,'Fixture available buyer'),(5,'Fixture foreign buyer')]]
 docs={'/payers':buyers}
 for p,ids in [(buyers[0],[2201,2202]),(buyers[1],[2301,2302]),(buyers[2],[41]),(buyers[3],[51])]:
  pid=p['id'];docs['/payers/'+str(pid)]=p;points=[]
  for cid in ids:
   point={'id':cid,'payer_id':pid,'state':1,'kod':'C'+str(cid),'name':'Fixture point '+str(cid),'adres':'Fixture address'}
   points.append(point);docs['/clients/'+str(cid)]=point
  docs['/payers/'+str(pid)+'/clients']=points
 (folder/'kis.json').write_text(json.dumps(docs))
 (bindir/'curl').write_text('''#!/usr/bin/env python3
import json,pathlib,sys
assert '--data-raw' not in sys.argv and '-X' not in sys.argv
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
print(json.dumps({'success':True,'data':json.loads((pathlib.Path(__file__).resolve().parents[1]/'kis.json').read_text())[p]}),end='\\n__KIS_HTTP__:200')
''');(bindir/'curl').chmod(0o755)
 class Kis(BaseHTTPRequestHandler):
  def do_GET(self):
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'success':True,'data':docs[self.path]}).encode())
  def do_POST(self):raise AssertionError('KIS writes forbidden')
  def log_message(self,*_):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Kis);threading.Thread(target=server.serve_forever,daemon=True).start()
 seed.PB=BASE;seed.KIS='http://127.0.0.1:'+str(server.server_address[1])
 password='fixture-'+secrets.token_urlsafe(24)
 env=dict(os.environ,PATH=str(bindir)+':'+os.environ['PATH'])
 subprocess.run([BINARY,'superuser','upsert','admin@example.test',password,'--dir',str(folder/'data')],check=True,stdout=subprocess.DEVNULL)
 with (folder/'pb.log').open('w') as log:
  process=subprocess.Popen([BINARY,'serve','--http=127.0.0.1:18947','--dir',str(folder/'data'),'--hooksDir',str(hooks),'--publicDir',str(public)],env=env,stdout=log,stderr=log)
  try:
   for _ in range(100):
    try:call('/api/health');break
    except (urllib.error.URLError,ConnectionError):time.sleep(.1)
   admin=call('/api/collections/_superusers/auth-with-password',{'identity':'admin@example.test','password':password})['token']
   schema=json.loads((ROOT/'tests/schema.json').read_text());schema[0]['fields'].append({'name':'manager_owner','type':'relation','collectionId':schema[0]['id'],'maxSelect':1,'required':False,'hidden':True})
   call('/api/collections/import',{'collections':schema,'deleteMissing':False},admin,'PUT',204)
   api=seed.Api();api.token=admin
   roles={code:api.create('roles',{'code_role':code,'name_role':code,'active':True})['id'] for code in ['manager','owner','viewer']}
   user=lambda login,name,code='manager':api.create('users',{'name':name,'login':login,'email':login+'@example.test','role':roles[code],'role_code':code,'active':True,'must_change_password':False,'password':password,'passwordConfirm':password})['id']
   mid=user('real_manager','Менеджер Каравай');other=user('other_manager','Other manager');buyer_user=user('buyer_user','Buyer user','owner')
   foreign=api.create('payers',{'id_pay':5,'kod_pay':'P5','name_pay':'Fixture foreign buyer','active':True})['id']
   api.create('rights',{'user':other,'payer':foreign,'scope':'all','kis_client_id':0,'client':'','active':True})
   snap=lambda:{c:api.rows(c,'') for c in ['users','rights','payers','clients']}
   before=snap();report=setup.configure(api,False,output_dir=folder,public_url=BASE,payer_ids=(22,23),client_id=2201)
   assert report['status']=='read_only' and before==snap() and not (folder/'Karavay-Manager-Access.html').exists()
   report=setup.configure(api,True,output_dir=folder,public_url=BASE,payer_ids=(22,23),client_id=2201)
   assert report['demo']=='ready' and report['manager']['id']==mid
   original_quick_state=quick.STATE;quick.STATE=folder/'.karavay-quick-users-20261016.json'
   plan=quick.load_plan();quick.STATE=original_quick_state
   users=api.rows('users','manager_owner = '+json.dumps(mid));assert len(users)==3
   token=call('/api/collections/users/auth-with-password',{'identity':'real_manager@example.test','password':password})['token']
   state=call('/service/manager/state',token=token)
   assert state['version']=='0.9.0' and state['manager']['email']=='real_manager@example.test' and len(state['users'])==3
   assert foreign not in {p['id'] for p in state['payers']}
   diag_spec=importlib.util.spec_from_file_location('manager_diagnostic',ROOT/'scripts/Check-Manager.py');diag=importlib.util.module_from_spec(diag_spec);diag_spec.loader.exec_module(diag)
   diagnostic_root=folder/'diagnostic';diagnostic_root.mkdir()
   for name,target in [('pb_data',folder/'data'),('pb_public',public),('pb_hooks',hooks)]:
    (diagnostic_root/name).symlink_to(target,target_is_directory=True)
   # The production diagnostic uses fixed loopback port 8090; redirect only its
   # read-only opener in this isolated test, keeping actual PB HTTP and SQLite.
   original_opener=diag.urllib.request.build_opener
   class DiagnosticOpener:
    def open(self,url,**options):return original_opener(urllib.request.ProxyHandler({})).open(url.replace('http://127.0.0.1:8090',BASE),**options)
   from unittest import mock
   diagnostic_before=snap()
   with mock.patch.object(diag.urllib.request,'build_opener',return_value=DiagnosticOpener()):diagnostic=diag.inspect(diagnostic_root,ROOT)
   assert diagnostic_before==snap() and diagnostic['demo_user_count']==3 and diagnostic['managers'][0]['status']=='configuration_ok_password_not_tested'
   assert password not in json.dumps(diagnostic) and admin not in json.dumps(diagnostic)
   # The public button is absent until the local operator explicitly enables it.
   test_spec=importlib.util.spec_from_file_location('test_entry',ROOT/'scripts/Enable-Test-Login.py');test_entry=importlib.util.module_from_spec(test_spec);test_spec.loader.exec_module(test_entry)
   assert call('/service/manager/test-login')['enabled'] is False
   call('/service/manager/test-login',{},expected=404)
   test_before=snap();test_entry.toggle(diagnostic_root,None,BASE,BASE);assert snap()==test_before
   test_entry.toggle(diagnostic_root,True,BASE,BASE)
   assert snap()==test_before and (folder/'data/manager-test-login.json').stat().st_mode&0o777==0o600
   status=call('/service/manager/test-login');assert status['enabled'] is True and 'token' not in status and 'email' not in status
   call('/service/manager/test-login',{},expected=403)
   call('/service/manager/test-login',{},expected=403,headers={'Origin':'http://foreign.example.test'})
   call('/service/manager/test-login',{},expected=403,headers={'Origin':'null'})
   call('/service/manager/test-login?manager=other',{},expected=400,headers={'Origin':BASE})
   call('/service/manager/test-login',{'manager_id':other},expected=400,headers={'Origin':BASE})
   test_auth=call('/service/manager/test-login',{},headers={'Origin':BASE});assert test_auth['record']['id']==mid and 'password' not in test_auth['record'] and 'tokenKey' not in test_auth['record']
   claims=json.loads(base64.urlsafe_b64decode(test_auth['token'].split('.')[1]+'=='));assert claims['refreshable'] is False and 28790<=claims['exp']-int(time.time())<=28800
   assert call('/service/manager/state',token=test_auth['token'])['manager']['id']==mid and snap()==test_before
   for collection,key,change in [('users',mid,{'active':False}),('users',mid,{'must_change_password':True}),('roles',roles['manager'],{'active':False})]:
    old=api.call('/api/collections/'+collection+'/records/'+key)
    api.call('/api/collections/'+collection+'/records/'+key,change,'PATCH')
    assert call('/service/manager/test-login')['enabled'] is False
    call('/service/manager/test-login',{},expected=403,headers={'Origin':BASE})
    api.call('/api/collections/'+collection+'/records/'+key,{name:old[name] for name in change},'PATCH')
   config=folder/'data/manager-test-login.json';settings=config.read_bytes();config.write_text('{bad json')
   assert call('/service/manager/test-login')['enabled'] is False
   call('/service/manager/test-login',{},expected=404,headers={'Origin':BASE});config.write_bytes(settings)
   wrong_user=json.loads(settings);wrong_user['manager_id']=buyer_user;config.write_text(json.dumps(wrong_user))
   assert call('/service/manager/test-login')['enabled'] is False
   call('/service/manager/test-login',{},expected=403,headers={'Origin':BASE});config.write_bytes(settings)
   ready=snap();setup.configure(api,True,output_dir=folder,public_url=BASE,payer_ids=(22,23),client_id=2201);assert ready==snap()
   for filename in ['Karavay-Manager-Access.html','Karavay-Test-Login.html','Karavay-Manager-Setup-Report.json']:
    p=folder/filename;assert p.stat().st_mode&0o777==0o600
    text=p.read_text();assert password not in text and admin not in text
    if filename.endswith('.html'):
     for script in re.findall(r'<script[^>]*>(.*?)</script>',text,re.S):
      digest=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode();assert 'sha256-'+digest in text
   for account,expected in zip([s|a for s,a in zip(quick.account_specs(mid),plan['accounts'])],quick.grants(plan)):
    quick.verify_login(api,account,expected)
   if os.environ.get('MANAGER_CHROME'):
    subprocess.run(['node',str(ROOT/'tests/browser.cjs')],input=json.dumps({'url':BASE,'email':'real_manager@example.test','buyer_email':'buyer_user@example.test','password':password,'private_file':str(folder/'Karavay-Manager-Access.html')}),text=True,check=True,env=env,cwd=ROOT.parent)
   test_entry.toggle(diagnostic_root,False,BASE,BASE)
   assert call('/service/manager/test-login')['enabled'] is False
   call('/service/manager/test-login',{},expected=404,headers={'Origin':BASE})
   assert call('/api/collections/users/auth-with-password',{'identity':'real_manager@example.test','password':password})['record']['id']==mid
   print('PASS: public test button defaults off, fixed manager/empty input, same-origin only, real static token/8h, inactive/role/password guards, config disable, unchanged passwords/rights.')
   api.call('/api/collections/users/records/'+plan['accounts'][0]['id'],{'active':False},'PATCH')
   disabled=snap()
   try:setup.configure(api,True,output_dir=folder,public_url=BASE,payer_ids=(22,23),client_id=2201);raise AssertionError('Disabled demo unexpectedly enabled')
   except setup.Failure as error:assert 'отключён' in str(error)
   assert disabled==snap()
   assert json.loads((folder/'Karavay-Manager-Setup-Report.json').read_text())['demo']=='not_ready'
   print('PASS: PB 0.40.3 workspace setup: real manager authorization, unchanged password, explicit KIS fixture 22/23, three demo logins/isolation, no duplicates, no foreign scope, private CSP/files, disabled guard, partial-result report.')
  finally:
   process.terminate();process.wait(timeout=10);server.shutdown()
