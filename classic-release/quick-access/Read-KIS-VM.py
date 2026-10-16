#!/usr/bin/env python3
"""Read real KIS buyer/recipient candidates on the VM. No PB/KIS writes."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import urllib.error
import urllib.request

KIS = 'http://serv15db:55580/api/v1'
EXCLUDED_IDS = {300182, 299271}


class Failure(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        raise Failure('КИС перенаправляет запрос. Ожидается прямой внутренний API.')


def excluded(row):
    name = re.sub(r'[^А-ЯA-Z0-9]', '', str(row.get('name', '')).upper().replace('Ё', 'Е'))
    return row.get('id') in EXCLUDED_IDS or 'НЕВА' in name or 'ПРОМТЕХСБЫТ' in name


def valid_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def parse(raw):
    # Repair observed KIS decimals such as .14 only outside JSON strings.
    parts = re.split(r'("(?:\\.|[^"\\])*")', raw.decode('utf-8-sig'))
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r'([:\[,]\s*)(-?)\.(\d)', r'\g<1>\g<2>0.\3', parts[i])
    try:
        doc = json.loads(''.join(parts))
    except (ValueError, UnicodeError):
        raise Failure('КИС вернула некорректный JSON.') from None
    if not isinstance(doc, dict) or doc.get('success') is not True or 'data' not in doc:
        raise Failure('В ответе КИС нет success=true/data.')
    return doc['data']


def checked_list(data, maximum):
    if not isinstance(data, list) or len(data) > maximum:
        raise Failure('КИС вернула неожиданный или слишком большой справочник.')
    ids = set()
    for row in data:
        if not isinstance(row, dict) or not valid_id(row.get('id')) or row['id'] in ids:
            raise Failure('В справочнике отсутствует или повторяется ID.')
        ids.add(row['id'])
    return sorted(data, key=lambda row: row['id'])


def normalized(row):
    if not valid_id(row.get('id')) or any(not isinstance(row.get(k), str) or not row[k].strip() for k in ('kod', 'name')):
        raise Failure('В КИС отсутствует ID, код или название записи.')
    return {'id': row['id'], 'code': row['kod'], 'name': row['name']}


class Api:
    def __init__(self, report):
        self.report = report
        self.deadline = time.monotonic() + 180
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path):
        if not re.fullmatch(r'/(?:payers(?:/[1-9][0-9]*(?:/clients)?)?|clients/[1-9][0-9]*)', path):
            raise Failure('Неожиданный путь API.')
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise Failure('Достигнут лимит проверки 3 минуты. Сохранён частичный результат.')
        step = {'method': 'GET', 'path': path}
        self.report['requests'].append(step)
        try:
            request = urllib.request.Request(KIS + path, method='GET', headers={'Accept': 'application/json'})
            with self.opener.open(request, timeout=min(12, remaining)) as response:
                step['status'] = response.status
                raw = response.read(8388609)
            if len(raw) > 8388608:
                raise Failure('Ответ КИС превышает 8 МБ.')
            return parse(raw)
        except urllib.error.HTTPError as error:
            step['status'] = error.code
            raise Failure('КИС: HTTP ' + str(error.code) + ' при GET ' + path + '. Проверьте доступ с VM и состояние Web API.') from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = getattr(error, 'reason', error)
            if isinstance(reason, socket.gaierror):
                message = 'VM не разрешает имя serv15db. Нужна проверка корпоративного DNS.'
            elif isinstance(reason, (TimeoutError, socket.timeout)):
                message = 'КИС не ответила за 12 секунд. Проверьте маршрут и порт 55580 с VM.'
            elif isinstance(reason, ConnectionRefusedError):
                message = 'КИС отказала в соединении. Проверьте Web API на порту 55580.'
            else:
                message = 'Нет соединения VM → КИС. Проверьте корпоративный DNS, маршрут и Web API.'
            raise Failure(message) from None


def collect(api, report, scan_limit):
    directory = checked_list(api.get('/payers'), 10000)
    report['directory_count'] = len(directory)
    report['excluded_count'] = sum(excluded(row) for row in directory)
    print('КИС ответила. Покупателей в справочнике:', len(directory), flush=True)
    print('Подбираю две другие активные организации и проверяю принадлежность получателей…', flush=True)
    eligible = []
    for row in directory:
        if excluded(row):
            continue
        if report['scanned_count'] >= scan_limit:
            break
        report['scanned_count'] += 1
        pid = row['id']
        buyer = api.get('/payers/' + str(pid))
        if not isinstance(buyer, dict) or buyer.get('id') != pid or type(buyer.get('state')) is not int or buyer['state'] != 1 or excluded(buyer):
            continue
        item = normalized(buyer)
        rows = checked_list(api.get('/payers/' + str(pid) + '/clients'), 2000)
        item['directory_client_count'] = len(rows)
        item['clients'] = []
        # Only a small verified sample is needed to select demo candidates.
        for candidate in rows[:30]:
            detail = api.get('/clients/' + str(candidate['id']))
            if not isinstance(detail, dict) or detail.get('id') != candidate['id'] or detail.get('payer_id') != pid or type(detail.get('state')) is not int or detail['state'] != 1:
                continue
            detail = {**candidate, **detail, 'kod': detail.get('kod') or candidate.get('kod'), 'name': detail.get('name') or candidate.get('name')}
            item['clients'].append(normalized(detail))
            if len(item['clients']) == 2:
                break
        item['sample_only'] = len(item['clients']) < len(rows)
        if item['clients']:
            eligible.append(item)
            report['buyers'] = eligible[:2]
            print('Найден:', item['name'], '| КИС ID', pid, '| подтверждено точек:', len(item['clients']), flush=True)
        if len(eligible) >= 2 and (any(len(b['clients']) > 1 for b in eligible) or len(eligible) >= 20):
            break
    if len(eligible) < 2:
        raise Failure('В просмотренной части справочника не найдены два других активных покупателя с подтверждёнными получателями. Результат сохранён.')
    first = next((b for b in eligible if len(b['clients']) > 1), eligible[0])
    second = next(b for b in eligible if b['id'] != first['id'])
    report['buyers'] = [first, second]
    report['suggested_single_client'] = {'payer_id': first['id'], **first['clients'][0]}
    report['status'] = 'success'


def save_report(prefix, report):
    lines = ['КАРАВАЙ — ответ КИС с VM', report['checked_at'], 'Статус: ' + report['status']]
    if report.get('error'):
        lines += ['Ошибка: ' + report['error']]
    lines += ['Покупателей в справочнике: ' + str(report.get('directory_count', 'не получен')),
              'Просмотрено покупателей: ' + str(report['scanned_count']), '']
    for buyer in report['buyers']:
        lines += ['ПОКУПАТЕЛЬ: ' + buyer['name'], '  Код: ' + buyer['code'] + ' | ID КИС: ' + str(buyer['id'])]
        for client in buyer['clients']:
            lines += ['  ПОЛУЧАТЕЛЬ: ' + client['name'] + ' | код ' + client['code'] + ' | ID КИС ' + str(client['id'])]
        if buyer['sample_only']:
            lines += ['  Показана подтверждённая выборка; в справочнике покупателя записей: ' + str(buyer['directory_client_count'])]
        lines += ['']
    lines += ['Это кандидаты из живой КИС. Учётные записи и права не создавались.',
              'Перед назначением требуется сверка области менеджера в PocketBase.']
    prefix.parent.mkdir(parents=True, exist_ok=True)
    for suffix, content in [('.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n'), ('.txt', '\n'.join(lines) + '\n')]:
        path = Path(str(prefix) + suffix)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
    print('\n' + '\n'.join(lines), flush=True)
    print('Отчёт:', str(prefix) + '.json', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / 'Karavay-KIS-VM-20261016')
    parser.add_argument('--scan-limit', type=int, default=100)
    args = parser.parse_args()
    if not 2 <= args.scan_limit <= 1000:
        parser.error('--scan-limit must be between 2 and 1000')
    report = {'checked_at': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).isoformat(timespec='seconds'),
              'status': 'error', 'selection_is_preview': True, 'scanned_count': 0, 'buyers': [], 'requests': []}
    try:
        collect(Api(report), report, args.scan_limit)
    except (Failure, UnicodeError, ValueError) as error:
        report['error'] = str(error) if isinstance(error, Failure) else 'КИС вернула некорректные данные.'
    save_report(args.output, report)
    print('KIS_VM_READ_OK' if report['status'] == 'success' else 'KIS_VM_READ_FAILED', flush=True)
    return 0 if report['status'] == 'success' else 2


if __name__ == '__main__':
    sys.exit(main())
