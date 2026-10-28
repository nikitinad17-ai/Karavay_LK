"""Find three OTHER customers using recipient histories, independently of prices.

Only live GET results count as evidence. The small resume file contains IDs and
scan progress, never tokens, order contents, prices or customer contact details.
"""
import datetime
import math
import re
import time


class Unavailable(Exception):
    """An inactive/foreign/empty candidate, rather than a transport failure."""


def positive(value):
    return type(value) is int and 0 < value < 2**53


def customer(value, pid=None):
    if not isinstance(value, dict):
        return False
    name = re.sub('[^А-ЯA-Z0-9]', '', str(value.get('name', '')).upper().replace('Ё', 'Е'))
    return (positive(value.get('id')) and (pid is None or value['id'] == pid)
            and value.get('state') == 1 and value['id'] not in (2, 3, 299271, 300182)
            and not any(s in name for s in ('КАРАВАЙ', 'ПАЛЯНИЦ', 'НЕВА', 'ПРОМТЕХСБЫТ',
                                          'KARAVAY', 'KARAVAI', 'PALYAN', 'PALIAN'))
            and isinstance(value.get('name'), str) and bool(value['name'].strip())
            and isinstance(value.get('kod'), str) and bool(value['kod'].strip()))


def rows(value, label):
    if (not isinstance(value, list) or len(value) > 10000
            or any(not isinstance(r, dict) or not positive(r.get('id')) for r in value)
            or len({r['id'] for r in value}) != len(value)):
        raise RuntimeError('Invalid or duplicate IDs: ' + label)
    return value


def lines(value):
    def number(n):
        return type(n) in (int, float) and math.isfinite(n) and n >= 0
    products = value.get('products')
    return (isinstance(products, list) and 0 < len(products) <= 1000
            and all(isinstance(p, dict) and positive(p.get('id'))
                    and isinstance(p.get('product_kod'), str)
                    and isinstance(p.get('product_name'), str)
                    and type(p.get('kol_sht')) is int and p['kol_sht'] >= 0
                    and number(p.get('cena_otp')) and number(p.get('sum_all')) for p in products))


def verify(api, payer, cid, deadline, directory=None):
    def check_time():
        if time.monotonic() >= deadline:
            raise TimeoutError('History search time budget reached; progress saved')
    check_time()
    point = api.call('/clients/' + str(cid), kis=True)
    if (not isinstance(point, dict) or point.get('id') != cid
            or point.get('payer_id') != payer['id'] or point.get('state') != 1
            or not isinstance(point.get('name'), str) or not point['name'].strip()
            or not isinstance(point.get('kod'), str) or not point['kod'].strip()):
        raise Unavailable('Inactive or foreign recipient')
    directory = directory if directory is not None else rows(api.call('/payers/' + str(payer['id']) + '/clients', kis=True), 'recipients')
    if not any(p['id'] == cid for p in directory):
        raise Unavailable('Recipient missing from customer directory')
    check_time()
    history = api.call('/clients/' + str(cid) + '/orders', kis=True)
    if isinstance(history, dict):
        if history.get('id_clt') != cid or 'Orders' not in history:
            raise RuntimeError('Recipient history owner/format mismatch')
        history = [] if history['Orders'] is None else history['Orders']
    history = rows(history, 'recipient orders')
    if not history:
        raise Unavailable('Empty recipient history')
    chosen = None
    # The existing gateway reads every header on page one. Verify the SAME page.
    for row in history[:20]:
        check_time()
        order = api.call('/orders/' + str(row['id']), kis=True)
        if not isinstance(order, dict) or order.get('id') != row['id'] or order.get('client_id') != cid:
            raise Unavailable('Order is missing or belongs to another recipient')
        if chosen is None and lines(order):
            chosen = order['id']
    if chosen is None:
        raise Unavailable('No readable order lines on the first history page')
    day = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() + datetime.timedelta(days=1)).isoformat()
    return {'payer': payer, 'point': point, 'order_id': chosen, 'history_count': len(history),
            'day': day, 'stamp': int(datetime.datetime.fromisoformat(day + 'T00:00:00+03:00').timestamp()), 'group': 1}


def proof(item):
    return {'payer_kid': item['payer']['id'], 'client': item['point']['id'], 'order_id': item['order_id']}


def revalidate(api, proofs, deadline, allowed=lambda p, c: True):
    if (not isinstance(proofs, list) or len(proofs) != 3
            or any(not isinstance(p, dict) or not all(positive(p.get(k)) for k in ('payer_kid', 'client', 'order_id')) for p in proofs)
            or len({p['payer_kid'] for p in proofs}) != 3):
        raise RuntimeError('Invalid saved diverse history selection')
    result = []
    for p in proofs:
        payer = api.call('/payers/' + str(p['payer_kid']), kis=True)
        if not customer(payer, p['payer_kid']) or not allowed(payer, p['client']):
            raise RuntimeError('Saved demo customer is disabled or its mapping changed')
        try:
            result.append(verify(api, payer, p['client'], deadline))
        except Unavailable as error:
            raise RuntimeError('Saved demo history is no longer usable: ' + str(error)) from None
    return result


def select(api, excluded, state, save, seconds=1200, emit=print, allowed=lambda p, c: True):
    deadline = time.monotonic() + seconds
    excluded = sorted(set(excluded) | {2, 3, 299271, 300182})
    now = time.time()
    if (not state or state.get('version') != 1 or state.get('excluded') != excluded
            or type(state.get('started')) not in (int, float) or now - state['started'] >= 86400):
        state = {'version': 1, 'started': now, 'excluded': excluded, 'done_payers': [],
                 'done_clients': [], 'found': [], 'empty': 0, 'unavailable': 0}
    if (not isinstance(state.get('done_payers'), list) or not all(positive(x) for x in state['done_payers'])
            or not isinstance(state.get('done_clients'), list)
            or any(not isinstance(x, list) or len(x) != 2 or not all(positive(y) for y in x) for x in state['done_clients'])
            or not isinstance(state.get('found'), list) or len(state['found']) > 3
            or any(not isinstance(p, dict) or not all(positive(p.get(k)) for k in ('payer_kid', 'client', 'order_id')) for p in state['found'])
            or len({p['payer_kid'] for p in state['found']}) != len(state['found'])
            or any(type(state.get(k)) is not int or state[k] < 0 for k in ('empty', 'unavailable'))):
        raise RuntimeError('Search checkpoint is invalid; use --rescan to start a fresh read')
    done = set(state['done_payers'])
    done_clients = {tuple(x) for x in state['done_clients']}
    found, errors, repeated = [], 0, {}
    # Partial results are re-read; the checkpoint never substitutes for KIS.
    for old in state['found'][:]:
        payer = api.call('/payers/' + str(old['payer_kid']), kis=True)
        try:
            if old['payer_kid'] in excluded or not customer(payer, old['payer_kid']) or not allowed(payer, old['client']):
                raise Unavailable('Saved candidate changed')
            found.append(verify(api, payer, old['client'], deadline))
        except Unavailable:
            done.discard(old['payer_kid'])
            done_clients.discard((old['payer_kid'], old['client']))
    def persist():
        state.update(done_payers=sorted(done), done_clients=[list(x) for x in sorted(done_clients)], found=[proof(x) for x in found])
        save(state)
    persist()
    if len(found) == 3:
        return found
    directory = rows(api.call('/payers', kis=True), 'customers')
    candidates = sorted((p for p in directory if p['id'] not in excluded and p.get('state') in (None, 1)), key=lambda p: p['id'], reverse=True)
    emit('HISTORY_SCAN: customers ' + str(len(candidates)) + ' | resumed ' + str(len(done)) + ' | verified ' + str(len(found)))
    try:
        for index, candidate in enumerate(candidates):
            pid = candidate['id']
            if pid in done:
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError('History search time budget reached; progress saved')
            if index % 10 == 0:
                emit('HISTORY_PROGRESS: customer ' + str(index + 1) + '/' + str(len(candidates)) + ' | empty recipients ' + str(state['empty']) + ' | verified ' + str(len(found)))
            try:
                payer = api.call('/payers/' + str(pid), kis=True)
                if not customer(payer, pid) or not allowed(payer, None):
                    done.add(pid)
                    persist()
                    continue
                points = rows(api.call('/payers/' + str(pid) + '/clients', kis=True), 'recipients')
                for point in points:
                    cid = point['id']
                    if (pid, cid) in done_clients or point.get('state') not in (None, 1):
                        continue
                    if not allowed(payer, cid):
                        done_clients.add((pid, cid))
                        continue
                    try:
                        item = verify(api, payer, cid, deadline, points)
                    except Unavailable as error:
                        state['empty' if str(error) == 'Empty recipient history' else 'unavailable'] += 1
                        done_clients.add((pid, cid))
                        persist()
                        continue
                    found.append(item)
                    emit('HISTORY_FOUND: ' + payer['name'] + ' | ' + point.get('kod', str(cid)) + ' | orders ' + str(item['history_count']) + ' | readable order ' + str(item['order_id']))
                    break
                done.add(pid)
                persist()
            except TimeoutError:
                raise
            except (RuntimeError, OSError) as error:
                errors += 1
                message = ' '.join(str(error).split())[:1400]
                if errors <= 5:
                    emit('HISTORY_READ_ERROR: ' + message)
                signature = re.sub(r'\d+', '#', message)
                repeated[signature] = repeated.get(signature, 0) + 1
                if repeated[signature] >= 3:
                    raise RuntimeError('Repeated KIS read/contract failure: ' + message) from None
            if len(found) == 3:
                return found
    finally:
        persist()
    raise RuntimeError('THREE_HISTORIES_NOT_FOUND: verified=' + str(len(found)) + ', empty recipients=' + str(state['empty']) + ', unavailable=' + str(state['unavailable']) + ', read errors=' + str(errors) + '. Existing logins retained; no substitute history or orders created.')
