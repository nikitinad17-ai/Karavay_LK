"""Real HTTP/SQLite/filesystem tests. No connection to the user's VM or KIS."""
import copy
import importlib.util
import contextlib
import io
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('diverse_installer', HERE / 'install-diverse-history.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
s = m.selection


def payer(pid, name):
    return {'id': pid, 'name': name, 'kod': 'P' + str(pid), 'state': 1}


def fixture_docs():
    people = [payer(2, 'Manufacturer'), payer(3, 'Manufacturer'), payer(950, 'ОАО Каравай'),
              payer(900, 'Current demo A'), payer(800, 'Current demo B'),
              payer(700, 'Fixture customer with empty history'), payer(650, 'Fixture foreign point'),
              payer(600, 'Fixture customer A'), payer(500, 'Fixture customer B'), payer(400, 'Fixture customer C')]
    docs = {'/payers': people}
    for p in people:
        pid = p['id']
        docs['/payers/' + str(pid)] = p
        docs['/payers/' + str(pid) + '/orders'] = []  # This index alone misses real client histories.
        points = [{'id': pid * 10 + n, 'payer_id': pid if pid != 650 else 123,
                   'state': 1, 'kod': 'C' + str(pid * 10 + n), 'name': 'Fixture point ' + str(n)} for n in (1, 2)]
        docs['/payers/' + str(pid) + '/clients'] = points
        for c in points:
            cid = c['id']
            docs['/clients/' + str(cid)] = c
            ids = [cid + 10000, cid + 20000] if pid in (600, 500, 400) and c == points[1] else []
            docs['/clients/' + str(cid) + '/orders'] = {'id_clt': cid, 'Orders': [{'id': oid} for oid in ids]}
            for oid in ids:
                docs['/orders/' + str(oid)] = {'id': oid, 'client_id': cid, 'order_number': oid,
                    'products': [{'id': 66, 'product_kod': 'P66', 'product_name': 'Fixture product',
                                  'kol_sht': 8, 'cena_otp': 3.5, 'sum_all': 28}]}
    return docs


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        self.server.calls.append(('POST', self.path, self.headers.get('Authorization')))
        if self.path != '/service/test-access':
            return self.send({'code': 'WRITE_FORBIDDEN'}, 405)
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        account = next(a for a in self.server.config()['accounts'] if a['id'] == body['id'])
        self.send({'token': 'fixture:' + account['id'], 'record': {'id': account['id'], 'email': account['email']}})

    def do_GET(self):
        self.server.calls.append(('GET', self.path, self.headers.get('Authorization')))
        if self.path.startswith('/api/v1'):
            if self.headers.get('Authorization'):
                return self.send({'code': 'TOKEN_LEAK'}, 500)
            route = self.path.removeprefix('/api/v1')
            if self.server.redirect and route == '/payers':
                self.send_response(302)
                self.send_header('Location', '/api/v1/redirect-target')
                self.end_headers()
                return
            if '/matrix?' in route:
                return self.send({'success': False, 'error': {'code': '-20001', 'message': 'Не определена цена.', 'details': 'private-sql-stack'}}, 400)
            if route not in self.server.docs:
                return self.send({'success': False, 'error': {'message': 'Not found'}}, 404)
            return self.send({'success': True, 'data': self.server.docs[route]})
        if self.path == '/api/health':
            return self.send({})
        if self.path == '/':
            raw = self.server.html
            self.send_response(200)
            self.end_headers()
            self.wfile.write(raw)
            return
        config = self.server.config()
        if self.path == '/service/test-access':
            return self.send({'environment': 'test-kis', 'accounts': [a | {'preferredPayer': config['payers'][i]['id'], 'preferredClient': config['points'][i]['kid']} for i, a in enumerate(config['accounts'])]})
        uid = (self.headers.get('Authorization') or '').removeprefix('fixture:')
        index = next(i for i, a in enumerate(config['accounts']) if a['id'] == uid)
        grants = m.grants(config, index)
        allowed = {g['payer'] for g in grants}
        if self.path == '/service/context':
            return self.send({'payers': [{'id': pid} for pid in sorted(allowed)]})
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        pid = q['payer'][0]
        if pid not in allowed:
            return self.send({'code': 'ACCESS_DENIED'}, 403)
        mapping = next(p for p in config['payers'] if p['id'] == pid)
        if parsed.path == '/service/clients':
            points = self.server.docs['/payers/' + str(mapping['kid']) + '/clients']
            if index == 0:
                points = [p for p in points if p['id'] == config['point']['kid']]
            points = sorted((p for p in points if p['id'] > int(q.get('cursor', ['0'])[0])), key=lambda p: p['id'])
            limit = int(q['perPage'][0])
            return self.send({'payer': pid, 'clients': points[:limit], 'count': len(points[:limit]), 'hasMore': len(points) > limit, 'nextCursor': points[limit-1]['id'] if len(points) > limit else None})
        cid = int(q['client'][0])
        if parsed.path == '/service/orders':
            entries = self.server.docs['/clients/' + str(cid) + '/orders']['Orders']
            return self.send({'orders': entries, 'count': len(entries)})
        order = self.server.docs['/orders/' + parsed.path.rsplit('/', 1)[1]]
        return self.send({'order': {'id': order['id']}, 'itemsAvailable': True, 'items': order['products']})


class DiverseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.server.docs, self.server.calls, self.server.redirect = fixture_docs(), [], False
        base = 'http://127.0.0.1:' + str(self.server.server_port)
        self.api = m.Api(base, base + '/api/v1')
        self.api.token = 'must-stay-local'
        self.state = None
        self.messages = []

    def save(self, value):
        self.state = copy.deepcopy(value)

    def select(self):
        return s.select(self.api, [900, 800], self.state, self.save, emit=self.messages.append)

    def test_live_recipient_history_despite_empty_payer_index_and_no_prices(self):
        chosen = self.select()
        self.assertEqual([c['payer']['id'] for c in chosen], [600, 500, 400])
        self.assertEqual([c['point']['id'] for c in chosen], [6002, 5002, 4002])
        self.assertTrue(all(c['history_count'] == 2 for c in chosen))
        self.assertTrue(all(method == 'GET' and not auth for method, _, auth in self.server.calls))
        paths = [p for _, p, _ in self.server.calls]
        self.assertFalse(any('/matrix?' in p or re_payer_orders(p) for p in paths))
        self.assertFalse(any(p in ('/api/v1/payers/2', '/api/v1/payers/3', '/api/v1/payers/900', '/api/v1/payers/800') for p in paths))
        self.assertNotIn('products', json.dumps(self.state))
        with self.assertRaises(m.ApiError) as error:
            self.api.call('/clients/6002/matrix?DateOrd=1793134800&Group=1', kis=True)
        self.assertIn('Не определена цена', str(error.exception))
        self.assertNotIn('private-sql-stack', str(error.exception))
        self.assertEqual([c['payer']['id'] for c in self.select()], [600, 500, 400])

    def test_resume_revalidates_found_and_skips_previous_empty_recipients(self):
        clock = [0]
        def pause_after_one(value):
            self.save(value)
            if len(value['found']) == 1:
                clock[0] = 40
        with patch.object(s.time, 'monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(TimeoutError):
                s.select(self.api, [900, 800], None, pause_after_one, seconds=30, emit=self.messages.append)
        self.assertEqual(len(self.state['found']), 1)
        self.server.calls.clear()
        chosen = self.select()
        self.assertEqual(len(chosen), 3)
        paths = [p for _, p, _ in self.server.calls]
        self.assertIn('/api/v1/clients/6002/orders', paths)
        self.assertNotIn('/api/v1/clients/7001/orders', paths)
        self.assertNotIn('/api/v1/clients/6001/orders', paths)

    def test_foreign_and_invalid_lines_never_prove_history(self):
        self.server.docs['/orders/16002']['client_id'] = 999
        with self.assertRaises(RuntimeError) as error:
            self.select()
        self.assertIn('verified=2', str(error.exception))
        self.server.docs = fixture_docs()
        for key, value in self.server.docs.items():
            if key.startswith('/orders/') and value['client_id'] == 6002:
                value['products'][0]['kol_sht'] = 1.5
        self.state = None
        with self.assertRaises(RuntimeError) as error:
            self.select()
        self.assertIn('verified=2', str(error.exception))

    def test_empty_histories_do_not_install_or_create_orders(self):
        for key, value in self.server.docs.items():
            if key.startswith('/clients/') and key.endswith('/orders'):
                value['Orders'] = []
        with self.assertRaises(RuntimeError) as error:
            self.select()
        self.assertIn('THREE_HISTORIES_NOT_FOUND', str(error.exception))
        self.assertEqual(self.state['found'], [])
        self.assertTrue(all(method == 'GET' for method, _, _ in self.server.calls))

    def test_write_and_redirect_guards(self):
        for path, body, kis in [('/orders', {}, True), ('/orders/7', {}, True), ('/service/orders', {}, False), ('/api/collections/users/records', {}, False)]:
            with self.assertRaisesRegex(RuntimeError, 'WRITE_FORBIDDEN'):
                self.api.call(path, body, kis)
        self.assertEqual(self.server.calls, [])
        self.server.redirect = True
        with self.assertRaises(m.ApiError):
            self.api.call('/payers', kis=True)
        self.assertFalse(any('redirect-target' in path for _, path, _ in self.server.calls))

    def make_root(self, path):
        root = pathlib.Path(path) / 'pocketbase'
        for folder in ('pb_data', 'pb_hooks', 'pb_public', 'pb_migrations'):
            (root / folder).mkdir(parents=True, exist_ok=True)
        fields = json.loads((HERE / 'DIVERSE-MANIFEST.json').read_text())['required_fields']
        with sqlite3.connect(root / 'pb_data/data.db') as con:
            con.execute('CREATE TABLE _collections(name TEXT, fields TEXT)')
            for name, definition in fields.items():
                definition = dict(definition)
                if name == 'users':
                    definition['manager_owner'] = 'relation'
                con.execute('INSERT INTO _collections VALUES(?,?)', (name, json.dumps([{'name': k, 'type': v} for k, v in definition.items()])))
            con.execute('CREATE TABLE _migrations(file TEXT)')
            con.execute('CREATE TABLE roles(id TEXT,code_role TEXT,active INTEGER)')
            con.execute('INSERT INTO roles VALUES("owner0000000001","owner",1),("manager00000001","manager",1)')
            con.execute('CREATE TABLE users(id TEXT,email TEXT,login TEXT,name TEXT,role TEXT,role_code TEXT,active INTEGER,must_change_password INTEGER,manager_owner TEXT,password_hash TEXT)')
            con.execute('INSERT INTO users VALUES("manager00000001","keep@example.test","manager","Менеджер Каравай","manager00000001","manager",1,0,"","keep-hash")')
            con.execute('CREATE TABLE payers(id TEXT,id_pay INTEGER,kod_pay TEXT,name_pay TEXT,active INTEGER)')
            con.execute('CREATE TABLE clients(id TEXT,id_clt INTEGER,payer TEXT,kod_clt TEXT,name_clt TEXT,active INTEGER)')
            con.execute('CREATE TABLE rights(id TEXT,user TEXT,payer TEXT,scope TEXT,kis_client_id INTEGER,client TEXT,active INTEGER)')
            con.execute('CREATE TABLE business_journal(message TEXT)')
        old = subprocess.run(['git', 'show', 'a56ad6a4800de486e33a5e95ee2ee8d8cc1f5de9:classic-release/pb_hooks/karavay-test-access.js'], cwd=HERE, check=True, capture_output=True).stdout
        (root / m.HELPER).write_bytes(old)
        html = (HERE.parent / 'pb_public/index.html').read_bytes()
        (root / 'pb_public/index.html').write_bytes(html)
        (root / 'pb_hooks/karavay-test-access.pb.js').write_bytes((HERE.parent / 'pb_hooks/karavay-test-access.pb.js').read_bytes())
        saved = {'version': 1, 'enabled': True, 'environment': 'test-kis', 'payers': [{'kid': 900}, {'kid': 800}]}
        (root / m.CONFIG).write_text(json.dumps(saved))
        self.server.config = lambda: json.loads((root / m.CONFIG).read_text())
        self.server.html = html
        return root, saved

    def insert_plan(self, root, config):
        with sqlite3.connect(root / 'pb_data/data.db') as con:
            for p, c in zip(config['payers'], config['points']):
                con.execute('INSERT INTO payers VALUES(?,?,?,?,1)', (p['id'], p['kid'], p['code'], p['name']))
                con.execute('INSERT INTO clients VALUES(?,?,?,?,?,1)', (c['id'], c['kid'], p['id'], c['code'], c['name']))
            for i, a in enumerate(config['accounts']):
                con.execute('INSERT INTO users VALUES(?,?,?,?,?,?,1,0,?,?)', (a['id'], a['email'], a['login'], a['name'], config['ownerRole'], 'owner', config['managerOwner'], 'unchanged-' + str(i)))
                for rid, grant in zip(a['rights'], m.grants(config, i)):
                    con.execute('INSERT INTO rights VALUES(?,?,?,?,?,?,1)', (rid, a['id'], grant['payer'], grant['scope'], grant['kis_client_id'], grant['client']))

    def test_sqlite_plan_repeat_and_post_install_http_verification(self):
        chosen = self.select()
        with tempfile.TemporaryDirectory() as folder:
            root, saved = self.make_root(folder)
            config = m.plan(root, chosen, saved)
            self.assertEqual([p['kid'] for p in config['payers']], [600, 500, 400])
            self.assertEqual(config['managerOwner'], 'manager00000001')
            self.insert_plan(root, config)
            again = m.plan(root, chosen, config)
            for key in ('payers', 'points', 'accounts'):
                self.assertEqual(config[key], again[key])
            (root / m.CONFIG).write_text(json.dumps(config))
            m.verify(self.api, config, m.sha(root / 'pb_public/index.html'))
            self.assertEqual(sum(method == 'POST' for method, _, _ in self.server.calls), 3)
            with sqlite3.connect(root / 'pb_data/data.db') as con:
                self.assertEqual(con.execute('SELECT password_hash FROM users WHERE id="manager00000001"').fetchone()[0], 'keep-hash')
                con.execute('UPDATE users SET active=0 WHERE id=?', (config['accounts'][0]['id'],))
            with self.assertRaisesRegex(RuntimeError, 'occupied/changed'):
                m.plan(root, chosen, config)

    def test_file_rollback_and_ctrl_c_preserve_business_database(self):
        chosen = self.select()
        for error in (RuntimeError('verification failed'), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as folder:
                root, saved = self.make_root(folder)
                config = m.plan(root, chosen, saved)
                before = {name: m.sha(root / name) for name in (m.HELPER, 'pb_public/index.html', m.CONFIG)}
                manifest = json.loads((HERE / 'DIVERSE-MANIFEST.json').read_text())
                def fail(*_):
                    with sqlite3.connect(root / 'pb_data/data.db') as con:
                        con.execute('INSERT INTO business_journal VALUES("preserve-current")')
                    raise error
                actions = []
                with patch.object(m, 'service', side_effect=actions.append), patch.object(m, 'verify', side_effect=fail):
                    with self.assertRaises(type(error)):
                        m.deploy(root, self.api, config, manifest, before)
                self.assertEqual(actions, ['stop', 'start', 'stop', 'start'])
                self.assertEqual({name: m.sha(root / name) for name in before}, before)
                self.assertFalse((root / 'pb_migrations' / m.MIGRATION).exists())
                with sqlite3.connect(root / 'pb_data/data.db') as con:
                    self.assertEqual(con.execute('SELECT message FROM business_journal').fetchone()[0], 'preserve-current')

    def test_preflight_unknown_file_and_pending_migration(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _ = self.make_root(folder)
            with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'PocketBase 0.40.3')):
                m.preflight(root, self.api)
                (root / 'pb_migrations/unrelated.js').write_text('unrelated')
                with self.assertRaisesRegex(RuntimeError, 'Unrelated pending'):
                    m.preflight(root, self.api)
                (root / 'pb_migrations/unrelated.js').unlink()
                (root / m.HELPER).write_text('unknown helper')
                with self.assertRaisesRegex(RuntimeError, 'Unknown installed file'):
                    m.preflight(root, self.api)

    def test_actual_main_apply_and_repeat_with_http_sqlite_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _ = self.make_root(folder)
            def start(action):
                if action == 'start':
                    config = json.loads((root / m.CONFIG).read_text())
                    with sqlite3.connect(root / 'pb_data/data.db') as con:
                        created = con.execute('SELECT count(*) FROM users WHERE id=?', (config['accounts'][0]['id'],)).fetchone()[0]
                    if not created:
                        self.insert_plan(root, config)
                        with sqlite3.connect(root / 'pb_data/data.db') as con:
                            con.execute('INSERT INTO _migrations VALUES(?)', (m.MIGRATION,))
            output = io.StringIO()
            with patch.object(m, 'ROOT', root), patch.object(m, 'Api', return_value=self.api), \
                 patch.object(m, 'service', side_effect=start), patch.object(sys, 'argv', ['install', '--apply']), \
                 patch.object(m.os, 'geteuid', return_value=0), \
                 patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'PocketBase 0.40.3')), \
                 contextlib.redirect_stdout(output):
                m.main()
                first = json.loads((root / m.CONFIG).read_text())
                with sqlite3.connect(root / 'pb_data/data.db') as con:
                    passwords = list(con.execute('SELECT id,password_hash FROM users ORDER BY id'))
                m.main()
            second = json.loads((root / m.CONFIG).read_text())
            for key in ('payers', 'points', 'accounts'):
                self.assertEqual(first[key], second[key])
            with sqlite3.connect(root / 'pb_data/data.db') as con:
                self.assertEqual(passwords, list(con.execute('SELECT id,password_hash FROM users ORDER BY id')))
            self.assertEqual(output.getvalue().count('DIVERSE_HISTORY_READY:'), 2)
            self.assertEqual(output.getvalue().count('CATALOG_WARNING:'), 12)
            self.assertNotIn('private-sql-stack', output.getvalue())
            self.assertEqual(sum(method == 'POST' for method, _, _ in self.server.calls), 6)


def re_payer_orders(path):
    return path.startswith('/api/v1/payers/') and path.endswith('/orders')


if __name__ == '__main__':
    unittest.main(verbosity=2)
