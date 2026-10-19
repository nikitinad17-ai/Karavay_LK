"""Real PB 0.40.3 and real client; KIS transport is an isolated fixture, never the VM."""
import hashlib, importlib.util, json, os, pathlib, secrets, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
BASE = 'http://127.0.0.1:18947'
BINARY = os.environ['PB_BINARY']
spec = importlib.util.spec_from_file_location('setup', HERE / 'install-test.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
buyer_mode = bool(os.environ.get('BUYER_SELECTION'))
price_error = buyer_mode and bool(os.environ.get('BUYER_PRICE_ERROR'))
if buyer_mode:
    buyer_setup = setup.module('buyer_installer', HERE / 'install-buyers.py')
    buyer_setup.setup = setup

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
    for kid, name, clients in ((2, 'ОАО"Каравай"', [2, 234243]), (3, 'АО "ПАЛЯНИЦА"', [384786, 385317]), *(((500001, 'Fixture customer A', [501011, 501012]), (500002, 'Fixture customer B', [502011, 502012])) if buyer_mode else ())):
        docs['/payers/' + str(kid)] = {'id': kid, 'kod': '000' + str(kid + 4), 'name': name, 'state': 1}
        points = []
        for cid in clients:
            point = {'id': cid, 'kod': 'C' + str(cid), 'name': name + ' · ' + str(cid), 'adres': 'Адрес КИС', 'payer_id': kid, 'state': 1, 'ord_min_sum': 200, 'ord_min_sum_flg_nds': 1}
            points.append(point); docs['/clients/' + str(cid)] = point
        docs['/payers/' + str(kid) + '/clients'] = points
    docs['/payers'] = [value for key, value in docs.items() if key.startswith('/payers/') and key.count('/') == 2]
    (d / 'kis.json').write_text(json.dumps(docs))
    history_mode = bool(os.environ.get('HISTORY_SELECTION'))
    if history_mode: (d / 'history-mode').write_text('yes')
    if buyer_mode: (d / 'buyer-mode').write_text('yes')
    if price_error: (d / 'price-error').write_text('yes')
    (d / 'bin/curl').write_text('''#!/usr/bin/env python3
import datetime,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
p=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
docs=json.loads((root/'kis.json').read_text());status=200
last=root/'last.json'
if '/matrix?' in p and (root/'price-error').exists():
 print(json.dumps({'success':False,'error':{'code':'-20001','message':'3002 Бублики Украинские. Не определена цена.'}}),end='\\n__KIS_HTTP__:400');sys.exit(0)
if '--data-raw' in sys.argv:
 assert not (root/'price-error').exists(), 'No order POST allowed during buyer-login test'
 assert p=='/orders' and not any('Authorization' in x for x in sys.argv)
 body=json.loads(sys.argv[sys.argv.index('--data-raw')+1]);assert set(body)=={'Id_clt','DateOrd','Product'}
 assert body['Id_clt']==(502011 if (root/'buyer-mode').exists() else 234243 if (root/'history-mode').exists() else 2) and body['Product']==[{'Id_prd':66,'KolSht':8}]
 assert not last.exists(),'duplicate KIS POST'
 last.write_text(json.dumps(body));data={'Id_ord':7};status=201
elif '/matrix?' in p:data=[{'id_prd':66,'kod_prod':'1263','nameprod':'Хлеб из КИС','vesprod':.5,'srok':72,'kolukl':8,'cenaotp':34.9,'basecenaotp':40,'procskd':0,'kolshtordmin':4},{'id_prd':67,'kod_prod':'LOT8','nameprod':'Только лотками из КИС','kolukl':8,'cenaotp':30,'kolshtordmin':None}]
elif p.endswith('/orders'):
 cid=int(p.split('/')[2]);data=([{'id':8 if cid==234243 else 9}] if (root/'history-mode').exists() and cid in (234243,384786) else [])
 if last.exists() and cid==json.loads(last.read_text())['Id_clt']:data=[{'id':7}]+data
elif p in ('/orders/8','/orders/9'):
 oid=int(p.split('/')[-1]);data={'id':oid,'client_id':234243 if oid==8 else 384786,'order_number':8000+oid,'order_date':'2026-10-01T00:00:00','kol_sht':8,'sum_all':279.2,'state':0,'products':[{'id':66,'product_kod':'1263','product_name':'Existing KIS bread','kol_sht':8,'cena_otp':34.9,'sum_all':279.2}]}
elif p=='/orders/7':
 b=json.loads(last.read_text());data={'id':7,'client_id':b['Id_clt'],'order_number':948,'order_date':datetime.datetime.fromtimestamp(b['DateOrd']+10800,datetime.timezone.utc).strftime('%Y-%m-%dT00:00:00'),'create_date':b['DateOrd'],'kol_sht':8,'sum_all':279.2,'state':0,'products':[{'id':66,'product_kod':'1263','product_name':'Хлеб из КИС','kol_sht':8,'cena_otp':34.9,'sum_all':279.2}]}
else:data=docs[p]
if p.startswith('/clients/') and p.endswith('/orders') and (root/'wrapper').exists():data={'id_clt':999999 if (root/'foreign-wrapper').exists() else int(p.split('/')[2]),'Orders':'invalid' if (root/'invalid-wrapper').exists() else data}
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
                    assert kw == {'kis':True}
                    if '/matrix?' in path:
                        if price_error: raise setup.seed.Failure('HTTP 400 при ' + path.split('?')[0] + ' | KIS: 3002 Бублики Украинские. Не определена цена.')
                        return [{'id_prd':66,'kolukl':8,'kolshtordmin':4,'cenaotp':34.9}]
                    return docs[path]
            chosen = None
            if history_mode or buyer_mode:
                # Upgrade from the previous version in the SAME database.
                previous_config = setup.plan(d, Kis())
                proc.terminate(); proc.wait(timeout=10)
                (d / 'pb_data/karavay-test-access.json').write_text(json.dumps(previous_config))
                shutil.copy2(HERE / setup.MIGRATION, d / 'pb_migrations')
                proc = start()
                if buyer_mode:
                    previous_auth = call('/service/test-access', {'id': previous_config['accounts'][0]['id']})
                    env['PREVIOUS_TEST_SESSION'] = json.dumps({'token': previous_auth['token'], 'id': previous_auth['record']['id'], 'email': previous_auth['record']['email'], 'test': True})
                old_snapshot = {c:call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] for c in ('users','rights','payers','clients')}
                if buyer_mode:
                    chosen = buyer_setup.selection.select(Kis(), emit=lambda _: None)
                    setup.MIGRATION = buyer_setup.MIGRATION
                else:
                    tomorrow = (int(time.time()+10800)//86400+1)*86400-10800
                    chosen = [{'payer':docs['/payers/'+str(k)],'point':docs['/clients/'+str(cid)],'order_id':oid,'history_count':1,'day':__import__('datetime').datetime.fromtimestamp(tomorrow+10800,__import__('datetime').timezone.utc).strftime('%Y-%m-%d'),'stamp':tomorrow,'group':1} for k,cid,oid in [(2,234243,8),(3,384786,9)]]
                    setup.MIGRATION = '1792260000_test_history_users.js'
            config = buyer_setup.plan(d, Kis(), chosen) if buyer_mode else setup.plan(d, Kis(), chosen)
            assert config['managerOwner'] == manager
            proc.terminate(); proc.wait(timeout=10)
            (d / 'pb_data/karavay-test-access.json').write_text(json.dumps(config))
            shutil.copy2(HERE / setup.MIGRATION, d / 'pb_migrations')
            proc = start()
            accounts = call('/service/test-access')['accounts']
            assert len(accounts) == 3
            if buyer_mode: call('/service/test-access', {'id': previous_config['accounts'][0]['id']}, expected=403)
            if history_mode or buyer_mode:
                for c, values in old_snapshot.items():
                    current = {r['id']:r for r in call('/api/collections/'+c+'/records?perPage=200', token=admin)['items']}
                    assert all(current[v['id']]==v for v in values), 'Existing records changed: '+c
            assert password not in json.dumps(accounts) and all('password' not in a for a in accounts)
            call('/service/test-access', {'id':manager}, expected=403)
            call('/service/test-access', {'id':accounts[0]['id'], 'email':'x'}, expected=400)
            call('/service/test-access', {'id':accounts[0]['id']}, expected=403, headers={'Origin':'https://foreign.example'})
            auth = call('/service/test-access', {'id':accounts[0]['id']}); token = auth['token']
            assert auth['record']['must_change_password'] is False
            assert call('/api/collections/users/auth-refresh', {}, token)['record']['id'] == accounts[0]['id']
            p1, p2 = [p['id'] for p in config['payers']]
            assert len(call('/service/context', token=token)['payers']) == 1
            assert [c['id'] for c in call('/service/clients?payer='+p1+'&perPage=20', token=token)['clients']] == [config['point']['kid']]
            call('/service/clients?payer='+p2+'&perPage=20', token=token, expected=403)
            q='/service/orders?payer='+p1+'&client='+str(config['point']['kid'])
            (d/'wrapper').write_text('yes')
            call(q,token=token)
            (d/'foreign-wrapper').write_text('yes');call(q,token=token,expected=403);(d/'foreign-wrapper').unlink()
            (d/'invalid-wrapper').write_text('yes');call(q,token=token,expected=502);(d/'invalid-wrapper').unlink()
            if not history_mode:(d/'wrapper').unlink()

            another = next(p['id'] for p in docs['/payers/'+str(config['payers'][0]['kid'])+'/clients'] if p['id'] != config['point']['kid'])
            call('/service/order-options?payer='+p1+'&client='+str(another), token=token, expected=403)
            for i, a in enumerate(accounts):
                t = call('/service/test-access', {'id':a['id']})['token']
                assert len(call('/service/context', token=t)['payers']) == (2 if i == 2 else 1)
            if os.environ.get('QUICK_CHROME'):
                subprocess.run(['node', str(HERE / ('test-buyer-logins.cjs' if price_error else 'test-browser.cjs')), BASE, json.dumps(config)], check=True, env=env)
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
            assert (buyer_setup.plan(d, Kis(), chosen) if buyer_mode else setup.plan(d, Kis(), chosen)) == config
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
            if buyer_mode:
                (d / 'pocketbase').symlink_to(BINARY)
                setup.base.run = lambda *args: subprocess.run(args, check=True, capture_output=True, text=True) if args[0] != 'systemctl' else systemctl(*args)
                manifest = buyer_setup.preflight(d)
                setup.base.run = systemctl
                saved_verify = setup.verify
                setup.verify = lambda c, m: (saved_verify(c, m), buyer_setup.verify(c, m))
            else:
                manifest = json.loads((ROOT / 'MANIFEST.json').read_text())
            (d / 'backups').mkdir()
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
                if os.environ.get('QUICK_CHROME'):
                    assert (d / 'last.json').exists() is not price_error
                for c in before:
                    assert call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] == before[c]
                print('PASS: actual installer deploy, verification and failed-update rollback; prior HTML, users, rights and order data retained.')
                if buyer_mode:
                    import unittest.mock as mock
                    buyer_setup.ROOT = d
                    setup.verify = saved_verify
                    setup.base.run = lambda *args: subprocess.run(args, check=True, capture_output=True, text=True) if args[0] != 'systemctl' else systemctl(*args)
                    with mock.patch.object(sys, 'argv', ['install-buyers.py', '--apply']), mock.patch.object(setup.seed, 'Api', Kis):
                        buyer_setup.main()
                    for c in before:
                        assert call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] == before[c]
                    assert (d / 'pb_public/index.html').read_bytes() == previous
                    print('PASS: complete buyer installer main/apply/repeat, saved selection and gateway scopes despite catalog failures; current HTML/users/rights/order data retained.')
                # ClientOnly dispatch uses this unchanged core installer. Exercise its
                # real main/apply path; substitute only VM paths, URL and systemctl.
                (d / 'pb_public/index.html').write_bytes((ROOT / 'pb_public/index.html').read_bytes())
                if not (d / 'pocketbase').exists(): (d / 'pocketbase').symlink_to(BINARY)
                source = d / 'client-package'; source.mkdir()
                core_manifest = json.loads((ROOT / 'MANIFEST.json').read_text())
                for name in core_manifest['package']:
                    target = source / name; target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / name, target)
                for name in core_manifest['gateway_preserved']:
                    core_manifest['gateway_preserved'][name] = hashlib.sha256((d / 'pb_hooks' / name).read_bytes()).hexdigest()
                (source / 'MANIFEST.json').write_text(json.dumps(core_manifest))
                core_path = ROOT / 'scripts/install.py'
                code = core_path.read_text().replace("pathlib.Path('/opt/pocketbase')", 'pathlib.Path(' + repr(str(d)) + ')').replace("pathlib.Path('/opt')", 'pathlib.Path(' + repr(str(d / 'backups')) + ')').replace('http://127.0.0.1:8090', BASE)
                core = {'__name__':'fixture_client_installer','__file__':str(core_path)}
                exec(compile(code, str(core_path), 'exec'), core)
                core['SOURCE'] = source
                def core_run(*args):
                    if args[0] == 'systemctl':
                        if args[1] != 'is-active': systemctl(*args)
                        return subprocess.CompletedProcess(args, 0, stdout='active', stderr='')
                    return subprocess.run(args, check=True, capture_output=True, text=True)
                core['run'] = core_run
                config_before = (d / 'pb_data/karavay-test-access.json').read_bytes()
                import unittest.mock as mock
                with mock.patch.object(sys, 'argv', ['install.py','--apply']): core['main']()
                assert (d / 'pb_data/karavay-test-access.json').read_bytes() == config_before
                for c in before:
                    assert call('/api/collections/'+c+'/records?perPage=200', token=admin)['items'] == before[c]
                print('PASS: client-only core installer main/apply, auth gates, served HTML and journal; test config and all existing users/rights retained.')
            finally:
                proc = running[0]
            (d / 'pb_data/karavay-test-access.json').unlink()
            call('/service/test-access', expected=404)
            call('/service/test-access', {'id':first['id']}, expected=404)
            print('PASS: real PB 0.40.3: test migration, 3 passwordless sessions, auth-refresh, exact scopes, foreign IDs/origin, disable guards, restart/repeat, configuration off.')
        finally:
            proc.terminate(); proc.wait(timeout=10)
