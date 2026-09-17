# КАРАВАЙ — личный кабинет 3.6 TypeScript + multi-buyer access

Основная версия личного кабинета покупателя на **React 18 + TypeScript + Vite 8**. В версии 3.6 авторизуется пользователь из `users`, который через `user_buyers` может работать с одним или несколькими покупателями и их получателями. Бизнес-разделы честно остаются недоступными до серверного подключения КИС.

Прямой вход через auth-коллекции `buyers` и `outlets`, использовавшийся в 3.5, удалён из HTML 3.6. Эти коллекции остаются только бизнес-справочниками.

## Что входит в 3.6

- шесть рабочих разделов: обзор, оформление заказа, история, точки, документы и профиль;
- иерархия покупатель → получатели/торговые точки;
- двухэтапное оформление: каталог → проверка → отправка;
- закреплённая нижняя панель проверки на мобильном экране;
- защита от повторной отправки заказа;
- безопасная отмена несохранённых корректировок;
- неизменяемое обновление заказа и кэша деталей;
- проверка минимального количества и продажи полными лотками в UI и mock API;
- защита загрузок от устаревших ответов;
- понятная ошибка первоначальной загрузки с повторной попыткой;
- сборка с базовым адресом `/react-test/`;
- unit-, интеграционные и браузерные сценарии версии 3.6;
- строгий `tsconfig` (`strict: true`) без `any`, `@ts-ignore` и отключения проверки файлов;
- единые типы для ролей, состояния, покупателей, точек, товаров, заказов, документов и ответов КИС;
- обязательный `typecheck` перед тестами и production-сборкой;
- вход только через `POST /api/collections/users/auth-with-password`;
- блокировка входа при `active=false` или `must_change_password=true`;
- повторная проверка `users` и `user_buyers` при восстановлении после F5;
- автоматический выбор единственного покупателя и отдельный экран при нескольких;
- переключатель текущего юрлица с подтверждением потери несохранённых данных;
- полная очистка buyer-зависимого состояния и защита от устаревших ответов при переключении;
- профиль покупателя и список его активных получателей из PocketBase;
- роли доступа `owner`, `manager`, `viewer` и строгие типы каталога пользователя;
- постраничная загрузка связей и получателей с запасом для ~600 точек;
- отдельный режим `directory`, который не подмешивает mock-заказы, цены или документы;
- один HTML для размещения как `/opt/pocketbase/pb_public/index.html`.

## Запуск

Рекомендуется Node.js 24 LTS и npm.

```bash
npm ci
npm run dev
```

Dev-сервер: `http://localhost:5173/react-test/`.

```bash
npm run typecheck   # строгая проверка TypeScript без генерации файлов
npm run check       # typecheck + unit + React integration + production build
npm run test:e2e    # Playwright, Chromium должен быть установлен
npm run preview     # проверка dist/ на /react-test/
npm run build:demo  # обычная demo-сборка в dist-demo/
npm run build:pocketbase-test # совместимый alias: users + user_buyers directory, base /
npm run build:pocketbase-directory # users + реальные user_buyers/buyers/outlets, base /
npm run build:standalone # один автономный HTML в artifacts/
npm run build:standalone:pocketbase # один HTML для pb_public в artifacts/
```

Для первой локальной установки браузера: `npx playwright install chromium`.

## Структура

- `src/types.ts` — единые доменные и API-типы;
- `src/store.tsx` — типизированное состояние, загрузчики и действия;
- `src/orderRules.ts` — единые правила количества и проверка заказа;
- `src/requestGate.ts` — отсечение устаревших ответов;
- `src/authApi.ts` — вход, refresh и безопасное хранение сессии PocketBase;
- `src/pocketBaseDirectoryApi.ts` — загрузка `user_buyers`, разрешённых покупателей и их получателей;
- `src/runtimeConfig.ts` — проверяемая конфигурация режимов;
- `src/mockApi.ts` — типизированный демонстрационный контракт КИС;
- `src/components/` — экраны и диалоги;
- `tests/` — unit, React integration и Playwright E2E;
- `contracts/` — OpenAPI бизнес-API и JSON Schema ошибки;
- `docs/` — контракт авторизации и инструкция проверки на VM;
- `public/` — статические ресурсы и демонстрационные документы.
- `scripts/build-standalone.mjs` — упаковка demo-сборки, логотипа и PDF в один HTML.

## Адреса

| Назначение | Адрес |
|---|---|
| Локальная разработка | `http://localhost:5173/react-test/` |
| Локальный preview | `http://localhost:4173/react-test/` |
| Базовый путь production-сборки | `/react-test/` |
| Тестовый PocketBase | `http://192.168.25.98:8090/` |
| Админка PocketBase | `http://192.168.25.98:8090/_/` |
| Репозиторий | `https://github.com/nikitinad17-ai/Karavay_LK` |

Внутренние разделы пока переключаются состоянием React и не имеют отдельных URL.

## Текущее состояние этапа 2

Авторизация пользователя и каталог доступа PocketBase готовы к проверке. Реальные `user_buyers`, `buyers` и `outlets` читаются с учётом API rules. Matrix, orders и documents ещё не подключены: для этого нужен серверный API-шлюз КИС. Production и directory-сборки остаются fail-closed и не включают mock fallback.

Пошаговая настройка: [docs/POCKETBASE_USER_ACCESS_SETUP.md](docs/POCKETBASE_USER_ACCESS_SETUP.md). Контракт авторизации: [docs/AUTH_CONTRACT.md](docs/AUTH_CONTRACT.md). Результаты проверок: [docs/TEST_REPORT_V3.6.md](docs/TEST_REPORT_V3.6.md). Полный контекст и дорожная карта: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
