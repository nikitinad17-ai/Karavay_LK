"""One authorized TEST KIS control order, then history through the PB gateway.

Operator diagnostic on the VM, separate from every installer. Never retries an
ambiguous POST. No passwords/PB tokens in files or in requests to KIS.
"""
import argparse
import datetime
import fcntl
import json
import math
import os
import pathlib
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

PB = 'http://127.0.0.1:8090'
KIS = 'http://serv15db:55580'


class Stop(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def integer(value, minimum=1):
    return type(value) is int and minimum <= value <= 1000000


def kid(value):
    return type(value) is int and 0 < value < 2**53


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def decode(raw):
    parts = re.split(r'("(?:\\.|[^"\\])*")', raw.decode('utf-8-sig'))
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r'([:\[,]\s*)(-?)\.(\d)', r'\g<1>\g<2>0.\3', parts[i])
    return json.loads(''.join(parts))


class Api:
    def __init__(self, pb, kis):
        self.pb, self.kis, self.token = pb, kis, ''
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None, upstream=False):
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if self.token and not upstream:
            headers['Authorization'] = self.token
        request = urllib.request.Request(
            (self.kis if upstream else self.pb) + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers,
            method='GET' if body is None else 'POST')
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read(8388609)
        if len(raw) > 8388608:
            raise Stop('RESPONSE_TOO_LARGE')
        return status, decode(raw)

    def pb_json(self, path, body=None):
        status, doc = self.call(path, body)
        if status != 200 or not isinstance(doc, dict):
            raise Stop('PB_HTTP_' + str(status) + ': ' + path.split('?')[0])
        return doc


def write_state(path, value):
    if path.is_symlink():
        raise Stop('STATE_SYMLINK')
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     prefix='karavay-control-', delete=False) as f:
        temp = pathlib.Path(f.name)
        try:
            os.fchmod(f.fileno(), 0o600)
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            temp.unlink()
            raise
    os.replace(temp, path)


def check_contract(api):
    status, doc = api.call('/openapi/v1.json', upstream=True)
    if status != 200:
        raise Stop('OPENAPI_HTTP_' + str(status))
    schemas = doc['components']['schemas']
    body = doc['paths']['/api/v1/orders']['post']['requestBody']['content']['application/json']['schema']
    request = schemas[body['$ref'].rsplit('/', 1)[1]]
    properties = request['properties']
    if not {'Id_clt', 'DateOrd', 'Product'} <= set(properties) or not set(request.get('required', [])) <= {'Id_clt', 'DateOrd', 'Product'}:
        raise Stop('CREATE_CONTRACT_CHANGED')
    item = schemas[properties['Product']['items']['$ref'].rsplit('/', 1)[1]]
    if not {'Id_prd', 'KolSht'} <= set(item['properties']) or not set(item.get('required', [])) <= {'Id_prd', 'KolSht'}:
        raise Stop('PRODUCT_CONTRACT_CHANGED')
    if any(properties[k].get('type') != 'integer' for k in ('Id_clt', 'DateOrd')) or any(item['properties'][k].get('type') != 'integer' for k in ('Id_prd', 'KolSht')):
        raise Stop('CREATE_CONTRACT_CHANGED')


def choose(catalog, minimum):
    choices = []
    for p in catalog:
        if not isinstance(p, dict) or not kid(p.get('id')) or not number(p.get('cenaotp')) or p['cenaotp'] <= 0:
            continue
        per_tray, base = p.get('kol_sht'), p.get('kolshtordmin')
        if base is None:
            if not integer(per_tray):
                continue
            base = per_tray
        elif not integer(base, 0):
            continue
        ratio = minimum / p['cenaotp'] if minimum is not None else 1
        if not math.isfinite(ratio) or ratio > 1000000:
            continue
        qty = max(1, base, math.ceil(ratio))
        if p.get('kolshtordmin') is None:
            qty = math.ceil(qty / per_tray) * per_tray
        if integer(qty):
            total = round(p['cenaotp'] * qty, 2)
            if math.isfinite(total) and (minimum is None or total >= minimum):
                choices.append((total, qty, p['id'], p))
    if not choices:
        raise Stop('NO_VALID_CONTROL_PRODUCT')
    total, qty, _, product = min(choices, key=lambda x: x[:3])
    return product, qty, total


def verify(api, state, path, emit):
    oid, cid, payer = state.get('id'), state['client'], state['payer']
    if not kid(oid):
        raise Stop('ORDER_ID_UNKNOWN: no new POST will be sent')
    suffix = '?' + urllib.parse.urlencode({'payer': payer, 'client': cid})
    detail = api.pb_json('/service/orders/' + str(oid) + suffix)
    if detail.get('payer') != payer or detail.get('client') != cid or detail.get('order', {}).get('id') != oid:
        raise Stop('ORDER_DETAIL_SCOPE_MISMATCH')
    wanted = {p['Id_prd']: p['KolSht'] for p in state['request']['Product']}
    items = detail.get('items')
    if detail.get('itemsAvailable') is not True or not isinstance(items, list) or len(items) != len(wanted) or any(wanted.get(i.get('id')) != i.get('quantity') for i in items):
        raise Stop('ORDER_LINES_MISMATCH')
    offset, found = 0, False
    for _ in range(5):
        page = api.pb_json('/service/orders' + suffix + ('&offset=' + str(offset) if offset else ''))
        if page.get('payer') != payer or page.get('client') != cid or not isinstance(page.get('orders'), list):
            raise Stop('HISTORY_SCOPE_MISMATCH')
        if any(o.get('id') == oid for o in page['orders']):
            found = True
            break
        if page.get('hasMore') is not True:
            break
        cursor = page.get('nextOffset')
        if not integer(cursor) or cursor <= offset:
            raise Stop('INVALID_HISTORY_CURSOR')
        offset = cursor
    if not found:
        raise Stop('ORDER_CREATED_BUT_NOT_IN_HISTORY: KIS id=' + str(oid) + '; no new POST will be sent')
    state['state'] = 'verified'
    write_state(path, state)
    emit('CONTROL_ORDER_HISTORY_OK: KIS id=' + str(oid) + ' | readable lines | PB gateway history')
    return state


def run(pb=PB, kis=KIS, directory=None, new_after_rejection=False, emit=print):
    api = Api(pb, kis)
    access = api.pb_json('/service/test-access')
    if access.get('environment') != 'test-kis':
        raise Stop('TEST_ENVIRONMENT_REQUIRED')
    accounts = [a for a in access.get('accounts', []) if a.get('email') in ('demo.test.point@example.test', 'demo.test.point.v382@example.test')]
    if len(accounts) != 1 or accounts[0].get('id') not in ('test381point001', 'test382point001'):
        raise Stop('ONE_ALLOWLISTED_TEST_POINT_REQUIRED')
    account = accounts[0]
    auth = api.pb_json('/service/test-access', {'id': account['id']})
    if auth.get('record', {}).get('id') != account['id'] or auth['record'].get('active') is not True or auth['record'].get('must_change_password') is not False or not isinstance(auth.get('token'), str) or not auth['token']:
        raise Stop('TEST_IDENTITY_MISMATCH')
    api.token = auth['token']
    ctx = api.pb_json('/service/context')
    if ctx.get('user', {}).get('role') != 'owner' or len(ctx.get('payers', [])) != 1:
        raise Stop('TEST_POINT_SCOPE_MISMATCH')
    payer = ctx['payers'][0]['id']
    clients = api.pb_json('/service/clients?payer=' + payer + '&perPage=20')
    if clients.get('payer') != payer or len(clients.get('clients', [])) != 1 or clients.get('hasMore') is not False:
        raise Stop('ONE_TEST_RECIPIENT_REQUIRED')
    point = clients['clients'][0]
    cid = point.get('id')
    if not kid(cid) or account.get('preferredClient', cid) != cid:
        raise Stop('TEST_RECIPIENT_MISMATCH')
    suffix = '?' + urllib.parse.urlencode({'payer': payer, 'client': cid})
    options = api.pb_json('/service/order-options' + suffix)
    if options.get('payer') != payer or options.get('client') != cid or options.get('create') is not True:
        raise Stop('ORDER_CREATION_DISABLED')
    minimum = options.get('minimumSum')
    if minimum is not None and not number(minimum):
        raise Stop('INVALID_MINIMUM_SUM')
    root = pathlib.Path(directory) if directory is not None else pathlib.Path.home()
    path = root / ('karavay-control-order-' + account['id'] + '.json')
    lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop('CONTROL_ALREADY_RUNNING') from None
        if path.is_symlink():
            raise Stop('STATE_SYMLINK')
        old = json.loads(path.read_text()) if path.exists() else None
        if old:
            if old.get('version') != 1 or old.get('account') != account['id'] or old.get('payer') != payer or old.get('client') != cid:
                raise Stop('SAVED_CONTROL_SCOPE_CHANGED')
            if kid(old.get('id')):
                return verify(api, old, path, emit)
            if not (new_after_rejection and old.get('state') == 'rejected'):
                emit('SAVED_CONTROL: ' + old.get('state', 'unknown') + ' | ' + str(path))
                if old.get('message'):
                    emit('KIS_MESSAGE: ' + old['message'])
                raise Stop('NO_REPEAT_POST: previous result must be resolved first')
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
            write_state(root / (path.stem + '-rejected-' + stamp + '.json'), old)
        check_contract(api)
        day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() + datetime.timedelta(days=1)).isoformat()
        timestamp = int(datetime.datetime.fromisoformat(day + 'T00:00:00+03:00').timestamp())
        selected = None
        for group in (1, 0):
            cat = api.pb_json('/service/catalog' + suffix + '&DateOrd=' + str(timestamp) + '&Group=' + str(group))
            if cat.get('payer') != payer or cat.get('client') != cid or cat.get('DateOrd') != timestamp or cat.get('Group') != group or not isinstance(cat.get('products'), list):
                raise Stop('CATALOG_SCOPE_MISMATCH')
            try:
                selected = (*choose(cat['products'], minimum), group)
                break
            except Stop:
                pass
        if selected is None:
            raise Stop('NO_VALID_CONTROL_PRODUCT')
        product, qty, total, group = selected
        payload = {'Id_clt': cid, 'DateOrd': timestamp, 'Product': [{'Id_prd': product['id'], 'KolSht': qty}]}
        state = {'version': 1, 'account': account['id'], 'payer': payer, 'client': cid,
                 'day': day, 'group': group, 'request': payload, 'sum': total,
                 'minimum_sum': minimum, 'state': 'attempted', 'id': None}
        emit('CONTROL_SCOPE: ' + ctx['payers'][0].get('name', payer) + ' | ' + point.get('name', str(cid)))
        emit('CONTROL_PRODUCT: ' + str(product.get('kod', product['id'])) + ' | ' + str(product.get('name', '')) + ' | pieces=' + str(qty) + ' | sum=' + str(total))
        emit('KIS_REQUEST: ' + json.dumps(payload))
        # Last guard before the one direct operator POST. The PB token stays in PB.
        fresh = api.pb_json('/service/order-options' + suffix)
        if fresh.get('create') is not True or fresh.get('payer') != payer or fresh.get('client') != cid:
            raise Stop('ORDER_CREATION_DISABLED')
        write_state(path, state)
        emit('CONTROL_STATE: ' + str(path))
        try:
            status, response = api.call('/api/v1/orders', payload, upstream=True)
        except Exception as error:
            state['state'] = 'unknown'
            write_state(path, state)
            raise Stop('KIS_RESULT_UNKNOWN: no automatic repeat POST; ' + type(error).__name__) from None
        state['http'], state['response'] = status, response
        if status == 400 and isinstance(response, dict) and response.get('success') is False:
            error = response.get('error')
            message = error.get('message', '') if isinstance(error, dict) else response.get('message', '')
            state['state'], state['message'] = 'rejected', ' '.join(str(message).split())[:1800]
            write_state(path, state)
            emit('KIS_HTTP: ' + str(status))
            emit('KIS_MESSAGE: ' + state['message'])
            raise Stop('KIS_CONTROL_REJECTED: KIS did not confirm creation for the documented request')
        result = response.get('data') if isinstance(response, dict) else None
        oid = result.get('id', result.get('Id_ord')) if isinstance(result, dict) else None
        if status not in (200, 201) or not isinstance(response, dict) or response.get('success') is not True or not kid(oid):
            state['state'] = 'unknown'
            write_state(path, state)
            raise Stop('KIS_RESULT_UNKNOWN: no automatic repeat POST')
        state['state'], state['id'] = 'created', oid
        write_state(path, state)
        emit('KIS_CONTROL_CREATED: ' + str(oid))
        return verify(api, state, path, emit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--new-after-rejection', action='store_true')
    args = parser.parse_args()
    try:
        run(new_after_rejection=args.new_after_rejection)
    except (Stop, KeyError, ValueError, urllib.error.URLError, OSError) as error:
        print('CONTROL_STOP: ' + str(error))
        raise SystemExit(1)
