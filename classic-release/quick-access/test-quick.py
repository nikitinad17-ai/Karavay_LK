"""Real isolated PB + fixture KIS. Never contacts production. Requires built classic HTML."""
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
spec = importlib.util.spec_from_file_location('quick', HERE / 'Create-Quick-Users.py')
quick = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quick)
seed = quick.seed
BASE = 'http://127.0.0.1:18946'
BINARY = os.environ['PB_BINARY']


def call(path, body=None, token='', method=None, expected=200):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw, status = error.read(), error.code
    assert status == expected, (path, status, raw)
    return json.loads(raw) if raw else {}


with tempfile.TemporaryDirectory(prefix='quick-users-test-') as temp:
    folder = Path(temp)
    hooks, public, bindir = folder / 'hooks', folder / 'public', folder / 'bin'
    for path in (hooks, public, bindir):
        path.mkdir()
    for source in (REPO / 'manager-live/tests/gateway-fixtures').glob('*.pb.js'):
        shutil.copy(source, hooks)
    shutil.copy(ROOT / 'pb_public/index.html', public / 'index.html')
    buyers = [{'id': k, 'kod': 'K' + str(k), 'name': name, 'state': 1} for k, name in [
        (299271, 'Old Neva'), (300182, 'Old Prom'), (700001, 'НЕВА'),
        (700050, 'Fixture foreign'), (700101, 'Fixture single buyer'), (700201, 'Fixture multi buyer')]]
    clients = {700050: [700051], 700101: [700102], 700201: [700202, 700203]}
    docs = {'/payers': buyers}
    for buyer in buyers:
        pid = buyer['id']
        docs['/payers/' + str(pid)] = buyer
        docs['/payers/' + str(pid) + '/clients'] = []
        for cid in clients.get(pid, []):
            point = {'id': cid, 'payer_id': pid, 'state': 1, 'kod': 'C' + str(cid), 'name': 'Fixture recipient ' + str(cid), 'adres': 'Fixture address'}
            docs['/payers/' + str(pid) + '/clients'].append(point)
            docs['/clients/' + str(cid)] = point
    fixture = folder / 'kis.json'
    fixture.write_text(json.dumps(docs))
    (bindir / 'curl').write_text('''#!/usr/bin/env python3
import json,pathlib,sys
assert '--data-raw' not in sys.argv and '-X' not in sys.argv, 'KIS write forbidden'
root=pathlib.Path(__file__).resolve().parents[1]
path=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
print(json.dumps({'success':True,'data':json.loads((root/'kis.json').read_text())[path]}),end='\\n__KIS_HTTP__:200')
''')
    (bindir / 'curl').chmod(0o755)
    kis_calls = []

    class Kis(BaseHTTPRequestHandler):
        def do_GET(self):
            kis_calls.append(self.path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'data': json.loads(fixture.read_text())[self.path]}).encode())

        def do_POST(self):
            raise AssertionError('KIS write forbidden')

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Kis)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    seed.PB, seed.KIS = BASE, 'http://127.0.0.1:' + str(server.server_address[1])
    quick.STATE, quick.OUTPUT = folder / 'private.json', folder / 'private.html'
    password = 'test-' + secrets.token_urlsafe(24)
    env = dict(os.environ, PATH=str(bindir) + ':' + os.environ['PATH'])
    subprocess.run([BINARY, 'superuser', 'upsert', 'admin@example.test', password, '--dir', str(folder / 'data')], check=True, stdout=subprocess.DEVNULL)
    with (folder / 'pb.log').open('w') as log:
        proc = subprocess.Popen([BINARY, 'serve', '--http=127.0.0.1:18946', '--dir', str(folder / 'data'), '--hooksDir', str(hooks), '--publicDir', str(public)], env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    call('/api/health')
                    break
                except (urllib.error.URLError, ConnectionError):
                    time.sleep(.1)
            admin = call('/api/collections/_superusers/auth-with-password', {'identity': 'admin@example.test', 'password': password})['token']
            schema = json.loads((ROOT / 'schema-test.json').read_text())
            schema[0]['fields'].append({'name': 'manager_owner', 'type': 'relation', 'collectionId': schema[0]['id'], 'maxSelect': 1, 'required': False})
            call('/api/collections/import', {'collections': schema, 'deleteMissing': False}, admin, 'PUT', 204)
            api = seed.Api()
            api.token = admin
            role = api.create('roles', {'code_role': 'manager', 'name_role': 'Manager', 'active': True})['id']
            owner = api.create('roles', {'code_role': 'owner', 'name_role': 'Owner', 'active': True})['id']
            mid = api.create('users', {'name': 'Fixture manager', 'email': 'manager@example.test', 'login': 'manager', 'role': role, 'role_code': 'manager', 'active': True, 'must_change_password': False, 'password': password, 'passwordConfirm': password})['id']
            foreign = api.create('payers', {'id_pay': 700050, 'kod_pay': 'K700050', 'name_pay': 'Fixture foreign', 'active': True})['id']
            snap = lambda: {c: api.rows(c, '') for c in ('users', 'rights', 'payers', 'clients')}
            before = snap()
            quick.provision(api, False, BASE)
            assert before == snap() and not quick.STATE.exists() and not quick.OUTPUT.exists()
            # Interrupted user creation resumes the same plan and secrets.
            original_create = api.create
            def interrupt(collection, body):
                if collection == 'rights' and body.get('user') != mid:
                    raise quick.Failure('Simulated interrupted grant')
                return original_create(collection, body)
            api.create = interrupt
            try:
                quick.provision(api, True, BASE)
                raise AssertionError('Expected interruption')
            except quick.Failure as error:
                assert 'Simulated' in str(error)
            plan_before = quick.load_plan()
            first = api.rows('users', 'id = ' + json.dumps(plan_before['accounts'][0]['id']))[0]
            assert first['active'] is False
            api.create = original_create
            quick.provision(api, True, BASE)
            plan = quick.load_plan()
            assert [p['kid'] for p in plan['payers']] == [700201, 700101]
            assert plan['manager'] == mid and all(a['done'] for a in plan['accounts'])
            assert [a['password'] for a in plan_before['accounts']] == [a['password'] for a in plan['accounts']]
            assert quick.STATE.stat().st_mode & 0o777 == 0o600 and quick.OUTPUT.stat().st_mode & 0o777 == 0o600
            accounts = [s | a for s, a in zip(quick.account_specs(mid), plan['accounts'])]
            for account in accounts:
                u = api.rows('users', 'id = ' + json.dumps(account['id']))[0]
                assert u['manager_owner'] == mid and u['must_change_password'] is False
            assert {p['payer'] for p in api.rows('rights', 'user = ' + json.dumps(mid))} == {p['id'] for p in plan['payers']}
            assert foreign not in {r['payer'] for r in api.rows('rights', 'user = ' + json.dumps(mid))}
            assert not any(path in ('/payers/299271', '/payers/300182', '/payers/700001', '/payers/700050/clients') for path in kis_calls)
            ready = snap()
            quick.provision(api, True, BASE)
            assert ready == snap()  # No password reset, duplicate or unrelated record update.
            auth = call('/api/collections/users/auth-with-password', {'identity': accounts[0]['email'], 'password': accounts[0]['password']})
            assert call('/service/clients?payer=' + plan['payers'][1]['id'], token=auth['token'], expected=403)['code']
            assert call('/service/clients?payer=' + foreign, token=auth['token'], expected=403)['code']
            html = quick.OUTPUT.read_text()
            assert password not in html and admin not in html and 'superusers' not in html
            for script in __import__('re').findall(r'<script[^>]*>(.*?)</script>', html, __import__('re').S):
                digest = __import__('base64').b64encode(hashlib.sha256(script.encode()).digest()).decode()
                assert 'sha256-' + digest in html
            # A disabled completed user is never automatically re-enabled.
            api.call('/api/collections/users/records/' + accounts[0]['id'], {'active': False}, 'PATCH')
            disabled = snap()
            try:
                quick.provision(api, True, BASE)
                raise AssertionError('Expected disabled rejection')
            except quick.Failure as error:
                assert 'отключён' in str(error)
            assert disabled == snap()
            # Optional real browser test uses only the isolated PB and fixture data.
            if os.environ.get('QUICK_CHROME'):
                api.call('/api/collections/users/records/' + accounts[0]['id'], {'active': True}, 'PATCH')
                names = [{'name': account['name']} for account in accounts]
                subprocess.run(['node', str(HERE / 'test-browser.cjs'), str(quick.OUTPUT), json.dumps(names), BASE], check=True, env=env)
            print('PASS: real PB 0.40.3: live fixture KIS GET, 3 scenarios, manager scope, dry-run, interrupted resume, repeat without changes, login/isolation, disabled guard, private HTML/CSP.')
        finally:
            proc.terminate()
            proc.wait(timeout=10)
            server.shutdown()
