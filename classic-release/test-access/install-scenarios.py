#!/usr/bin/env python3
"""One recipient, at least TWO recipients, multiple buyers. No history prerequisite."""
import argparse
import fcntl
import importlib.util
import json
import os
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path('/opt/pocketbase')
MIGRATION = '1793093600_test_scenario_users.js'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


base = module('scenario_base', HERE / 'install-diverse-history.py')
selection = module('scenario_selection', HERE / 'select-buyers.py')


def recipients(api, payer):
    found, cursor = [], 0
    for _ in range(501):
        page = api.call('/service/clients?payer=' + payer + ('&cursor=' + str(cursor) if cursor else '') + '&perPage=20')
        clients = page.get('clients')
        if (page.get('payer') != payer or not isinstance(clients, list) or page.get('count') != len(clients)
                or any(not isinstance(c, dict) or not selection.positive(c.get('id')) for c in clients)):
            raise RuntimeError('Invalid scoped recipient response')
        found.extend(clients)
        if page.get('hasMore') is False:
            if len({c['id'] for c in found}) != len(found):
                raise RuntimeError('Duplicate scoped recipient')
            return found
        next_cursor = page.get('nextCursor')
        if page.get('hasMore') is not True or not selection.positive(next_cursor) or next_cursor <= cursor:
            raise RuntimeError('Recipient pagination did not advance')
        cursor = next_cursor
    raise RuntimeError('Too many recipient pages')


def verify(api, config, html_sha):
    base.health(api)
    if base.hashlib.sha256(api.call('/')).hexdigest() != html_sha:
        raise RuntimeError('Served client differs')
    public = api.call('/service/test-access')
    listed = public.get('accounts', [])
    if public.get('environment') != 'test-kis' or {a['id'] for a in listed} != {a['id'] for a in config['accounts']}:
        raise RuntimeError('Three scenario logins missing')
    multiple = []
    for i, account in enumerate(config['accounts']):
        metadata = next(a for a in listed if a['id'] == account['id'])
        if metadata.get('preferredPayer') != config['payers'][i]['id'] or metadata.get('preferredClient') != config['points'][i]['kid']:
            raise RuntimeError('Scenario opens the wrong buyer/recipient')
        auth = api.call('/service/test-access', {'id': account['id']})
        if auth.get('record', {}).get('id') != account['id']:
            raise RuntimeError('Wrong scenario identity')
        api.token = auth['token']
        context = api.call('/service/context')
        expected = {g['payer'] for g in base.grants(config, i)}
        if {p['id'] for p in context.get('payers', [])} != expected:
            raise RuntimeError('Wrong scenario scope')
        for payer in expected:
            clients = recipients(api, payer)
            n = next(n for n, p in enumerate(config['payers']) if p['id'] == payer)
            if config['points'][n]['kid'] not in {c['id'] for c in clients}:
                raise RuntimeError('Default recipient is unavailable')
            if i == 0 and [c['id'] for c in clients] != [config['point']['kid']]:
                raise RuntimeError('One-recipient account has a wider scope')
            if i == 1:
                required = set(config['multipleRecipients'])
                if len(clients) < 2 or not required <= {c['id'] for c in clients}:
                    raise RuntimeError('MULTI_RECIPIENT_CHECK_FAILED: demo buyer MUST see at least TWO active recipients')
                multiple = clients
                for point in clients[:10]:
                    print('DEMO_RECIPIENT:', account['email'], '|', point.get('code'), '|', point.get('name'), '| KIS', point['id'], flush=True)
            print('DEMO_SCOPE_OK:', account['email'], '| buyer', config['payers'][n]['name'], '| recipients', len(clients), flush=True)
        forbidden = config['payers'][2 if i < 2 else 0]['id']
        try:
            api.call('/service/clients?payer=' + forbidden + '&perPage=20')
        except base.ApiError as error:
            if error.status != 403:
                raise
        else:
            raise RuntimeError('Foreign buyer access permitted')
    api.token = ''
    return multiple


def history_report(api, config):
    # Read the actual selected recipients AFTER their logins exist. Empty/error
    # histories are explicitly reported and never block the requested scopes.
    auth = api.call('/service/test-access', {'id': config['accounts'][1]['id']})
    api.token = auth['token']
    payer = config['payers'][1]['id']
    for cid in config['multipleRecipients']:
        suffix = '?payer=' + payer + '&client=' + str(cid)
        try:
            value = api.call('/service/orders' + suffix)
            orders = value.get('orders')
            if not isinstance(orders, list) or value.get('count') != len(orders):
                raise RuntimeError('Invalid history response')
            print('DEMO_HISTORY:', cid, '| returned orders', len(orders), '| total', value.get('total', len(orders)), flush=True)
            if orders:
                detail = api.call('/service/orders/' + str(orders[0]['id']) + suffix)
                print('DEMO_ORDER_LINES:', cid, '|', len(detail.get('items') or []), flush=True)
        except (RuntimeError, OSError) as error:
            print('DEMO_HISTORY_WARNING:', cid, '|', str(error)[:1400], flush=True)
    api.token = ''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--seconds', type=int, default=900)
    args = parser.parse_args()
    if os.geteuid() != 0 or not 30 <= args.seconds <= 3600:
        raise RuntimeError('Use sudo; search budget 30..3600 seconds')
    with os.fdopen(os.open(ROOT / '.karavay-scenarios.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        base.MIGRATION = MIGRATION
        api = base.Api()
        saved, manifest, before = base.preflight(ROOT, api, 'SCENARIOS-MANIFEST.json')
        installed = saved.get('scenario') == 'multi-recipient-v385'
        checkpoint = ROOT / '.karavay-multi-recipient-selection.json'
        if checkpoint.is_symlink():
            raise RuntimeError('Unexpected selection symbolic link')
        previous = saved.get('selection') if installed else json.loads(checkpoint.read_text()) if checkpoint.is_file() else None
        chosen = selection.select(api, previous, seconds=args.seconds, target_count=3,
                    exclude_ids=[p['kid'] for p in saved['payers']] if not installed else (),
                    allowed=lambda p, c: base.allowed_mapping(ROOT, p, c))
        proof = {'buyers': {'version': 1, 'proofs': [{'payer_kid': c['payer']['id'], 'clients': [p['point']['id'] for p in c['points']]} for c in chosen]}}
        # Put the buyer with proven MULTIPLE points in the dedicated second button.
        chosen = [chosen[1], chosen[0], chosen[2]]
        chosen[1]['point'] = chosen[1]['points'][1]['point']
        config = base.plan(ROOT, chosen, saved if installed else None, namespace='385')
        config.pop('history', None)
        config['multipleRecipients'] = [p['point']['id'] for p in chosen[1]['points']]
        config['selection'] = proof
        for a in config['accounts']:
            print('DEMO_PLAN:', a['email'], '|', a['name'], '|', a['description'], flush=True)
        if not args.apply:
            print('SCENARIOS_PREFLIGHT_OK: buyer with at least TWO recipients verified; no application changes')
            return
        base.save_json(checkpoint, proof, ROOT.stat())
        actual = []
        def check(api, config, html_sha):
            actual[:] = verify(api, config, html_sha)
        base.verify = check
        backup = base.deploy(ROOT, api, config, manifest, before)
        print('MULTI_RECIPIENT_DEMO_READY:', config['accounts'][1]['email'], '| recipients:', len(actual), flush=True)
        print('SCENARIOS_READY: one recipient / multiple recipients / multiple buyers. All logins are passwordless.', flush=True)
        print('BACKUP:', backup, flush=True)
        try:
            history_report(api, config)
        except (RuntimeError, OSError) as error:
            print('DEMO_HISTORY_WARNING:', str(error)[:1400], flush=True)
        print('Reload the cabinet. No KIS order created. Existing accounts/passwords/manager retained.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('SCENARIOS_PAUSED: no KIS writes; selection saved if deployment began') from None
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit('SCENARIOS_STOP: ' + str(error)) from None
