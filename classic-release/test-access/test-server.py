"""Real PB 0.40.3 and real client; KIS transport is an isolated fixture, never the VM."""
import importlib.util, json, os, pathlib, secrets, shutil, subprocess, tempfile, time, urllib.error, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
BASE = 'http://127.0.0.1:18947'
BINARY = os.environ['PB_BINARY']
spec = importlib.util.spec_from_file_location('setup', HERE / 'install-test.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)

def call(path, body=None, token='', method=None, expected=200, headers=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    data = json.loads(raw) if raw else {}
    assert status == expected, (path, status, data)
    return data

with tempfile.TemporaryDirectory(prefix='karavay-test-access-') as temp:
    d = pathlib.Path(temp)
    for name in ('pb_hooks', 'pb_migrations', 'pb_public', 'bin'): (d / name).mkdir()
    for source in (ROOT / 'pb_hooks').glob('*.js'): shutil.copy2(source, d / 'pb_hooks' / source.name)
    for source in (REPO / 'manager-live/tests/gateway-fixtures').glob('*.pb.js'): shutil.copy2(source, d / 'pb_hooks' / source.name)
    shutil.copy2(HERE / 'catalog-fixture.pb.js', d / 'pb_hooks/karavay-catalog.pb.js')
    shutil.copy2(ROOT / 'pb_public/index.html', d / 'pb_public/index.html')
    shutil.copy2(ROOT / 'pb_migrations/1792000000_classic_order_requests.js', d / 'pb_migrations')
    docs = {}
    for kid, name, clients in ((2, 'ОАО"Каравай"', [2, 234243]), (3, 'АО "ПАЛЯНИЦА"', [384786, 385317])):
        docs['/payers/' + str(kid)] = {'id': kid, 'kod': '000' + str(kid + 4), 'name': name, 'state': 1}
        points = []
        for cid in clients:
            point = {'id': cid, 'kod': 'C' + str(cid), 'name': name + ' · ' + str(cid), 'adres': 'Адрес КИС', 'payer_id': kid, 'state': 1, 'ord_min_sum': 200, 'ord_min_sum_flg_nds': 1}
            points.append(point); docs['/clients/' + str(cid)] = point
        docs['/payers/' + str(kid) + '/clients'] = points
    (d / 'kis.json').write_text(json.dumps(docs))
    (d / 'bin/curl').write_text('''#!/usr/bin/env python3
import datetime,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
docs=json.loads((root/'kis.json').read_text());status=200
last=root/'last.json'
if '--data-raw' in sys.argv:
 assert p=='/orders' and not any('Authorization' in x for x in sys.argv)
 body=json.loads(sys.argv[sys.argv.index('--data-raw')+1]);assert set(body)=={'Id_clt','DateOrd','Product'}
 assert body['Id_clt']==2 and body['Product']==[{'Id_prd':66,'KolSht':8}]
 assert not last.exists(),'duplicate KIS POST'
 last.write_text(json.dumps(body));data={'Id_ord':7};status=201
elif '/matrix?' in p:data=[{'id_prd':66,'kod_prod':'1263','nameprod':'Хлеб из КИС','vesprod':.5,'srok':72,'kolukl':8,'cenaotp':34.9,'basecenaotp':40,'procskd':0,'kolshtordmin':4}]
elif p.endswith('/orders'):data=[{'id':7}] if last.exists() else []
elif p=='/orders/7':
 b=json.loads(last.read_text());data={'id':7,'client_id':2,'order_number':948,'order_date':datetime.datetime.fromtimestamp(b['DateOrd']+10800,datetime.timezone.utc).strftime('%Y-%m-%dT00:00:00'),'create_date':b['DateOrd'],'kol_sht':8,'sum_all':279.2,'state':0,'products':[{'id':66,'product_kod':'1263','product_name':'Хлеб из КИС','kol_sht':8,'cena_otp':34.9,'sum_all':279.2}]}
else:data=docs[p]
print(json.dumps({'success':True,'data':data}),end='\\n__KIS_HTTP__:'+str(status))
''')
    (d / 'bin/curl').chmod(0o755)
    env = {**os.environ, 'PATH': str(d / 'bin') + ':' + os.environ['PATH']}
    password = secrets.token_urlsafe(30)
    subprocess.run([BINARY, 'superuser', 'upsert', 'admin@example.test', password, '--dir', str(d / 'pb_data'), '--migrationsDir', str(d / 'pb_migrations')], check=True, stdout=subprocess.DEVNULL)
    with (d / 'log').open('w+') as log:
        def start():
            proc = subprocess.Popen([BINARY, 'serve', '--http=127.0.0.1:18947', '--dir', str(d / 'pb_data'), '--hooksDir', str(d / 'pb_hooks'), '--publicDir', str(d / 'pb_public'), '--migrationsDir', str(d / 'pb_migrations')], env=env, stdout=log, stderr=log)
            for _ in range(100):
                try: call('/api/health'); return proc
                except Exception:
                    if proc.poll() is not None:
                        log.seek(0); raise AssertionError(log.read())
                    time.sleep(.1)
            raise AssertionError('PB did not start')
        proc = start()
        try:
            call('/service/test-access', expected=404)
            admin = call('/api/collections/_superusers/auth-with-password', {'identity':'admin@example.test', 'password':password})['token']
            schema = json.loads((ROOT / 'schema-test.json').read_text())
            schema[0]['fields'].append({'name':'manager_owner','type':'relation','collectionId':schema[0]['id'],'maxSelect':1})
            call('/api/collections/import', {'collections':schema,'deleteMissing':False}, admin, 'PUT', 204)
            owner = call('/api/collections/roles/records', {'code_role':'owner','name_role':'Owner','active':True}, admin, expected=200)['id']
            manager_role = call('/api/collections/roles/records', {'code_role':'manager','name_role':'Manager','active':True}, admin)['id']
            manager = call('/api/collections/users/records', {'name':'Менеджер Каравай','login':'manager','email':'extra.letters@example.test','password':password,'passwordConfirm':password,'role':manager_role,'role_code':'manager','active':True}, admin)['id']
            # Same setup code used by the VM installer; KIS reads only are substituted here.
            class Kis:
                def call(self, path, **kw):
                    assert kw == {'kis':True}; return docs[path]
            config = setup.plan(d, Kis())
            assert config['managerOwner'] == manager
            proc.terminate(); proc.wait(timeout=10)
            (d / 'pb_data/karavay-test-access.json').write_text(json.dumps(config))
            shutil.copy2(HERE / setup.MIGRATION, d / 'pb_migrations')
            proc = start()
            accounts = call('/service/test-access')['accounts']
            assert len(accounts) == 3
            assert password not in json.dumps(accounts) and all('password' not in a for a in accounts)
            call('/service/test-access', {'id':manager}, expected=403)
            call('/service/test-access', {'id':accounts[0]['id'], 'email':'x'}, expected=400)
            call('/service/test-access', {'id':accounts[0]['id']}, expected=403, headers={'Origin':'https://foreign.example'})
            auth = call('/service/test-access', {'id':accounts[0]['id']}); token = auth['token']
            assert auth['record']['must_change_password'] is False
            assert call('/api/collections/users/auth-refresh', {}, token)['record']['id'] == accounts[0]['id']
            p1, p2 = [p['id'] for p in config['payers']]
            assert len(call('/service/context', token=token)['payers']) == 1
            assert [c['id'] for c in call('/service/clients?payer='+p1+'&perPage=20', token=token)['clients']] == [2]
            call('/service/clients?payer='+p2+'&perPage=20', token=token, expected=403)
            call('/service/order-options?payer='+p1+'&client=234243', token=token, expected=403)
            for i, a in enumerate(accounts):
                t = call('/service/test-access', {'id':a['id']})['token']
                assert len(call('/service/context', token=t)['payers']) == (2 if i == 2 else 1)
            if os.environ.get('QUICK_CHROME'):
                subprocess.run(['node', str(HERE / 'test-browser.cjs'), BASE, json.dumps(config)], check=True, env=env)
            # Disabled account, right, role and payer cannot use passwordless access.
            first = config['accounts'][0]
            for collection, rid, field in [('users',first['id'],'active'), ('users',first['id'],'must_change_password'), ('rights',first['rights'][0],'active'), ('roles',owner,'active'), ('payers',p1,'active')]:
                off = field == 'must_change_password'
                call('/api/collections/'+collection+'/records/'+rid, {field:off}, admin, 'PATCH')
                call('/service/test-access', {'id':first['id']}, expected=403)
                assert first['id'] not in {a['id'] for a in call('/service/test-access')['accounts']}
                call('/api/collections/'+collection+'/records/'+rid, {field:not off}, admin, 'PATCH')
            # Reboot and installer repeat preserve users, passwords and rights.
            before = {c:call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] for c in ('users','rights','payers','clients')}
            assert setup.plan(d, Kis()) == config
            proc.terminate(); proc.wait(timeout=10); proc = start()
            after = {c:call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] for c in before}
            assert before == after
            # Exercise the actual deployment/rollback code with a real PB process.
            # Only systemctl and the private VM address are substituted.
            setup.PB_BASE = BASE
            setup.base.health = lambda: call('/api/health')
            running = [proc]
            def systemctl(*args):
                assert args[:1] == ('systemctl',)
                if args[1] == 'stop': running[0].terminate(); running[0].wait(timeout=10)
                elif args[1] == 'start': running[0] = start()
                else: raise AssertionError(args)
            setup.base.run = systemctl
            (d / 'backups').mkdir()
            manifest = json.loads((ROOT / 'MANIFEST.json').read_text())
            try:
                setup.deploy(d, config, manifest, d / 'backups')
                # A failed update restores the exact preceding client and retains orders.
                previous = (d / 'pb_public/index.html').read_bytes() + b'<!--previous-->'
                (d / 'pb_public/index.html').write_bytes(previous)
                verify = setup.verify
                setup.verify = lambda *_: (_ for _ in ()).throw(RuntimeError('fixture post-install failure'))
                try:
                    setup.deploy(d, config, manifest, d / 'backups')
                    raise AssertionError('Expected rollback')
                except RuntimeError as error:
                    assert 'fixture post-install failure' in str(error)
                finally:
                    setup.verify = verify
                assert (d / 'pb_public/index.html').read_bytes() == previous
                assert (d / 'last.json').exists() if os.environ.get('QUICK_CHROME') else True
                for c in before:
                    assert call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] == before[c]
                print('PASS: actual installer deploy, verification and failed-update rollback; prior HTML, users, rights and accepted order retained.')
            finally:
                proc = running[0]
            (d / 'pb_data/karavay-test-access.json').unlink()
            call('/service/test-access', expected=404)
            call('/service/test-access', {'id':first['id']}, expected=404)
            print('PASS: real PB 0.40.3: test migration, 3 passwordless sessions, auth-refresh, exact scopes, foreign IDs/origin, disable guards, restart/repeat, configuration off.')
        finally:
            proc.terminate(); proc.wait(timeout=10)
