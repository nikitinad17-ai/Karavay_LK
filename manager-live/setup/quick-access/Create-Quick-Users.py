#!/usr/bin/env python3
"""Create three scoped LK test users from live KIS; generate a PRIVATE local client.

Run on the VM with ssh -t. Never writes to KIS, pb_public, schema or hooks.
Only newly registered buyers are added to the selected manager's scope.
"""
import argparse
import base64
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('seed', HERE.parent / 'scripts/Seed-Demo-Users.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)
Failure = seed.Failure
STATE = Path.home() / '.karavay-quick-users-20261016.json'
OUTPUT = Path.home() / 'Karavay-Test-Login.html'
PB_PUBLIC = 'http://192.168.25.98:8090'
CLIENT_SHA = '899f81157a6204251fb2348af8b244ac8a465ecb3186a0aa08be951306f49f0b'


def new_id():
    return ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(15))


def private_save(path, text):
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def save(plan):
    private_save(STATE, json.dumps(plan, ensure_ascii=False, indent=2) + '\n')


def load_plan():
    if not STATE.exists():
        return None
    if STATE.is_symlink() or STATE.stat().st_uid != os.getuid() or STATE.stat().st_mode & 0o077:
        raise Failure('Приватный файл состояния должен принадлежать текущему пользователю и иметь права 600.')
    plan = json.loads(STATE.read_text())
    try:
        ids = [plan['manager'], plan['client_record'], plan['manager_rights'][0], plan['manager_rights'][1]]
        ids += [p['id'] for p in plan['payers']] + [a['id'] for a in plan['accounts']]
        valid = (plan['version'] == 1 and len(plan['payers']) == 2 and
                 len({p['kid'] for p in plan['payers']}) == 2 and
                 all(seed.valid_id(p['kid']) and p['kid'] not in seed.EXCLUDED_IDS and type(p['new']) is bool for p in plan['payers']) and
                 seed.valid_id(plan['client']) and len(plan['accounts']) == 3 and
                 len(ids) == len(set(ids)) and all(re.fullmatch('[a-z0-9]{15}', value) for value in ids) and
                 all(re.fullmatch('[A-Za-z0-9_-]{32}', a['password']) and type(a['done']) is bool for a in plan['accounts']))
    except (KeyError, TypeError):
        valid = False
    if not valid:
        raise Failure('Приватный план повреждён. Автоматическая смена назначений отменена.')
    return plan


def account_specs(mid):
    return [
        {'email': 'demo.quick.point.' + mid + '@example.test', 'login': 'quick_point_' + mid, 'name': 'Один получатель (демо)'},
        {'email': 'demo.quick.buyer.' + mid + '@example.test', 'login': 'quick_buyer_' + mid, 'name': 'Все точки покупателя (демо)'},
        {'email': 'demo.quick.multi.' + mid + '@example.test', 'login': 'quick_multi_' + mid, 'name': 'Два покупателя (демо)'},
    ]


def manager(api, wanted=None, preferred_name=None):
    role = seed.only(api.rows('roles', 'active = true && code_role = "manager"'), 'Активная роль manager')
    candidates = api.rows('users', 'active = true && must_change_password = false && role_code = "manager" && role = ' + json.dumps(role['id']))
    if wanted:
        chosen = seed.only([u for u in candidates if u['id'] == wanted], 'Выбранный активный менеджер')
        if preferred_name and chosen.get('name', '').strip().casefold() != preferred_name.strip().casefold():
            raise Failure('Сохранённый план принадлежит другому менеджеру. Автоматическая смена отменена.')
        print('Выбран менеджер:', chosen.get('name', ''), '|', chosen['email'])
        return chosen
    if not candidates:
        raise Failure('Нет активного менеджера. Сначала настройте его в PocketBase.')
    if preferred_name:
        chosen = seed.only([u for u in candidates if u.get('name', '').strip().casefold() == preferred_name.strip().casefold()], 'Активный менеджер «' + preferred_name + '»')
        print('Выбран менеджер:', chosen.get('name', ''), '|', chosen['email'])
        return chosen
    if len(candidates) == 1:
        return candidates[0]
    print('Активные менеджеры:')
    for index, u in enumerate(candidates, 1):
        print(' ', index, '—', u.get('name', ''), '|', u['email'])
    value = input('Номер, название или email менеджера: ').strip().casefold()
    if value.isdecimal() and 1 <= int(value) <= len(candidates):
        return candidates[int(value) - 1]
    return seed.only([u for u in candidates if u['email'].casefold() == value or u.get('name', '').strip().casefold() == value], 'Менеджер')


def whole_rights(api, mid):
    rights = api.rows('rights', 'user = ' + json.dumps(mid))
    return {r['payer'] for r in rights if r.get('active') is True and r.get('scope') == 'all' and r.get('kis_client_id') == 0 and not r.get('client')}


def choose(api, mid, payer_ids=None, client_id=None):
    allowed = whole_rights(api, mid)
    directory = seed.checked_list(api.call('/payers', kis=True), 10000)
    directory_count = len(directory)
    if payer_ids is not None:
        if len(payer_ids) != 2 or len(set(payer_ids)) != 2 or any(not seed.valid_id(pid) or pid in seed.EXCLUDED_IDS for pid in payer_ids) or not seed.valid_id(client_id):
            raise Failure('Нужны два разных допустимых ID покупателей и ID получателя.')
        directory = [seed.only([row for row in directory if row['id'] == pid], 'Покупатель КИС ' + str(pid)) for pid in payer_ids]
    eligible = []
    print('КИС:', directory_count, 'покупателей. Исключены НЕВА, ПРОМТЕХСБЫТ и чужие назначения.', flush=True)
    for row in directory:
        if seed.excluded(row):
            continue
        payer = seed.buyer_mapping(api, row['id'])
        if not payer or (payer['id'] and payer['id'] not in allowed):
            if payer_ids is not None:
                raise Failure('Закреплённый покупатель КИС ' + str(row['id']) + ' недоступен в полной области менеджера. Другую компанию не подставляем.')
            continue
        points = seed.recipients(api, payer, client_id if payer_ids is not None and row['id'] == payer_ids[0] else None)
        if points:
            eligible.append((payer, points))
        if len(eligible) >= 2 and (any(len(pair[1]) > 1 for pair in eligible) or len(eligible) >= 20):
            break
    if len(eligible) < 2:
        raise Failure('Не найдены два других покупателя с активными получателями в допустимой области. Записей не сделано.')
    first = eligible[0] if payer_ids is not None else next((pair for pair in eligible if len(pair[1]) > 1), eligible[0])
    if payer_ids is not None and first[0]['id_pay'] != payer_ids[0]:
        raise Failure('Закреплённый получатель первого покупателя недоступен. Подстановка другой точки отменена.')
    second = next(pair for pair in eligible if pair[0]['id_pay'] != first[0]['id_pay'])
    return {
        'version': 1, 'manager': mid,
        'payers': [{'kid': p['id_pay'], 'id': p['id'] or new_id(), 'new': not bool(p['id'])} for p in (first[0], second[0])],
        'client': first[1][0]['id_clt'],
        'client_record': first[1][0]['local']['id'] if first[1][0]['local'] else new_id(),
        'manager_rights': [new_id(), new_id()],
        'accounts': [{'id': new_id(), 'password': secrets.token_urlsafe(24), 'done': False} for _ in range(3)],
    }


def grants(plan):
    p1, p2 = [p['id'] for p in plan['payers']]
    all_first = {'payer': p1, 'scope': 'all', 'kis_client_id': 0, 'client': ''}
    return [
        [{'payer': p1, 'scope': 'client', 'kis_client_id': plan['client'], 'client': plan['client_record']}],
        [all_first],
        [all_first, {'payer': p2, 'scope': 'all', 'kis_client_id': 0, 'client': ''}],
    ]


def source_client(api):
    req = urllib.request.Request(seed.PB + '/', headers={'Accept': 'text/html'})
    with api.opener.open(req, timeout=25) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if hashlib.sha256(raw).hexdigest() != CLIENT_SHA:
        raise Failure('На VM другой клиент. Ожидается установленный 3.8.0; сайт не изменён. Нужна сверка клиентского HTML.')
    # file:// has opaque Origin:null; a private copy must be permitted to call PB.
    req = urllib.request.Request(seed.PB + '/api/collections/users/auth-with-password', method='OPTIONS', headers={
        'Origin': 'null', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
    })
    with api.opener.open(req, timeout=25) as response:
        if response.headers.get('Access-Control-Allow-Origin') not in ('*', 'null'):
            raise Failure('Настройки CORS не разрешают личный локальный HTML. Серверные настройки не изменены.')
    return raw.decode('utf-8')


def render_launcher(source, accounts, public_base):
    parsed = urllib.parse.urlsplit(public_base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise Failure('Некорректный адрес кабинета.')
    if not re.fullmatch(r'https?://[a-zA-Z0-9.:-]+', public_base):
        raise Failure('Адрес кабинета должен содержать только origin.')
    payload = json.dumps({'base': public_base, 'accounts': accounts}, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    js = (HERE / 'launcher.js').read_text().replace('__QUICK_DATA__', payload)
    css = (HERE / 'launcher.css').read_text()
    digest = base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()
    if source.count("connect-src 'self'") != 1 or source.count('script-src ') != 1:
        raise Failure('Неизвестная политика CSP клиента. Личный HTML не создан.')
    result = source.replace("connect-src 'self'", "connect-src 'self' " + public_base, 1)
    result = result.replace('script-src ', "script-src 'sha256-" + digest + "' ", 1)
    # Before the original module starts: relative requests target the fixed PB.
    result = result.replace('</head>', '<style>' + css + '</style><script>' + js + '</script></head>', 1)
    return result


def verify_login(api, account, expected):
    private = seed.Api()
    auth = private.call('/api/collections/users/auth-with-password', {'identity': account['email'], 'password': account['password']}, 'POST')
    record = auth.get('record', {})
    if record.get('id') != account['id'] or record.get('active') is not True or record.get('must_change_password') is True:
        raise Failure('Тестовый вход не подтверждён. Пароль не сбрасываем.')
    private.token = auth['token']
    try:
        context = private.call('/service/context')
        if context.get('user', {}).get('role') != 'owner' or {p['id'] for p in context['payers']} != {r['payer'] for r in expected}:
            raise Failure('Изоляция покупателей не подтверждена.')
        for right in expected:
            path = '/service/clients?' + urllib.parse.urlencode({'payer': right['payer'], 'perPage': 20})
            doc = private.call(path)
            if doc.get('payer') != right['payer'] or not doc.get('clients'):
                raise Failure('Доступные получатели не подтверждены.')
            if right['scope'] == 'client' and ({c['id'] for c in doc['clients']} != {right['kis_client_id']} or doc.get('hasMore') is not False):
                raise Failure('Изоляция одной точки не подтверждена.')
    finally:
        private.token = ''


def provision(api, apply, public_base=PB_PUBLIC, payer_ids=None, client_id=None, manager_name=None):
    plan = load_plan()
    if plan and payer_ids is not None and ([p['kid'] for p in plan['payers']] != payer_ids or plan['client'] != client_id):
        raise Failure('Сохранённый план содержит других покупателей/получателя. Существующие аккаунты и назначения не перезаписаны.')
    mid = manager(api, plan['manager'] if plan else None, manager_name)['id']
    owner = seed.only(api.rows('roles', 'active = true && code_role = "owner"'), 'Активная роль owner')
    if plan is None:
        plan = choose(api, mid, payer_ids, client_id)
    definitions = {col: api.call('/api/collections/' + col) for col in ('users', 'payers')}
    manager_owner = any(f['name'] == 'manager_owner' for f in definitions['users']['fields'])
    allowed = whole_rights(api, mid)
    mappings = []
    for i, p in enumerate(plan['payers']):
        payer = seed.buyer_mapping(api, p['kid'])
        if not payer or (payer['id'] and payer['id'] != p['id']):
            raise Failure('Связь выбранного покупателя изменилась. Назначения не перезаписываем.')
        if payer['id'] and payer['id'] not in allowed:
            # Resume only a buyer created with this saved ID, before its manager right.
            prior = api.rows('rights', 'payer = ' + json.dumps(payer['id']))
            if not p['new'] or prior:
                raise Failure('Покупатель вне полной области менеджера. Права не расширены.')
        if not payer['id'] and not p['new']:
            raise Failure('Существовавший покупатель удалён. Не восстанавливаем его автоматически.')
        mappings.append(payer)
    point = seed.only(seed.recipients(api, mappings[0], plan['client']), 'Выбранный получатель')
    if point['local'] and point['local']['id'] != plan['client_record']:
        raise Failure('Связь получателя изменилась. Существующая запись не перезаписана.')
    if not seed.recipients(api, mappings[1]):
        raise Failure('У второго покупателя нет активных получателей.')
    if any(not p['id'] for p in mappings) and any(f['name'] == 'contact_email' and f.get('required') for f in definitions['payers']['fields']):
        raise Failure('Схема требует настоящий контактный email покупателя. Вымышленную почту организации не записываем.')
    accounts = [s | a for s, a in zip(account_specs(mid), plan['accounts'])]
    expected = grants(plan)
    existing = []
    # All identities and all rights checked before any PB write.
    for i, account in enumerate(accounts):
        rows = api.rows('users', ' || '.join(k + ' = ' + json.dumps(account[k]) for k in ('id', 'email', 'login')))
        user = seed.only(rows, 'Тестовый пользователь') if rows else None
        if user:
            if any(user.get(k) != account[k] for k in ('id', 'email', 'login', 'name')) or user.get('role') != owner['id'] or user.get('role_code') != 'owner' or user.get('must_change_password') is True or (manager_owner and user.get('manager_owner') != mid):
                raise Failure('Совпавшая учётная запись изменена или принадлежит другому сценарию. Она не изменена.')
            rights = api.rows('rights', 'user = ' + json.dumps(user['id']))
            keys = {seed.right_key(r) for r in rights}
            wanted = {seed.right_key(r) for r in expected[i]}
            if len(keys) != len(rights) or not keys <= wanted or any(r.get('active') is not True for r in rights):
                raise Failure('Назначения тестового пользователя изменены. Не перезаписываем их.')
            if user.get('active') is True and keys != wanted:
                raise Failure('У активного пользователя неполные права. Не расширяем их автоматически.')
            if account['done'] and user.get('active') is not True:
                raise Failure('Готовый тестовый пользователь отключён. Повторное включение отменено.')
        elif account['done']:
            raise Failure('Тестовый пользователь удалён. Автоматическое восстановление отменено.')
        existing.append(user)
    print('Менеджер:', mid)
    for p in mappings:
        print('Покупатель КИС:', p['id_pay'], '|', p['_actual_name'])
    print('Одна точка:', point['id_clt'], '|', point['name_clt'])
    if not apply:
        print('READ_ONLY_PLAN: записи не выполнены. Для создания: --apply')
        return
    source = source_client(api)  # Fail before writes for an incompatible client/CORS.
    save(plan)  # Generated IDs/passwords survive uncertain HTTP outcomes.
    for i, p in enumerate(mappings):
        if not p['id']:
            fields = {k: p[k] for k in ('id_pay', 'kod_pay', 'name_pay', 'active')}
            api.create('payers', fields | {'id': plan['payers'][i]['id']})
        pid = plan['payers'][i]['id']
        if pid not in whole_rights(api, mid):
            if not plan['payers'][i]['new']:
                raise Failure('Права менеджера изменились; существующие назначения не расширены.')
            api.create('rights', {'id': plan['manager_rights'][i], 'user': mid, 'payer': pid, 'scope': 'all', 'kis_client_id': 0, 'client': '', 'active': True})
    if not point['local']:
        api.create('clients', {k: point[k] for k in ('id_clt', 'kod_clt', 'name_clt')} | {'id': plan['client_record'], 'payer': plan['payers'][0]['id'], 'active': True})
    for i, account in enumerate(accounts):
        user = existing[i]
        if not user:
            user = api.create('users', account_specs(mid)[i] | {'id': account['id'], 'password': account['password'], 'passwordConfirm': account['password'], 'role': owner['id'], 'role_code': 'owner', 'active': False, 'must_change_password': False} | ({'manager_owner': mid} if manager_owner else {}))
        if user.get('active') is not True:
            saved = {seed.right_key(r) for r in api.rows('rights', 'user = ' + json.dumps(user['id']))}
            for right in expected[i]:
                if seed.right_key(right) not in saved:
                    api.create('rights', right | {'user': user['id'], 'active': True})
            rights = api.rows('rights', 'user = ' + json.dumps(user['id']))
            if len(rights) != len(expected[i]) or {seed.right_key(r) for r in rights} != {seed.right_key(r) for r in expected[i]} or any(r.get('active') is not True for r in rights):
                raise Failure('Права не подтверждены. Новый пользователь оставлен отключённым.')
            api.call('/api/collections/users/records/' + user['id'], {'active': True}, 'PATCH')
        # Save immediately after enabling, before a potentially uncertain read.
        plan['accounts'][i]['done'] = True
        save(plan)
        verify_login(api, account, expected[i])
        print('QUICK_USER_VERIFIED:', account['email'])
    personal = []
    for i, account in enumerate(accounts):
        names = [mappings[0]['_actual_name']] if i < 2 else [p['_actual_name'] for p in mappings]
        description = ' → '.join(names) + (' · ' + point['name_clt'] if i == 0 else ' · все активные получатели')
        personal.append({k: account[k] for k in ('id', 'name', 'email', 'password')} | {'description': description, 'payers': [r['payer'] for r in expected[i]]})
    private_save(OUTPUT, render_launcher(source, personal, public_base))
    print('QUICK_USERS_READY:', OUTPUT)
    print('Личный HTML хранится вне pb_public. Скачайте его на свой компьютер. Заказы в КИС не создавались.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--payers', type=int, nargs=2, metavar=('FIRST', 'SECOND'))
    parser.add_argument('--client', type=int)
    parser.add_argument('--manager-karavay', action='store_true', help='Select the unique active user named Менеджер Каравай')
    args = parser.parse_args()
    if (args.payers is None) != (args.client is None):
        parser.error('--payers and --client must be provided together')
    if not sys.stdin.isatty():
        raise Failure('Запускайте через ssh -t. Пароли в аргументы не передавайте.')
    fd = os.open(str(STATE) + '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('Создание уже запущено в другом терминале.') from None
        api = seed.Api()
        email = input('Email администратора PocketBase (один раз при настройке): ').strip()
        password = getpass.getpass('Пароль администратора: ')
        auth = api.call('/api/collections/_superusers/auth-with-password', {'identity': email, 'password': password}, 'POST')
        password = None
        api.token = auth['token']
        auth = None
        try:
            provision(api, args.apply, payer_ids=args.payers, client_id=args.client, manager_name='Менеджер Каравай' if args.manager_karavay else None)
        finally:
            api.token = ''


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except (Failure, OSError, ValueError, KeyError, TypeError) as error:
        print('ОСТАНОВЛЕНО:', str(error) if isinstance(error, Failure) else 'Проверьте соединение и приватный план. Повторный запуск продолжит тот же сценарий; пароли не сбрасываются.', file=sys.stderr)
        sys.exit(1)
