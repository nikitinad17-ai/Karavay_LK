"""Fix only test-login date defaults; read the selected catalog through KIS/PB.

No account/schema migration, order endpoints, KIS writes or persisted tokens.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/pocketbase')
PB = 'http://127.0.0.1:8090'
KIS = 'http://serv15db:55580'
KNOWN = {'753ff0f4136b7cf2861dfac44c26d6d6091219df358991360656e2bbac3a478a',
         'e569691d5a3227c535e57565bcdc6583dd80b53401236c6d302c53b914003fe8',
         '664c97a27bde4a91a6b6f9ea8d9a38c7dda799ec0a89b8dbf484901bc7929d8f'}
SPB = dt.timezone(dt.timedelta(hours=3))

def days():
    today = dt.datetime.now(SPB).date()
    return [today, today + dt.timedelta(days=1)]

def kid(value):
    return type(value) is int and 0 < value < 2**53

def rid(value):
    return isinstance(value, str) and re.fullmatch('[a-z0-9]{15}', value)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None

class Api:
    def __init__(self, pb=PB, kis=KIS):
        self.pb, self.kis, self.token = pb, kis, ''
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None, upstream=False):
        # The only POST allowed by this operator utility is passwordless PB login.
        if body is not None and (upstream or path != '/service/test-access'):
            raise RuntimeError('WRITE_FORBIDDEN')
        if upstream:
            if not re.fullmatch(r'/api/v1/clients/[1-9][0-9]*(/matrix\?DateOrd=[0-9]+&Group=[01])?', path):
                raise RuntimeError('UPSTREAM_PATH_FORBIDDEN')
        elif not (path in ('/api/health', '/service/test-access', '/service/context')
                  or re.fullmatch(r'/service/clients\?payer=[a-z0-9]{15}(&cursor=[1-9][0-9]*)?&perPage=(?:1|20)', path)
                  or re.fullmatch(r'/service/catalog\?payer=[a-z0-9]{15}&client=[1-9][0-9]*&DateOrd=[0-9]+&Group=[01]', path)):
            raise RuntimeError('PB_PATH_FORBIDDEN')
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if self.token and not upstream:
            headers['Authorization'] = self.token
        req = urllib.request.Request((self.kis if upstream else self.pb) + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            response = self.opener.open(req, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read(8388609)
        if len(raw) > 8388608:
            raise RuntimeError('RESPONSE_TOO_LARGE')
        try:
            parts = re.split(r'("(?:\\.|[^"\\])*")', raw.decode('utf-8-sig'))
            for i in range(0, len(parts), 2):
                parts[i] = re.sub(r'([:\[,]\s*)(-?)\.(\d)', r'\g<1>\g<2>0.\3', parts[i])
            doc = json.loads(''.join(parts))
        except (ValueError, UnicodeError):
            doc = {'code': 'NON_JSON_RESPONSE'}
        return status, doc

    def pb_json(self, path, body=None):
        status, doc = self.call(path, body)
        if status != 200 or not isinstance(doc, dict):
            raise RuntimeError('PB_HTTP_' + str(status) + ': ' + path.split('?')[0])
        return doc

def accounts(api):
    public = api.pb_json('/service/test-access')
    if public.get('environment') != 'test-kis' or len(public.get('accounts', [])) != 3:
        raise RuntimeError('THREE_ENABLED_TEST_ACCOUNTS_REQUIRED')
    return public['accounts']

def service(action):
    subprocess.run(['systemctl', action, 'pocketbase'], check=True, capture_output=True)

def health(api):
    for _ in range(40):
        try:
            if api.call('/api/health')[0] == 200:
                return
        except (OSError, RuntimeError):
            pass
        time.sleep(.2)
    raise RuntimeError('PB_HEALTH_FAILED')

def atomic(path, data, stat):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='test-date-', delete=False) as f:
        temp = pathlib.Path(f.name)
        try:
            os.fchmod(f.fileno(), stat.st_mode & 0o777)
            os.fchown(f.fileno(), stat.st_uid, stat.st_gid)
            f.write(data); f.flush(); os.fsync(f.fileno())
        except BaseException:
            temp.unlink(); raise
    os.replace(temp, path)

def no_pending_migrations(root):
    with sqlite3.connect('file:' + str(root / 'pb_data/data.db') + '?mode=ro', uri=True) as con:
        applied = {r[0] for r in con.execute('SELECT file FROM _migrations')}
    pending = [p.name for p in (root / 'pb_migrations').glob('*.js') if p.name not in applied]
    if pending:
        raise RuntimeError('Pending migrations need review; date helper retained: ' + ', '.join(pending))

def patch_date(root, api, source):
    if os.geteuid() != 0:
        raise RuntimeError('Use sudo for the date patch')
    target = root / 'pb_hooks/karavay-test-access.js'
    if target.is_symlink() or not target.is_file():
        raise RuntimeError('Unexpected test helper path')
    old, new = target.read_bytes(), source.read_bytes()
    if hashlib.sha256(old).hexdigest() not in KNOWN | {hashlib.sha256(new).hexdigest()}:
        raise RuntimeError('Test helper changed separately; it was not replaced')
    before = accounts(api)
    wanted = {a['id'] for a in before}
    if old == new:
        if any(a.get('preferredDate') != days()[1].isoformat() for a in before):
            raise RuntimeError('Updated helper is not being served')
        print('TEST_DATE_ALREADY_OK:', days()[1], flush=True)
        return
    backup = root.parent / ('.karavay-test-date-before-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(target, backup / target.name)
    stat = target.stat()
    stopped, changed = False, False
    try:
        service('stop'); stopped = True
        if target.read_bytes() != old:
            raise RuntimeError('Test helper changed during preflight')
        atomic(target, new, stat); changed = True
        service('start'); stopped = False
        health(api)
        after = accounts(api)
        if {a['id'] for a in after} != wanted or any(a.get('preferredDate') != days()[1].isoformat() for a in after):
            raise RuntimeError('Test date/login list verification failed')
    except BaseException:
        if changed:
            if not stopped:
                service('stop')
            atomic(target, old, stat)
        service('start')
        raise
    print('TEST_DATE_FIXED:', days()[1], '| backup:', backup, flush=True)

def normalize_code(code):
    return str(code).strip().upper().replace('У', 'Y')

def resolve(api, config, code):
    listed = accounts(api)
    multi = [a for a in listed if re.fullmatch(r'demo\.test\.multi(\.v38[23])?@example\.test', a.get('email', ''))]
    if len(multi) != 1 or not rid(multi[0].get('id')):
        raise RuntimeError('ONE_ALLOWLISTED_MULTI_ACCOUNT_REQUIRED')
    auth = api.pb_json('/service/test-access', {'id': multi[0]['id']})
    if auth.get('record', {}).get('id') != multi[0]['id'] or not auth.get('token'):
        raise RuntimeError('TEST_IDENTITY_MISMATCH')
    api.token = auth['token']
    context = api.pb_json('/service/context')
    if context.get('user', {}).get('role') != 'owner':
        raise RuntimeError('TEST_OWNER_REQUIRED')
    # Most screenshots use the configured default point. Verify it directly
    # through the scoped gateway instead of scanning hundreds of recipients.
    default = config.get('point', {})
    if kid(default.get('kid')) and normalize_code(default.get('code', '')) == normalize_code(code):
        first = config['payers'][0]
        payer = next((p for p in context.get('payers', []) if p.get('id') == first.get('id')), None)
        if payer and rid(payer.get('id')) and kid(first.get('kid')):
            page = api.pb_json('/service/clients?payer=' + payer['id'] + ('&cursor=' + str(default['kid'] - 1) if default['kid'] > 1 else '') + '&perPage=1')
            matches = [c for c in page.get('clients', []) if c.get('id') == default['kid'] and normalize_code(c.get('code', '')) == normalize_code(code)]
            if page.get('payer') != payer['id'] or len(matches) != 1:
                raise RuntimeError('DEFAULT_CLIENT_SCOPE_CHANGED')
            return payer, matches[0], first['kid']
    found = []
    for payer in context.get('payers', []):
        if not rid(payer.get('id')):
            raise RuntimeError('INVALID_PAYER')
        cursor = 0
        for _ in range(200):
            page = api.pb_json('/service/clients?payer=' + payer['id'] + ('&cursor=' + str(cursor) if cursor else '') + '&perPage=20')
            if page.get('payer') != payer['id'] or not isinstance(page.get('clients'), list):
                raise RuntimeError('CLIENT_SCOPE_MISMATCH')
            for client in page['clients']:
                if not kid(client.get('id')):
                    raise RuntimeError('INVALID_CLIENT')
                if normalize_code(client.get('code', '')) == normalize_code(code):
                    mapping = [p for p in config['payers'] if p['id'] == payer['id']]
                    if len(mapping) != 1 or not kid(mapping[0].get('kid')):
                        raise RuntimeError('PAYER_MAPPING_MISMATCH')
                    found.append((payer, client, mapping[0]['kid']))
            if not page.get('hasMore'):
                break
            if not kid(page.get('nextCursor')) or page['nextCursor'] <= cursor:
                raise RuntimeError('CLIENT_CURSOR_INVALID')
            cursor = page['nextCursor']
        else:
            raise RuntimeError('CLIENT_PAGE_LIMIT')
    if len(found) != 1:
        raise RuntimeError('CLIENT_CODE_NOT_UNIQUE_OR_NOT_ALLOWED: ' + code)
    return found[0]

def diagnose(api, config, code):
    payer, client, payer_kid = resolve(api, config, code)
    cid = client['id']
    status, detail = api.call('/api/v1/clients/' + str(cid), upstream=True)
    point = detail.get('data') if isinstance(detail, dict) else None
    if status != 200 or not isinstance(point, dict) or point.get('id') != cid or point.get('payer_id') != payer_kid or point.get('state') != 1:
        raise RuntimeError('KIS_CLIENT_MEMBERSHIP_MISMATCH')
    print('CATALOG_RECIPIENT:', payer['name'], '|', client.get('code'), '|', client.get('name'), '| KIS', cid, flush=True)
    for day in days():
        stamp = int(dt.datetime.combine(day, dt.time(), SPB).timestamp())
        for group in (1, 0):
            print('CATALOG_CHECK:', day, '| Group', group, flush=True)
            try:
                status, doc = api.call('/api/v1/clients/' + str(cid) + '/matrix?DateOrd=' + str(stamp) + '&Group=' + str(group), upstream=True)
                print('KIS_CATALOG_HTTP:', status, flush=True)
                error = doc.get('error') if isinstance(doc, dict) else None
                if isinstance(error, dict):
                    print('KIS_MESSAGE:', ' '.join(str(error.get('message', '')).split())[:1800], '| code:', str(error.get('code', ''))[:80], flush=True)
                else:
                    data = doc.get('data') if isinstance(doc, dict) else doc
                    print('KIS_CATALOG_PRODUCTS:', len(data) if isinstance(data, list) else 'invalid response', flush=True)
                status, result = api.call('/service/catalog?payer=' + payer['id'] + '&client=' + str(cid) + '&DateOrd=' + str(stamp) + '&Group=' + str(group))
                print('GATEWAY_CATALOG_HTTP:', status, '| code:', result.get('code', '') if isinstance(result, dict) else 'invalid response', flush=True)
            except (OSError, RuntimeError) as error:
                print('CATALOG_READ_FAILED:', type(error).__name__, flush=True)
    print('CATALOG_READ_COMPLETE: no order endpoints, no KIS writes', flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply-date', action='store_true')
    parser.add_argument('--client-code', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-zА-Яа-я0-9_-]{1,40}', args.client_code):
        raise RuntimeError('INVALID_CLIENT_CODE')
    config = json.loads((ROOT / 'pb_data/karavay-test-access.json').read_text())
    if config.get('environment') != 'test-kis' or config.get('enabled') is not True:
        raise RuntimeError('EXPLICIT_TEST_KIS_CONFIG_REQUIRED')
    api = Api()
    fd = os.open(str(ROOT / '.karavay-test-date.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.apply_date:
            no_pending_migrations(ROOT)
            patch_date(ROOT, api, pathlib.Path(__file__).with_name('karavay-test-access.js'))
        try:
            diagnose(api, config, args.client_code)
        finally:
            api.token = ''

if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit('CATALOG_DATE_STOP: ' + str(error)) from None
