#!/usr/bin/env python3
"""Replace the three public test scenarios with KIS customer scenarios. No KIS writes."""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import sqlite3
import urllib.error

HERE = pathlib.Path(__file__).resolve().parent
import importlib.util
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
setup = module('buyer_setup', HERE / 'install-test.py')
selection = module('buyer_selection', HERE / 'select-buyers.py')
MIGRATION = '1792400000_test_buyer_users.js'
ROOT = pathlib.Path('/opt/pocketbase')
HELPER = 'pb_hooks/karavay-test-access.js'
OLD_HASHES = {'1cc4199f80209ccf1b783352deab667fbfd7a0878e011e140ea7252188be3c5b',
              '753ff0f4136b7cf2861dfac44c26d6d6091219df358991360656e2bbac3a478a',
              'e569691d5a3227c535e57565bcdc6583dd80b53401236c6d302c53b914003fe8',
              '664c97a27bde4a91a6b6f9ea8d9a38c7dda799ec0a89b8dbf484901bc7929d8f'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def preflight(root):
    expected = json.loads((HERE / 'BUYERS-MANIFEST.json').read_text())
    for name, digest in expected['files'].items():
        if sha(setup.SOURCE / name) != digest:
            raise RuntimeError('Buyer package hash mismatch: ' + name)
    if (root / HELPER).is_symlink() or sha(root / HELPER) not in OLD_HASHES | {expected['files'][HELPER]}:
        raise RuntimeError('Test access helper changed; it was not replaced')
    route = 'pb_hooks/karavay-test-access.pb.js'
    if (root / route).is_symlink() or sha(root / route) != expected['route_sha256']:
        raise RuntimeError('Test access routes changed; review needed')
    if '0.40.3' not in setup.base.run(str(root / 'pocketbase'), '--version').stdout:
        raise RuntimeError('Expected PocketBase 0.40.3')
    with sqlite3.connect('file:' + str(root / 'pb_data/data.db') + '?mode=ro', uri=True) as con:
        definitions = {r[0]: json.loads(r[1]) for r in con.execute('SELECT name,fields FROM _collections')}
        for collection, fields in expected['required_fields'].items():
            actual = {f['name']: f['type'] for f in definitions.get(collection, [])}
            if any(actual.get(name) != kind for name, kind in fields.items()):
                raise RuntimeError('Schema mismatch: ' + collection)
        applied = {r[0] for r in con.execute('SELECT file FROM _migrations')}
        pending = [p.name for p in (root / 'pb_migrations').glob('*.js') if p.name not in applied and p.name != MIGRATION]
        if pending:
            raise RuntimeError('Unrelated pending migrations: ' + ', '.join(pending))
    setup.base.health()
    return {'package': {HELPER: expected['files'][HELPER]}, 'html_sha256': sha(root / 'pb_public/index.html')}

def plan(root, api, chosen):
    # Reuse the existing PB mapping/manager logic, then assign a NEW namespace.
    config = setup.plan(root, api, [{**c, 'order_id': None} for c in chosen])
    config.pop('history')
    config['buyers'] = {'version': 1, 'proofs': [{'payer_kid': c['payer']['id'],
        'clients': [p['point']['id'] for p in c['points']], 'day': c['day'],
        'stamp': c['stamp'], 'group': c['group'], 'catalog_available': c.get('catalog_available', False)} for c in chosen]}
    for account, slug in zip(config['accounts'], ('point', 'buyer', 'multi')):
        account.update(id='test383' + slug + '001', login='kis_test_' + slug + '_v383',
                       email='demo.test.' + slug + '.v383@example.test',
                       rights=['t383' + slug + '000001'] + (['t383' + slug + '000002'] if slug == 'multi' else []))
    with sqlite3.connect('file:' + str(root / 'pb_data/data.db') + '?mode=ro', uri=True) as con:
        con.row_factory = sqlite3.Row
        for index, account in enumerate(config['accounts']):
            found = list(con.execute('SELECT * FROM users WHERE id=? OR email=? OR login=?', (account['id'], account['email'], account['login'])))
            if found:
                if len(found) != 1 or any(found[0][k] != account[k] for k in ('id', 'email', 'login', 'name')) or found[0]['role'] != config['ownerRole'] or found[0]['role_code'] != 'owner' or not found[0]['active'] or found[0]['must_change_password']:
                    raise RuntimeError('New demo identity occupied/changed; no users overwritten')
            grants = ([{'payer': config['payers'][0]['id'], 'scope': 'client', 'kis_client_id': config['point']['kid'], 'client': config['point']['id']}]
                      if index == 0 else [{'payer': p['id'], 'scope': 'all', 'kis_client_id': 0, 'client': ''} for p in config['payers'][:1 if index == 1 else 2]])
            rights = list(con.execute('SELECT * FROM rights WHERE user=?', (account['id'],)))
            if found and (len(rights) != len(grants) or any(not r['active'] or not any(all(r[k] == v for k, v in g.items()) for g in grants) for r in rights)):
                raise RuntimeError('Demo rights changed; not overwritten')
            for rid in account['rights']:
                collision = con.execute('SELECT user FROM rights WHERE id=?', (rid,)).fetchone()
                if collision and collision['user'] != account['id']:
                    raise RuntimeError('Demo right ID occupied')
        for p in config['payers']:
            found = list(con.execute('SELECT id,id_pay,kod_pay,active FROM payers WHERE id_pay=? OR kod_pay=?', (p['kid'], p['code'])))
            if found and (len(found) != 1 or found[0]['id'] != p['id'] or found[0]['id_pay'] != p['kid'] or found[0]['kod_pay'] != p['code'] or not found[0]['active']):
                raise RuntimeError('Buyer mapping/code collision')
    return config

def verify(config, manifest):
    for i, account in enumerate(config['accounts']):
        token = setup.api_call('/service/test-access', {'id': account['id']})['token']
        for proof in config['buyers']['proofs'][:1 if i < 2 else 2]:
            payer = next(p['id'] for p in config['payers'] if p['kid'] == proof['payer_kid'])
            directory, cursor = [], 0
            wanted = [config['point']['kid']] if i == 0 else proof['clients']
            for _ in range(200):
                page = setup.api_call('/service/clients?payer=' + payer + ('&cursor=' + str(cursor) if cursor else '') + '&perPage=20', token=token)
                directory.extend(c['id'] for c in page['clients'])
                if set(wanted) <= set(directory) or not page.get('hasMore'):
                    break
                if type(page.get('nextCursor')) is not int or page['nextCursor'] <= cursor:
                    raise RuntimeError('Recipient pagination did not advance')
                cursor = page['nextCursor']
            if not set(wanted) <= set(directory):
                raise RuntimeError('Buyer scenario recipient missing through gateway')
        if i == 0:
            forbidden = config['buyers']['proofs'][0]['clients'][1]
            try:
                setup.api_call('/service/order-options?payer=' + config['payers'][0]['id'] + '&client=' + str(forbidden), token=token)
                raise RuntimeError('Single-point account can read another recipient')
            except urllib.error.HTTPError as error:
                if error.code != 403:
                    raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = ROOT
    if args.apply and os.geteuid() != 0:
        raise RuntimeError('Run through sudo once')
    if args.apply:
        fd = os.open(str(root / '.karavay-buyers-install.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        lock = os.fdopen(fd, 'r+')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError('Buyer installer is already running') from None
    manifest = preflight(root)
    saved_path = root / 'pb_data/karavay-test-access.json'
    saved = json.loads(saved_path.read_text()) if saved_path.is_file() else None
    if not saved or saved.get('enabled') is not True or saved.get('environment') != 'test-kis':
        raise RuntimeError('Existing explicitly enabled TEST KIS configuration required')
    api = setup.seed.Api()
    chosen = selection.select(api, saved)
    selection.probe_catalogs(api, chosen)
    config = plan(root, api, chosen)
    for account in config['accounts']:
        print('DEMO_SCENARIO:', account['email'], '|', account['description'], flush=True)
    for c in chosen:
        for point in c['points']:
            print('KIS_RECIPIENT:', c['payer']['id'], c['payer']['name'], '->', point['point']['id'], point['point']['name'], flush=True)
    if not args.apply:
        print('BUYERS_PREFLIGHT_OK: read-only; no changes')
        return
    setup.MIGRATION = MIGRATION
    original_verify = setup.verify
    def extended(c, m):
        original_verify(c, m)
        verify(c, m)
    setup.verify = extended
    backup = setup.deploy(root, config, manifest)
    print('BUYER_SCENARIOS_READY: 3 passwordless demo logins; buyer cards, active recipients and access scopes verified')
    if any(not c['catalog_available'] for c in chosen):
        print('CATALOG_ATTENTION: KIS catalog is unavailable for some selected recipients; accounts are ready, prices were not substituted')
    print('BACKUP:', backup)
    print('Reload the cabinet. Previous test sessions are cleared by the existing client on refresh.')
    print('Existing users/passwords/rights, client HTML and manager files retained. No KIS order requests sent.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, setup.seed.Failure) as error:
        raise SystemExit('BUYER_UPDATE_STOP: ' + str(error)) from None
