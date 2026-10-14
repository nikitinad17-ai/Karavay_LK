"""Integration tests against an isolated PocketBase 0.40.3 and a local KIS stub.
Usage: PB_BINARY=/path/to/pocketbase python3 manager-live/tests/integration.py
No requests to the Karavay VM or actual KIS are made.
"""
import os,json,tempfile,pathlib,subprocess,time,urllib.request,urllib.error,secrets,shutil,socketserver,threading
ROOT=pathlib.Path(__file__).resolve().parents[1]
BINARY=os.environ.get('PB_BINARY','/tmp/karavay-pb-test/pocketbase')
base='http://127.0.0.1:18943'
def request(path,body=None,token='',expect=200):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=20) as r: status=r.status; raw=r.read(); data=json.loads(raw) if raw else {}
 except urllib.error.HTTPError as e: status=e.code;data=json.load(e)
 assert status==expect,(path,status,data)
 return data
with tempfile.TemporaryDirectory(prefix='karavay-manager-integration-') as temp:
 d=pathlib.Path(temp);(d/'bin').mkdir();shutil.copytree(ROOT/'pb_hooks',d/'pb_hooks');shutil.copytree(ROOT/'pb_public',d/'pb_public')
 for hook in (ROOT/'tests/gateway-fixtures').glob('*.pb.js'):shutil.copy2(hook,d/'pb_hooks'/hook.name)
 (d/'bin/curl').write_text('''#!/usr/bin/env python3
import sys,json
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
clients=[{'id':11,'kod':'CL11','name':'Test recipient 11','adres':'Test address'},{'id':12,'kod':'CL12','name':'Test recipient 12','adres':'Test address'}]
if p=='/payers': data=[{'id':i,'kod':'P'+str(i),'name':'New buyer' if i==3 else 'Buyer '+str(i),'adres':'Address'} for i in [1,2,3,4]]
elif p=='/payers/1/clients': data=clients
elif p=='/payers/3/clients': data=[{'id':31,'kod':'CL31','name':'New buyer recipient'}]
elif p=='/payers/4/clients': data=[{'id':41,'kod':'CL41','name':'UI buyer recipient'}]
elif p=='/clients/41': data={'id':41,'payer_id':4,'state':1}
elif p=='/clients/31': data={'id':31,'payer_id':3,'state':1}
elif p=='/payers/2/clients': data=[{'id':21,'kod':'CL21','name':'Foreign recipient'}]
elif p in ['/clients/11','/clients/12']: data={'id':int(p.split('/')[-1]),'payer_id':1,'state':1}
elif p=='/clients/21': data={'id':21,'payer_id':2,'state':1}
else: data=None
raw=json.dumps({'success':data is not None,'data':data})
if p=='/payers': raw=raw.replace('\"adres\":', '\"saldo_calc\":.14,\"adres\":')
print(raw,end='\\n__KIS_HTTP__:200')
''');(d/'bin/curl').chmod(0o755)
 env={**os.environ,'PATH':str(d/'bin')+':'+os.environ['PATH']}
 (d/'pb_hooks/testing.pb.js').write_text("routerAdd('GET','/__test_reset/{id}',e=>e.json(200,{token:e.app.findRecordById('users',e.request.pathValue('id')).newPasswordResetToken()}),$apis.requireAuth('_superusers'));")
 password='Test-'+secrets.token_urlsafe(24);mail='admin@example.test'
 subprocess.run([BINARY,'superuser','upsert',mail,password,'--dir',str(d/'pb_data')],cwd=d,env=env,stdout=subprocess.DEVNULL,check=True)
 log=open(d/'server.log','w+')
 process=subprocess.Popen([BINARY,'serve','--http=127.0.0.1:18943','--dir',str(d/'pb_data'),'--hooksDir',str(d/'pb_hooks'),'--publicDir',str(d/'pb_public')],cwd=d,env=env,stdout=log,stderr=log)
 try:
  for i in range(100):
   try:request('/api/health');break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('PB did not start')
  admin=request('/api/collections/_superusers/auth-with-password',{'identity':mail,'password':password})['token']
  schema=json.load(open(ROOT/'tests/schema.json'))
    # Import returns 204: handle it separately to avoid JSON-decoding empty bodies.
  req=urllib.request.Request(base+'/api/collections/import',data=json.dumps({'collections':schema,'deleteMissing':False}).encode(),headers={'Authorization':admin,'Content-Type':'application/json'},method='PUT')
  try:
   with urllib.request.urlopen(req) as r:assert r.status==204
  except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
  def create(col,body):return request('/api/collections/'+col+'/records',body,admin)['id']
  roles={code:create('roles',{'code_role':code,'name_role':code,'active':True}) for code in ['owner','manager','viewer']}
  def user(login,role='manager',active=True):return create('users',{'name':login,'login':login,'email':login+'@example.test','role':roles[role],'role_code':role,'active':active,'must_change_password':False,'password':password,'passwordConfirm':password})
  mid=user('manager');other=user('other');viewer=user('viewer','viewer');owner=user('buyerowner','owner')
  p1=create('payers',{'id_pay':1,'kod_pay':'P1','name_pay':'Test buyer 1','contact_email':'p1@example.test','active':True})
  p2=create('payers',{'id_pay':2,'kod_pay':'P2','name_pay':'Foreign buyer','contact_email':'p2@example.test','active':True})
  def right(uid,payer,scope='all',kid=0,client=''):return create('rights',{'user':uid,'payer':payer,'scope':scope,'kis_client_id':kid,'client':client,'active':True})
  rid=right(mid,p1);right(other,p2);right(owner,p1)
  def auth(login,pw=password):return request('/api/collections/users/auth-with-password',{'identity':login+'@example.test','password':pw})['token']
  token=auth('manager');vt=auth('viewer');ot=auth('buyerowner');checks=0
  # Exercise the actual grant script against this isolated PocketBase.
  import importlib.util
  spec=importlib.util.spec_from_file_location('manager_grant',ROOT/'scripts/Grant-Manager-Access.py');grantmod=importlib.util.module_from_spec(spec);spec.loader.exec_module(grantmod);grantmod.BASE=base
  grantapi=grantmod.Api();grantapi.token=admin
  grantuser=user('manager_test');granted=grantmod.grant(grantapi,'manager_test','P1');checks+=1
  assert grantmod.grant(grantapi,'manager_test','P1')==granted;checks+=1
  req=urllib.request.Request(base+'/api/collections/rights/records/'+granted,data=json.dumps({'active':False}).encode(),headers={'Authorization':admin,'Content-Type':'application/json'},method='PATCH');urllib.request.urlopen(req).close()
  assert grantmod.grant(grantapi,'manager_test','P1')==granted;checks+=1
  for login,code in [('viewer','P1'),('missing','P1'),('manager_test','missing')]:
   try:grantmod.grant(grantapi,login,code);raise AssertionError('grant unexpectedly succeeded')
   except grantmod.Failure:checks+=1
  def check(path,body=None,t=token,expect=200):
   global checks
   data=request(path,body,t,expect);checks+=1;return data
  check('/service/manager/state',t='',expect=401)
  check('/service/manager/state',t=vt,expect=403)
  check('/service/manager/state',t=ot,expect=403)
  s=check('/service/manager/state');assert [x['id'] for x in s['payers']]==[p1]
  check('/service/manager/directory',t='',expect=401)
  check('/service/manager/directory',t=vt,expect=403)
  directory=check('/service/manager/directory')['buyers'];assert [p['id'] for p in directory]==[1,2,3,4];assert directory[0]['connection']=='assigned' and directory[1]['connection']=='registered'
  check('/service/manager/buyers',t='',expect=401)
  check('/service/manager/buyers',t=vt,expect=403)
  assert [p['id'] for p in check('/service/manager/buyers')['buyers']]==[3,4]
  check('/service/manager/clients?payer='+p2,expect=403)
  assert len(check('/service/manager/clients?payer='+p1)['clients'])==2
  check('/service/manager/action',{'action':'attach_client','payer':p1,'kis_client_id':21},expect=403)
  for kid in [11,12]:check('/service/manager/action',{'action':'attach_client','payer':p1,'kis_client_id':kid})
  rs=[{'payer':p1,'scope':'client','kis_client_id':kid} for kid in [11,12]]
  body={'action':'create_user','name':'New customer','login':'newcustomer','email':'new@example.test','role_code':'viewer','password':password,'rights':rs}
  uid=check('/service/manager/action',body)['id']
  s=check('/service/manager/state');u=next(u for u in s['users'] if u['id']==uid);assert len(u['rights'])==2 and u['must_change_password']
  check('/service/manager/action',{'action':'edit_user','user':uid,'name':'Updated customer','login':'newcustomer','email':'new@example.test','role_code':'owner'})
  check('/service/manager/action',{'action':'toggle_user','user':uid,'active':False})
  check('/service/manager/action',{'action':'toggle_user','user':uid,'active':True})
  check('/service/manager/action',{'action':'set_rights','user':uid,'rights':rs})
  check('/service/manager/action',{'action':'create_payer','id_pay':3,'code':'P3','name':'New buyer','email':'p3@example.test'})
  p3=next(p['id'] for p in check('/service/manager/state')['payers'] if p['id_pay']==3)
  check('/service/manager/action',{'action':'edit_payer','payer':p3,'name':'New buyer edited','email':'p3@example.test','active':False})
  check('/service/manager/action',{'action':'edit_payer','payer':p3,'name':'New buyer edited','email':'p3@example.test','active':True})
  check('/service/manager/action',{**body,'login':'illegal','email':'illegal@example.test','role_code':'manager'},expect=400)
  check('/service/manager/action',{**body,'login':'foreign','email':'foreign@example.test','rights':[{'payer':p2,'scope':'all','kis_client_id':0}]},expect=403)
  check('/service/manager/action',{'action':'toggle_user','user':mid,'active':False},expect=403)
  request('/api/collections/rights/records',{'user':uid,'payer':p2,'scope':'all','kis_client_id':0,'active':False},admin)
  check('/service/manager/action',{'action':'toggle_user','user':uid,'active':False},expect=403)
  check('/service/manager/action',{'action':'create_payer','id_pay':2,'code':'P2','name':'Foreign','email':'p2@example.test'},expect=409)
  check('/service/manager/action',{'action':'create_payer','id_pay':999,'code':'P999','name':'Missing','email':'x@example.test'},expect=409)
  # Real PB token generation and native confirmation exercise the new hook.
  resetuid=user('resetcustomer','viewer');right(resetuid,p1)
  req=urllib.request.Request(base+'/api/collections/users/records/'+resetuid,data=json.dumps({'must_change_password':True}).encode(),headers={'Authorization':admin,'Content-Type':'application/json'},method='PATCH');urllib.request.urlopen(req).close()
  # Local SMTP sink verifies the email path without delivering anything externally.
  delivered=[]
  class SMTP(socketserver.StreamRequestHandler):
   def handle(self):
    self.wfile.write(b'220 localhost test SMTP\r\n');self.wfile.flush()
    while True:
     line=self.rfile.readline()
     if not line:break
     verb=line.split(b' ',1)[0].strip().upper()
     if verb==b'DATA':
      self.wfile.write(b'354 Continue\r\n');self.wfile.flush();body=b''
      while True:
       part=self.rfile.readline()
       if part in [b'.\r\n',b''] :break
       body+=part
      delivered.append(body);response=b'250 accepted\r\n'
     elif verb==b'QUIT':self.wfile.write(b'221 bye\r\n');self.wfile.flush();break
     else:response=b'250 OK\r\n'
     self.wfile.write(response);self.wfile.flush()
  smtp=socketserver.ThreadingTCPServer(('127.0.0.1',0),SMTP);threading.Thread(target=smtp.serve_forever,daemon=True).start()
  settings={'smtp':{'enabled':True,'host':'127.0.0.1','port':smtp.server_address[1],'username':'','password':'','authMethod':'PLAIN','tls':False}}
  req=urllib.request.Request(base+'/api/settings',data=json.dumps(settings).encode(),headers={'Authorization':admin,'Content-Type':'application/json'},method='PATCH');urllib.request.urlopen(req).close()
  check('/service/manager/action',{'action':'reset_password','user':resetuid});assert len(delivered)==1 and b'resetcustomer@example.test' in delivered[0]
  smtp.shutdown();smtp.server_close()
  resetToken=request('/__test_reset/'+resetuid,token=admin)['token']
  check('/api/collections/users/confirm-password-reset',{'token':'invalid','password':password+'reset','passwordConfirm':password+'reset'},t='',expect=400)
  check('/api/collections/users/confirm-password-reset',{'token':resetToken,'password':password+'reset','passwordConfirm':password+'reset'},t='',expect=204)
  resetAuth=request('/api/collections/users/auth-with-password',{'identity':'resetcustomer@example.test','password':password+'reset'});assert resetAuth['record']['must_change_password'] is False
  # DOM integration uses real HTTP requests to the isolated PB (no browser rendering).
  subprocess.run(['node',str(ROOT/'tests/ui.cjs')],input=json.dumps({'url':base,'email':'manager@example.test','password':password}),text=True,check=True,cwd=ROOT.parent)
  newtoken=request('/api/collections/users/auth-with-password' ,{'identity':'new@example.test','password':password})['token']
  check('/service/account/change-password',{'oldPassword':'wrong','password':password+'new'},t=newtoken,expect=403)
  check('/service/account/change-password',{'oldPassword':password,'password':password+'new'},t=newtoken)
  check('/service/manager/state',t=newtoken,expect=401)
  newauth=request('/api/collections/users/auth-with-password',{'identity':'new@example.test','password':password+'new'});assert newauth['record']['must_change_password'] is False
  req=urllib.request.Request(base+'/api/collections/rights/records/'+rid,data=json.dumps({'active':False}).encode(),headers={'Authorization':admin,'Content-Type':'application/json'},method='PATCH');urllib.request.urlopen(req).close()
  assert p1 not in [p['id'] for p in check('/service/manager/state')['payers']]
  check('/service/manager/action',{'action':'edit_payer','payer':p1,'name':'Changed','email':'x@example.test','active':True},expect=403)
  # Client cabinet uses the same users/rights with live KIS recipients.
  ctx=check('/service/context',t=newauth['token']);assert [p['id'] for p in ctx['payers']]==[p1]
  cl=check('/service/clients?payer='+p1,t=newauth['token']);assert [c['id'] for c in cl['clients']]==[11,12]
  check('/service/clients?payer='+p2,t=newauth['token'],expect=403)
  subprocess.run(['node',str(ROOT/'tests/client-ui.cjs')],input=json.dumps({'url':base,'email':'new@example.test','password':password+'new'}),text=True,check=True,cwd=ROOT.parent)
  # Native collection writes remain closed to managers.
  check('/api/collections/payers/records',{'id_pay':7},expect=403)
  check('/api/collections/users/records',{'email':'hijack@example.test'},expect=403)
  print('PASS:',checks,'HTTP integration checks on PocketBase 0.40.3; isolated schema and KIS stub.')
 finally:
  process.terminate();process.wait(timeout=10)
  log.seek(0);logs=log.read();log.close()
  if 'PASS' not in locals() and process.returncode not in (0,-15):print(logs[-3000:])
