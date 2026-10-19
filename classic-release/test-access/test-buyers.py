"""Real HTTP read-only KIS fixture. This never connects to the user's KIS."""
import copy
import importlib.util
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
s = module('buyers', HERE / 'select-buyers.py')
seed = module('seed', HERE.parent / 'scripts/Seed-Demo-Users.py')
history = module('history', HERE / 'select-history.py')
def payer(pid, name):
    return {'id': pid, 'name': name, 'kod': str(pid), 'state': 1}
docs = { '/payers': [payer(2, 'Manufacturer A'), payer(3, 'Manufacturer B'),
    payer(900009, 'ОАО «Каравай»'), payer(900008, 'АО ПАЛЯНИЦА'),
    payer(900007, 'ООО НЕВА'), payer(900006, 'ПРОМТЕХСБЫТ'),
    payer(800003, 'HTTP fixture customer without prices'), payer(800002, 'Foreign recipient'),
    payer(800001, 'HTTP fixture customer A'), payer(700001, 'HTTP fixture customer B')] }
for p in docs['/payers']:
    pid = p['id']; docs['/payers/' + str(pid)] = p
    points = [{'id': pid + n, 'payer_id': pid if pid != 800002 else 123,
               'kod': 'C' + str(pid + n), 'name': 'Fixture point ' + str(n), 'state': 1} for n in ((100, 101) if pid == 800002 else (10, 11))]
    docs['/payers/' + str(pid) + '/clients'] = points
    for point in points:
        docs['/clients/' + str(point['id'])] = point
calls = []
catalog_failure = True
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        raise AssertionError('KIS writes forbidden')
    def do_GET(self):
        assert not self.headers.get('Authorization'), 'PB token forwarded to KIS'
        path = self.path.removeprefix('/api/v1'); calls.append(path)
        assert '/orders' not in path, 'Selection unexpectedly depends on history'
        if '/matrix?' in path:
            if catalog_failure:
                body = json.dumps({'success': False, 'error': {'code': '-20001', 'message': '3002 Бублики Украинские 1с 0.1 уп.2шт.19.10.26. Не определена цена.', 'details': 'private-oracle-stack'}}).encode()
                self.send_response(400); self.end_headers(); self.wfile.write(body); return
            cid = int(path.split('/')[2]); data = [{'id_prd': 66, 'kolukl': None if cid in (800013, 800014) and path.endswith('Group=1') else 8, 'kolshtordmin': None, 'cenaotp': 34.9}]
        else: data = docs[path]
        body = json.dumps({'success': True, 'data': data}).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(body)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
try:
    with patch.object(seed, 'KIS', 'http://127.0.0.1:' + str(server.server_port) + '/api/v1'):
        api = seed.Api(); api.token = 'must-stay-local'
        selected = s.select(api, emit=lambda _: None)
        assert [c['payer']['id'] for c in selected] == [800003, 800001]
        assert not any('/matrix?' in path for path in calls), 'Price read gates account selection'
        assert len(selected[0]['points']) == 2 and all(c['stamp'] % 86400 == 75600 for c in selected)
        assert all(not any(path.startswith('/payers/' + str(pid) + '/') or path == '/payers/' + str(pid) for path in calls) for pid in (2, 3, 900009, 900008, 900007, 900006))
        saved = {'buyers': {'version': 1, 'proofs': [{'payer_kid': c['payer']['id'], 'clients': [p['point']['id'] for p in c['points']]} for c in selected]}}
        assert [c['payer']['id'] for c in s.select(api, saved, emit=lambda _: None)] == [800003, 800001]
        messages = []
        s.probe_catalogs(api, selected, messages.append)
        assert [c['payer']['id'] for c in selected] == [800003, 800001]
        assert all(c['catalog_available'] is False for c in selected)
        assert sum('/matrix?' in path for path in calls) == 4
        assert sum('CATALOG_WARNING' in m and 'Не определена цена' in m for m in messages) == 4
        assert all('private-oracle-stack' not in m and 'must-stay-local' not in m for m in messages)
        catalog_failure = False
        s.probe_catalogs(api, selected, lambda _: None)
        assert all(c['catalog_available'] is True for c in selected) and selected[0]['group'] == 0
        original = copy.deepcopy(docs['/clients/800013'])
        docs['/clients/800013']['state'] = 0
        try:
            s.select(api, saved, emit=lambda _: None); raise AssertionError('Saved inactive point accepted')
        except RuntimeError as error: assert 'Saved' in str(error)
        docs['/clients/800013'] = original
        original = docs['/payers']; docs['/payers'] = [payer(2, 'Manufacturer A'), payer(3, 'Manufacturer B')]
        try:
            s.select(api, emit=lambda _: None); raise AssertionError('Manufacturers chosen as fallback')
        except RuntimeError as error: assert 'BUYER_SCENARIOS_NOT_FOUND' in str(error)
        docs['/payers'] = original
finally:
    server.shutdown(); server.server_close(); thread.join()
for row in [payer(2, 'anything'), payer(3, 'anything'), payer(300182, 'anything'), payer(299271, 'anything'), payer(999, '«Каравай»'), payer(998, 'АО Паляница')]:
    assert s.excluded(row) and seed.excluded(row) and not history.eligible(row)
assert not s.usable({'id_prd': 1, 'cenaotp': 1, 'kolukl': None, 'kolshtordmin': None})
assert s.usable({'id_prd': 1, 'cenaotp': 1, 'kolukl': None, 'kolshtordmin': 0})
assert s.usable({'id_prd': 1, 'cenaotp': 1, 'kolukl': 8, 'kolshtordmin': None})
print('PASS: actual HTTP reader; customer/recipient selection independent of catalog; four captured-style HTTP 400 price failures do not change/block accounts; separate warnings and Group 0 probe; manufacturer/ownership/saved-scope guards; no history, POST, token or SQL-detail leaks.')
