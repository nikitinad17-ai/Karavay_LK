"""HTTP fixture + file rollback test. No connection to the user's VM or KIS."""
import contextlib, datetime as dt, importlib.util, io, json, pathlib, sqlite3, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('catalog_date', HERE / 'catalog-date-check.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
days = [dt.date(2026, 10, 27), dt.date(2026, 10, 28)]
config = {'point': {'kid': 110, 'code': 'У100'}, 'payers': [{'id': 'payer0000000001', 'kid': 100}]}
account = {'id': 'test383multi001', 'email': 'demo.test.multi.v383@example.test'}
requests = []
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def send(self, status, data, headers=None):
        self.send_response(status)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(json.dumps(data).encode())
    def do_POST(self):
        assert self.path == '/service/test-access'
        assert json.loads(self.rfile.read(int(self.headers['Content-Length']))) == {'id': account['id']}
        requests.append(('POST', self.path))
        self.send(200, {'token': 'fixture-session', 'record': {'id': account['id']}})
    def do_GET(self):
        requests.append(('GET', self.path))
        if self.path.startswith('/api/v1/'):
            assert not self.headers.get('Authorization'), 'PB token forwarded to KIS'
            if self.path == '/api/v1/clients/110':
                return self.send(200, {'success': True, 'data': {'id': 110, 'payer_id': 100, 'state': 1}})
            if self.path == '/api/v1/clients/120':
                return self.send(302, {}, {'Location': 'http://example.invalid/must-not-follow'})
            assert self.path.startswith('/api/v1/clients/110/matrix?DateOrd=')
            return self.send(400, {'success': False, 'error': {'code': '-20001', 'message': '3002 Бублики. Не определена цена.', 'details': 'private SQL stack'}})
        if self.path == '/service/test-access':
            return self.send(200, {'environment': 'test-kis', 'accounts': [account, {'id': 'test383point001'}, {'id': 'test383buyer001'}]})
        assert self.headers.get('Authorization') == 'fixture-session'
        if self.path == '/service/context':
            return self.send(200, {'user': {'role': 'owner'}, 'payers': [{'id': config['payers'][0]['id'], 'name': 'Fixture buyer'}]})
        if self.path == '/service/clients?payer=payer0000000001&cursor=109&perPage=1':
            return self.send(200, {'payer': 'payer0000000001', 'clients': [{'id': 110, 'code': 'У100', 'name': 'Fixture recipient'}], 'hasMore': False})
        assert self.path.startswith('/service/catalog?')
        self.send(502, {'code': 'UPSTREAM_HTTP'})

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
try:
    origin = 'http://127.0.0.1:' + str(server.server_port)
    api = m.Api(origin, origin); output = io.StringIO()
    with patch.object(m, 'days', lambda: days), contextlib.redirect_stdout(output):
        m.diagnose(api, config, 'Y100')
    text = output.getvalue()
    assert text.count('KIS_CATALOG_HTTP: 400') == 4
    assert text.count('GATEWAY_CATALOG_HTTP: 502') == 4
    assert text.count('Не определена цена') == 4
    assert '2026-10-27' in text and '2026-10-28' in text
    assert 'fixture-session' not in text and 'private SQL stack' not in text
    assert not any('/orders' in path for _, path in requests)
    assert [p for method, p in requests if method == 'POST'] == ['/service/test-access']
    before = len(requests)
    for path, body, upstream in [('/api/v1/orders', {}, True), ('/api/v1/clients/110', {}, True), ('/service/orders', {}, False), ('/service/orders', None, False)]:
        try: api.call(path, body, upstream); raise AssertionError('Forbidden path/write accepted')
        except RuntimeError: pass
    assert len(requests) == before
    assert api.call('/api/v1/clients/120', upstream=True)[0] == 302
finally:
    server.shutdown(); server.server_close(); thread.join()

old = subprocess.run(['git', 'show', 'a56ad6a4800de486e33a5e95ee2ee8d8cc1f5de9:classic-release/pb_hooks/karavay-test-access.js'], cwd=HERE.parents[1], check=True, capture_output=True).stdout
new = (HERE.parent / 'pb_hooks/karavay-test-access.js').read_bytes()
with tempfile.TemporaryDirectory(prefix='karavay-date-files-') as temp:
    root = pathlib.Path(temp) / 'pb'; (root / 'pb_hooks').mkdir(parents=True)
    target = root / 'pb_hooks/karavay-test-access.js'; target.write_bytes(old)
    html = root / 'index.html'; html.write_text('unchanged HTML')
    data = root / 'data.db'; data.write_bytes(b'unchanged users/rights/orders')
    source = pathlib.Path(temp) / 'new.js'; source.write_bytes(new)
    (root / 'pb_data').mkdir(); (root / 'pb_migrations').mkdir()
    with sqlite3.connect(root / 'pb_data/data.db') as con:
        con.execute('CREATE TABLE _migrations(file TEXT)')
        con.execute('INSERT INTO _migrations VALUES (?)', ('previous.js',))
    (root / 'pb_migrations/previous.js').write_text('applied migration')
    m.no_pending_migrations(root)
    pending = root / 'pb_migrations/unrelated.js'; pending.write_text('not applied')
    try: m.no_pending_migrations(root); raise AssertionError('Pending migration ignored')
    except RuntimeError: pass
    pending.unlink()
    actions = []
    class Fake:
        fail = False
        def pb_json(self, path):
            assert path == '/service/test-access'
            date = '2026-10-28' if target.read_bytes() == new and not self.fail else '2026-10-20'
            return {'environment': 'test-kis', 'accounts': [{'id': 'account' + str(i), 'preferredDate': date} for i in range(3)]}
    fake = Fake()
    with patch.object(m.os, 'geteuid', lambda: 0), patch.object(m, 'service', actions.append), patch.object(m, 'health', lambda _: None), patch.object(m, 'days', lambda: days), contextlib.redirect_stdout(io.StringIO()):
        m.patch_date(root, fake, source)
        assert target.read_bytes() == new and actions == ['stop', 'start']
        m.patch_date(root, fake, source)
        assert actions == ['stop', 'start'], 'Repeat restarted/replaced unnecessarily'
        target.write_bytes(old); fake.fail = True; actions.clear()
        try: m.patch_date(root, fake, source); raise AssertionError('Verification failure ignored')
        except RuntimeError: pass
        assert target.read_bytes() == old and actions == ['stop', 'start', 'stop', 'start']
        target.write_bytes(old); fake.fail = False; actions.clear()
        with patch.object(m, 'health', side_effect=KeyboardInterrupt):
            try: m.patch_date(root, fake, source); raise AssertionError('Interrupt ignored')
            except KeyboardInterrupt: pass
        assert target.read_bytes() == old and actions == ['stop', 'start', 'stop', 'start']
        target.write_bytes(b'unrelated helper edit'); actions.clear()
        try: m.patch_date(root, fake, source); raise AssertionError('Unrecognized helper overwritten')
        except RuntimeError: pass
        assert not actions and target.read_bytes() == b'unrelated helper edit'
    assert html.read_text() == 'unchanged HTML' and data.read_bytes() == b'unchanged users/rights/orders'
print('PASS: scoped code lookup and ownership; four raw KIS errors vs gateway responses; order/write/redirect guards; no token/SQL leaks; helper-only update, repeat, rollback, unknown-file guard and data preservation.')
