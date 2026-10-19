"""Read-only selection from KIS payers; excludes the owner's known non-customers.

The available API has no manufacturer/customer flag. Never infer one from a code
prefix. Verify payer cards, recipient ownership and a usable dated catalog.
History and order creation are deliberately independent of this selection.
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

def select(api, saved=None, seconds=900, emit=print):
    deadline = time.monotonic() + seconds
    day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() + datetime.timedelta(days=1)).isoformat()
    stamp = int(datetime.datetime.fromisoformat(day + 'T00:00:00+03:00').timestamp())
    def check_time():
        if time.monotonic() >= deadline:
            raise RuntimeError('BUYER_SELECTION_TIME_LIMIT: no accounts changed')
    def verify(pid, wanted=None):
        check_time()
        payer = api.call('/payers/' + str(pid), kis=True)
        if not valid(payer) or payer['id'] != pid:
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
            if not valid(point, pid) or point['id'] != row['id']:
                continue
            for group in (1, 0):
                check_time()
                matrix = api.call('/clients/' + str(point['id']) + '/matrix?DateOrd=' + str(stamp) + '&Group=' + str(group), kis=True)
                if not isinstance(matrix, list) or len(matrix) > 10000:
                    raise RuntimeError('Invalid KIS catalog')
                if any(usable(p) for p in matrix):
                    points.append({'point': point, 'group': group})
                    break
            if len(points) == (len(wanted) if wanted is not None else 2):
                break
        if wanted is not None and {p['point']['id'] for p in points} != set(wanted):
            raise RuntimeError('Saved recipients/catalog unavailable; selection not silently changed')
        return {'payer': payer, 'points': points, 'point': points[0]['point'], 'day': day,
                'stamp': stamp, 'group': points[0]['group']} if points else None
    proofs = saved.get('buyers', {}).get('proofs') if isinstance(saved, dict) else None
    if proofs is not None:
        if (saved['buyers'].get('version') != 1 or not isinstance(proofs, list) or len(proofs) != 2
                or any(not isinstance(p, dict) or not positive(p.get('payer_kid'))
                       or p['payer_kid'] in EXCLUDED_IDS or not isinstance(p.get('clients'), list)
                       or not 1 <= len(p['clients']) <= 2 or any(not positive(c) for c in p['clients'])
                       or len(set(p['clients'])) != len(p['clients']) for p in proofs)
                or len(proofs[0]['clients']) != 2):
            raise RuntimeError('Invalid saved buyer scenarios')
        chosen = [verify(p['payer_kid'], p['clients']) for p in proofs]
        if (not all(chosen) or chosen[0]['payer']['id'] == chosen[1]['payer']['id']
                or len(chosen[0]['points']) < 2):
            raise RuntimeError('Saved buyer scenarios no longer usable')
        return chosen
    directory = rows(api, '/payers')
    candidates = sorted((p for p in directory if not excluded(p) and p.get('state') in (None, 1)), key=lambda r: r['id'], reverse=True)
    emit('BUYER_DIRECTORY: ' + str(len(directory)) + ' | known manufacturers and rejected demos excluded')
    chosen, errors, repeats = [], 0, {}
    for index, row in enumerate(candidates):
        check_time()
        emit('BUYER_CHECK: ' + str(index + 1) + ' | KIS ' + str(row['id']))
        try:
            candidate = verify(row['id'])
            if candidate:
                chosen.append(candidate)
                emit('BUYER_VERIFIED: ' + candidate['payer']['name'] + ' | KIS ' + str(row['id']) + ' | usable recipients ' + str(len(candidate['points'])))
                first = next((c for c in chosen if len(c['points']) >= 2), None)
                if first and len(chosen) >= 2:
                    return [first, next(c for c in chosen if c['payer']['id'] != first['payer']['id'])]
        except Exception as error:
            errors += 1
            if errors <= 3:
                emit('BUYER_READ_ERROR: ' + str(error)[:1400])
            signature = re.sub(r'\d+', '#', str(error))
            repeats[signature] = repeats.get(signature, 0) + 1
            if repeats[signature] >= 3:
                break
    raise RuntimeError('BUYER_SCENARIOS_NOT_FOUND: need two buyers and at least two usable recipients of the first; read errors=' + str(errors) + '. No users/configuration changed.')
