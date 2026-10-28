"""Real isolated PB 0.40.3: six accounts, transactional setup and access guards.

KIS and systemctl are local fixtures; the Karavay VM is never contacted.
"""
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
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
BINARY = os.environ.get('PB_BINARY', '/tmp/karavay-pb-test/pocketbase')
BASE = 'http://127.0.0.1:18948'
spec = importlib.util.spec_from_file_location('recipient_setup', ROOT/'scripts/Setup-Recipient-Demos.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def call(path, body=None, token='', method=None, status=200, origin=None):
    request = urllib.request.Request(BASE+path, data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {}), **({'Origin': origin} if origin else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            code, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, raw = error.code, error.read()
    assert code == status, (path, code, raw)
    return json.loads(raw) if raw else {}


with tempfile.TemporaryDirectory(prefix='manager-recipients-') as temporary:
    folder = Path(temporary)
    root = folder/'pocketbase'
    root.mkdir()
    (root/'pocketbase').symlink_to(BINARY)
    shutil.copytree(ROOT/'pb_hooks', root/'pb_hooks')
    shutil.copytree(ROOT/'pb_public', root/'pb_public')
    if os.environ.get('CLIENT_HTML'):
        shutil.copy2(os.environ['CLIENT_HTML'], root/'pb_public/index.html')
    for hook in (ROOT/'tests/gateway-fixtures').glob('*.pb.js'):
        shutil.copy2(hook, root/'pb_hooks'/hook.name)
    (root/'bin').mkdir()
    docs = {}
    for pid, count, name in [(2, 2, 'ОАО Каравай'), (3, 2, 'АО Паляница'), (12, 3, 'Сеть А (фикстура)'), (14, 2, 'Сеть Б (фикстура)'), (16, 2, 'Чужой покупатель (фикстура)'), (20, 1, 'Одна точка (фикстура)')]:
        payer = {'id': pid, 'kod': 'P'+str(pid), 'name': name, 'state': 1}
        docs['/payers/'+str(pid)] = payer
        points = []
        for i in range(count):
            cid = pid*100+i+1
            point = {'id': cid, 'payer_id': pid, 'state': 1, 'kod': 'C'+str(cid), 'name': name if not i else 'Магазин '+str(i+1), 'adres': 'Адрес точки '+str(cid)}
            docs['/clients/'+str(cid)] = point
            points.append(point)
        docs['/payers/'+str(pid)+'/clients'] = points
    docs['/payers'] = [doc for path, doc in docs.items() if path.startswith('/payers/') and not path.endswith('/clients')]
    (root/'kis.json').write_text(json.dumps(docs))
    (root/'bin/curl').write_text('''#!/usr/bin/env python3
import json,pathlib,sys
assert '--data-raw' not in sys.argv and '-X' not in sys.argv
path=sys.argv[sys.argv.index('--url')+1].split('/api/v1',1)[1]
root=pathlib.Path(__file__).resolve().parents[1]
with (root/'kis-calls').open('a') as out:out.write(path+'\\n')
data=json.loads((root/'kis.json').read_text()).get(path)
print(json.dumps({'success':data is not None,'data':data}),end='\\n__KIS_HTTP__:200')
''')
    (root/'bin/curl').chmod(0o755)
    kis_calls = []
    class Kis(BaseHTTPRequestHandler):
        def do_GET(self):
            assert 'Authorization' not in self.headers
            kis_calls.append(self.path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'data': docs[self.path]}).encode())
        def do_POST(self):
            raise AssertionError('KIS writes forbidden')
        def log_message(self, *_):
            pass
    kis = ThreadingHTTPServer(('127.0.0.1', 0), Kis)
    threading.Thread(target=kis.serve_forever, daemon=True).start()
    api = setup.Api(BASE, 'http://127.0.0.1:'+str(kis.server_address[1]))
    env = dict(os.environ, PATH=str(root/'bin')+':'+os.environ['PATH'])
    password = 'Test-'+secrets.token_urlsafe(24)
    subprocess.run([BINARY, 'superuser', 'upsert', 'admin@example.test', password, '--dir', str(root/'pb_data')], check=True, stdout=subprocess.DEVNULL, cwd=root)
    log = (folder/'pb.log').open('w')
    process = None
    def start():
        global process
        process = subprocess.Popen([BINARY, 'serve', '--http=127.0.0.1:18948', '--dir', str(root/'pb_data'), '--hooksDir', str(root/'pb_hooks'), '--publicDir', str(root/'pb_public')], env=env, stdout=log, stderr=log)
        for _ in range(100):
            try:
                call('/api/health')
                return
            except (OSError, AssertionError):
                time.sleep(.1)
        raise AssertionError('PB did not start: '+(folder/'pb.log').read_text()[-1500:])
    def stop():
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
    actual_run = subprocess.run
    def service_run(args, **kwargs):
        if args[:1] == ['systemctl']:
            (stop if args[1] == 'stop' else start)()
            return subprocess.CompletedProcess(args, 0)
        return actual_run(args, env=env, **kwargs)
    try:
        start()
        admin = call('/api/collections/_superusers/auth-with-password', {'identity': 'admin@example.test', 'password': password})['token']
        schema = json.loads((ROOT/'tests/schema.json').read_text())
        schema[0]['fields'].append({'name': 'manager_owner', 'type': 'relation', 'collectionId': schema[0]['id'], 'maxSelect': 1, 'required': False, 'hidden': True})
        call('/api/collections/import', {'collections': schema, 'deleteMissing': False}, admin, 'PUT', 204)
        create = lambda collection, body: call('/api/collections/'+collection+'/records', body, admin)['id']
        roles = {code: create('roles', {'code_role': code, 'name_role': code, 'active': True}) for code in ['owner', 'manager', 'viewer']}
        def user(login, name, role='manager'):
            return create('users', {'name': name, 'login': login, 'email': login+'@example.test', 'password': password, 'passwordConfirm': password, 'role': roles[role], 'role_code': role, 'active': True, 'must_change_password': False})
        mid = user('manager', 'Менеджер Каравай')
        other = user('other', 'Другой менеджер')
        ordinary = user('ordinary', 'Обычный клиент', 'owner')
        local = create('payers', {'id_pay': 12, 'kod_pay': 'P12', 'name_pay': docs['/payers/12']['name'], 'active': True})
        foreign = create('payers', {'id_pay': 16, 'kod_pay': 'P16', 'name_pay': docs['/payers/16']['name'], 'active': True})
        for uid, pid in [(mid, local), (other, foreign)]:
            create('rights', {'user': uid, 'payer': pid, 'scope': 'all', 'kis_client_id': 0, 'active': True})
        test_config = {'version': 1, 'enabled': True, 'manager_id': mid, 'origin': BASE}
        (root/'pb_data/manager-test-login.json').write_text(json.dumps(test_config))
        legacy = root/'pb_data/karavay-test-access.json'
        legacy.write_text('{"sentinel":"other-client-chat"}')
        before = setup.snapshot(root)
        setup.configure(root, api, False, BASE)
        assert before == setup.snapshot(root) and not (root/'pb_data'/setup.CONFIG).exists()
        # A one-point-only directory must fail before any database/file write.
        saved_directory = docs['/payers']
        docs['/payers'] = [docs['/payers/20'], docs['/payers/2'], docs['/payers/3']]
        try:
            setup.select(api, before)
            raise AssertionError('Insufficient recipients accepted')
        except RuntimeError as error:
            assert 'Не найдены два' in str(error)
        docs['/payers'] = saved_directory
        assert before == setup.snapshot(root)
        with mock.patch.object(setup.subprocess, 'run', side_effect=service_run):
            plan = setup.configure(root, api, True, BASE, 'fixture-first')
        assert {p['kid'] for p in plan['payers']} == {12, 14}
        assert legacy.read_text() == '{"sentinel":"other-client-chat"}'
        assert (root/'pb_data'/setup.CONFIG).stat().st_mode & 0o777 == 0o600
        assert not any('/matrix' in p or '/orders' in p for p in kis_calls)
        # All ordinary users/passwords/rights remain byte-for-byte unchanged.
        after = setup.snapshot(root)
        for collection in before:
            for record in before[collection]:
                assert record in after[collection]
        assert len(after['users']) == len(before['users'])+6
        assert call('/api/collections/users/auth-with-password', {'identity': 'ordinary@example.test', 'password': password})['record']['id'] == ordinary
        manager_token = call('/service/manager/test-login', {}, origin=BASE)['token']
        call('/service/manager/demo-accounts', status=401)
        ordinary_token = call('/api/collections/users/auth-with-password', {'identity': 'ordinary@example.test', 'password': password})['token']
        call('/service/manager/demo-accounts', token=ordinary_token, status=403)
        other_token = call('/api/collections/users/auth-with-password', {'identity': 'other@example.test', 'password': password})['token']
        call('/service/manager/demo-accounts', token=other_token, status=403)
        account = plan['accounts'][1]
        for origin in [None, 'null', 'http://foreign.example.test']:
            call('/service/manager/demo-login', {'id': account['id']}, manager_token, status=403, origin=origin)
        call('/service/manager/demo-login', {'id': mid}, manager_token, status=403, origin=BASE)
        call('/service/manager/demo-login', {'id': account['id'], 'email': account['email']}, manager_token, status=400, origin=BASE)
        accounts = call('/service/manager/demo-accounts', token=manager_token)['accounts']
        assert len(accounts) == 6 and sum(a['scope'] == 'recipient' for a in accounts) == 4
        assert all(x['address'] for a in accounts for x in a['clients'])
        state = call('/service/manager/state', token=manager_token)
        assert len(state['users']) == 6 and state['version'] == '0.9.2'
        # Repeating setup reuses all IDs and does not rotate passwords/token keys.
        with mock.patch.object(setup.subprocess, 'run', side_effect=service_run):
            setup.configure(root, api, True, BASE, 'fixture-repeat')
        assert after == setup.snapshot(root)
        if os.environ.get('MANAGER_CHROME'):
            subprocess.run(['node', str(ROOT/'tests/recipients-browser.cjs')], input=json.dumps({'url': BASE, 'manager': mid, 'plan': plan, 'screenshot': os.environ.get('MANAGER_DEMOS_SCREENSHOT')}), text=True, check=True, env=env, cwd=ROOT.parent)
        # A new password of one recipient works only for that account. Its
        # buyer and sibling retain independent auth and unchanged records.
        new_password = 'recipient-'+secrets.token_urlsafe(24)
        buyer_before = next(u for u in after['users'] if u['id'] == plan['accounts'][0]['id'])
        call('/api/collections/users/records/'+account['id'], {'password': new_password, 'passwordConfirm': new_password}, admin, 'PATCH')
        assert call('/api/collections/users/auth-with-password', {'identity': account['email'], 'password': new_password})['record']['id'] == account['id']
        for other_account in [plan['accounts'][0], plan['accounts'][2]]:
            call('/api/collections/users/auth-with-password', {'identity': other_account['email'], 'password': new_password}, status=400)
            call('/service/manager/demo-login', {'id': other_account['id']}, manager_token, origin=BASE)
        assert buyer_before in setup.snapshot(root)['users']
        # Disabled accounts / modified grants fail closed and are never restored.
        call('/api/collections/users/records/'+account['id'], {'active': False}, admin, 'PATCH')
        call('/service/manager/demo-login', {'id': account['id']}, manager_token, status=403, origin=BASE)
        stop()
        disabled = setup.snapshot(root)
        assert next(u for u in disabled['users'] if u['id']==account['id'])['active'] == 0
        start()
        try:
            with mock.patch.object(setup.subprocess, 'run', side_effect=service_run):
                setup.configure(root, api, True, BASE)
            raise AssertionError('Disabled demo was reenabled')
        except RuntimeError as error:
            assert 'учётная запись изменена' in str(error)
        assert disabled == setup.snapshot(root), {'before': next(u for u in disabled['users'] if u['id']==account['id']), 'after': next(u for u in setup.snapshot(root)['users'] if u['id']==account['id'])}
        print('PASS: real PB six separate logins, two multi-recipient buyers, read-only/selection guards, transactional install/repeat, preserved existing data, independent passwords, same-origin and manager scope, disabled-account guard.')
    finally:
        stop()
        kis.shutdown()
        log.close()
