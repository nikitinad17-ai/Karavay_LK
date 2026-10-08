# Первый GET /service/catalog — 2026-10-08

Реализация в отдельной ветке `feature/pb-kis-catalog`, исходная база main:
`818a0c11cf34c0cf33c816d762126cc07e568296`.
Никаких миграций VM, изменений React-auth, заказов или записи в КИС.

## Контракт

`GET /service/catalog?client=<PB clients.id>&DateOrd=<Unix seconds>&Group=0|1`
Дополнительный `payer=<PB payers.id>` необязателен, но должен совпадать с
фактическим payer получателя. Обязательные параметры не имеют неявных defaults.
Отклоняются неизвестные, повторные и неверные параметры; max query 2048 символов.
DateOrd — положительное целое до 4102444800 (2100-01-01 UTC), не миллисекунды.
Семантику даты/часового пояса и допустимые дни поставки надо сверить с КИС.

Авторизация — обычный PB users token в Authorization. Middleware
`$apis.requireAuth('users')` закрывает анонимный доступ и другие auth-коллекции.
На каждом запросе заново читаются users, roles, clients, payers и active rights.
Блокируется must_change_password; допустимы owner/manager/viewer (только чтение).
Relations ожидаются одиночными; активность — bool; id_pay/id_clt — числовые
положительные safe integers. Несовместимая схема не даёт доступ. После HTTP снова
проверяется доступ и неизменность сопоставления payer/client с КИС.
Отзыв после финальной проверки не может отменить уже отправленный ответ.

Rights проверяются параметризованным existence query: user + реальный payer +
active + (пустой client либо конкретный client). Поэтому право не теряется после
первых 200 записей; общий grant никогда не распространяется на другой payer.
API rules коллекций отдельно надо проверить на копии VM; hook их не изменяет.
Отсутствующая запись и чужая запись дают одинаковый отказ.

Ответ: `{client, payer, DateOrd, Group, Product:[...]}`. client/payer — PB IDs.
Внутренние ID получателя/плательщика в ответ не включаются. Product содержит
allowlist полей из исторического Product: id_prd, KodProd, NameProd, KolUkl,
CenaOTP, Group, необязательные BaseCenaOTP, Vesprod, ProcSkd, KolshtOrdmin,
MarketingGroup, Srok. Неизвестные поля отбрасываются. Текст — обычный текст,
клиент должен выводить его как текст, без HTML-интерпретации.

**Контракт КИС ещё не подтверждён живым запросом.** Строго принимается JSON-объект
`{id_clt, DateOrd, Group, Product}` из contracts/openapi.yaml; обязательна точная
принадлежность запрошенному контексту. Id_pay и id_clt/Id_pay строк продуктов,
если присутствуют, также сверяются. Не принимаются массивы без контекста,
data/result wrappers, числовые строки, ошибки под HTTP 200, отрицательные цены,
дубликаты SKU или другая группа. Пустой Product с правильным контекстом допустим.
Некорректные JSON-десятичные `.00` из старой диагностики **не ремонтируются**:
это 502 до согласования исправленного контракта/подтверждённых реальных fixtures.
После проверки VM адаптер можно уточнить; не ослаблять область доступа.

## Transport и зависимости

`pb_hooks/karavay-kis.pb.js` загружает `lib/catalog.cjs` внутри handler (JSVM).
Исходящий запрос выполняет системный **curl >= 8.4.0** через `$os.cmd()`, без shell.
`$http.send()` не используется: в проверенном исходнике PB v0.40.5 он следует
redirect через http.DefaultClient и полностью буферизует тело, без настройки
redirect policy/ограничения размера. Зависимость curl выбрана явно, а не скрыта.

- Только фиксированный `http://serv15db:55580/api/v1/clients/{validated id}/matrix`.
- GET; Accept JSON; без PB-токена, Cookie, ключа КИС, клиентских headers и URL.
- `--disable` первым аргументом: не читать пользовательский curlrc.
- `--noproxy '*'`, `--proto '=http'`; не использовать proxy из окружения.
- Без `--location`; 3xx отклоняется как 502, перехода на другой host нет.
- connect timeout 3 s; total timeout 10 s; без автоматических повторов.
- max response 2 MiB (`--max-filesize`), max 10000 products.
- curl exit 28 → 504; другие process/network failures → 502.
- upstream 401/403/5xx/204 → 502; PB 401/403 относятся к авторизации/правам.
- no-store, request ID, журнал только operation/status/duration/requestId.
- Сырые тела ошибок и внутренние адреса не выдаются; demo fallback отсутствует.

При отсутствии подходящего curl запрос безопасно завершится 502. Не размещать
подменяемый curl в writable PATH сервиса. Ограничить egress/firewall VM до КИС,
настроить PB rate limiting и proxy timeout >10 s на тестовом контуре до публикации.
curl запускает один процесс на чтение: нагрузку нужно измерить на VM.

## Выполнено локально

- `node --test tests/gateway/*.test.cjs`: 74 passed.
- `npm run check`: gateway tests, TypeScript strict, 22 existing Vitest tests,
  production build (результат финального запуска фиксируется в передаче).
- Изолированный PocketBase **v0.40.5** с временной БД и настоящими auth/relations:
  HTTP 401 без/с неверным токеном, 403 чужой client, 400 duplicate client,
  отключение user/role/right/payer/client после входа, 200 с отфильтрованным
  каталогом, curl exit 28 → 504, upstream 403/invalid JSON → 502.
  КИС заменён локальным curl stub; это не тест настоящего КИС/сети/таймаута 10 s.
  Hook действительно выполнен JSVM, включая SQL relation filter и $os.cmd.
- `npm run test:e2e`: 8 сценариев не запущены — отсутствует Chromium binary;
  это ограничение среды, не успешная UI-проверка.
- Runtime test: `POCKETBASE_BIN=/absolute/path/pocketbase python3 tests/gateway/runtime.py`.
  Нужны Python 3 и Linux; тест сам создаёт и удаляет только временную БД.
  fixture hook с тестовым mutation route **никогда не копировать на VM**.

## До развёртывания: только отдельная тестовая VM / копия данных

1. Узнать версию PB и curl под сервисным пользователем. Проверить исходную схему:
   users auth, roles, rights, payers, clients, типы/одиночность relations и ID,
   реальные API rules. Версия PB рабочей VM неизвестна; v0.40.5 не является
   рекомендацией обновить рабочий бинарник. Старые миграции не применять.
2. Владелец выбирает разрешённого тестового получателя; сверяет PB id_clt/id_pay
   с КИС. Проверить DNS/TCP, отсутствие ключа, JSON envelope, даты и обе группы.
3. В отдельный тестовый процесс скопировать **только** pb_hooks/karavay-kis.pb.js
   и pb_hooks/lib/catalog.cjs. Не копировать tests/gateway/fixture.pb.js.txt.
4. Проверить 200 с настоящим каталогом, сравнить SKU/цены/группу с ответом КИС;
   убедиться, что тело и Network не раскрывают внутренний URL/ошибки.
5. Обычными test users проверить 401, общий grant, конкретный grant, другой
   client того же payer, foreign payer, >200 rights и неправильную relation.
   Под тем же токеном отключать/отзывать каждое звено только в тестовой копии.
6. На локальном upstream stub тестовой VM проверить redirect на другой host
   (ноль переходов), timeout >10 s, отказ соединения, invalid/truncated JSON,
   тело >2 MiB, chunked тело >2 MiB. Не менять production DNS/КИС ради теста.
7. Проверить прямые PB list/view запросы обычным users token — чужие записи
   недоступны по rules. Сам GET hook эту отдельную защиту не устанавливает.
8. Проверить HTTPS/reverse proxy/no-store/rate limit и параллельную нагрузку.
   Никакие POST/PUT/DELETE заказов этим этапом не выполняются.

## PowerShell: связь из VM, без установки или перезапуска

Проверить SSH fingerprint по известному значению; не отключать host key checking.
Команды выполняются на Windows из папки с подготовленными скриптами:

```powershell
ssh.exe -T -o ConnectTimeout=10 Lindevadmin@192.168.25.98 'getent hosts serv15db; curl --version'
```

PB version: после определения пути бинарника выполнить через SSH именно
`<проверенный полный путь pocketbase> --version`. Путь нельзя угадывать.

Выбрать дату поставки вручную, в московском часовом поясе, например:

```powershell
$date = [DateTimeOffset]::Parse('2026-10-09T00:00:00+03:00').ToUnixTimeSeconds()
$kisClient = [int](Read-Host 'ID разрешённого тестового получателя в КИС')
.\Test-Karavay-KIS-Catalog.ps1 -KisClientId $kisClient -DateOrd $date -Group 0
.\Test-Karavay-KIS-Catalog.ps1 -KisClientId $kisClient -DateOrd $date -Group 1
```

Датированная дата — пример, не гарантия разрешённого дня поставки. Новый скрипт
проверяет DNS, TCP 55580 и один GET matrix, без proxy/redirect/auth; выводит
статус/структуру/совпадение контекста, не сырые значения. Python read timeout
10 s относится к операциям сокета; это диагностика, не транспорт hook.

Исходный Drive скрипт 05.10.2026 сохранён в
scripts/Karavay-KIS-API-Full-Check-v1.ps1 с **единственной** правкой default
`lindevedamin` → `Lindevadmin`. Drive-оригинал не изменён. Он перебирает
плательщиков, получателей и заказы GET, нормализует JSON decimals и следует
redirect urllib; для первого ограниченного теста использовать новый targeted
скрипт выше. PowerShell/SSH на Windows и связь с реальной VM здесь не запускались.

Источники: docs/POCKETBASE_KIS_GATEWAY.md, docs/POCKETBASE_ACCESS_MODEL.md,
contracts/openapi.yaml, src/types.ts, исходный Drive diagnostic.
Официальные API: https://pocketbase.io/docs/js-routing/,
https://pocketbase.io/docs/js-overview/, https://pocketbase.io/docs/js-sending-http-requests/.
