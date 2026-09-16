# Контракт авторизации и каталога доступа — этап 2.2

Статус: реализован в React 3.5, готов к проверке на тестовом PocketBase.

## Граница ответственности

- PocketBase подтверждает личность, выдаёт и обновляет токен.
- Коллекция `buyers` соответствует роли `buyer`, `outlets` — роли `outlet`.
- Поле `kis_code` связывает auth-запись с бизнес-профилем КИС.
- В режиме `directory` профиль и relation `buyer → outlets` читаются из PocketBase без mock.
- Бизнес-данные могут работать из mock только при явном `VITE_DATA_MODE=mock`.
- Production по умолчанию использует `pocketbase + remote` и не подмешивает demo-данные.

## Запросы PocketBase

### Вход

React сначала проверяет `buyers`, затем — только при ошибке 400 — `outlets`.

```http
POST /api/collections/{buyers|outlets}/auth-with-password
Content-Type: application/json
X-Request-ID: <uuid>

{"identity":"TEST-B-01","password":"<введённый пароль>"}
```

Успешный ответ должен содержать `token` и `record`. Обязательные бизнес-поля записи:

```json
{
  "id": "<PocketBase record id>",
  "kis_id": 900001,
  "kis_code": "TEST-B-01",
  "name": "Тестовый покупатель",
  "active": true
}
```

### Каталог доступа

После входа покупателя React постранично запрашивает только его активных
получателей:

```http
GET /api/collections/outlets/records?page=1&perPage=200&filter=buyer%20%3D%20...
Authorization: <PocketBase token>
```

После входа получателя React получает родительского покупателя по relation
`buyer`. Реальное ограничение строк выполняют API rules PocketBase; клиентский
`filter` не считается защитой.

### Восстановление сессии

```http
POST /api/collections/{buyers|outlets}/auth-refresh
Authorization: <PocketBase token>
X-Request-ID: <uuid>
```

Таймаут авторизации задаётся `VITE_AUTH_TIMEOUT_MS`, по умолчанию 12 секунд.

## Хранение на клиенте

В `sessionStorage` сохраняются только:

```json
{
  "token": "<PocketBase token>",
  "collection": "buyers",
  "role": "buyer",
  "kisCode": "TEST-B-01"
}
```

Пароль и полная запись пользователя не сохраняются. Сессия действует в текущей вкладке браузера. При выходе, истечении токена либо ошибке связывания с бизнес-профилем локальная сессия удаляется.

## Ошибки клиента

| Код | HTTP | Значение | Поведение UI |
|---|---:|---|---|
| `MISSING_CREDENTIALS` | — | Не заполнен код или пароль | Оставить форму, показать сообщение |
| `INVALID_CREDENTIALS` | 400 | Код/пароль не принят обеими коллекциями | Оставить форму, не уточнять существование записи |
| `ACCOUNT_DISABLED` | 403 | `active=false` | Запретить вход |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `must_change_password=true` | Запретить вход до отдельного сценария смены пароля |
| `MISSING_KIS_CODE` | 422 | Нет связи с КИС | Запретить вход, исправить запись в админке |
| `ROLE_MISMATCH` | 409 | Коллекция и бизнес-профиль имеют разные роли | Удалить сессию, исправить данные |
| `SESSION_EXPIRED` | 401/403 | Токен больше не действителен | Удалить сессию, показать форму входа |
| `TIMEOUT` | 408 | PocketBase не ответил вовремя | Предложить повторить |
| `NETWORK` | — | Сервер недоступен/CORS/обрыв сети | Предложить проверить адрес и сеть |
| `INVALID_RESPONSE` | 2xx | Нет `token` или `record` | Запретить вход, проверить версию/прокси |
| `POCKETBASE_ERROR` | 5xx/другое | Ошибка PocketBase | Показать безопасный текст ошибки |
| `DIRECTORY_ACCESS_DENIED` | 403/404 | API rules не разрешили получить профиль/точки | Не открывать кабинет, проверить правила и relation |
| `DIRECTORY_INVALID_RECORD` | 422 | Нет `id`, `kis_id`, `kis_code`, `name` или `buyer` | Не открывать кабинет, исправить запись |
| `DIRECTORY_INVALID_RESPONSE` | 502 | Неверный формат списка или пагинации | Не открывать кабинет, проверить схему |
| `BUSINESS_API_NOT_CONNECTED` | 503 | Авторизация работает, но remote API ещё не подключён | Не открывать кабинет и удалить локальную сессию |

## Режимы сборки

| Команда | Авторизация | Бизнес-данные | Назначение |
|---|---|---|---|
| `npm run dev` | mock | mock | Локальная UI-разработка |
| `npm run build:demo` | mock | mock | Полностью автономная демонстрация |
| `npm run build:pocketbase-test` | PocketBase | mock | Проверка реального входа на VM |
| `npm run build:pocketbase-directory` | PocketBase | PocketBase directory | Проверка реальных buyers/outlets без КИС |
| `npm run build:standalone:pocketbase` | PocketBase | PocketBase directory | Один HTML для `pb_public` |
| `npm run build` | PocketBase | remote | Production, fail-closed до подключения КИС |

## Условия приёмки 2.2

1. Покупатель входит по `kis_code` из `buyers` и видит только связанные активные точки PocketBase.
2. Получатель входит по `kis_code` из `outlets` и видит только собственную точку и родительского покупателя.
3. Обновление страницы восстанавливает сессию через `auth-refresh`.
4. Выход удаляет токен; кнопка «Назад» не возвращает в кабинет.
5. `active=false`, `must_change_password=true`, неверный пароль и отсутствующий `kis_code` не открывают кабинет.
6. В исходниках, HTML/JS-сборке и хранилище браузера нет паролей.
7. Directory-сборка не содержит mock-заказы, цены, документы или фиксированный список клиентов.
