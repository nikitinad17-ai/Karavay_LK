# Проверка React + PocketBase на VM

Целевой адрес текущего тестового сервера: `http://192.168.25.98:8090/`.

## 1. Создать тестовые auth-записи

Откройте `http://192.168.25.98:8090/_/` и создайте две записи. Пароль задайте вручную в админке и не добавляйте его в файлы проекта.

### Покупатель

Коллекция `buyers`:

- `kis_code`: `DEMO-B-01`;
- `active`: `true`;
- `must_change_password`: `false`;
- `password` и `passwordConfirm`: один временный тестовый пароль.

### Получатель

Коллекция `outlets`:

- `kis_code`: `DEMO-O-0101`;
- `buyer`: relation на созданную запись `DEMO-B-01`;
- `active`: `true`;
- `must_change_password`: `false`;
- `password` и `passwordConfirm`: отдельный временный тестовый пароль.

В настройках обеих auth-коллекций `kis_code` должен быть разрешён как identity field. Если UI требует email, используйте отдельные технические адреса, но вход в React всё равно выполняйте по `kis_code`.

## 2. Проверить API до публикации React

В PowerShell пароль вводится скрыто и живёт только в текущей переменной:

```powershell
$secure = Read-Host "Пароль DEMO-B-01" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
$body = @{ identity = "DEMO-B-01"; password = $password } | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri "http://192.168.25.98:8090/api/collections/buyers/auth-with-password" -ContentType "application/json" -Body $body
$result.record.kis_code
$password = $null
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
```

Ожидаемый вывод: `DEMO-B-01`. Аналогично проверьте `outlets` и `DEMO-O-0101`.

## 3. Собрать тестовую версию

На компьютере, где установлен Node.js:

```bash
npm ci
npm run check
npm run build:pocketbase-test
```

Сборка лежит в `dist-pocketbase/`, использует базовый путь `/` и обращается к PocketBase на том же origin. Mock-данные включены только для временного бизнес-контура.

## 4. Опубликовать в `pb_public`

Сначала сохраните текущую папку `/opt/pocketbase/pb_public`, затем скопируйте содержимое `dist-pocketbase/` в `/opt/pocketbase/pb_public/`. Не удаляйте `pb_data`, `pb_migrations` и сам бинарник PocketBase.

После копирования откройте:

- приложение: `http://192.168.25.98:8090/`;
- админка: `http://192.168.25.98:8090/_/`.

Если старый JS остался в кэше браузера, выполните принудительное обновление страницы (`Ctrl+F5`). Перезапуск PocketBase для замены статических файлов обычно не требуется.

## 5. Чек-лист

- вход `DEMO-B-01` открывает роль покупателя;
- вход `DEMO-O-0101` открывает роль получателя;
- после F5 пользователь остаётся в кабинете;
- после выхода появляется форма входа;
- при `active=false` вход запрещён;
- неверный пароль даёт общее сообщение без раскрытия существования пользователя;
- в DevTools → Application → Session Storage есть токен, роль и `kisCode`, но нет пароля и полной записи пользователя.

## Следующий технический шаг

После приёмки авторизации нужно получить доступный из браузера API-шлюз КИС либо точное описание его URL, методов, заголовков авторизации и примеров ответов. Затем `VITE_DATA_MODE` можно переводить с `mock` на `remote` ресурс за ресурсом: buyer/outlets → matrix → orders → documents.
