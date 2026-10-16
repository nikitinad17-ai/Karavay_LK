#!/usr/bin/env python3
"""Create two new demo accounts using OTHER real buyers from the full KIS directory.
Run on the VM through ssh -t. No KIS writes, schema changes or client reinstall.
The local resume file contains IDs only, never passwords or auth tokens.
"""
import argparse, fcntl, getpass, json, os, pathlib, re, secrets, string, sys
import urllib.error, urllib.parse, urllib.request

PB = 'http://127.0.0.1:8090'
KIS = 'http://serv15db:55580/api/v1'
STATE = pathlib.Path.home() / '.karavay-other-demos-20261015.json'
EXCLUDED_IDS = {300182, 299271}
ACCOUNTS = [
    {'name': 'Два других покупателя КИС (демо)', 'email': 'demo.multi.kis@karavay.example', 'login': 'demo_multi_kis_20261015'},
    {'name': 'Одна торговая точка КИС (демо)', 'email': 'demo.point.kis@karavay.example', 'login': 'demo_point_kis_20261015'},
]

class Failure(Exception):
    pass

class Api:
    def __init__(self):
        self.token = ''
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, path, body=None, method=None, kis=False):
        if kis and (body is not None or method not in (None, 'GET')):
            raise Failure('Этот скрипт разрешает только чтение КИС.')
        req = urllib.request.Request(
            (KIS if kis else PB) + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={'Content-Type': 'application/json', **({'Authorization': self.token} if self.token and not kis else {})},
        )
        try:
            with self.opener.open(req, timeout=25) as response:
                raw = response.read(8388609)
            if len(raw) > 8388608:
                raise Failure('Ответ превышает допустимый размер.')
            parts = re.split(r'("(?:\\.|[^"\\])*")', raw.decode('utf-8-sig'))
            if kis:
                for i in range(0, len(parts), 2):
                    parts[i] = re.sub(r'([:\[,]\s*)(-?)\.(\d)', r'\g<1>\g<2>0.\3', parts[i])
            doc = json.loads(''.join(parts))
            if kis:
                if not isinstance(doc, dict) or doc.get('success') is not True or 'data' not in doc:
                    raise Failure('КИС не подтвердила чтение справочника.')
                return doc['data']
            return doc
        except urllib.error.HTTPError as error:
            raise Failure('HTTP ' + str(error.code) + ' при ' + path.split('?')[0] + '. Повторите тот же запуск: сохранённый план предотвратит дубли.') from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeError):
            raise Failure('Нет корректного ответа. Повторите тот же запуск; пароли не сохранялись.') from None

    def rows(self, collection, expression):
        doc = self.call('/api/collections/' + collection + '/records?' + urllib.parse.urlencode({'filter': expression, 'perPage': 200}))
        if doc.get('totalPages', 1) > 1:
            raise Failure('Слишком много совпадений в ' + collection + '.')
        return doc['items']

    def create(self, collection, body):
        return self.call('/api/collections/' + collection + '/records', body, 'POST')


def only(rows, description):
    if len(rows) != 1:
        raise Failure(description + ' отсутствует или неоднозначен.')
    return rows[0]


def valid_id(value):
    return type(value) is int and value > 0


def excluded(buyer):
    name = re.sub(r'[^А-ЯA-Z0-9]', '', str(buyer.get('name', '')).upper().replace('Ё', 'Е'))
    return buyer.get('id') in EXCLUDED_IDS or 'НЕВА' in name or 'ПРОМТЕХСБЫТ' in name


def checked_list(rows, maximum):
    if not isinstance(rows, list) or len(rows) > maximum:
        raise Failure('Некорректный или слишком большой справочник КИС.')
    ids = set()
    for row in rows:
        if not isinstance(row, dict) or not valid_id(row.get('id')) or row['id'] in ids:
            raise Failure('В справочнике КИС отсутствует или повторяется ID.')
        ids.add(row['id'])
    return sorted(rows, key=lambda row: row['id'])


def buyer_mapping(api, pid):
    actual = api.call('/payers/' + str(pid), kis=True)
    if not isinstance(actual, dict) or actual.get('id') != pid or actual.get('state') != 1 or excluded(actual):
        return None
    if not isinstance(actual.get('kod'), str) or not actual['kod'].strip() or not isinstance(actual.get('name'), str) or not actual['name'].strip():
        return None
    rows = api.rows('payers', 'id_pay = ' + str(pid) + ' || kod_pay = ' + json.dumps(actual['kod']))
    if rows:
        if len(rows) != 1 or rows[0].get('id_pay') != pid or rows[0].get('kod_pay') != actual['kod'] or rows[0].get('active') is not True:
            return None
        return {**rows[0], '_actual_name': actual['name']}
    return {'id': '', 'id_pay': pid, 'kod_pay': actual['kod'], 'name_pay': actual['name'], 'active': True, '_actual_name': actual['name']}


def recipients(api, payer, wanted=None):
    pid = payer['id_pay']
    rows = checked_list(api.call('/payers/' + str(pid) + '/clients', kis=True), 2000)
    result = []
    for candidate in rows:
        cid = candidate['id']
        if wanted is not None and cid != wanted:
            continue
        detail = api.call('/clients/' + str(cid), kis=True)
        if not isinstance(detail, dict) or detail.get('id') != cid or detail.get('payer_id') != pid or detail.get('state') != 1:
            continue
        name, code = detail.get('name') or candidate.get('name'), detail.get('kod') or candidate.get('kod')
        if not isinstance(name, str) or not name.strip() or not isinstance(code, str) or not code.strip():
            continue
        expression = 'id_clt = ' + str(cid)
        if payer['id']:
            expression += ' || (payer = ' + json.dumps(payer['id']) + ' && kod_clt = ' + json.dumps(code) + ')'
        local = api.rows('clients', expression)
        if local and (len(local) != 1 or local[0].get('id_clt') != cid or local[0].get('kod_clt') != code or not payer['id'] or local[0].get('payer') != payer['id'] or local[0].get('active') is not True):
            continue
        result.append({'id_clt': cid, 'kod_clt': code, 'name_clt': name, 'local': local[0] if local else None})
        if wanted is not None or len(result) == 2:
            break
    return result


def choose(api):
    directory = checked_list(api.call('/payers', kis=True), 10000)
    print('Получен полный справочник КИС:', len(directory), 'покупателей. НЕВА и ПРОМТЕХСБЫТ исключены.', flush=True)
    eligible = []
    for index, row in enumerate(directory):
        if excluded(row):
            continue
        if index % 20 == 0:
            print('Подбираю других активных покупателей и проверяю их получателей…', flush=True)
        payer = buyer_mapping(api, row['id'])
        if not payer:
            continue
        points = recipients(api, payer)
        if not points:
            continue
        eligible.append((payer, points))
        multi = next((pair for pair in eligible if len(pair[1]) > 1), None)
        if len(eligible) >= 2 and (multi or len(eligible) >= 20):
            break
    if len(eligible) < 2:
        raise Failure('В КИС не найдены два других активных покупателя с подтверждёнными получателями. Ничего не создано.')
    first = next((pair for pair in eligible if len(pair[1]) > 1), eligible[0])
    second = next(pair for pair in eligible if pair[0]['id_pay'] != first[0]['id_pay'])
    return {
        'version': 1,
        'payers': [first[0]['id_pay'], second[0]['id_pay']],
        'client': first[1][0]['id_clt'],
        'users': [{'id': ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(15)), 'done': False} for _ in ACCOUNTS],
    }


def save(plan):
    temporary = STATE.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(plan, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, STATE)


def validate_plan(plan):
    try:
        good = (plan['version'] == 1 and len(plan['payers']) == 2 and len(set(plan['payers'])) == 2
                and all(valid_id(pid) and pid not in EXCLUDED_IDS for pid in plan['payers']) and valid_id(plan['client'])
                and len(plan['users']) == 2 and len({u['id'] for u in plan['users']}) == 2
                and all(re.fullmatch('[a-z0-9]{15}', u['id']) and type(u['done']) is bool for u in plan['users']))
    except (KeyError, TypeError):
        good = False
    if not good:
        raise Failure('Сохранённый план повреждён. Автоматическая смена покупателей отменена.')


def right_key(right):
    return right.get('payer'), right.get('scope'), right.get('kis_client_id'), right.get('client', '')


def run(api, apply):
    role = only(api.rows('roles', 'active = true && code_role = "owner"'), 'Активная роль owner')
    plan = json.loads(STATE.read_text()) if STATE.exists() else choose(api)
    validate_plan(plan)
    mappings = [buyer_mapping(api, pid) for pid in plan['payers']]
    if not all(mappings):
        raise Failure('Выбранный покупатель отключён или его связь с КИС изменилась.')
    point = only(recipients(api, mappings[0], plan['client']), 'Выбранная точка первого покупателя')
    if not recipients(api, mappings[1]):
        raise Failure('У второго покупателя больше нет подтверждённых активных получателей.')
    if any(not payer['id'] for payer in mappings):
        definition = api.call('/api/collections/payers')
        if any(field['name'] == 'contact_email' and field.get('required') for field in definition['fields']):
            raise Failure('Текущая схема требует реальный email покупателя. Контакт организации не выдумывается.')
    print('\n' + ACCOUNTS[0]['email'] + ' — два покупателя (демо):')
    for payer in mappings:
        print('  ', payer['_actual_name'], '| КИС', payer['id_pay'], '→ все активные получатели')
    print(ACCOUNTS[1]['email'] + ' — одна точка (демо):')
    print('  ', mappings[0]['_actual_name'], '→', point['name_clt'], '| КИС', point['id_clt'])
    legacy_id = point['local']['id'] if point['local'] else ''
    expected = [
        {(p['id'], 'all', 0, '') for p in mappings},
        {(mappings[0]['id'], 'client', point['id_clt'], legacy_id)},
    ]
    existing = []
    # Complete preflight of BOTH identities and their rights before any PB write.
    for index, account in enumerate(ACCOUNTS):
        rows = api.rows('users', 'email = ' + json.dumps(account['email']) + ' || login = ' + json.dumps(account['login']) + ' || id = ' + json.dumps(plan['users'][index]['id']))
        user = only(rows, 'Демо-пользователь') if rows else None
        if user:
            if user['id'] != plan['users'][index]['id'] or any(user.get(k) != v for k, v in account.items()) or user.get('role_code') != 'owner' or user.get('role') != role['id']:
                raise Failure('Email/login занят другой учётной записью. Она не изменена.')
            rights = api.rows('rights', 'user = ' + json.dumps(user['id']))
            keys = {right_key(r) for r in rights}
            if len(keys) != len(rights) or not keys <= expected[index] or any(r.get('active') is not True for r in rights):
                raise Failure('Права демо-пользователя были изменены отдельно. Они не перезаписаны.')
            if user.get('active') is True and keys != expected[index]:
                raise Failure('Активный пользователь имеет неполные права. Они не расширены.')
            if plan['users'][index]['done'] and user.get('active') is not True:
                raise Failure('Созданный ранее пользователь отключён. Автоматическое включение отменено.')
        elif plan['users'][index]['done']:
            raise Failure('Созданный ранее пользователь удалён. Автоматическое восстановление отменено.')
        existing.append(user)
    if not apply:
        print('READ_ONLY_PLAN: для создания запустите с --apply.')
        return
    password = None
    if any(user is None for user in existing):
        password = getpass.getpass('Временный пароль новых демо-пользователей (от 12 символов): ')
        if not 12 <= len(password) <= 128 or getpass.getpass('Повторите временный пароль: ') != password:
            raise Failure('Пароли не совпали или неверная длина.')
    save(plan)
    for i, payer in enumerate(mappings):
        if not payer['id']:
            mappings[i] = api.create('payers', {k: payer[k] for k in ('id_pay', 'kod_pay', 'name_pay', 'active')})
            print('PAYER_REGISTERED_FROM_KIS:', payer['id_pay'], payer['_actual_name'])
    if not legacy_id:
        legacy_id = api.create('clients', {k: point[k] for k in ('id_clt', 'kod_clt', 'name_clt')} | {'payer': mappings[0]['id'], 'active': True})['id']
    grants = [
        [{'payer': p['id'], 'scope': 'all', 'kis_client_id': 0, 'client': ''} for p in mappings],
        [{'payer': mappings[0]['id'], 'scope': 'client', 'kis_client_id': point['id_clt'], 'client': legacy_id}],
    ]
    for index, account in enumerate(ACCOUNTS):
        user = existing[index]
        if user and user.get('active') is True:
            print('ALREADY_EXISTS:', account['email'], '— пароль и права сохранены')
        else:
            if user is None:
                user = api.create('users', account | {'id': plan['users'][index]['id'], 'password': password, 'passwordConfirm': password, 'role': role['id'], 'role_code': 'owner', 'active': False, 'must_change_password': True})
            saved = api.rows('rights', 'user = ' + json.dumps(user['id']))
            keys = {right_key(r) for r in saved}
            for grant in grants[index]:
                if right_key(grant) not in keys:
                    api.create('rights', grant | {'user': user['id'], 'active': True})
            saved = api.rows('rights', 'user = ' + json.dumps(user['id']))
            if len(saved) != len(grants[index]) or {right_key(r) for r in saved} != {right_key(r) for r in grants[index]} or any(r.get('active') is not True for r in saved):
                raise Failure('Права не подтверждены. Новый пользователь остаётся отключённым.')
            api.call('/api/collections/users/records/' + user['id'], {'active': True}, 'PATCH')
            print('DEMO_USER_CREATED:', account['email'], '— при первом входе смена пароля')
        plan['users'][index]['done'] = True
        save(plan)
    print('ГОТОВО: другие покупатели взяты из КИС. Заказы не создавались; клиент не переустанавливался.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise Failure('Запускайте через ssh -t. Не передавайте пароль в аргументах.')
    with open(str(STATE) + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('Этот скрипт уже запущен в другом терминале.') from None
        api = Api()
        email = input('Email администратора PocketBase: ').strip()
        password = getpass.getpass('Пароль администратора: ')
        api.token = api.call('/api/collections/_superusers/auth-with-password', {'identity': email, 'password': password}, 'POST')['token']
        password = None
        try:
            run(api, args.apply)
        finally:
            api.token = ''


if __name__ == '__main__':
    try:
        main()
    except (Failure, OSError, ValueError) as error:
        print('ОСТАНОВЛЕНО:', error, file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
