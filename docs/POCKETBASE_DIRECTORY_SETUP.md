# PocketBase directory — настройка этапа 2.2

Цель версии 3.5: проверить реальные учётные записи PocketBase и связь
`покупатель → получатели`, не подключая и не имитируя бизнес-данные КИС.

## 0. Перед изменениями

Сделайте резервную копию `/opt/pocketbase/pb_data` и текущей папки
`/opt/pocketbase/pb_public`. Не удаляйте `pb_data`, `pb_migrations` и бинарник
PocketBase.

## 1. Коллекция `buyers` (Auth)

В Password auth добавьте `kis_code` в **Identity fields**.

| Поле | Тип | Обязательно | Назначение |
|---|---|---:|---|
| `kis_id` | Number, целое, min 1 | да | числовой ID покупателя в КИС |
| `kis_code` | Text, unique | да | код для входа и связи с КИС |
| `name` | Text | да | отображаемое название |
| `active` | Bool | да | возможность входа и доступа |
| `must_change_password` | Bool | да | временный пароль ещё не заменён |
| `min_order_sum` | Number, min 0 | нет | резерв под данные КИС |
| `manager` | Text | нет | резерв под отображение менеджера |
| `manager_phone` | Text | нет | резерв под телефон менеджера |
| `inn` | Text | нет | резерв под профиль |
| `contact_email` | Email | нет | контактный email, не логин |

Правила:

- List: **Locked / superusers only**;
- View:

```text
@request.auth.id != "" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
active = true &&
(id = @request.auth.id || id = @request.auth.buyer)
```

- Create, Update, Delete, Manage: **Locked / superusers only**.

Если в настройках версии PocketBase есть отдельное поле **Auth rule**, задайте:

```text
active = true
```

## 2. Коллекция `outlets` (Auth)

В Password auth добавьте `kis_code` в **Identity fields**.

| Поле | Тип | Обязательно | Назначение |
|---|---|---:|---|
| `kis_id` | Number, целое, min 1 | да | числовой `id_clt` получателя в КИС |
| `kis_code` | Text, unique | да | код точки для входа |
| `name` | Text | да | название получателя |
| `address` | Text | нет | адрес получателя |
| `buyer` | Relation → `buyers`, max 1 | да | владелец получателя |
| `active` | Bool | да | возможность входа и видимость точки |
| `must_change_password` | Bool | да | временный пароль ещё не заменён |
| `min_order_sum` | Number, min 0 | нет | резерв под данные КИС |

Правила:

- List:

```text
@request.auth.id != "" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
active = true &&
must_change_password = false &&
buyer = @request.auth.id
```

- View:

```text
@request.auth.id != "" &&
@request.auth.active = true &&
@request.auth.must_change_password = false &&
active = true &&
must_change_password = false &&
(buyer = @request.auth.id || id = @request.auth.id)
```

- Create, Update, Delete, Manage: **Locked / superusers only**.
- Auth rule, если доступно: `active = true`.

Покупатель не получает право менять связь `buyer`, `kis_id`, `kis_code`, флаги
доступа или пароль точки. На этом этапе записи создаёт только администратор.

## 3. Первые безопасные тестовые записи

Сначала не используйте реального клиента.

Покупатель `buyers`:

```text
kis_id: 900001
kis_code: TEST-B-01
name: Тестовый покупатель
active: true
must_change_password: false
```

Получатель `outlets`:

```text
kis_id: 910001
kis_code: TEST-O-01
name: Тестовая точка 1
address: Тестовый адрес
buyer: relation на TEST-B-01
active: true
must_change_password: false
```

Пароли задайте вручную в админке. Не сохраняйте их в документации, GitHub,
командах терминала или сообщениях.

## 4. Публикация одного HTML

Файл `Karavay-LK-v3.5-PocketBase.html` переименуйте в `index.html` и поместите
в `/opt/pocketbase/pb_public/`. Он обращается к PocketBase того же origin, то
есть при открытии `http://192.168.25.98:8090/` не требует CORS и отдельного URL.

После замены выполните `Ctrl+F5`. Перезапуск PocketBase для статического HTML
обычно не нужен.

## 5. Приёмка

1. `TEST-B-01` входит и видит ровно одну связанную точку `TEST-O-01`.
2. `TEST-O-01` входит и видит только себя и название своего покупателя.
3. F5 восстанавливает сессию через `auth-refresh`.
4. Выход очищает токен.
5. `active=false` блокирует новый вход и доступ по старому токену к каталогу записей.
6. Получатель, привязанный к другому покупателю, не появляется в списке.
7. Разделы матрицы, заказов и документов честно отмечены как недоступные до подключения КИС.
