"""Disposable PocketBase integration test. Never pass an existing data directory.
Run: POCKETBASE_BIN=/absolute/path/pocketbase python3 tests/gateway/runtime.py
KIS is replaced by a local curl stub. No network call to the real KIS occurs.
"""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError
ROOT = pathlib.Path(__file__).resolve().parents[2]
PB = pathlib.Path(os.environ['POCKETBASE_BIN']).resolve()
opener = build_opener(ProxyHandler({}))
with tempfile.TemporaryDirectory(prefix='karavay-catalog-test-') as directory:
    d = pathlib.Path(directory)
    shutil.copytree(ROOT/'pb_hooks', d/'pb_hooks')
    shutil.copy(ROOT/'tests/gateway/fixture.pb.js.txt', d/'pb_hooks/fixture.pb.js')
    (d/'bin').mkdir()
    (d/'mode').write_text('ok')
    stub = '''#!/usr/bin/env python3
import json,sys,pathlib
p=pathlib.Path(__file__).resolve().parents[1]
with (p/'calls').open('a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
mode=(p/'mode').read_text()
if mode=='timeout':sys.exit(28)
if mode=='denied':print('private\\n403',end='');sys.exit(0)
if mode=='bad':print('invalid json\\n200',end='');sys.exit(0)
print(json.dumps({'id_clt':20,'DateOrd':1791493200,'Group':0,'Product':[{'id_prd':1,'KodProd':'01','NameProd':'Bread','KolUkl':12,'CenaOTP':25,'Group':0,'secret':'hidden'}]})+'\\n200',end='')
'''
    (d/'bin/curl').write_text(stub)
    (d/'bin/curl').chmod(0o755)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    env={**os.environ,'PATH':str(d/'bin')+os.pathsep+os.environ['PATH']}
    log=(d/'runtime.log').open('w')
    proc=subprocess.Popen([str(PB),'serve','--http='+f'127.0.0.1:{port}','--dir='+str(d/'data'),'--hooksDir='+str(d/'pb_hooks')],env=env,stdout=log,stderr=log)
    def request(path, token=None, data=None):
        headers={}
        if token:headers['Authorization']=token
        if data is not None:headers['Content-Type']='application/json'
        req=Request(base+path,headers=headers,data=None if data is None else json.dumps(data).encode())
        try:
            with opener.open(req,timeout=15) as r:return r.status,json.load(r),r.headers
        except HTTPError as e:return e.code,json.load(e),e.headers
    try:
        for _ in range(100):
            try: request('/api/health');break
            except URLError:time.sleep(.1)
        else:raise AssertionError('PocketBase did not start: '+(d/'runtime.log').read_text()[-2000:])
        path='/service/catalog?client=ccccccccccccccc&DateOrd=1791493200&Group=0'
        assert request(path)[0]==401
        assert request(path,'invalid-token')[0]==401
        assert not (d/'calls').exists()
        status,auth,_=request('/api/collections/users/auth-with-password',data={'identity':'fixture@example.test','password':'fixture-password-ONLY'})
        assert status==200,auth
        token=auth['token']
        status,result,headers=request(path,token)
        assert status==200,(status,result)
        assert result['Product'][0]['NameProd']=='Bread'
        assert 'secret' not in result['Product'][0]
        assert headers['Cache-Control']=='no-store'
        def calls():return len((d/'calls').read_text().splitlines())
        count=calls()
        assert request(path.replace('ccccccccccccccc','ooooooooooooooo'),token)[0]==403
        assert calls()==count
        assert request(path+'&client=ooooooooooooooo',token)[0]==400
        for collection in ['rights','users','roles','payers','clients']:
            request('/fixture/'+collection+'/active/false',data={})
            assert request(path,token)[0]==403,collection
            assert calls()==count
            request('/fixture/'+collection+'/active/true',data={})
        for mode,expected in [('timeout',504),('denied',502),('bad',502)]:
            (d/'mode').write_text(mode)
            status,result,_=request(path,token)
            assert status==expected,(mode,status,result)
            assert 'serv15db' not in json.dumps(result) and 'private' not in json.dumps(result)
        print('PocketBase runtime: PASS (auth 401, foreign client 403, duplicate query 400, 5 inactive/revoked links 403, catalog 200, timeout 504, upstream 403/invalid JSON 502). KIS stub only.')
    finally:
        proc.terminate();proc.wait(timeout=10);log.close()
