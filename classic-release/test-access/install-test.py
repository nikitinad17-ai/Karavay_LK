#!/usr/bin/env python3
"""One-time installation on the explicitly authorized TEST KIS VM. No PB password."""
import argparse, datetime, hashlib, importlib.util, json, os, pathlib, secrets, shutil, sqlite3, subprocess, urllib.request

SOURCE = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = '1792180000_test_access_users.js'
PB_BASE = 'http://127.0.0.1:8090'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

base = module('installer', SOURCE / 'scripts/install.py')
seed = module('seed', SOURCE / 'scripts/Seed-Demo-Users.py')

def new_id():
    return ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(15))

def plan(root, api, selection=None):
    con = sqlite3.connect('file:' + str(root / 'pb_data/data.db') + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    def rows(sql, args=()):
        return [dict(r) for r in con.execute(sql, args)]
    def one(rs, label):
        if len(rs) != 1:
            raise RuntimeError('Expected one ' + label)
        return rs[0]
    role = one(rows('SELECT id FROM roles WHERE active=1 AND code_role=?', ('owner',)), 'active owner role')
    mappings = []
    buyer_ids = [item["payer"]["id"] for item in selection] if selection else [2, 3]
    point_kid = selection[0]["point"]["id"] if selection else 2
    for kid in buyer_ids:
        remote = api.call('/payers/' + str(kid), kis=True)
        if not isinstance(remote, dict) or remote.get('id') != kid or remote.get('state') != 1 or not remote.get('name') or not remote.get('kod'):
            raise RuntimeError('KIS buyer is unavailable: ' + str(kid))
        existing = rows('SELECT id,active FROM payers WHERE id_pay=?', (kid,))
        if len(existing) > 1 or existing and not existing[0]['active']:
            raise RuntimeError('KIS buyer mapping is disabled or ambiguous: ' + str(kid))
        mappings.append({'id': existing[0]['id'] if existing else new_id(), 'kid': kid, 'code': remote['kod'], 'name': remote['name']})
        recipients = api.call('/payers/' + str(kid) + '/clients', kis=True)
        if not isinstance(recipients, list) or not recipients:
            raise RuntimeError('KIS buyer has no recipients: ' + str(kid))
        if kid == buyer_ids[0] and not any(r.get('id') == point_kid for r in recipients):
            raise RuntimeError('KIS client 2 is not a recipient of buyer 2')
    point = api.call('/clients/' + str(point_kid), kis=True)
    if not isinstance(point, dict) or point.get('id') != point_kid or point.get('payer_id') != buyer_ids[0] or point.get('state') != 1 or not point.get('kod') or not point.get('name'):
        raise RuntimeError('KIS client 2 is unavailable')
    existing = rows('SELECT id,payer,active FROM clients WHERE id_clt=?', (point_kid,))
    if len(existing) > 1 or existing and (not existing[0]['active'] or existing[0]['payer'] != mappings[0]['id']):
        raise RuntimeError('KIS client mapping changed')
    names = ['Один получатель (демо)', 'Все получатели покупателя (демо)', 'Два покупателя (демо)'] if selection else ['Один получатель (тест)', 'Все получатели Каравая (тест)', 'Два покупателя (тест)']
    namespace = '382' if selection else '381'
    accounts = []
    for i, slug in enumerate(('point', 'buyer', 'multi')):
        accounts.append({'id': 'test' + namespace + slug + '001', 'name': names[i], 'login': 'kis_test_' + slug + '_v' + namespace,
                         'email': 'demo.test.' + slug + ('.v382' if selection else '') + '@example.test',
                         'description': (mappings[0]['name'] + ' · ' + point['name']) if i == 0 else (mappings[0]['name'] + ' · все активные получатели') if i == 1 else (' / '.join(p['name'] for p in mappings) + ' · все активные получатели'),
                         'rights': ['t' + namespace + slug + '000001'] + (['t' + namespace + slug + '000002'] if i == 2 else [])})
    fields = json.loads(one(rows('SELECT fields FROM _collections WHERE name="users"'), 'users collection')['fields'])
    manager = ''
    if any(f['name'] == 'manager_owner' for f in fields):
        managers = rows('SELECT u.id FROM users u JOIN roles r ON r.id=u.role WHERE u.active=1 AND u.must_change_password=0 AND u.role_code="manager" AND r.active=1 AND r.code_role="manager" AND u.name=?', ('Менеджер Каравай',))
        if len(managers) > 1:
            raise RuntimeError('More than one active manager named Менеджер Каравай')
        if managers:
            manager = managers[0]['id']
    con.close()
    config = {'version': 1, 'enabled': True, 'environment': 'test-kis', 'ownerRole': role['id'], 'managerOwner': manager,
            'payers': mappings, 'point': {'id': existing[0]['id'] if existing else new_id(), 'kid': point_kid, 'code': point['kod'], 'name': point['name']}, 'accounts': accounts}
    if selection:
        config['history'] = {'version': 1, 'proofs': [{'payer_kid': x['payer']['id'], 'client': x['point']['id'], 'order_id': x['order_id'], 'day': x['day'], 'stamp': x['stamp'], 'group': x['group']} for x in selection]}
    return config

def api_call(path, body=None, token=''):
    req = urllib.request.Request(PB_BASE + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {})})
    with urllib.request.urlopen(req, timeout=70) as response:
        return json.load(response)

def verify(config, manifest):
    base.health()
    with urllib.request.urlopen(PB_BASE + '/', timeout=5) as response:
        if hashlib.sha256(response.read()).hexdigest() != manifest['html_sha256']:
            raise RuntimeError('Served client does not match package')
    listed = api_call('/service/test-access')
    if {a['id'] for a in listed.get('accounts', [])} != {a['id'] for a in config['accounts']}:
        raise RuntimeError('Not all three test users are available')
    for i, account in enumerate(config['accounts']):
        auth = api_call('/service/test-access', {'id': account['id']})
        if auth['record']['id'] != account['id']:
            raise RuntimeError('Wrong test identity')
        token = auth['token']
        ctx = api_call('/service/context', token=token)
        expected = {p['id'] for p in config['payers'][:1 if i < 2 else 2]}
        if {p['id'] for p in ctx['payers']} != expected:
            raise RuntimeError('Test scope mismatch')
        for payer in expected:
            first = api_call('/service/clients?payer=' + payer + '&perPage=20', token=token)
            if i == 0 and ([r['id'] for r in first['clients']] != [config['point']['kid']] or first.get('hasMore')):
                raise RuntimeError('Single client isolation failed')
            if not first['clients']:
                raise RuntimeError('No active recipients returned from KIS')
        if config.get('history'):
            for proof in config['history']['proofs'][:1 if i < 2 else 2]:
                payer = next(p['id'] for p in config['payers'] if p['kid'] == proof['payer_kid'])
                suffix = '?payer=' + payer + '&client=' + str(proof['client'])
                history = api_call('/service/orders' + suffix, token=token)
                if not history.get('orders') or history.get('count') != len(history['orders']):
                    raise RuntimeError('Real KIS history missing through gateway')
                detail = api_call('/service/orders/' + str(history['orders'][0]['id']) + suffix, token=token)
                if not detail.get('itemsAvailable') or not detail.get('items'):
                    raise RuntimeError('Real KIS order lines missing through gateway')
                catalog = api_call('/service/catalog' + suffix + '&DateOrd=' + str(proof['stamp']) + '&Group=' + str(proof['group']), token=token)
                if not catalog.get('products'):
                    raise RuntimeError('Real KIS catalog missing through gateway')
        print('TEST_LOGIN_OK:', account['email'])

def deploy(root, config, manifest, backup_parent=None):
    backup = (backup_parent or root.parent) / ('.karavay-test-before-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(mode=0o700)
    names = [*manifest['package'], 'pb_migrations/' + MIGRATION, 'pb_data/karavay-test-access.json']
    for name in names:
        if (root / name).is_symlink():
            raise RuntimeError('Unexpected symbolic link: ' + name)
    stopped = False
    changed = False
    try:
        base.run('systemctl', 'stop', 'pocketbase'); stopped = True
        shutil.copytree(root / 'pb_data', backup / 'pb_data')
        for name in names:
            target = root / name
            if target.is_symlink():
                raise RuntimeError('Unexpected symbolic link: ' + name)
            if target.is_file() and not name.startswith('pb_data/'):
                old = backup / name; old.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(target, old)
        owner = (root / 'pb_data').stat()
        changed = True
        for name in manifest['package']:
            target = root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(SOURCE / name, target); target.chmod(0o644); os.chown(target, owner.st_uid, owner.st_gid)
        target = root / 'pb_migrations' / MIGRATION
        shutil.copyfile(SOURCE / 'test-access' / MIGRATION, target); target.chmod(0o644); os.chown(target, owner.st_uid, owner.st_gid)
        target = root / 'pb_data/karavay-test-access.json'
        target.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n'); target.chmod(0o600); os.chown(target, owner.st_uid, owner.st_gid)
        base.run('systemctl', 'start', 'pocketbase'); stopped = False
        verify(config, manifest)
    except Exception:
        if not stopped:
            base.run('systemctl', 'stop', 'pocketbase')
        # Preserve business DB/journal: restoring a DB snapshot could lose accepted orders.
        for name in names if changed else []:
            target, old = root / name, backup / name
            if old.is_file(): shutil.copy2(old, target)
            elif target.is_file(): target.unlink()
        base.run('systemctl', 'start', 'pocketbase')
        raise
    return backup


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = pathlib.Path('/opt/pocketbase')
    if args.apply and os.geteuid() != 0:
        raise RuntimeError('Run once using sudo')
    subprocess.run(['python3', str(SOURCE / 'scripts/install.py')], check=True)
    manifest = json.loads((SOURCE / 'MANIFEST.json').read_text())
    config = plan(root, seed.Api())
    print('TEST_MANAGER:', config['managerOwner'] or 'not assigned (no unique active Менеджер Каравай or no manager_owner field)')
    if not args.apply:
        print('TEST_PREFLIGHT_OK: buyers 2/3, recipient 2; no changes')
        return
    backup = deploy(root, config, manifest)
    print('TEST_3.8.1_READY: http://192.168.25.98:8090/ — three buttons, no login password')
    print('BACKUP:', backup)
    print('KIS reads and three logins verified. Installation creates no orders; submit an order in the client.')

if __name__ == '__main__':
    main()
