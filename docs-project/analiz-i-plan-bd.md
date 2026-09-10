# ОАО «КАРАВАЙ» · Личный кабинет клиента v1.8
## Технический аудит и план перехода на реальную базу данных

Дата анализа: 04.09.2026 · Анализируемая сборка: `v1_8_2026-08-24`

---

## 1. Что представляет собой проект сейчас

### 1.1 Стек и архитектура

Это **vanilla-JS SPA без фреймворка и без сборщика**. Ни `package.json`, ни npm, ни бандлера — три `<script>` в HTML плюс один Python-скрипт, который склеивает всё в один self-contained файл.

| Файл | Строк | Роль |
|---|---|---|
| `app/app.js` | 2 240 | Весь UI: состояние, роутинг, рендер, обработчики, Excel-импорт/экспорт |
| `app/api.js` | 645 | **Фейковый бэкенд**: демо-данные + перехват `window.fetch` |
| `app/styles.css` | 1 065 | Стили, ~14 медиа-брейкпоинтов |
| `app/products.js` | 1 (минифиц.) | 111 SKU в `window.__PRODUCTS__` |
| `build_inline.py` | 75 | Инлайнит CSS/JS/SVG → `standalone.html` |

Рендер — полная перерисовка `innerHTML` корня на каждое изменение (`render()`), обработка событий — один делегированный слушатель на `document` с `data-action` / `data-route`. Для текущего объёма это работает, но это архитектурный потолок.

### 1.2 Про загруженные файлы

Все три артефакта — одна и та же сборка:

- `Karavay-...standalone.html` = `index.html` = `dist/index.html` = `app/standalone.html` — **побайтово идентичны** (md5 `ab3bb5df…`).
- `karavay-v1_8.html` — та же сборка **плюс инжектированный скрипт `data-pplx-inline-edit`** (визуальный редактор Perplexity Labs, ~11 КБ). В продакшн этот файл брать нельзя.

Единственный источник правды — папка `app/`. Остальное — артефакты сборки.

### 1.3 Реализованный функционал

Функционально проект гораздо дальше, чем обычный прототип:

- **Три сценария входа**: код покупателя + мастер-пароль → все точки; код точки + мастер-пароль → все точки с фокусом на этой; код точки + пароль точки → только эта точка.
- **Две роли** с разграничением: `buyer` видит сальдо и раздел «Мои точки», `outlet` — нет.
- **Каталог с двойным вводом** лотки ↔ штуки, `piecesPerLot`, флаг `lotOnly`, промо-цены (`isPromo` / `oldPrice`), поиск, фильтры (все / в заказе / регулярные), категории.
- **Графики доставки по слотам**: `deliverySchedule[7][]` — массив часов на каждый день недели, валидация слота при оформлении.
- **Бизнес-правила блокировки отгрузки** с приоритетом: нет договора → ручная блокировка → отрицательное сальдо → разрешено.
- **Минимальная сумма заказа** с приоритетом точки над покупателем.
- **Отмена/редактирование заказа** с дедлайном 17:00 дня, предшествующего доставке.
- **Excel**: импорт бланка заказа с матчингом по коду/названию и превью-модалкой; экспорт бланка заказа и всей истории.
- **Trusted-device**: код клиента запоминается в `localStorage`, вход по одному паролю.
- Документы (декларации соответствия, прайс), чат с менеджером, профиль, карточки точек.
- Полная мобильная адаптация со sticky-шапками и fullscreen-модалками.

Это зрелый, продуманный прототип с проработанной доменной логикой. Основная работа по переходу в продакшн — не «дописать фичи», а **перенести логику туда, где ей место**.

---

## 2. Критические блокеры

### 2.1 🔴 Пароли лежат в открытом виде в коде фронтенда

```js
{ id:15, code:"B-1467", name:"АО «Тандер» (Магнит)", …, password:"master1467" }
{ id:101, code:"P-1024-01", …, password:"grz2026" }
```

16 покупателей и 32 точки с паролями открытым текстом в `standalone.html`, который отдаётся браузеру целиком. Любой, кто открыл «Просмотр кода», получает доступ ко всем кабинетам.

**Это не «недоделка демо» — это то, что должно быть удалено первым же коммитом,** до того как файл окажется на любом публичном хосте. Даже если сейчас данные вымышленные, шаблон «пароль в объекте клиента» переезжает в реальную систему незаметно.

### 2.2 🔴 Вся бизнес-логика исполняется на клиенте

Проверки минимальной суммы, доступности слота, статуса отгрузки, дедлайна отмены — всё в `api.js`, то есть в браузере пользователя. Клиент может изменить сальдо, снять блокировку и отправить заказ на 10 рублей при минимуме 8 000.

При переносе на сервер эти проверки нужно **продублировать, а не переместить**: на клиенте — для UX (мгновенная подсветка), на сервере — как источник истины.

### 2.3 🟠 Мутации не доходят до бэкенда

Отмена заказа (`a==='cancel-order'`) и изменение количеств (`order-item-inc/dec`) правят только `state.ordersAll` в памяти. Ни одного HTTP-запроса. После F5 всё возвращается назад. Соответствующих эндпоинтов в `api.js` попросту нет.

**Отсутствующие ручки, которые фронт уже подразумевает:**

| Метод | Путь | Зачем |
|---|---|---|
| `POST` | `/api/orders/:id/cancel` | Кнопка «Отменить заказ» |
| `PATCH` | `/api/orders/:id` | Правка позиций до дедлайна |
| `POST` | `/api/auth/refresh` · `/api/auth/logout` | Сессии |
| `GET` | `/api/buyers/:id/balance` | Сальдо отдельно от профиля |
| `GET` | `/api/documents/:id/download` | Сейчас `href` — статический путь к PDF |

### 2.4 🟠 Ноль слоя доступа к данным

`api.js` — это одновременно и данные, и валидация, и роутер, и сериализация. Нет ни разделения, ни возможности подменить источник. Единственная точка стыковки с реальным сервером — строка:

```js
if (!/^\/api\//.test(path)) return _fetch(input, init);
```

Хорошая новость: **сам контракт уже спроектирован по-REST'овски**, пути и формы ответов вменяемые. Их можно взять как готовую спецификацию бэкенда почти без изменений.

### 2.5 🟡 Прочее

- **Цена одна для всех.** `GET /api/buyers/:id/products` возвращает общий прайс с комментарием «теперь без скидок». В реальности у сетей и HoReCa разные условия — нужен слой прайс-листов.
- **Нет пагинации.** История заказов и каталог грузятся целиком. При 111 SKU и 6 заказах на точку это незаметно; при 2 000 SKU и трёх годах истории — нет.
- **Роутинг не в URL.** `state.route` живёт только в памяти: нельзя дать ссылку на конкретный заказ, кнопка «назад» ломает навигацию.
- **XLSX подтягивается с CDN jsDelivr.** Единственная внешняя зависимость в offline-first приложении. Плюс шрифты Google Fonts.
- **Телефоны диспетчерских — заглушки** (`+7 (812) 000-00-01`), помечено комментарием в коде.
- **`docs/…pdf` захардкожен** как один и тот же файл для всех покупателей.

---

## 3. Модель данных (реконструирована из кода)

```
managers ──< buyers ──< outlets ──< orders ──< order_items >── products
                │         │                                      │
                │         └── delivery_schedule                   └── prices
                ├──< documents                                 (по прайс-листам)
                ├──< messages
                └──< balance_snapshots
platforms ──────┘ (площадка отгрузки точки)
```

**Сущности и их поля в текущем коде:**

- **buyer** (16 шт.): `code, name, legal, inn, sinceYear, manager, managerPhone, email, paymentDeferralDays, hasContract, contractNumber, contractDate, balance, shipmentMode ∈ {allowed|blocked|balance}, shipmentBlockReason, minOrderSum, segment, badges[], usesEdi, ediClientCode`
- **outlet** (32 шт.): `buyerId, code, name, address, phones[], deliverySchedule[7][], rep, repPhone, minOrderSum, receiver, platform ∈ {kush|zarya|karavay}`
- **product** (111 шт.): `code, name, category, weight, price, priceBase, pricePerKg, vat ∈ {10,22}, unit, packaging, shelf, minOrder, piecesPerLot, isPromo, oldPrice, lotOnly`
- **order**: `orderNumber, buyerId, outletId, deliveryDate, deliverySlotHour, createdAt, status ∈ {accepted|picked|shipped|delivered|hold|cancelled}, holdReason, source ∈ {web|voice|operator|edi}, ediOrderNumber, managerComment, items[], totalUnits, total`
- **document**: `kind ∈ {declaration|pricelist}, number, orderId, title, date, href`
- **message**: `author ∈ {manager|client}, authorName, text, createdAt, read`

Модель хорошо продумана. Проблема не в ней, а в том, что она размазана по литералам в JS-файле.

---

## 4. Целевая схема БД (PostgreSQL)

Ключевые решения по нормализации относительно текущего кода:

1. **`deliverySchedule[7][]` → таблица `delivery_slots`.** JSON-массив невозможно запросить («какие точки принимают в среду в 7 утра?») и невозможно расширить (сезонность, праздники, временные окна вместо часа).
2. **Пароли → отдельная таблица `credentials`** с хэшем Argon2id, отвязанная от бизнес-сущности. Одна точка может иметь несколько учёток, у учётки — своя жизнь (блокировка, срок, сброс).
3. **`balance` → `balance_snapshots`.** Сальдо приходит из 1С и меняется независимо от ЛК. Хранить его полем в `buyers` — значит терять историю и не знать, насколько данные свежие.
4. **Цены → `price_lists` + `prices`** с датами действия и привязкой к покупателю. Позволяет и промо, и индивидуальные условия сетей, и корректный пересчёт исторических заказов.
5. **`order_items` хранит цену на момент заказа** (`price_at_order`). Иначе изменение прайса перепишет прошлое.

```sql
-- ============ СПРАВОЧНИКИ ============

CREATE TABLE platforms (                    -- площадки отгрузки
  id           smallserial PRIMARY KEY,
  code         text UNIQUE NOT NULL,        -- 'kush' | 'zarya' | 'karavay'
  name         text NOT NULL,
  dispatch_phone text
);

CREATE TABLE managers (
  id       serial PRIMARY KEY,
  full_name text NOT NULL,
  phone    text,
  email    text,
  is_active boolean NOT NULL DEFAULT true
);

-- ============ КЛИЕНТЫ ============

CREATE TYPE shipment_mode AS ENUM ('allowed','blocked','balance');

CREATE TABLE buyers (
  id                     serial PRIMARY KEY,
  code                   text UNIQUE NOT NULL,            -- 'B-1024'
  erp_id                 text UNIQUE,                     -- ключ 1С (GUID)
  name                   text NOT NULL,
  legal_name             text NOT NULL,
  inn                    varchar(12) NOT NULL,
  kpp                    varchar(9),
  email                  text,
  since_year             smallint,
  manager_id             int REFERENCES managers(id),
  payment_deferral_days  smallint NOT NULL DEFAULT 0,
  has_contract           boolean NOT NULL DEFAULT true,
  contract_number        text,
  contract_date          date,
  shipment_mode          shipment_mode NOT NULL DEFAULT 'allowed',
  shipment_block_reason  text,
  min_order_sum          numeric(12,2) NOT NULL DEFAULT 0,
  segment                text,
  badges                 text[] NOT NULL DEFAULT '{}',
  uses_edi               boolean NOT NULL DEFAULT false,
  edi_client_code        text,                            -- GLN
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON buyers (inn);
CREATE INDEX ON buyers (manager_id);

CREATE TABLE outlets (
  id             serial PRIMARY KEY,
  buyer_id       int NOT NULL REFERENCES buyers(id) ON DELETE RESTRICT,
  code           text UNIQUE NOT NULL,                    -- 'P-1024-01'
  erp_id         text UNIQUE,
  name           text NOT NULL,
  address        text NOT NULL,
  geo            point,                                   -- на будущее: логистика
  phones         text[] NOT NULL DEFAULT '{}',
  receiver_name  text,                                    -- приёмщик
  rep_id         int REFERENCES managers(id),             -- торговый представитель
  platform_id    smallint REFERENCES platforms(id),
  min_order_sum  numeric(12,2),                           -- NULL → берём у buyer
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outlets (buyer_id) WHERE is_active;

-- График доставки: вместо deliverySchedule[7][]
CREATE TABLE delivery_slots (
  id          serial PRIMARY KEY,
  outlet_id   int NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=Пн
  slot_hour   smallint NOT NULL CHECK (slot_hour BETWEEN 0 AND 23),
  cutoff_time time,                       -- дедлайн приёма заказа на этот слот
  valid_from  date NOT NULL DEFAULT CURRENT_DATE,
  valid_to    date,                       -- NULL = бессрочно (сезонность/праздники)
  UNIQUE (outlet_id, weekday, slot_hour, valid_from)
);
CREATE INDEX ON delivery_slots (outlet_id, weekday);

-- ============ АВТОРИЗАЦИЯ ============

CREATE TYPE principal_kind AS ENUM ('buyer','outlet');

CREATE TABLE credentials (
  id             bigserial PRIMARY KEY,
  kind           principal_kind NOT NULL,
  buyer_id       int REFERENCES buyers(id) ON DELETE CASCADE,
  outlet_id      int REFERENCES outlets(id) ON DELETE CASCADE,
  login_code     text UNIQUE NOT NULL,     -- совпадает с buyers.code / outlets.code
  password_hash  text NOT NULL,            -- Argon2id
  must_change    boolean NOT NULL DEFAULT true,
  failed_attempts smallint NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  password_changed_at timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  CHECK ( (kind='buyer'  AND buyer_id IS NOT NULL AND outlet_id IS NULL)
       OR (kind='outlet' AND outlet_id IS NOT NULL) )
);

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id   bigint NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  buyer_id        int NOT NULL REFERENCES buyers(id),
  scope_outlet_id int REFERENCES outlets(id),   -- NULL = доступ ко всем точкам
  refresh_hash    text NOT NULL,
  user_agent      text,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX ON sessions (credential_id) WHERE revoked_at IS NULL;

-- ============ НОМЕНКЛАТУРА И ЦЕНЫ ============

CREATE TABLE product_categories (
  id    serial PRIMARY KEY,
  name  text UNIQUE NOT NULL,
  sort_order smallint NOT NULL DEFAULT 100
);

CREATE TABLE products (
  id              serial PRIMARY KEY,
  code            text UNIQUE NOT NULL,        -- артикул 1С: '1521'
  erp_id          text UNIQUE,
  name            text NOT NULL,
  category_id     int REFERENCES product_categories(id),
  weight_kg       numeric(6,3),
  unit            text NOT NULL DEFAULT 'шт',  -- 'шт' | 'лоток'
  packaging       text,                        -- 'Нарезка' | 'Упаковка' | ...
  shelf_life      text,                        -- позже → interval
  vat_rate        smallint NOT NULL,           -- 10 | 22
  min_order_qty   int NOT NULL DEFAULT 1,
  pieces_per_lot  int NOT NULL DEFAULT 1,
  lot_only        boolean NOT NULL DEFAULT false,
  in_pricelist    boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON products (category_id) WHERE is_active;
-- поиск по названию (уже есть в UI)
CREATE INDEX ON products USING gin (to_tsvector('russian', name));

CREATE TABLE price_lists (
  id          serial PRIMARY KEY,
  name        text NOT NULL,               -- 'Базовый', 'Сети СЗ', 'HoReCa'
  is_default  boolean NOT NULL DEFAULT false,
  valid_from  date NOT NULL,
  valid_to    date
);

CREATE TABLE prices (
  price_list_id int NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_no_vat  numeric(12,2) NOT NULL,
  price_vat     numeric(12,2) NOT NULL,
  is_promo      boolean NOT NULL DEFAULT false,
  old_price     numeric(12,2),
  PRIMARY KEY (price_list_id, product_id)
);

CREATE TABLE buyer_price_lists (          -- какой прайс у какого покупателя
  buyer_id      int NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  price_list_id int NOT NULL REFERENCES price_lists(id),
  valid_from    date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (buyer_id, valid_from)
);

-- Матрица доступности: не всё продаётся всем
CREATE TABLE buyer_assortment (
  buyer_id   int NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  product_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (buyer_id, product_id)
);

-- ============ ЗАКАЗЫ ============

CREATE TYPE order_status AS ENUM
  ('draft','hold','accepted','picked','shipped','delivered','cancelled');
CREATE TYPE order_source AS ENUM ('web','voice','operator','edi','excel');

CREATE TABLE orders (
  id                  bigserial PRIMARY KEY,
  order_number        bigint UNIQUE NOT NULL,
  erp_id              text UNIQUE,                  -- номер документа в 1С
  edi_order_number    text,
  buyer_id            int NOT NULL REFERENCES buyers(id),
  outlet_id           int NOT NULL REFERENCES outlets(id),
  delivery_date       date NOT NULL,
  delivery_slot_hour  smallint NOT NULL,
  status              order_status NOT NULL DEFAULT 'accepted',
  hold_reason         text,
  source              order_source NOT NULL DEFAULT 'web',
  client_comment      text,
  manager_comment     text,
  total_units         int NOT NULL DEFAULT 0,
  total_no_vat        numeric(14,2) NOT NULL DEFAULT 0,
  total_vat           numeric(14,2) NOT NULL DEFAULT 0,
  total               numeric(14,2) NOT NULL DEFAULT 0,
  created_by_session  uuid REFERENCES sessions(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  cancelled_at        timestamptz,
  cancel_reason       text,
  synced_to_erp_at    timestamptz
);
CREATE INDEX ON orders (buyer_id, created_at DESC);
CREATE INDEX ON orders (outlet_id, delivery_date DESC);
CREATE INDEX ON orders (status) WHERE status IN ('hold','accepted','picked');
CREATE INDEX ON orders (synced_to_erp_at) WHERE synced_to_erp_at IS NULL;

CREATE TABLE order_items (
  id             bigserial PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     int NOT NULL REFERENCES products(id),
  -- снимок на момент заказа: прайс потом изменится, документ — нет
  product_code   text NOT NULL,
  product_name   text NOT NULL,
  qty_lots       int NOT NULL DEFAULT 0,
  qty_pieces     int NOT NULL DEFAULT 0,
  qty_total      int NOT NULL,                  -- lots*pieces_per_lot + pieces
  pieces_per_lot int NOT NULL,
  price_at_order numeric(12,2) NOT NULL,
  vat_rate       smallint NOT NULL,
  sum            numeric(14,2) NOT NULL,
  UNIQUE (order_id, product_id)
);

CREATE TABLE order_status_history (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  reason      text,
  actor       text NOT NULL,          -- 'client:B-1024' | 'erp' | 'system'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON order_status_history (order_id, created_at);

-- ============ САЛЬДО ============

CREATE TABLE balance_snapshots (
  id          bigserial PRIMARY KEY,
  buyer_id    int NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  balance     numeric(14,2) NOT NULL,
  overdue     numeric(14,2) NOT NULL DEFAULT 0,   -- просроченная задолженность
  as_of       timestamptz NOT NULL,               -- на какой момент в 1С
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON balance_snapshots (buyer_id, as_of DESC);

-- ============ ДОКУМЕНТЫ И СООБЩЕНИЯ ============

CREATE TYPE document_kind AS ENUM
  ('declaration','pricelist','invoice','ttn','act','contract','upd');

CREATE TABLE documents (
  id          bigserial PRIMARY KEY,
  buyer_id    int REFERENCES buyers(id) ON DELETE CASCADE,  -- NULL = общий
  order_id    bigint REFERENCES orders(id) ON DELETE SET NULL,
  kind        document_kind NOT NULL,
  number      text,
  title       text NOT NULL,
  doc_date    date NOT NULL,
  storage_key text NOT NULL,          -- ключ в S3/MinIO, не публичный URL
  mime_type   text NOT NULL DEFAULT 'application/pdf',
  size_bytes  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON documents (buyer_id, doc_date DESC);

CREATE TABLE message_threads (
  id         bigserial PRIMARY KEY,
  buyer_id   int NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  subject    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id)                   -- пока одна ветка на клиента
);

CREATE TABLE messages (
  id          bigserial PRIMARY KEY,
  thread_id   bigint NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('client','manager','system')),
  author_name text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX ON messages (thread_id, created_at DESC);

-- ============ АУДИТ ============

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  session_id  uuid,
  buyer_id    int,
  action      text NOT NULL,          -- 'order.create', 'order.cancel', 'login.fail'
  entity      text,
  entity_id   text,
  payload     jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (buyer_id, created_at DESC);
CREATE INDEX ON audit_log (action, created_at DESC);
```

**Row-Level Security.** Если бэкенд будет ходить в БД под одной ролью, RLS даёт второй контур защиты от «клиент видит чужой заказ»:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_tenant ON orders
  USING (buyer_id = current_setting('app.buyer_id')::int
     AND (current_setting('app.outlet_id', true) IS NULL
          OR outlet_id = current_setting('app.outlet_id')::int));
```

---

## 5. Контракт API

Текущие пути хороши и переносятся почти as-is. Ниже — итоговая спецификация с пометками.

### Аутентификация

| Метод | Путь | Статус | Комментарий |
|---|---|---|---|
| `POST` | `/api/auth/login` | ✅ есть как `/api/login` | Возвращает access (JWT, 15 мин) + refresh (httpOnly cookie) |
| `POST` | `/api/auth/refresh` | ❌ **добавить** | |
| `POST` | `/api/auth/logout` | ❌ **добавить** | Отзыв сессии в БД |
| `POST` | `/api/auth/change-password` | ❌ **добавить** | Обязателен при `must_change` |
| `GET` | `/api/lookup?code=` | ⚠️ есть | **Утечка**: перебором кодов узнаётся, какие клиенты есть. Нужен rate limit + капча |

Ответ логина сохраняем в текущей форме — фронт её уже разбирает:
```json
{ "role":"buyer|outlet", "scope":"all-outlets|single-outlet",
  "buyer":{…}, "outlet":{…}, "enteredOutletId":101,
  "accessToken":"…", "expiresIn":900 }
```

### Данные

| Метод | Путь | Статус |
|---|---|---|
| `GET` | `/api/buyers/:id` | ✅ |
| `GET` | `/api/buyers/:id/products` | ⚠️ добавить прайс-лист покупателя + `?category=&q=&limit=&offset=` |
| `GET` | `/api/buyers/:id/orders` | ⚠️ добавить `?from=&to=&status=&outletId=&limit=&cursor=` |
| `GET` | `/api/buyers/:id/documents` | ⚠️ `href` → `/api/documents/:id/download` (подписанный URL) |
| `GET` | `/api/buyers/:id/messages` | ✅ |
| `POST` | `/api/buyers/:id/messages` | ✅ |
| `POST` | `/api/buyers/:id/messages/mark-read` | ✅ |
| `GET` | `/api/buyers/:id/balance` | ❌ **добавить** — сальдо отдельным запросом, оно меняется чаще профиля |
| `GET` | `/api/outlets/:id` · `/api/outlets/:id/orders` | ✅ |
| `PATCH` | `/api/outlets/:id` | ✅ отдаёт 403 `read_only` — оставить |

### Заказы

| Метод | Путь | Статус |
|---|---|---|
| `GET` | `/api/orders/:id` | ✅ |
| `POST` | `/api/orders` | ⚠️ **добавить `Idempotency-Key`** — иначе двойной клик = два заказа |
| `PATCH` | `/api/orders/:id` | ❌ **добавить** — правка позиций до дедлайна |
| `POST` | `/api/orders/:id/cancel` | ❌ **добавить** |
| `GET` | `/api/orders/:id/export` | ❌ Excel лучше генерить на сервере: один формат бланка для всех |
| `GET` | `/api/next-order-number` | ❌ **убрать** — номер выдаёт БД при вставке, а не отдельным вызовом |

### Формат ошибок

Фронт уже разбирает `err.error` по кодам (`below_min_sum`, `slot_unavailable`, `slot_required`, `read_only`). Стоит это закрепить и расширить:

```json
{ "error": "below_min_sum",
  "message": "Сумма заказа ниже минимальной для точки",
  "details": { "minSum": 6000, "total": 4820 } }
```

Коды: `invalid_credentials`, `account_locked`, `password_change_required`, `below_min_sum`, `slot_required`, `slot_unavailable`, `shipment_blocked`, `cutoff_passed`, `product_unavailable`, `order_not_editable`, `read_only`, `not_found`.

---

## 6. План перехода: 5 этапов

### Этап 0 · Гигиена (1–2 дня)

Прежде чем что-либо строить:

1. **Удалить все пароли из `api.js`.** В демо-режиме — сравнение с хэшем или единый демо-пароль из переменной сборки.
2. `git init`, `.gitignore`, `package.json`. Сейчас версионирование ведётся именами zip-архивов — это не масштабируется.
3. Снять `data-pplx-inline-edit` — не тащить редактор Perplexity в продакшн-сборку.
4. Self-host для `xlsx` и шрифтов: убрать зависимость от внешних CDN.

### Этап 1 · Развязать фронт и фейк-бэкенд (3–5 дней)

Ключевой шаг, который делает всё остальное дешёвым. Сейчас `api.js` подменяет глобальный `window.fetch` — это hack, работающий ровно до появления настоящего сервера.

Вводим тонкий клиент:

```js
// app/http.js
const BASE = window.__API_BASE__ || '/api';
async function request(path, { method='GET', body, headers={} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type':'application/json',
               ...(token ? {Authorization:`Bearer ${token}`} : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) return refreshAndRetry(path, {method, body, headers});
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message||'HTTP '+res.status), data);
  return data;
}
export const API = {
  login:      (code,password) => request('/auth/login',{method:'POST',body:{code,password}}),
  products:   (buyerId, q)    => request(`/buyers/${buyerId}/products${qs(q)}`),
  orders:     (buyerId, q)    => request(`/buyers/${buyerId}/orders${qs(q)}`),
  createOrder:(payload, key)  => request('/orders',{method:'POST',body:payload,
                                          headers:{'Idempotency-Key':key}}),
  cancelOrder:(id, reason)    => request(`/orders/${id}/cancel`,{method:'POST',body:{reason}}),
  patchOrder: (id, items)     => request(`/orders/${id}`,{method:'PATCH',body:{items}}),
};
```

`api.js` остаётся как **MSW-мок** (или просто флаг `__API_BASE__='mock'`) для локальной разработки и демо-показов. Переключение среды — одна переменная.

Здесь же: провести `cancel-order` и `order-item-inc/dec` через API вместо мутации `state`.

### Этап 2 · Схема БД и загрузка данных (3–5 дней)

1. Накатить DDL из §4 (миграции: Flyway / Alembic / node-pg-migrate — по стеку команды).
2. Написать сидер: `products.json` → `products` + `prices`; литералы `BUYERS`/`OUTLETS` из `api.js` → `buyers`/`outlets`/`delivery_slots`/`credentials` (пароли захэшировать Argon2id, выставить `must_change=true`).
3. Проверить целостность: 111 SKU, 16 покупателей, 32 точки, 32×6=192 заказа истории.

### Этап 3 · Бэкенд (2–3 недели)

Стек — на усмотрение команды; при отсутствии сильных предпочтений разумно **Node.js + Fastify + PostgreSQL** (тот же язык, что фронт, вся доменная логика переиспользуется почти дословно) либо **FastAPI + SQLAlchemy**, если в компании сильнее Python.

Слои: `routes → services → repositories → DB`. Вся доменная логика из `api.js` переезжает в `services`:

```
services/
  auth.service       — три сценария входа, блокировка после N попыток
  shipment.service   — effectiveShipment(): договор → блок → сальдо
  schedule.service   — валидация слота, cutoff, ближайшая доступная дата
  order.service      — создание, минимальная сумма, дедлайн отмены/правки
  pricing.service    — прайс-лист покупателя, промо, ассортиментная матрица
```

Обязательно:
- Argon2id для паролей, блокировка учётки после 5 неудач.
- JWT access 15 мин + refresh в httpOnly/SameSite=Strict cookie.
- Rate limiting на `/auth/login` и `/lookup`.
- Idempotency-Key на `POST /orders`.
- Валидация схемой (Zod / Pydantic) на каждом входе.
- Аудит в `audit_log`: создание, отмена, правка, вход, неудачный вход.

### Этап 4 · Интеграция с 1С и EDI (2–4 недели, параллельно)

Это самая недооценённая часть. В коде уже заложены `usesEdi`, `ediClientCode`, `source:'edi'`, `ediOrderNumber` — значит, EDI в контуре предусмотрен, но не реализован.

**Из 1С в ЛК** (входящий поток):
- Номенклатура и цены — раз в сутки или по событию.
- Сальдо и просрочка — каждые 15–30 минут (сейчас `balance` статичен).
- Статусы отгрузки, договоры, реквизиты.
- Документы: УПД, ТТН, акты сверки → S3/MinIO + строка в `documents`.

**Из ЛК в 1С** (исходящий поток):
- Заказы. Обязательно **очередь с ретраями** (RabbitMQ / Kafka / pgmq), а не синхронный HTTP: если 1С недоступна, клиент не должен получать ошибку. Поле `orders.synced_to_erp_at` для этого уже заложено.

**EDI**: для сетей (Магнит, X5, Дикси, Лента — все есть в данных) заказы приходят как EDI ORDERS через провайдера и должны попадать в ту же таблицу `orders` с `source='edi'`, чтобы клиент видел их в истории наравне с веб-заказами.

**Формат обмена**: если 1С — УТ/КА, скорее всего OData или HTTP-сервисы. Ключи `erp_id` в схеме заложены под GUID'ы 1С.

---

## 7. Что ещё стоит сделать помимо БД

| Приоритет | Задача | Обоснование |
|---|---|---|
| Высокий | **URL-роутинг** (`/orders/12345`) | Сейчас нельзя дать ссылку на заказ, «назад» ломает навигацию |
| Высокий | **Пагинация истории и каталога** | При росте истории страница встанет |
| Высокий | **Смена пароля в ЛК** | Сейчас её нет вообще; при `must_change` вход невозможен |
| Средний | Серверный экспорт Excel | Один формат бланка, не зависит от CDN |
| Средний | Уведомления (email/SMS/push) о смене статуса | Особенно `hold` — клиент должен узнать о блокировке |
| Средний | Повтор последнего заказа в 1 клик | Данные (`lastOrderForOutlet`) уже есть, кнопки нет |
| Средний | Шаблоны заказов | Для регулярных поставок — основной сценарий у сетей |
| Низкий | Отказ от `innerHTML`-перерисовки | При росте каталога перерисовка всей страницы станет заметной |
| Низкий | Тесты доменной логики | `effectiveShipment`, `canCancelOrder`, `slotsForDate` — чистые функции, тестируются легко |
| Низкий | Разбить `app.js` (2 240 строк) на модули | Один файл на весь UI тяжело поддерживать вдвоём и больше |

---

## 8. Оценка сроков

| Этап | Срок | Можно параллелить |
|---|---|---|
| 0 · Гигиена и безопасность | 1–2 дня | — |
| 1 · Развязка фронта и API-клиент | 3–5 дней | — |
| 2 · Схема БД + сидеры | 3–5 дней | с этапом 1 |
| 3 · Бэкенд | 2–3 недели | — |
| 4 · Интеграция 1С/EDI | 2–4 недели | с этапом 3 |
| 5 · Тестирование и пилот на 2–3 клиентах | 1–2 недели | — |

**Итого до пилота: 6–9 недель** силами 1 бэкендера + 1 фронтендера. Основной риск и основная неопределённость — этап 4: сроки там определяются не вашей командой, а готовностью 1С и EDI-провайдера.

---

## 9. Резюме

Проект в заметно лучшем состоянии, чем типичный прототип на этой стадии. Доменная модель продумана (роли, слоты, лотки/штуки, приоритеты блокировок, дедлайны), UI зрелый и адаптивный, а `api.js` — фактически готовая спецификация REST-контракта, которую можно отдать бэкендеру почти без правок.

Основная работа — не дописывание функционала, а **перенос уже написанной логики на сервер**. Порядок действий:

1. **Немедленно** — убрать пароли из клиентского кода и завести git.
2. **Затем** — развязать фронт и мок через тонкий API-клиент; провести отмену и правку заказа через HTTP.
3. **Параллельно** — накатить схему БД и залить в неё существующие данные.
4. **Основной объём** — бэкенд с продублированной на сервере доменной логикой.
5. **Отдельный трек** — интеграция с 1С и EDI, начинать переговоры о форматах обмена уже сейчас, не дожидаясь готовности бэкенда.
