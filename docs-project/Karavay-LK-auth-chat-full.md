# Karavay-LK: авторизация и деплой — конспект

## 1. Задача

Нужна авторизация для двух ролей ЛК:
- **Покупатель** — юрлицо с договором, мастер-пароль, видит все свои Точки и балансы
- **Точка/Получатель** — конкретный адрес доставки, свой пароль (~600 точек в системе)

КИС не описывает авторизацию конечного пользователя (рассчитана на сервисный доступ по токену) — значит логины/пароли нужно хранить отдельно от КИС.

## 2. Технология: PocketBase на VPS в России

**Выбор:** PocketBase, self-hosted на VPS у Timeweb или Selectel.

**Почему не глобальные облака (Supabase/Neon/AWS):** 152-ФЗ требует хранить персональные данные россиян на серверах в РФ — это сразу исключает глобальные managed-сервисы, независимо от их технических достоинств.

**Почему PocketBase, а не managed Postgres:**
- один бинарник, готовая auth-система из коробки (хэширование, токены, reset-flow)
- встроенная админ-панель — менеджер КАРАВАЯ может вручную сбросить пароль без отдельного инструмента
- нагрузка на ~600 точек тривиальна для SQLite под капотом PocketBase — managed Postgres-кластер избыточен
- по духу совпадает с остальным стеком проекта (vanilla JS без бандлера — минимум движущихся частей)

*(Примечание: изначально в планировании фигурировала оценка ~5000 точек, актуальное число — 600. На выбор архитектуры это не повлияло, только на размер VM — можно брать самый скромный тариф.)*

## 3. Схема данных

Две auth-коллекции, повторяющие бизнес-иерархию. Логин — `kis_code` (напр. `B-1024`, `M-1467-01`), не email.

### Коллекция `buyers`

| Поле | Тип | Комментарий |
|---|---|---|
| `kis_code` | text, unique | логин, код Покупателя из КИС `/payers` |
| `phone` | text | опционально, задел под OTP-восстановление |
| `contact_email` | email | опционально, то же самое |
| `must_change_password` | bool | принудительная смена при первом входе |
| `active` | bool | блокировка без удаления при расторжении договора |

Auth-настройка: `passwordAuth.identityFields = ["kis_code"]`

```
listRule:   id = @request.auth.id
viewRule:   id = @request.auth.id
createRule: null   // заводит только менеджер КАРАВАЯ через админку
updateRule: id = @request.auth.id
deleteRule: null
```

### Коллекция `outlets`

| Поле | Тип | Комментарий |
|---|---|---|
| `kis_code` | text, unique | логин, код Точки из КИС `/clients` |
| `buyer` | relation → buyers | родительский Покупатель |
| `must_change_password` | bool | |
| `active` | bool | |

```
listRule:   buyer = @request.auth.id || id = @request.auth.id
viewRule:   buyer = @request.auth.id || id = @request.auth.id
createRule: @request.auth.collectionName = 'buyers' && @request.data.buyer = @request.auth.id
updateRule: buyer = @request.auth.id || id = @request.auth.id
deleteRule: buyer = @request.auth.id
manageRule: buyer = @request.auth.id
```

**Ключевой механизм — `manageRule`:** позволяет авторизованному Покупателю напрямую задать новый пароль своей Точке **без ввода старого пароля**, одним вызовом SDK:

```js
await pb.collection('outlets').update(outletId, {
  password: newPassword,
  passwordConfirm: newPassword,
  must_change_password: true
});
```

Отдельный бэкенд-прокси с суперюзер-токеном под это не нужен — вся логика на уровне правил доступа коллекции.

## 4. Выдача и восстановление паролей

| | Кто заводит | Кто восстанавливает |
|---|---|---|
| **Покупатель** | Менеджер КАРАВАЯ вручную, при подписании договора | Менеджер КАРАВАЯ (ручной сброс через админку). OTP на телефон/email — опция на будущее, если в КИС `/payers` реально есть актуальные контакты (не проверено) |
| **Точка** | Покупатель сам, через свой ЛК | Покупатель сам, через свой ЛК (self-service, без участия КАРАВАЯ) |

Мастер-пароль Покупателя восстановить "изнутри" некому — он на вершине иерархии, отсюда обязательное участие менеджера или OTP.

## 5. Миграция PocketBase (создание коллекций)

Файл `pb_migrations/1757304000_create_auth_collections.js`, применяется автоматически при первом запуске `pocketbase serve`:

```js
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // --- buyers ---
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

  // --- outlets ---
  const outlets = new Collection({
    type: "auth",
    name: "outlets",
    listRule: "buyer = @request.auth.id || id = @request.auth.id",
    viewRule: "buyer = @request.auth.id || id = @request.auth.id",
    createRule: "@request.auth.collectionName = 'buyers' && @request.data.buyer = @request.auth.id",
    updateRule: "buyer = @request.auth.id || id = @request.auth.id",
    deleteRule: "buyer = @request.auth.id",
    manageRule: "buyer = @request.auth.id",
    fields: [
      { name: "kis_code", type: "text", required: true, presentable: true },
      { name: "buyer", type: "relation", required: true, collectionId: buyers.id, maxSelect: 1, cascadeDelete: true },
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

*Синтаксис `passwordAuth`/`addIndex` сверить с [pocketbase.io/jsvm](https://pocketbase.io/jsvm/classes/Collection.html) для установленной версии — между минорными релизами PocketBase эти детали иногда меняются.*

## 6. Нужен ли отдельный веб-сервер

**Нет.** Готовый бинарник PocketBase по умолчанию отдаёт статику из `pb_public/` на `/` — а `build_inline.py` уже собирает весь ЛК в один самодостаточный HTML-файл. Достаточно положить его как `pb_public/index.html`.

Для проксирования запросов к КИС (нужно скрыть сервисные креды от браузера, почистить кривой JSON) — не отдельный Node/Python-сервис, а кастомный роут прямо в PocketBase через `pb_hooks` (`routerAdd`). Один процесс, один порт закрывает статику, авторизацию и прокси к КИС.

Единственное, что стоит добавить — **Caddy** перед PocketBase, но только ради автоматического HTTPS-сертификата (пара строк конфига, не отдельный сервер приложения).

## 7. Параметры VM и ОС

| Параметр | Рекомендация |
|---|---|
| CPU | 2 vCPU |
| RAM | 2 GB |
| Диск | 20–30 GB SSD/NVMe |
| ОС | **Ubuntu Server 24.04 LTS** |

Ubuntu — конкретный дистрибутив Linux (выбран за широкую документацию по связке PocketBase + Caddy + systemd). При выборе образа у провайдера — брать готовый шаблон "Ubuntu 24.04", ничего не доустанавливать.

## 8. Деплой с Windows-машины на Linux VM

1. **SSH из PowerShell** — OpenSSH-клиент встроен в Windows 10+, `ssh root@IP_VM`, PuTTY не нужен
2. **Перенос файлов** — `scp` прямо из PowerShell (`scp .\Karavay-LK-v2_0.html root@IP:/opt/pocketbase/pb_public/index.html`), для регулярной синхронизации — WinSCP или rsync через WSL
3. **CRLF vs LF** — Windows хранит переводы строк как CRLF, Linux ждёт LF; для shell-скриптов на VM это критично (та же проблема, из-за которой уже стоит `.gitattributes` для `.sh`-файлов) — новые bash-скрипты сохранять с LF
4. **Установка PocketBase на VM** — через bash: `curl` бинарника с GitHub, `unzip`, `chmod +x`, миграции в `pb_migrations/`, собранный HTML в `pb_public/`
5. **systemd-юнит** — `ExecStart` на `pocketbase serve`, `Restart=always`, автозапуск после перезагрузки/падения
6. **Caddy** — `apt install caddy`, короткий `Caddyfile` с доменом и `reverse_proxy` на порт PocketBase (обычно 8090), сертификат Let's Encrypt выпускается автоматически

## 9. Статус на момент чата

- Схема данных и правила доступа зафиксированы
- Миграция для автосоздания коллекций написана
- Параметры VM и ОС определены
- **Не начато:** `authApi.js` — обёртка над PocketBase SDK, заменяющая plaintext-проверку паролей в текущем `api.js`, по образцу существующих адаптеров (`adaptPayer`, `adaptClient` и т.д.)
