"""Select two real TEST KIS buyers only after history, details and a dated matrix pass."""
import datetime, math, re, time

def positive(n):
    return type(n) is int and 0 < n < 2**53

def eligible(p, require_active=True):
    name = re.sub('[^А-ЯA-Z0-9]', '', str(p.get('name', '')).upper().replace('Ё', 'Е'))
    active = p.get('state') == 1 if require_active else p.get('state') in (None, 1)
    return positive(p.get('id')) and active and p.get('id') not in (299271, 300182) and 'НЕВА' not in name and 'ПРОМТЕХСБЫТ' not in name and bool(p.get('kod')) and bool(p.get('name'))

def rows(api, path):
    value = api.call(path, kis=True)
    if not isinstance(value, list) or len(value) > 10000 or any(not isinstance(x, dict) for x in value):
        raise RuntimeError('Invalid KIS list: ' + path)
    return value

def order_rows(api, path, owner_key, owner_id):
    """OpenAPI wrappers, plus the flat client array observed in the VM capture."""
    value = api.call(path, kis=True)
    if isinstance(value, dict):
        if value.get(owner_key) != owner_id or 'Orders' not in value:
            raise RuntimeError('KIS order owner/format mismatch: ' + path)
        value = [] if value['Orders'] is None else value['Orders']
    if not isinstance(value, list) or len(value) > 10000 or any(not isinstance(x, dict) for x in value):
        raise RuntimeError('Invalid KIS order list: ' + path)
    return value

def header(d, oid, cid):
    if not isinstance(d, dict) or d.get('id') != oid or d.get('client_id') != cid:
        raise RuntimeError('KIS order membership mismatch')

def details(d):
    products = d.get('products')
    if not isinstance(products, list) or not products or len(products) > 1000:
        return False
    def number(n): return type(n) in (int, float) and math.isfinite(n) and n >= 0
    return all(isinstance(p, dict) and positive(p.get('id')) and isinstance(p.get('product_kod'), str) and isinstance(p.get('product_name'), str) and type(p.get('kol_sht')) is int and p['kol_sht'] >= 0 and number(p.get('cena_otp')) and number(p.get('sum_all')) for p in products)

def verify_point(api, payer, cid, deadline):
    if time.monotonic() >= deadline: raise RuntimeError('History selection time limit')
    point = api.call('/clients/' + str(cid), kis=True)
    if not isinstance(point, dict) or point.get('id') != cid or point.get('payer_id') != payer['id'] or point.get('state') != 1 or not point.get('kod') or not point.get('name'):
        raise RuntimeError('Inactive or foreign recipient')
    if not any(r.get('id') == cid for r in rows(api, '/payers/' + str(payer['id']) + '/clients')):
        raise RuntimeError('Recipient missing from KIS directory')
    orders = order_rows(api, '/clients/' + str(cid) + '/orders', 'id_clt', cid)
    if not orders or len({r.get('id') for r in orders}) != len(orders) or any(not positive(r.get('id')) for r in orders):
        raise RuntimeError('No usable recipient history')
    first = None
    # Match exactly what the gateway will display on its first page.
    for row in orders[:20]:
        if time.monotonic() >= deadline: raise RuntimeError('History selection time limit')
        order = api.call('/orders/' + str(row['id']), kis=True)
        header(order, row['id'], cid)
        if first is None and details(order): first = order
    if first is None: raise RuntimeError('No readable order lines')
    day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() + datetime.timedelta(days=1)).isoformat()
    stamp = int(datetime.datetime.fromisoformat(day + 'T00:00:00+03:00').timestamp())
    for group in (1, 0):
        matrix = rows(api, '/clients/' + str(cid) + '/matrix?DateOrd=' + str(stamp) + '&Group=' + str(group))
        if any(positive(p.get('id_prd')) and type(p.get('cenaotp')) in (int, float) and math.isfinite(p['cenaotp']) and p['cenaotp'] >= 0 for p in matrix):
            return {'payer': payer, 'point': point, 'order_id': first['id'], 'history_count': len(orders), 'day': day, 'stamp': stamp, 'group': group}
    raise RuntimeError('No dated catalog with prices')

def select(api, saved=None, max_buyers=10000, seconds=900, emit=print):
    deadline = time.monotonic() + seconds
    if saved and saved.get('history', {}).get('version') == 1:
        result = []
        for proof in saved['history']['proofs']:
            p = api.call('/payers/' + str(proof['payer_kid']), kis=True)
            if not eligible(p): raise RuntimeError('Saved test buyer is unavailable')
            result.append(verify_point(api, p, proof['client'], deadline))
        if len(result) != 2 or result[0]['payer']['id'] == result[1]['payer']['id']:
            raise RuntimeError('Invalid saved history selection')
        return result
    directory = rows(api, '/payers')
    candidates = sorted((p for p in directory if eligible(p, False)), key=lambda p:p['id'], reverse=True)
    result, errors, empty, repeated = [], 0, 0, {}
    for index, p in enumerate(candidates[:max_buyers]):
        if time.monotonic() >= deadline: break
        emit('HISTORY_BUYER_CHECK: ' + str(index + 1) + ' | KIS ' + str(p['id']))
        try:
            pid = p['id']
            p = api.call('/payers/' + str(pid), kis=True)
            if not isinstance(p, dict) or p.get('id') != pid or not eligible(p): continue
            # VM-confirmed route: query attributes are rejected by the KIS validator.
            recent = order_rows(api, '/payers/' + str(p['id']) + '/orders', 'Id_pay', p['id'])
            if not recent: empty += 1
            tried = set()
            for row in recent[:5]:
                if time.monotonic() >= deadline: break
                oid = row.get('id')
                if not positive(oid): continue
                order = api.call('/orders/' + str(oid), kis=True)
                if not isinstance(order, dict) or order.get('id') != oid: continue
                cid = order.get('client_id') if isinstance(order, dict) else None
                if not positive(cid) or cid in tried: continue
                tried.add(cid)
                try: chosen = verify_point(api, p, cid, deadline)
                except Exception as error:
                    errors += 1
                    if errors <= 3: emit('HISTORY_READ_ERROR: ' + str(error)[:1400])
                    continue
                result.append(chosen)
                emit('HISTORY_BUYER_VERIFIED: KIS ' + str(p['id']) + ' | client ' + str(cid) + ' | orders ' + str(chosen['history_count']))
                break
        except Exception as error:
            errors += 1
            if errors <= 3: emit('HISTORY_READ_ERROR: ' + str(error)[:1400])
            signature = re.sub(r'\d+', '#', str(error))
            repeated[signature] = repeated.get(signature, 0) + 1
            if repeated[signature] >= 3: break
        if len(result) == 2: return result
    raise RuntimeError('HISTORY_SCENARIOS_NOT_FOUND: verified buyers=' + str(len(result)) + ', empty buyer histories=' + str(empty) + ', read/contract errors=' + str(errors) + '. No users or files were changed. Check TEST KIS order availability/API; do not install empty scenarios.')
