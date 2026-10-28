#!/usr/bin/env python3
"""Install three distinct passwordless TEST KIS scenarios with proven histories."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

SOURCE = pathlib.Path(__file__).resolve().parents[1]
ROOT = pathlib.Path('/opt/pocketbase')
PB = 'http://127.0.0.1:8090'
KIS = 'http://serv15db:55580/api/v1'
HELPER = 'pb_hooks/karavay-test-access.js'
MIGRATION = '1793090000_test_diverse_history_users.js'
CONFIG = 'pb_data/karavay-test-access.json'
KNOWN_HELPERS = {'753ff0f4136b7cf2861dfac44c26d6d6091219df358991360656e2bbac3a478a',
                 '84e179ecf77815f79cb4f7ed14efbbe37b6eb0752c42cb1f358c61a3ab49b9ad',
                 'e569691d5a3227c535e57565bcdc6583dd80b53401236c6d302c53b914003fe8',
                 '664c97a27bde4a91a6b6f9ea8d9a38c7dda799ec0a89b8dbf484901bc7929d8f',
                 '1cc4199f80209ccf1b783352deab667fbfd7a0878e011e140ea7252188be3c5b'}
spec = importlib.util.spec_from_file_location('diverse_selection', SOURCE / 'test-access/select-diverse-history.py')
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


class ApiError(RuntimeError):
    def __init__(self, status, code, message, path):
        self.status = status
        super().__init__('HTTP ' + str(status) + ' ' + code + ' ' + path.split('?')[0] + ' | ' + message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class Api:
    def __init__(self, pb=PB, kis=KIS):
        self.pb, self.kis, self.token = pb, kis, ''
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None, kis=False):
        if body is not None and (kis or path != '/service/test-access'):
            raise RuntimeError('WRITE_FORBIDDEN: only PB demo login POST is permitted')
        if kis:
            if not re.fullmatch(r'/payers(?:/[1-9][0-9]*(?:/clients)?)?|/clients/[1-9][0-9]*(?:/orders|/matrix\?DateOrd=[0-9]+&Group=[01])?|/orders/[1-9][0-9]*', path):
                raise RuntimeError('KIS_PATH_FORBIDDEN')
        elif not (path in ('/', '/api/health', '/service/test-access', '/service/context')
                  or re.fullmatch(r'/service/clients\?payer=[a-z0-9]{15}(?:&cursor=[1-9][0-9]*)?&perPage=(?:1|20)', path)
                  or re.fullmatch(r'/service/orders(?:/[1-9][0-9]*)?\?payer=[a-z0-9]{15}&client=[1-9][0-9]*', path)):
            raise RuntimeError('PB_PATH_FORBIDDEN')
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if self.token and not kis:
            headers['Authorization'] = self.token
        request = urllib.request.Request((self.kis if kis else self.pb) + path,
                    data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            response = self.opener.open(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read(8388609)
        if len(raw) > 8388608:
            raise RuntimeError('RESPONSE_TOO_LARGE')
        if path == '/' and not kis and status == 200:
            return raw
        try:
            parts = re.split(r'("(?:\\.|[^"\\])*")', raw.decode('utf-8-sig'))
            if kis:
                for i in range(0, len(parts), 2):
                    parts[i] = re.sub(r'([:\[,]\s*)(-?)\.(\d)', r'\g<1>\g<2>0.\3', parts[i])
            doc = json.loads(''.join(parts))
        except (ValueError, UnicodeError):
            raise ApiError(status, 'NON_JSON', '', path) from None
        if status != 200 or not isinstance(doc, dict) or (kis and (doc.get('success') is not True or 'data' not in doc)):
            error = doc.get('error', doc) if isinstance(doc, dict) else {}
            code = str(error.get('code', 'INVALID_RESPONSE'))[:80] if isinstance(error, dict) else 'INVALID_RESPONSE'
            message = ' '.join(str(error.get('message', '')).split())[:1200] if isinstance(error, dict) else ''
            raise ApiError(status, code, message, path)
        return doc['data'] if kis else doc


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_db(root):
    con = sqlite3.connect('file:' + str(root / 'pb_data/data.db') + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    return con


def atomic(path, data, owner):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.karavay-diverse-', delete=False) as stream:
        temp = pathlib.Path(stream.name)
        try:
            os.fchmod(stream.fileno(), 0o600 if path.name.endswith('.json') else 0o644)
            os.fchown(stream.fileno(), owner.st_uid, owner.st_gid)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def save_json(path, value, owner):
    if path.is_symlink():
        raise RuntimeError('Refusing symbolic link: ' + path.name)
    atomic(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode(), owner)


def service(action):
    subprocess.run(['systemctl', action, 'pocketbase'], check=True, capture_output=True)


def health(api):
    for _ in range(50):
        try:
            api.call('/api/health')
            return
        except (RuntimeError, OSError):
            time.sleep(.2)
    raise RuntimeError('PocketBase did not recover')


def check_pending(root):
    with read_db(root) as con:
        applied = {r[0] for r in con.execute('SELECT file FROM _migrations')}
        pending = [p.name for p in (root / 'pb_migrations').glob('*.js') if p.name not in applied and p.name != MIGRATION]
        if pending:
            raise RuntimeError('Unrelated pending migrations: ' + ', '.join(pending))


def preflight(root, api, manifest_name='DIVERSE-MANIFEST.json'):
    manifest = json.loads((SOURCE / 'test-access' / manifest_name).read_text())
    for name, digest in manifest['files'].items():
        if sha(SOURCE / name) != digest:
            raise RuntimeError('Package hash mismatch: ' + name)
    hashes = {}
    for name, allowed in {HELPER: KNOWN_HELPERS | {manifest['files'][HELPER]},
                          'pb_public/index.html': set(manifest['known_html']) | {manifest['files']['pb_public/index.html']},
                          'pb_hooks/karavay-test-access.pb.js': {manifest['route_sha256']}}.items():
        if (root / name).is_symlink() or sha(root / name) not in allowed:
            raise RuntimeError('Unknown installed file; retained: ' + name)
        hashes[name] = sha(root / name)
    if (root / CONFIG).is_symlink():
        raise RuntimeError('Unexpected test config symbolic link')
    saved = json.loads((root / CONFIG).read_text())
    if saved.get('enabled') is not True or saved.get('environment') != 'test-kis' or saved.get('version') not in (1, 2):
        raise RuntimeError('Explicitly enabled TEST KIS demo configuration required')
    if '0.40.3' not in subprocess.run([str(root / 'pocketbase'), '--version'], check=True, capture_output=True, text=True).stdout:
        raise RuntimeError('PocketBase 0.40.3 required')
    with read_db(root) as con:
        definitions = {r['name']: json.loads(r['fields']) for r in con.execute('SELECT name,fields FROM _collections')}
        for name, fields in manifest['required_fields'].items():
            actual = {f['name']: f['type'] for f in definitions.get(name, [])}
            if any(actual.get(k) != kind for k, kind in fields.items()):
                raise RuntimeError('Schema differs: ' + name)
    check_pending(root)
    health(api)
    hashes[CONFIG] = sha(root / CONFIG)
    if (root / 'pb_migrations' / MIGRATION).exists() and sha(root / 'pb_migrations' / MIGRATION) != manifest['files']['test-access/' + MIGRATION]:
        raise RuntimeError('Demo migration differs')
    return saved, manifest, hashes


def allowed_mapping(root, payer, cid):
    with read_db(root) as con:
        payers = list(con.execute('SELECT * FROM payers WHERE id_pay=? OR kod_pay=?', (payer['id'], payer['kod'])))
        if payers and (len(payers) != 1 or payers[0]['id_pay'] != payer['id'] or payers[0]['kod_pay'] != payer['kod'] or not payers[0]['active']):
            return False
        if cid is not None:
            points = list(con.execute('SELECT * FROM clients WHERE id_clt=?', (cid,)))
            if points and (len(points) != 1 or not payers or points[0]['payer'] != payers[0]['id'] or not points[0]['active']):
                return False
    return True


def grants(config, index):
    all_points = lambda p: {'payer': p['id'], 'scope': 'all', 'kis_client_id': 0, 'client': ''}
    if index == 0:
        return [{'payer': config['payers'][0]['id'], 'scope': 'client', 'kis_client_id': config['point']['kid'], 'client': config['point']['id']}]
    return [all_points(config['payers'][1])] if index == 1 else [all_points(config['payers'][2]), all_points(config['payers'][1])]


def plan(root, chosen, previous=None, namespace='384'):
    if namespace not in ('384', '385'):
        raise RuntimeError('Unsupported demo namespace')
    def new_id():
        return ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(15))
    with read_db(root) as con:
        def query(sql, args=()):
            return [dict(r) for r in con.execute(sql, args)]
        roles = query('SELECT id FROM roles WHERE active=1 AND code_role="owner"')
        if len(roles) != 1:
            raise RuntimeError('One active owner role required')
        config = {'version': 2, 'enabled': True, 'environment': 'test-kis', 'ownerRole': roles[0]['id'],
                  'managerOwner': '', 'payers': [], 'points': [], 'accounts': [],
                  'history': {'version': 2, 'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'proofs': []}}
        fields = json.loads(query('SELECT fields FROM _collections WHERE name="users"')[0]['fields'])
        if any(f['name'] == 'manager_owner' for f in fields):
            managers = query('SELECT u.id FROM users u JOIN roles r ON r.id=u.role WHERE u.active=1 AND u.must_change_password=0 AND u.role_code="manager" AND r.active=1 AND r.code_role="manager" AND u.name=?', ('Менеджер Каравай',))
            if len(managers) > 1:
                raise RuntimeError('Manager name ambiguous')
            if managers:
                config['managerOwner'] = managers[0]['id']
        for item in chosen:
            p, c = item['payer'], item['point']
            if not allowed_mapping(root, p, c['id']):
                raise RuntimeError('Customer mapping changed during selection')
            existing = query('SELECT id FROM payers WHERE id_pay=?', (p['id'],))
            pid = existing[0]['id'] if existing else new_id()
            config['payers'].append({'id': pid, 'kid': p['id'], 'name': p['name'], 'code': p['kod']})
            existing = query('SELECT id FROM clients WHERE id_clt=?', (c['id'],))
            config['points'].append({'id': existing[0]['id'] if existing else new_id(), 'kid': c['id'], 'name': c['name'], 'code': c['kod']})
            config['history']['proofs'].append({'payer_kid': p['id'], 'client': c['id'], 'order_id': item.get('order_id'), 'day': item['day'], 'stamp': item['stamp'], 'group': item['group'], 'count': item.get('history_count', 0)})
        config['point'] = config['points'][0]
        names = ['Одна точка · ', 'Покупатель · ', 'Несколько покупателей · ']
        if namespace == '385':
            config['scenario'] = 'multi-recipient-v385'
            names = ['Один получатель · ', 'Несколько получателей (от 2) · ', 'Два покупателя · ']
        for i, slug in enumerate(('point', 'buyer', 'multi')):
            customer_name = config['payers'][i]['name']
            text = customer_name + ' · ' + config['points'][i]['name'] if i == 0 else customer_name + ' · все активные получатели' if i == 1 else customer_name + ' / ' + config['payers'][1]['name'] + ' · все активные получатели'
            if namespace == '385' and i == 1:
                points = chosen[1]['points']
                if len(points) < 2 or len({p['point']['id'] for p in points}) < 2:
                    raise RuntimeError('Multiple-recipient demo requires at least TWO distinct active recipients')
                text = customer_name + ' · Проверены точки: ' + '; '.join(p['point']['kod'] + ' — ' + p['point']['name'] for p in points)
            account = {'id': 'test' + namespace + slug + '001', 'name': names[i] + customer_name,
                       'email': 'demo.test.' + slug + '.v' + namespace + '@example.test', 'login': 'kis_test_' + slug + '_v' + namespace,
                       'description': text, 'rights': ['t' + namespace + slug + '000001'] + (['t' + namespace + slug + '000002'] if i == 2 else [])}
            config['accounts'].append(account)
            existing = query('SELECT * FROM users WHERE id=? OR email=? OR login=?', (account['id'], account['email'], account['login']))
            if existing:
                u = existing[0]
                if (len(existing) != 1 or any(u[k] != account[k] for k in ('id', 'name', 'email', 'login'))
                        or u['role'] != config['ownerRole'] or u['role_code'] != 'owner' or not u['active'] or u['must_change_password']
                        or ('manager_owner' in u and u['manager_owner'] != config['managerOwner'])):
                    raise RuntimeError('Demo identity occupied/changed; no user overwritten')
                rights = query('SELECT * FROM rights WHERE user=?', (account['id'],))
                expected = grants(config, i)
                if len(rights) != len(expected) or any(not r['active'] or not any(all(r[k] == v for k, v in g.items()) for g in expected) for r in rights):
                    raise RuntimeError('Demo rights changed; no rights overwritten')
            for rid in account['rights']:
                other = query('SELECT user FROM rights WHERE id=?', (rid,))
                if other and other[0]['user'] != account['id']:
                    raise RuntimeError('Demo right ID occupied')
        if previous and previous.get('version') == 2:
            # Existing installed users cannot silently acquire another customer.
            for key in ('ownerRole', 'managerOwner', 'payers', 'points', 'accounts'):
                if config[key] != previous[key]:
                    raise RuntimeError('Installed demo selection changed: ' + key)
    return config


def verify(api, config, html_sha):
    health(api)
    if hashlib.sha256(api.call('/')).hexdigest() != html_sha:
        raise RuntimeError('Served HTML differs')
    public = api.call('/service/test-access')
    listed = public.get('accounts', [])
    if public.get('environment') != 'test-kis' or {a['id'] for a in listed} != {a['id'] for a in config['accounts']}:
        raise RuntimeError('Three demo buttons are not available')
    for i, account in enumerate(config['accounts']):
        preferred = next(a for a in listed if a['id'] == account['id'])
        p, c, evidence = config['payers'][i], config['points'][i], config['history']['proofs'][i]
        if preferred.get('preferredPayer') != p['id'] or preferred.get('preferredClient') != c['kid']:
            raise RuntimeError('Demo default points to a different customer')
        auth = api.call('/service/test-access', {'id': account['id']})
        if auth.get('record', {}).get('id') != account['id']:
            raise RuntimeError('Wrong demo identity')
        api.token = auth['token']
        ctx = api.call('/service/context')
        expected = {g['payer'] for g in grants(config, i)}
        if {p['id'] for p in ctx.get('payers', [])} != expected:
            raise RuntimeError('Demo scope mismatch')
        if i == 0:
            single = api.call('/service/clients?payer=' + p['id'] + '&perPage=20')
            if [r['id'] for r in single.get('clients', [])] != [c['kid']] or single.get('hasMore'):
                raise RuntimeError('Single-recipient scope expanded')
        for grant in grants(config, i):
            mapping = next(p for p in config['payers'] if p['id'] == grant['payer'])
            n = config['payers'].index(mapping)
            point, proof = config['points'][n], config['history']['proofs'][n]
            path = '/service/clients?payer=' + mapping['id']
            # The server cursor is a KIS ID. Verify exact default point even in a large directory.
            page = api.call(path + ('&cursor=' + str(point['kid'] - 1) if point['kid'] > 1 else '') + '&perPage=1')
            if [row['id'] for row in page.get('clients', [])] != [point['kid']]:
                raise RuntimeError('Proven history recipient missing through gateway')
            suffix = '?payer=' + mapping['id'] + '&client=' + str(point['kid'])
            history = api.call('/service/orders' + suffix)
            if not history.get('orders') or history.get('count') != len(history['orders']) or proof['order_id'] not in {r['id'] for r in history['orders']}:
                raise RuntimeError('Proven history missing through gateway')
            detail = api.call('/service/orders/' + str(proof['order_id']) + suffix)
            if detail.get('order', {}).get('id') != proof['order_id'] or not detail.get('itemsAvailable') or not detail.get('items'):
                raise RuntimeError('Order lines missing through gateway')
        forbidden = config['payers'][2 if i < 2 else 0]['id']
        try:
            api.call('/service/clients?payer=' + forbidden + '&perPage=20')
        except ApiError as error:
            if error.status != 403:
                raise
        else:
            raise RuntimeError('Foreign customer access was permitted')
        print('DEMO_HISTORY_OK:', account['email'], '|', p['name'], '|', c['code'], '| order', evidence['order_id'], flush=True)
    api.token = ''


def deploy(root, api, config, manifest, before):
    names = [HELPER, 'pb_public/index.html', 'pb_migrations/' + MIGRATION, CONFIG]
    backup = root.parent / ('.karavay-diverse-before-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(mode=0o700)
    for name in names:
        if (root / name).is_symlink():
            raise RuntimeError('Unexpected symbolic link: ' + name)
    stopped, changed = False, False
    try:
        service('stop')
        stopped = True
        for name, digest in before.items():
            if sha(root / name) != digest:
                raise RuntimeError('Installed file changed during the history search: ' + name)
        check_pending(root)
        shutil.copytree(root / 'pb_data', backup / 'pb_data')
        for name in names:
            if not name.startswith('pb_data/') and (root / name).is_file():
                target = backup / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(root / name, target)
        owner = (root / 'pb_data').stat()
        changed = True
        for name in names:
            target = root / name
            if name == CONFIG:
                save_json(target, config, owner)
            else:
                source = SOURCE / ('test-access/' + MIGRATION if name.startswith('pb_migrations/') else name)
                atomic(target, source.read_bytes(), owner)
        service('start')
        stopped = False
        verify(api, config, manifest['files']['pb_public/index.html'])
    except BaseException:
        if not stopped:
            service('stop')
        if changed:
            for name in names:
                target, old = root / name, backup / name
                if old.is_file():
                    shutil.copy2(old, target)
                elif target.is_file():
                    target.unlink()
        service('start')
        raise
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rescan', action='store_true')
    parser.add_argument('--seconds', type=int, default=1200)
    args = parser.parse_args()
    if not 30 <= args.seconds <= 3600:
        raise RuntimeError('Search budget must be 30..3600 seconds')
    if os.geteuid() != 0:
        raise RuntimeError('Run through sudo')
    with os.fdopen(os.open(ROOT / '.karavay-diverse.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        api = Api()
        saved, manifest, before = preflight(ROOT, api)
        allowed = lambda p, c: allowed_mapping(ROOT, p, c)
        checkpoint = ROOT / '.karavay-diverse-history-search.json'
        if checkpoint.is_symlink():
            raise RuntimeError('Unexpected search checkpoint symbolic link')
        if saved['version'] == 2:
            chosen = selection.revalidate(api, saved.get('history', {}).get('proofs'), time.monotonic() + args.seconds, allowed)
        else:
            state = json.loads(checkpoint.read_text()) if checkpoint.is_file() and not args.rescan else None
            chosen = selection.select(api, [p['kid'] for p in saved['payers']], state,
                        lambda value: save_json(checkpoint, value, ROOT.stat()), seconds=args.seconds, allowed=allowed)
        # Independent price diagnostic; a price error cannot discard a proven history.
        for item in chosen:
            for group in (1, 0):
                try:
                    value = api.call('/clients/' + str(item['point']['id']) + '/matrix?DateOrd=' + str(item['stamp']) + '&Group=' + str(group), kis=True)
                    if not isinstance(value, list) or not value:
                        raise RuntimeError('Empty KIS catalog')
                    item['group'] = group
                    print('CATALOG_READ_OK:', item['point']['id'], '| Group', group, flush=True)
                    break
                except (RuntimeError, OSError) as error:
                    print('CATALOG_WARNING:', item['point']['id'], '| Group', group, '|', str(error)[:1400], flush=True)
        config = plan(ROOT, chosen, saved)
        for item, account in zip(chosen, config['accounts']):
            print('DEMO_PLAN:', account['email'], '|', item['payer']['name'], '| recipient', item['point']['kod'], '| existing orders', item['history_count'], '| order', item['order_id'], flush=True)
        if not args.apply:
            print('DIVERSE_PREFLIGHT_OK: histories verified; no application files/users changed')
            return
        backup = deploy(ROOT, api, config, manifest, before)
        print('DIVERSE_HISTORY_READY: 3 passwordless logins, 3 different default customers, real order lines verified through gateway')
        print('BACKUP:', backup)
        print('Reload the cabinet. Existing users/passwords/rights and manager files retained. No KIS writes or order creation.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('DIVERSE_HISTORY_PAUSED: search progress saved; if deployment started, previous application files restored') from None
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit('DIVERSE_HISTORY_STOP: ' + str(error)) from None
