"""Real HTTP fixtures; the standalone VM operator diagnostic never touches KIS here."""
import concurrent.futures
import contextlib
import http.server
import importlib.util
import json
import pathlib
import tempfile
import threading
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('control', HERE / 'control-order.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
PAYER = 'aaaaaaaaaaaaaaa'
TOKEN = 'fixture-token-never-save-or-forward'
ACCOUNT = 'test381point001'


class Fixture:
    def __init__(self):
        self.posts, self.calls, self.failures = [], [], []
        self.mode, self.history, self.environment, self.role = 'success', True, 'test-kis', 'owner'
        self.created, self.invalid_packing, self.foreign = False, False, False
        self.entered, self.release = threading.Event(), threading.Event()
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), self.handler())
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)

    def handler(self):
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.handle_request()

            def do_POST(self):
                self.handle_request()

            def handle_request(self):
                try:
                    status, doc = fixture.dispatch(self)
                    raw = json.dumps(doc).encode()
                    self.send_response(status)
                    if status == 302:
                        self.send_header('Location', fixture.base + '/kis/forbidden-redirect')
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(raw)
                except Exception as error:
                    fixture.failures.append(str(error))
                    self.send_error(500)
        return Handler

    def dispatch(self, request):
        path = request.path.split('?')[0]
        self.calls.append((request.command, request.path))
        body = json.loads(request.rfile.read(int(request.headers.get('Content-Length', '0')))) if request.command == 'POST' else None
        if path.startswith('/kis/'):
            assert request.headers.get('Authorization') is None, 'PB token leaked to KIS'
        elif path.startswith('/pb/') and path != '/pb/service/test-access':
            assert request.headers.get('Authorization') == TOKEN
        if path == '/pb/service/test-access':
            if body is not None:
                assert body == {'id': ACCOUNT}
                return 200, {'token': TOKEN, 'record': {'id': ACCOUNT, 'active': True, 'must_change_password': False}}
            return 200, {'environment': self.environment, 'accounts': [{'id': ACCOUNT, 'email': 'demo.test.point@example.test', 'preferredClient': 2}]}
        if path == '/pb/service/context':
            if self.mode == 'redirect':
                return 302, {}
            return 200, {'user': {'role': self.role}, 'payers': [{'id': PAYER, 'name': 'Fixture buyer'}]}
        if path == '/pb/service/clients':
            return 200, {'payer': PAYER, 'clients': [{'id': 3 if self.foreign else 2, 'name': 'Fixture recipient'}], 'hasMore': False}
        if path == '/pb/service/order-options':
            return 200, {'payer': PAYER, 'client': 2, 'create': True, 'minimumSum': 200}
        if path == '/pb/service/catalog':
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(request.path).query)
            products = [{'id': 66, 'kod': 'BREAD', 'name': 'Whole trays', 'kol_sht': None if self.invalid_packing else 8, 'kolshtordmin': None, 'cenaotp': 34.9}]
            return 200, {'payer': PAYER, 'client': 2, 'DateOrd': int(q['DateOrd'][0]), 'Group': int(q['Group'][0]), 'products': products}
        if path == '/kis/openapi/v1.json':
            return 200, {'paths': {'/api/v1/orders': {'post': {'requestBody': {'content': {'application/json': {'schema': {'$ref': '#/components/schemas/CreateOrderRequest'}}}}}}}, 'components': {'schemas': {
                'CreateOrderRequest': {'properties': {'Id_clt': {'type': 'integer'}, 'DateOrd': {'type': 'integer'}, 'Product': {'items': {'$ref': '#/components/schemas/CreateOrderProductItem'}}}},
                'CreateOrderProductItem': {'properties': {'Id_prd': {'type': 'integer'}, 'KolSht': {'type': 'integer'}}}}}}
        if path == '/kis/api/v1/orders':
            assert request.command == 'POST' and set(body) == {'Id_clt', 'DateOrd', 'Product'}
            assert body['Id_clt'] == 2 and body['Product'] == [{'Id_prd': 66, 'KolSht': 8}]
            self.posts.append(body)
            if self.mode == 'slow':
                self.entered.set()
                assert self.release.wait(5)
            if self.mode == 'reject':
                return 400, {'success': False, 'error': {'message': 'Не задан aId_Clt', 'details': 'fixture oracle stack'}}
            if self.mode == 'unknown':
                return 201, {'success': True, 'data': {}}
            self.created = True
            return 201, {'success': True, 'data': {'Id_ord': 700}}
        if path == '/pb/service/orders/700':
            assert self.created
            return 200, {'payer': PAYER, 'client': 2, 'order': {'id': 700}, 'itemsAvailable': True, 'items': [{'id': 66, 'quantity': 8}]}
        if path == '/pb/service/orders':
            return 200, {'payer': PAYER, 'client': 2, 'orders': [{'id': 700}] if self.created and self.history else [], 'hasMore': False}
        raise AssertionError('Unexpected HTTP request ' + path)

    def __enter__(self):
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        assert not self.failures, self.failures


def run(fixture, folder, **kw):
    return control.run(fixture.base + '/pb', fixture.base + '/kis', folder, emit=lambda _: None, **kw)


def stops(callback, code):
    try:
        callback()
        raise AssertionError('Expected stop: ' + code)
    except control.Stop as error:
        assert code in str(error), str(error)


with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    state = run(f, folder)
    assert state['state'] == 'verified' and state['id'] == 700 and len(f.posts) == 1
    assert run(f, folder)['id'] == 700 and len(f.posts) == 1
    state_path = pathlib.Path(folder) / ('karavay-control-order-' + ACCOUNT + '.json')
    assert TOKEN not in state_path.read_text() and state_path.stat().st_mode & 0o777 == 0o600
    assert not any(m == 'POST' and p != '/pb/service/test-access' and p != '/kis/api/v1/orders' for m, p in f.calls)
print('PASS: one exact documented control POST, whole trays/minimum, gateway history/details, repeat reads only, private state without token.')

with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    f.mode = 'reject'
    stops(lambda: run(f, folder), 'KIS_CONTROL_REJECTED')
    stops(lambda: run(f, folder), 'NO_REPEAT_POST')
    assert len(f.posts) == 1
    f.mode = 'success'
    assert run(f, folder, new_after_rejection=True)['id'] == 700 and len(f.posts) == 2
    assert len(list(pathlib.Path(folder).glob('*-rejected-*.json'))) == 1
print('PASS: KIS rejection retained, no retry; explicit new attempt requires definite rejection and archives its result.')

with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    f.mode = 'unknown'
    stops(lambda: run(f, folder), 'KIS_RESULT_UNKNOWN')
    stops(lambda: run(f, folder, new_after_rejection=True), 'NO_REPEAT_POST')
    assert len(f.posts) == 1
print('PASS: ambiguous creation cannot be repeated, including the explicit rejection-only flag.')

with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    f.history = False
    stops(lambda: run(f, folder), 'ORDER_CREATED_BUT_NOT_IN_HISTORY')
    assert len(f.posts) == 1
    f.history = True
    assert run(f, folder)['state'] == 'verified' and len(f.posts) == 1
print('PASS: missing history after creation is distinct from POST rejection; verification resumes without a new order.')

for field, value, code in [('invalid_packing', True, 'NO_VALID_CONTROL_PRODUCT'), ('environment', 'production', 'TEST_ENVIRONMENT_REQUIRED'), ('role', 'viewer', 'TEST_POINT_SCOPE_MISMATCH'), ('foreign', True, 'TEST_RECIPIENT_MISMATCH')]:
    with tempfile.TemporaryDirectory() as folder, Fixture() as f:
        setattr(f, field, value)
        stops(lambda: run(f, folder), code)
        assert not f.posts
print('PASS: invalid packing, wrong environment/role/recipient all prevent creation.')

with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    f.mode = 'redirect'
    stops(lambda: run(f, folder), 'PB_HTTP_302')
    assert not any('forbidden-redirect' in p for _, p in f.calls)
print('PASS: redirects are not followed; PB token cannot be redirected into KIS.')

with tempfile.TemporaryDirectory() as folder, Fixture() as f:
    f.mode = 'slow'
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        first = pool.submit(run, f, folder)
        assert f.entered.wait(5)
        stops(lambda: run(f, folder), 'CONTROL_ALREADY_RUNNING')
        f.release.set()
        assert first.result()['id'] == 700 and len(f.posts) == 1
print('PASS: concurrent runs cannot submit duplicate direct KIS orders.')
