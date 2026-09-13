# Karavay-LK: авторизация и деплой PocketBase — конспект

## 1. Задача

Нужна авторизация для двух ролей ЛК:
- **Покупатель** — юрлицо с договором, мастер-пароль, видит все свои Точки и балансы
- **Точка/Получатель** — конкретный адрес доставки, свой пароль (~600 точек в системе)

КИС не описывает авторизацию конечного пользователя (рассчитана на сервисный доступ по токену) — значит логины/пароли нужно хранить отдельно от КИС.

## 2. Технология: PocketBase, self-hosted

**Выбор:** PocketBase на собственной VM (внутренняя, не облачный VPS — см. п.6).

**Почему PocketBase:**
- один бинарник, готовая auth-система из коробки (хэширование, токены, reset-flow)
- встроенная админ-панель — менеджер КАРАВАЯ может вручную сбросить пароль без отдельного инструмента
- нагрузка на ~600 точек тривиальна для SQLite под капотом — managed Postgres избыточен
- по духу совпадает с остальным стеком проекта (vanilla JS без бандлера)
- 152-ФЗ требует хранить персональные данные на серверах в РФ — исключает глобальные облачные auth-сервисы (Supabase, Neon и т.п.)

## 3. Схема данных

Две auth-коллекции, повторяющие бизнес-иерархию. Логин — `kis_code` (напр. `B-1024`, `M-1467-01`), не email.

### `buyers`

| Поле | Тип | Комментарий |
|---|---|---|
| `kis_code` | text, unique | логин, код Покупателя из КИС `/payers` |
| `phone` | text | опционально, задел под OTP-восстановление |
| `contact_email` | email | опционально, то же самое |
| `must_change_password` | bool | принудительная смена при первом входе |
| `active` | bool | блокировка без удаления при расторжении договора |

```
listRule:   id = @request.auth.id
viewRule:   id = @request.auth.id
createRule: null   // заводит только менеджер КАРАВАЯ через админку
updateRule: id = @request.auth.id
deleteRule: null
```

### `outlets`

| Поле | Тип | Комментарий |
|---|---|---|
| `kis_code` | text, unique | логин, код Точки из КИС `/clients` |
| `buyer` | relation → buyers | родительский Покупатель |
| `must_change_password` | bool | |
| `active` | bool | |

```
listRule:   buyer = @request.auth.id || id = @request.auth.id
viewRule:   buyer = @request.auth.id || id = @request.auth.id
createRule: @request.auth.collectionName = 'buyers' && @request.body.buyer = @request.auth.id
updateRule: buyer = @request.auth.id || id = @request.auth.id
deleteRule: buyer = @request.auth.id
manageRule: buyer = @request.auth.id
```

**Ключевой механизм — `manageRule`:** позволяет авторизованному Покупателю напрямую задать новый пароль своей Точке **без ввода старого пароля**, одним вызовом SDK — без отдельного бэкенд-прокси с суперюзер-токеном.

## 4. Выдача и восстановление паролей

| | Кто заводит | Кто восстанавливает |
|---|---|---|
| **Покупатель** | Менеджер КАРАВАЯ вручную, при подписании договора | Менеджер КАРАВАЯ (ручной сброс через админку). OTP на телефон/email — опция на будущее, **не проверено**, есть ли такие контакты в КИС `/payers` |
| **Точка** | Покупатель сам, через свой ЛК | Покупатель сам, через свой ЛК (self-service) |

## 5. Веб-сервер для интерфейса — отдельный не нужен

PocketBase по умолчанию отдаёт статику из `pb_public/` на `/`. `build_inline.py` уже собирает весь ЛК в один HTML-файл — достаточно положить его как `pb_public/index.html` (**пока не сделано**).

Для проксирования запросов к КИС (скрыть сервисные креды, почистить кривой JSON) — не отдельный Node/Python-сервис, а кастомный роут через `pb_hooks` (`routerAdd`) прямо в PocketBase (**пока не реализовано**).

## 6. Реальная инфраструктура

В процессе развёртывания выяснилось: разворачиваем не на облачном VPS (Timeweb/Selectel), а на **собственной внутренней VM**:

| | |
|---|---|
| Хост | `serv01WebLK` |
| IP | `192.168.25.98` (приватный, внутренняя сеть) |
| ОС | Ubuntu Server 24.04.5 LTS, x86_64 |
| Пользователь | `lindevadmin`, добавлен в sudo (`sudo -s`) |
| Интернет | **нет исходящего доступа** — apt/curl наружу не работают, все бинарники переносятся вручную через `scp` |

Работа велась с Windows-машины (RDP-сессия на `192.168.2.99`) через PowerShell + встроенный OpenSSH-клиент.

## 7. Ход развёртывания — ключевые уроки

- **Перенос бинарника PocketBase (0.40.3)** — скачан на Windows, распакован там же, перенесён через `scp` из **отдельного** окна PowerShell (не из уже открытой SSH-сессии — попытка выполнить `scp` изнутри SSH-сессии на Linux ломает разбор пути вида `C:\...`)
- **Права доступа** — `/opt/pocketbase` создавался через `sudo mkdir`, из-за чего оставался в собственности `root`; понадобился `sudo chown -R lindevadmin:lindevadmin /opt/pocketbase`, чтобы сам PocketBase (без sudo) мог создавать `pb_data`
- **Команды с `sudo` — строго по одной** — вставка нескольких строк одним блоком в терминал приводит к тому, что последующие строки "проваливаются" в запрос пароля первой команды (наблюдалось несколько раз, включая `sudo: 3 incorrect password attempts`)
- **Файл миграции без интернета** — вместо скачивания через браузер (могло скачаться не на ту машину, если работа велась внутри RDP-сессии — тогда Downloads/Desktop физически разные файловые системы) — содержимое вставлено напрямую через `cat > файл << 'EOF' ... EOF`, без интерактивного редактора
- **`pocketbase serve` в foreground обрывается** — процесс живёт только пока открыто конкретное окно/сессия; решение — systemd-сервис (см. п.8)

## 8. Текущий статус PocketBase — развёрнут и работает

| | |
|---|---|
| Версия | 0.40.3 |
| Бинарник | `/opt/pocketbase/pocketbase` |
| Запуск | systemd-юнит `pocketbase.service` — **enabled, active (running)** |
| API | `http://192.168.25.98:8090` |
| Админка | `http://192.168.25.98:8090/_/` |
| Суперюзер | `nikitinad17@gmail.com` |
| Коллекции | `buyers`, `outlets` — созданы согласно схеме из п.3 |

### systemd-юнит (`/etc/systemd/system/pocketbase.service`)

```ini
[Unit]
Description=PocketBase
After=network.target

[Service]
Type=simple
User=lindevadmin
Group=lindevadmin
WorkingDirectory=/opt/pocketbase
ExecStart=/opt/pocketbase/pocketbase serve --http=0.0.0.0:8090
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Исправление в миграции при разворачивании

Изначальный черновик миграции использовал `@request.data.buyer` в `createRule` — в PocketBase 0.40.3 это устаревший синтаксис, вызывал `invalid left operand`. Исправлено на `@request.body.buyer` (актуальное имя после рефакторинга правил в PocketBase v0.23+). Финальная рабочая версия — в разделе 10.

## 9. HTTPS — решение принято

Стандартный план (Caddy + автоматический Let's Encrypt) не подходит — у VM нет исходящего интернета, ACME-запрос до Let's Encrypt не пройдёт.

**Решение:** пока оставляем как есть, работаем по чистому HTTP. Вернуться к вопросу позже, когда будет ясность по сетевой инфраструктуре. Варианты на будущее: самоподписанный сертификат через Caddy (`tls internal`, не требует интернета), сертификат от корпоративного IT, либо TLS уже терминируется на другом узле сети.

## 10. Финальный файл миграции

`pb_migrations/1757304000_create_auth_collections.js`, уже применённый на сервере:

```js
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // --- buyers (Покупатели) ---
  const buyers = new Collection({
    type: "auth",
    name: "buyers",
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null,
    updateRule: "id = @request.auth.id",
    deleteRule: null,
    fields: [
      { name: "kis_code", type: "text", required: true, presentable: true },
      { name: "phone", type: "text" },
      { name: "contact_email", type: "email" },
      { name: "must_change_password", type: "bool" },
      { name: "active", type: "bool" }
    ]
  })
  buyers.addIndex("idx_buyers_kis_code", true, "`kis_code`", "")
  buyers.passwordAuth.identityFields = ["kis_code"]
  app.save(buyers)

  // --- outlets (Точки) ---
  const outlets = new Collection({
    type: "auth",
    name: "outlets",
    listRule: "buyer = @request.auth.id || id = @request.auth.id",
    viewRule: "buyer = @request.auth.id || id = @request.auth.id",
    createRule: "@request.auth.collectionName = 'buyers' && @request.body.buyer = @request.auth.id",
    updateRule: "buyer = @request.auth.id || id = @request.auth.id",
    deleteRule: "buyer = @request.auth.id",
    manageRule: "buyer = @request.auth.id",
    fields: [
      { name: "kis_code", type: "text", required: true, presentable: true },
      {
        name: "buyer",
        type: "relation",
        required: true,
        collectionId: buyers.id,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "must_change_password", type: "bool" },
      { name: "active", type: "bool" }
    ]
  })
  outlets.addIndex("idx_outlets_kis_code", true, "`kis_code`", "")
  outlets.addIndex("idx_outlets_buyer", false, "`buyer`", "")
  outlets.passwordAuth.identityFields = ["kis_code"]
  app.save(outlets)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("outlets")) } catch (e) {}
  try { app.delete(app.findCollectionByNameOrId("buyers")) } catch (e) {}
})
```

## 11. Открытые вопросы перед `authApi.js`

1. Есть ли в ответе КИС `/payers` реальный телефон/email покупателя (для self-service восстановления мастер-пароля)?
2. Полная замена demo-паролей в `api.js` сразу, или временный фолбэк на переходный период?
3. Заводить ли demo-учётки (`B-1024`, `M-1467-01`) в PocketBase сейчас, для Playwright-тестов, или отдельно позже?

## 12. Что дальше

- Ответить на вопросы из п.11
- Написать `authApi.js` — обёртка над PocketBase SDK, заменяющая plaintext-проверку в `api.js`
- Положить собранный `build_inline.py` HTML в `pb_public/index.html`
- Реализовать UI выдачи/сброса паролей (Покупатель → свои Точки)
- Прогнать демо-данные и Playwright-тесты против реального PocketBase
- Вернуться к вопросу HTTPS, когда будет ясность по сети
