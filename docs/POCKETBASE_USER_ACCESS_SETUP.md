# PocketBase: настройка доступа пользователей к нескольким покупателям

Инструкция для React 3.6. В рамках разработки этой ветки VM не изменялась и миграция к серверу не применялась.

Целевая модель:

```text
users (Auth) → user_buyers (Base) → buyers → outlets
```

## 0. Перед изменениями

1. Зафиксируйте версию PocketBase и экспорт коллекций.
2. Создайте проверяемую резервную копию `/opt/pocketbase/pb_data` и копию `pb_public`.
3. Выполняйте настройку сначала на копии данных или отдельном тестовом экземпляре.
4. Не удаляйте существующие `buyers` и `outlets`: они остаются бизнес-справочниками.
5. Не помещайте пароли, токены, реальные ФИО и контакты в Git, миграции или команды терминала.

Подготовленный файл `pb_migrations/1789660800_user_multi_buyer_access.js` предназначен для ревью. Он создаёт коллекции и правила, но не создаёт пользователей, связи или пароли. Перед применением сравните его с фактическим экспортом схемы PocketBase 0.40.x.

## 1. Коллекция `users` — Auth

Password auth:

- Enabled: **On**;
- Identity fields: только `login`;
- для `login` обязателен уникальный индекс без учёта регистра.

| Поле | Тип | Обязательно | Назначение |
|---|---|---:|---|
| `login` | Text, unique | да | логин конкретного пользователя |
| `name` | Text | да | отображаемое имя |
| `active` | Bool | логически да | доступ разрешён только при `true` |
| `must_change_password` | Bool | логически да | 3.6 блокирует вход при `true` |

Рекомендуемый индекс:

```sql
CREATE UNIQUE INDEX idx_users_login ON users (login COLLATE NOCASE)
```

Auth rule:

```text
active = true
```

API rules:

- List: **Locked**;
- View:

```text
@request.auth.id != "" &&
@request.auth.collectionName = "users" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
id = @request.auth.id
```

- Create, Update, Delete, Manage: **Locked**.

## 2. Коллекция `user_buyers` — Base

| Поле | Тип | Обязательно | Настройка |
|---|---|---:|---|
| `user` | Relation → `users` | да | Single; cascade delete допустим |
| `buyer` | Relation → `buyers` | да | Single; проверить политику cascade delete |
| `role` | Select | да | `owner`, `manager`, `viewer`; Single |
| `active` | Bool | логически да | доступ действует только при `true` |

Уникальный индекс:

```sql
CREATE UNIQUE INDEX idx_user_buyers_user_buyer ON user_buyers (user, buyer)
```

List и View:

```text
@request.auth.id != "" &&
@request.auth.collectionName = "users" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
user = @request.auth.id &&
active = true
```

Create, Update, Delete: **Locked**. Назначения создаёт и меняет только администратор.

## 3. Коллекция `buyers`

Существующие поля сохраняются. Для 3.6 обязательны:

- `kis_id` — положительное целое;
- `kis_code` — непустой уникальный код;
- `name` — непустое название;
- `active` — `true` для доступного покупателя.

List и View:

```text
@request.auth.id != "" &&
@request.auth.collectionName = "users" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
active = true &&
@collection.user_buyers.user ?= @request.auth.id &&
@collection.user_buyers.buyer ?= id &&
@collection.user_buyers.active ?= true
```

Create, Update, Delete, Manage: **Locked**.

Если `buyers` пока остаётся Auth-коллекцией, задайте Auth rule **Locked** (`null`) или отключите Password auth после отдельной проверки. Это запрещает прямой вход через `buyers`; React 3.6 этот endpoint не вызывает.

## 4. Коллекция `outlets`

Существующая relation `buyer → buyers` сохраняется. Для 3.6 обязательны:

- `kis_id`;
- `kis_code`;
- `name`;
- `buyer` — Single, Required;
- `active`;
- `address` и `min_order_sum` могут быть пустыми/нулевыми по бизнес-правилам.

List и View:

```text
@request.auth.id != "" &&
@request.auth.collectionName = "users" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
active = true &&
@collection.user_buyers.user ?= @request.auth.id &&
@collection.user_buyers.buyer ?= buyer &&
@collection.user_buyers.active ?= true
```

Create, Update, Delete, Manage: **Locked**.

Если `outlets` остаётся Auth-коллекцией, её Auth rule также должна быть **Locked**. Прямой вход точки в 3.6 запрещён.

## 5. Почему клиентского фильтра недостаточно

React отправляет фильтры `user=<currentUser>` и `buyer=<selectedBuyer>`, но query-параметры контролирует браузер. Защиту обеспечивают правила выше:

- `user_buyers` возвращает только связи текущего `users` record;
- `buyers` независимо требует активную связь с текущим пользователем;
- `outlets` независимо требует активную связь пользователя с relation `buyer` самой точки;
- токены старых `buyers`/`outlets` не проходят проверку `collectionName = "users"`.

Проверяйте правила обычным токеном `users`: `_superusers` всегда обходит API rules.

## 6. Безопасные тестовые данные

Создайте только вымышленные записи, например:

1. два активных покупателя `TEST-B-01` и `TEST-B-02`;
2. по одному активному получателю каждого покупателя;
3. пользователя `TEST-U-MULTI-01` с двумя активными связями;
4. пользователя `TEST-U-SINGLE-01` с одной активной связью;
5. пользователя `TEST-U-NONE-01` без связей;
6. отдельную неактивную связь для отрицательного теста.

Пароли задайте вручную в админке и нигде не записывайте. У всех пользователей для обычного теста явно установите `active=true`, `must_change_password=false`.

## 7. Проверки API rules

Обычным пользователем, не суперпользователем, проверьте:

1. список `user_buyers` не содержит чужих строк;
2. прямой GET чужого `buyers/<id>` возвращает отказ/404;
3. фильтр клиента с чужим `buyerId` не раскрывает покупателя;
4. список `outlets` выбранного покупателя не содержит точек другого;
5. прямой GET чужой точки возвращает отказ/404;
6. `active=false` у пользователя, связи, покупателя или точки отнимает доступ;
7. токен, ранее выданный через `buyers`/`outlets`, больше не читает справочники;
8. снятие связи во время активной сессии обнаруживается после F5.

## 8. Сборка и публикация HTML

На машине сборки:

```bash
npm ci
npm run check
npm run build:standalone:pocketbase
```

Результат:

```text
artifacts/Karavay-LK-v3.6-PocketBase.html
```

После отдельного подтверждения пользователя файл можно переименовать в `index.html` и скопировать в `/opt/pocketbase/pb_public/`. В этой ветке VM не меняется.

## 9. Приёмка интерфейса

1. `TEST-U-SINGLE-01` сразу открывает назначенного покупателя.
2. `TEST-U-MULTI-01` видит экран выбора и переключатель в шапке.
3. После смены отображаются только точки нового покупателя.
4. `TEST-U-NONE-01` получает `NO_BUYER_ACCESS`.
5. F5 восстанавливает только всё ещё разрешённого покупателя.
6. Выход удаляет `karavay_pocketbase_user_session_v2` и `karavay_selected_buyer_v1` из `sessionStorage`.
7. Матрица, заказы и документы показываются как ещё не подключённые; mock fallback отсутствует.

## 10. Откат

До применения подготовьте и проверьте восстановление резервной копии. `migrate down 1` из подготовленного файла удаляет `users` и `user_buyers` и возвращает правила 3.5; это допустимо только до создания ценных пользовательских записей либо после отдельного экспорта. На рабочем сервере предпочтительнее восстановить проверенный snapshot схемы и `pb_data` по утверждённой процедуре.
