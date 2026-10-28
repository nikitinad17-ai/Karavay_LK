"""Read-only selection from KIS payers; excludes the owner's known non-customers.

The available API has no manufacturer/customer flag. Never infer one from a code
prefix. Verify payer cards and active recipient ownership.
Catalog, history and order creation are independent of account selection.
"""
import datetime
import math
import re
import time

EXCLUDED_IDS = {2, 3, 299271, 300182}
EXCLUDED_NAMES = ('КАРАВАЙ', 'ПАЛЯНИЦ', 'НЕВА', 'ПРОМТЕХСБЫТ', 'KARAVAY', 'KARAVAI', 'PALYAN', 'PALIAN')

def positive(value):
    return type(value) is int and 0 < value < 2**53

def excluded(row):
    name = re.sub('[^А-ЯA-Z0-9]', '', str(row.get('name', '')).upper().replace('Ё', 'Е'))
    return row.get('id') in EXCLUDED_IDS or any(part in name for part in EXCLUDED_NAMES)

def valid(row, owner=None):
    return (isinstance(row, dict) and positive(row.get('id')) and row.get('state') == 1
            and isinstance(row.get('kod'), str) and bool(row['kod'].strip())
            and isinstance(row.get('name'), str) and bool(row['name'].strip())
            and not excluded(row) and (owner is None or row.get('payer_id') == owner))

def rows(api, path, maximum=10000):
    value = api.call(path, kis=True)
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(x, dict) or not positive(x.get('id')) for x in value):
        raise RuntimeError('Invalid KIS directory: ' + path)
    if len({x['id'] for x in value}) != len(value):
        raise RuntimeError('Duplicate KIS identity: ' + path)
    return value

def usable(product):
    if not isinstance(product, dict) or not positive(product.get('id_prd')):
        return False
    price, packing, minimum = product.get('cenaotp'), product.get('kolukl'), product.get('kolshtordmin')
    if type(price) not in (int, float) or not math.isfinite(price) or price <= 0:
        return False
    # Null minimum = full trays. Zero is an explicit piece minimum.
    return positive(packing) if minimum is None else type(minimum) is int and minimum >= 0

def select(api, saved=None, seconds=900, emit=print, target_count=2, exclude_ids=(), allowed=lambda p,c: True):
    if target_count not in (2, 3):
        raise RuntimeError('Unsupported customer scenario count')
    deadline = time.monotonic() + seconds
    day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() + datetime.timedelta(days=1)).isoformat()
    stamp = int(datetime.datetime.fromisoformat(day + 'T00:00:00+03:00').timestamp())
    def check_time():
        if time.monotonic() >= deadline:
            raise RuntimeError('BUYER_SELECTION_TIME_LIMIT: no accounts changed')
    def verify(pid, wanted=None):
        check_time()
        payer = api.call('/payers/' + str(pid), kis=True)
        if not valid(payer) or payer['id'] != pid or not allowed(payer, None):
            return None
        directory = rows(api, '/payers/' + str(pid) + '/clients', 2000)
        if wanted is not None and not set(wanted) <= {r['id'] for r in directory}:
            raise RuntimeError('Saved recipient no longer belongs to buyer')
        points = []
        for row in sorted(directory, key=lambda r: r['id']):
            check_time()
            if excluded(row) or wanted is not None and row['id'] not in wanted:
                continue
            point = api.call('/clients/' + str(row['id']), kis=True)
            if not valid(point, pid) or point['id'] != row['id'] or not allowed(payer, point['id']):
                continue
            points.append({'point': point, 'group': 1})
            if len(points) == (len(wanted) if wanted is not None else 2):
                break
        if wanted is not None and {p['point']['id'] for p in points} != set(wanted):
            raise RuntimeError('Saved recipients unavailable; selection not silently changed')
        return {'payer': payer, 'points': points, 'point': points[0]['point'], 'day': day,
                'stamp': stamp, 'group': points[0]['group']} if points else None
    proofs = saved.get('buyers', {}).get('proofs') if isinstance(saved, dict) else None
    if proofs is not None:
        if (saved['buyers'].get('version') != 1 or not isinstance(proofs, list) or len(proofs) != target_count
                or any(not isinstance(p, dict) or not positive(p.get('payer_kid'))
                       or p['payer_kid'] in EXCLUDED_IDS or not isinstance(p.get('clients'), list)
                       or not 1 <= len(p['clients']) <= 2 or any(not positive(c) for c in p['clients'])
                       or len(set(p['clients'])) != len(p['clients']) for p in proofs)
                or len(proofs[0]['clients']) != 2):
            raise RuntimeError('Invalid saved buyer scenarios')
        chosen = [verify(p['payer_kid'], p['clients']) for p in proofs]
        if (not all(chosen) or len({c['payer']['id'] for c in chosen if c}) != target_count
                or len(chosen[0]['points']) < 2):
            raise RuntimeError('Saved buyer scenarios no longer usable')
        return chosen
    directory = rows(api, '/payers')
    candidates = sorted((p for p in directory if not excluded(p) and p['id'] not in exclude_ids and p.get('state') in (None, 1)), key=lambda r: r['id'], reverse=True)
    emit('BUYER_DIRECTORY: ' + str(len(directory)) + ' | known manufacturers and rejected demos excluded')
    chosen, errors, repeats = [], 0, {}
    for index, row in enumerate(candidates):
        check_time()
        emit('BUYER_CHECK: ' + str(index + 1) + ' | KIS ' + str(row['id']))
        try:
            candidate = verify(row['id'])
            if candidate:
                chosen.append(candidate)
                emit('BUYER_VERIFIED: ' + candidate['payer']['name'] + ' | KIS ' + str(row['id']) + ' | active recipients ' + str(len(candidate['points'])))
                first = next((c for c in chosen if len(c['points']) >= 2), None)
                if first and len(chosen) >= target_count:
                    return [first, *[c for c in chosen if c['payer']['id'] != first['payer']['id']][:target_count-1]]
        except Exception as error:
            errors += 1
            if errors <= 3:
                emit('BUYER_READ_ERROR: ' + str(error)[:1400])
            signature = re.sub(r'\d+', '#', str(error))
            repeats[signature] = repeats.get(signature, 0) + 1
            if repeats[signature] >= 3:
                break
    raise RuntimeError('BUYER_SCENARIOS_NOT_FOUND: need buyer scenarios including one with at least TWO active recipients; read errors=' + str(errors) + '. No users/configuration changed.')

def probe_catalogs(api, chosen, emit=print):
    """Diagnostic only. A catalog failure never changes the selected identities.

    No price/product is repaired or fabricated. Try the other documented group
    and report the result separately from passwordless account installation.
    """
    for candidate in chosen:
        candidate['catalog_available'] = False
        cid = candidate['point']['id']
        for group in (1, 0):
            emit('CATALOG_CHECK: client ' + str(cid) + ' | Group ' + str(group))
            try:
                matrix = api.call('/clients/' + str(cid) + '/matrix?DateOrd=' + str(candidate['stamp']) + '&Group=' + str(group), kis=True)
                if not isinstance(matrix, list) or len(matrix) > 10000:
                    raise RuntimeError('Invalid KIS catalog')
                if not any(usable(p) for p in matrix):
                    raise RuntimeError('No usable priced products for this date/group')
                candidate['catalog_available'] = True
                candidate['group'] = group
                emit('CATALOG_AVAILABLE: client ' + str(cid) + ' | Group ' + str(group))
                break
            except Exception as error:
                emit('CATALOG_WARNING: client ' + str(cid) + ' | Group ' + str(group) + ' | ' + str(error)[:1400])
        if not candidate['catalog_available']:
            emit('CATALOG_UNAVAILABLE: client ' + str(cid) + ' | accounts will still be installed; no substitute prices')
