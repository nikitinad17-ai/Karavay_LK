#!/usr/bin/env python3
"""Two real KIS buyers, two recipients each, six independent PB test logins.

Run locally on the VM with sudo. No PB admin credentials, stored passwords,
KIS writes, client replacement, or schema changes. Default is read-only.
"""
import argparse
from contextlib import closing
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SOURCE = Path(__file__).resolve().parents[1]
CONFIG = 'manager-recipient-demos.json'
MIGRATION = '1793145600_manager_recipient_demos.js'
EXCLUDED_IDS = {2, 3, 299271, 300182}
EXCLUDED_NAMES = ('КАРАВАЙ', 'ПАЛЯНИЦ', 'НЕВА', 'ПРОМТЕХСБЫТ', 'KARAVAY', 'KARAVAI', 'PALYAN', 'PALIAN')
KINDS = ['buyer1', 'point11', 'point12', 'buyer2', 'point21', 'point22']


def rid():
    return ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(15))


def positive(value):
    return type(value) is int and 0 < value < 2**53


def excluded(row):
    name = re.sub('[^А-ЯA-Z0-9]', '', str(row.get('name', '')).upper().replace('Ё', 'Е'))
    return row.get('id') in EXCLUDED_IDS or any(x in name for x in EXCLUDED_NAMES)


class Api:
    def __init__(self, pb='http://127.0.0.1:8090', kis='http://serv15db:55580/api/v1'):
        self.pb, self.kis = pb, kis
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, path, body=None, token='', kis=False, origin=None):
        if kis and (body is not None or token):
            raise RuntimeError('Only unauthenticated GET to KIS is allowed')
        request = urllib.request.Request((self.kis if kis else self.pb) + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {}), **({'Origin': origin} if origin else {})})
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(8*1024*1024+1)
        except urllib.error.HTTPError as error:
            # Never print upstream SQL diagnostics, headers, or request bodies.
            raise RuntimeError('HTTP '+str(error.code)+' при '+path.split('?')[0]) from None
        if len(raw) > 8*1024*1024:
            raise RuntimeError('Response is too large')
        value = raw.decode('utf-8-sig')
        if kis:
            value = re.sub(r'"(?:[^"\\]|\\[\s\S])*"|([:\[,]\s*)(-?)\.(\d+)',
                lambda m: m[0] if m[1] is None else m[1]+m[2]+'0.'+m[3], value)
        doc = json.loads(value)
        if kis:
            if not isinstance(doc, dict) or doc.get('success') is not True:
                raise RuntimeError('КИС не подтвердила справочник')
            return doc['data']
        return doc


def snapshot(root):
    with closing(sqlite3.connect('file:'+str(root/'pb_data/data.db')+'?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        queries = {
            'users': 'id,name,email,login,role,role_code,active,must_change_password,manager_owner',
            'roles': 'id,code_role,active',
            'payers': 'id,id_pay,kod_pay,name_pay,active',
            'clients': 'id,id_clt,kod_clt,name_clt,payer,active',
            'rights': 'id,user,payer,client,scope,kis_client_id,active',
        }
        return {name: [dict(r) for r in db.execute('SELECT '+columns+' FROM '+name)] for name, columns in queries.items()}


def manager(data):
    users = [u for u in data['users'] if u['name'].strip() == 'Менеджер Каравай']
    if len(users) != 1:
        raise RuntimeError('Менеджер Каравай не найден однозначно')
    user = users[0]
    role = next((r for r in data['roles'] if r['id'] == user['role']), {})
    if not user['active'] or user['must_change_password'] or user['role_code'] != 'manager' or role.get('code_role') != 'manager' or not role.get('active'):
        raise RuntimeError('Менеджер отключён, требует смены пароля или имеет другую роль')
    owners = [r for r in data['roles'] if r['code_role'] == 'owner' and r['active']]
    if len(owners) != 1:
        raise RuntimeError('Активная роль оформления заказов не найдена однозначно')
    return user['id'], owners[0]['id']


def rows(api, path):
    value = api.call(path, kis=True)
    if not isinstance(value, list) or len(value) > 10000 or any(not isinstance(x, dict) or not positive(x.get('id')) for x in value) or len({x['id'] for x in value}) != len(value):
        raise RuntimeError('Некорректный справочник КИС: '+path)
    return value


def verify_buyer(api, data, mid, pid, wanted=None, deadline=None):
    p = api.call('/payers/'+str(pid), kis=True)
    if not isinstance(p, dict) or p.get('id') != pid or p.get('state') != 1 or excluded(p) or not all(isinstance(p.get(k), str) and p[k].strip() for k in ('name', 'kod')):
        return None
    matches = [x for x in data['payers'] if x['id_pay'] == pid or x['kod_pay'] == p['kod']]
    local = matches[0] if len(matches) == 1 else None
    if matches and (len(matches) != 1 or local['id_pay'] != pid or local['kod_pay'] != p['kod'] or not local['active']):
        return None
    if local and not any(r['user'] == mid and r['payer'] == local['id'] and r['active'] and r['scope'] == 'all' and r['kis_client_id'] == 0 and not r['client'] for r in data['rights']):
        return None
    directory = rows(api, '/payers/'+str(pid)+'/clients')
    if wanted is not None and not set(wanted) <= {x['id'] for x in directory}:
        raise RuntimeError('Сохранённый получатель больше не принадлежит покупателю')
    points = []
    for row in sorted(directory, key=lambda x: x['id']):
        if deadline is not None and time.monotonic() >= deadline:
            raise RuntimeError('Истекло время подбора покупателей; записей не сделано')
        if row.get('state') == 0:
            continue
        if wanted is not None and row['id'] not in wanted:
            continue
        x = api.call('/clients/'+str(row['id']), kis=True)
        if not isinstance(x, dict) or x.get('id') != row['id'] or x.get('payer_id') != pid or x.get('state') != 1 or not all(isinstance(x.get(k), str) and x[k].strip() for k in ('name', 'kod', 'adres')):
            continue
        existing = [c for c in data['clients'] if c['id_clt'] == x['id'] or local and c['payer'] == local['id'] and c['kod_clt'] == x['kod']]
        c = existing[0] if len(existing) == 1 else None
        if existing and (len(existing) != 1 or not local or c['payer'] != local['id'] or c['id_clt'] != x['id'] or c['kod_clt'] != x['kod'] or not c['active']):
            continue
        points.append({'id': c['id'] if c else rid(), 'kid': x['id'], 'code': x['kod'], 'name': x['name'], 'address': x['adres']})
        if len(points) == 2:
            break
    if len(points) != 2 or len({x['code'] for x in points}) != 2:
        return None
    return {'id': local['id'] if local else rid(), 'kid': pid, 'code': p['kod'], 'name': p['name'], 'new': not bool(local), 'manager_right': rid(), 'clients': points}


def select(api, data, saved=None, seconds=900):
    mid, owner = manager(data)
    if saved is not None:
        if saved.get('version') != 1 or saved.get('manager_id') != mid or saved.get('owner_role') != owner or len(saved.get('payers', [])) != 2 or len(saved.get('accounts', [])) != 6:
            raise RuntimeError('Сохранённый набор демо не соответствует менеджеру или формату')
        for p in saved['payers']:
            actual = verify_buyer(api, data, mid, p['kid'], [c['kid'] for c in p['clients']])
            # If a new payer was written but its transaction never completed, do
            # not invent replacement identities or expand a different scope.
            if actual is None or actual['code'] != p['code'] or {x['kid'] for x in actual['clients']} != {x['kid'] for x in p['clients']} or actual['id'] != p['id'] and not actual['new']:
                raise RuntimeError('Сохранённые покупатели или получатели изменились; подстановка отменена')
        return saved
    chosen, repeats = [], {}
    deadline = time.monotonic()+seconds
    directory = rows(api, '/payers')
    for row in sorted(directory, key=lambda x: x['id'], reverse=True):
        if time.monotonic() >= deadline:
            break
        if excluded(row) or row.get('state') not in (None, 1):
            continue
        print('Проверяю покупателя КИС:', row['id'], flush=True)
        try:
            candidate = verify_buyer(api, data, mid, row['id'], deadline=deadline)
        except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError) as error:
            signature = re.sub(r'\d+', '#', str(error))
            repeats[signature] = repeats.get(signature, 0)+1
            print('Не удалось проверить карточку:', row['id'], flush=True)
            if repeats[signature] >= 3:
                break
            continue
        if candidate:
            chosen.append(candidate)
            print('Подтверждено:', candidate['code'], candidate['name'], '— два получателя с адресами', flush=True)
        if len(chosen) == 2:
            break
    if len(chosen) != 2:
        raise RuntimeError('Не найдены два допустимых покупателя с двумя активными получателями и адресами у каждого. Записей не сделано')
    accounts = []
    for i, kind in enumerate(KINDS):
        p = chosen[i//3]
        point = p['clients'][i%3-1] if i%3 else None
        name = ('Получатель '+point['code'] if point else 'Покупатель '+p['code'])+' (демо)'
        accounts.append({'id': rid(), 'right': rid(), 'email': 'demo.manager.'+kind+'.v090@example.test', 'login': 'demo_manager_'+kind+'_v090', 'name': name})
    return {'version': 1, 'enabled': True, 'manager_id': mid, 'owner_role': owner, 'payers': chosen, 'accounts': accounts}


def validate_existing(data, plan, require_all=False):
    for i, a in enumerate(plan['accounts']):
        existing = [u for u in data['users'] if u['id'] == a['id'] or u['email'] == a['email'] or u['login'] == a['login']]
        if not existing and not require_all:
            continue
        values = {k: a[k] for k in ('id', 'name', 'email', 'login')}
        values.update(role=plan['owner_role'], role_code='owner', active=1, must_change_password=0, manager_owner=plan['manager_id'])
        if len(existing) != 1 or any(existing[0].get(k) != v for k, v in values.items()):
            raise RuntimeError('Тестовая учётная запись изменена или конфликтует с существующей; перезапись отменена')
        p = plan['payers'][i//3]
        point = p['clients'][i%3-1] if i%3 else None
        rights = [r for r in data['rights'] if r['user'] == a['id']]
        wanted = {'id': a['right'], 'user': a['id'], 'payer': p['id'], 'scope': 'client' if point else 'all', 'client': point['id'] if point else '', 'kis_client_id': point['kid'] if point else 0, 'active': 1}
        if rights != [wanted]:
            raise RuntimeError('Права тестового пользователя изменены; они не перезаписаны')


def write_config(path, plan):
    fd, temporary = tempfile.mkstemp(prefix='.recipient-demos-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(plan, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        owner = path.parent.stat()
        os.chown(temporary, owner.st_uid, owner.st_gid)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def verify(api, plan, origin):
    auth = api.call('/service/manager/test-login', {}, origin=origin)
    if auth.get('record', {}).get('id') != plan['manager_id']:
        raise RuntimeError('Тестовый вход выбранного менеджера не подтверждён')
    manager_token = auth['token']
    accounts = api.call('/service/manager/demo-accounts', token=manager_token)['accounts']
    if {a['id'] for a in accounts} != {a['id'] for a in plan['accounts']}:
        raise RuntimeError('Набор тестовых пользователей не подтверждён')
    for i, account in enumerate(plan['accounts']):
        login = api.call('/service/manager/demo-login', {'id': account['id']}, token=manager_token, origin=api.pb)
        if login.get('record', {}).get('id') != account['id']:
            raise RuntimeError('Вход тестового пользователя не подтверждён')
        token = login['token']
        p = plan['payers'][i//3]
        context = api.call('/service/context', token=token)
        if {x['id'] for x in context['payers']} != {p['id']}:
            raise RuntimeError('Изоляция покупателей не подтверждена')
        points, cursor = [], None
        for _ in range(501):
            path = '/service/clients?'+urllib.parse.urlencode({'payer': p['id'], **({'cursor': cursor} if cursor else {}), 'perPage': 20})
            doc = api.call(path, token=token)
            points.extend(x['id'] for x in doc['clients'])
            if doc.get('hasMore') is False:
                break
            nxt = doc.get('nextCursor')
            if not positive(nxt) or cursor is not None and nxt <= cursor:
                raise RuntimeError('Некорректная пагинация получателей')
            cursor = nxt
        else:
            raise RuntimeError('Слишком много страниц получателей')
        wanted = {x['kid'] for x in p['clients']} if not i%3 else {p['clients'][i%3-1]['kid']}
        if (not i%3 and not wanted <= set(points)) or (i%3 and (set(points) != wanted or len(points) != 1)):
            raise RuntimeError('Изоляция получателей не подтверждена')
        if i%3:
            other = p['clients'][1 if i%3 == 1 else 0]['kid']
            try:
                api.call('/service/catalog?'+urllib.parse.urlencode({'payer': p['id'], 'client': other}), token=token)
            except RuntimeError as error:
                if not str(error).startswith('HTTP 403 '):
                    raise
            else:
                raise RuntimeError('Чужой получатель оказался доступен')
        print('DEMO_VERIFIED:', account['email'])


def configure(root, api, apply=False, origin='http://192.168.25.98:8090', run_id='manual'):
    path = root/'pb_data'/CONFIG
    if path.is_symlink():
        raise RuntimeError('Конфигурация демо является ссылкой')
    saved = json.loads(path.read_text()) if path.exists() else None
    data = snapshot(root)
    plan = select(api, data, saved)
    validate_existing(data, plan, require_all=bool(saved and saved.get('ready')))
    for p in plan['payers']:
        print('Покупатель:', p['code'], p['name'])
        for x in p['clients']:
            print('  Получатель:', x['code'], x['name'], '|', x['address'])
    if not apply:
        print('READ_ONLY: шесть отдельных входов; записи не выполнены')
        return plan
    subprocess.run(['systemctl', 'stop', 'pocketbase'], check=True)
    backup = root.parent/('.karavay-recipient-demos-before-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    try:
        # Recheck after stopping PB; the last live read is not a write lock.
        validate_existing(snapshot(root), plan, require_all=bool(saved and saved.get('ready')))
        backup.mkdir(mode=0o700)
        shutil.copytree(root/'pb_data', backup/'pb_data')
        plan['enabled'] = True
        plan['ready'] = False
        write_config(path, plan)
        with tempfile.TemporaryDirectory(prefix='karavay-recipient-migration-') as temporary:
            shutil.copy2(SOURCE/'setup'/MIGRATION, Path(temporary)/MIGRATION)
            result = subprocess.run([str(root/'pocketbase'), 'migrate', 'up', '--dir', str(root/'pb_data'), '--hooksDir', str(root/'pb_hooks'), '--migrationsDir', temporary], capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Транзакция создания демо остановлена; проверьте связи и повторите тот же установщик')
        validate_existing(snapshot(root), plan, require_all=True)
    except Exception:
        if path.exists():
            plan['enabled'] = False
            write_config(path, plan)
        raise
    finally:
        subprocess.run(['systemctl', 'start', 'pocketbase'], check=True)
    try:
        for _ in range(60):
            try:
                api.call('/api/health')
                break
            except (OSError, ValueError, RuntimeError):
                time.sleep(.2)
        verify(api, plan, origin)
        plan.update(ready=True, run_id=run_id)
        write_config(path, plan)
    except Exception:
        plan['enabled'] = False
        write_config(path, plan)
        raise
    print('BACKUP:', backup)
    print('RECIPIENT_DEMOS_READY: 6 | /manager/ → Демо-пользователи')
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--run-id', default='manual')
    args = parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9_-]{1,100}', args.run_id):
        raise RuntimeError('Некорректный ID запуска')
    if os.geteuid() != 0:
        raise RuntimeError('Запустите с sudo на VM')
    root = Path('/opt/pocketbase')
    manifest = json.loads((SOURCE/'MANIFEST.json').read_text())
    for name in ['pb_hooks/karavay-manager.js', 'pb_hooks/karavay-manager.pb.js', 'pb_hooks/karavay-manager-demos.js', 'pb_public/manager/app.js', 'pb_public/manager/index.html']:
        if hashlib.sha256((root/name).read_bytes()).hexdigest() != manifest['package'][name]:
            raise RuntimeError('Сначала установите менеджер '+manifest['version']+': '+name)
    fd = os.open(root/'pb_data/.manager-recipient-demos.lock', os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Настройка демо уже выполняется') from None
        configure(root, Api(), args.apply, run_id=args.run_id)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit('ОСТАНОВЛЕНО: '+(str(error) if isinstance(error, RuntimeError) else 'Проверьте соединение и повторите тот же запуск; новые пароли не запрашиваются')) from None
