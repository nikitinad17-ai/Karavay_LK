# КАРАВАЙ — личный кабинет 3.4 TypeScript

Основная версия личного кабинета покупателя на **React 18 + TypeScript + Vite 8**. Версия 3.4 сохраняет интерфейс и бизнес-поведение React 3.3, но переводит приложение, mock-контур, конфигурацию и тесты на строгую статическую типизацию.

Контур **этапа 2.1** сохранён: реальный вход и восстановление сессии через PocketBase. До подключения КИС тестовая сборка использует PocketBase для авторизации и явный mock для бизнес-данных. Создание тестовых записей PocketBase в эту версию не входит.

## Что входит в 3.4

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
- unit-, интеграционные и браузерные сценарии версии 3.2.
- строгий `tsconfig` (`strict: true`) без `any`, `@ts-ignore` и отключения проверки файлов;
- единые типы для ролей, состояния, покупателей, точек, товаров, заказов, документов и ответов КИС;
- обязательный `typecheck` перед тестами и production-сборкой;
- блокировка входа при `must_change_password=true` до реализации отдельного сценария смены пароля.

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
npm run build:pocketbase-test # PocketBase auth + временные mock-данные, base /
npm run build:standalone # один автономный HTML в artifacts/
```

Для первой локальной установки браузера: `npx playwright install chromium`.

## Структура

- `src/types.ts` — единые доменные и API-типы;
- `src/store.tsx` — типизированное состояние, загрузчики и действия;
- `src/orderRules.ts` — единые правила количества и проверка заказа;
- `src/requestGate.ts` — отсечение устаревших ответов;
- `src/authApi.ts` — вход, refresh и безопасное хранение сессии PocketBase;
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

Авторизация PocketBase реализована и готова к проверке. Реальные buyer/outlets, matrix, orders и documents ещё не подключены: для этого нужен доступный контракт/API-шлюз КИС. Обычная production-сборка работает fail-closed и не включает mock; для теста на VM используйте отдельную команду `build:pocketbase-test`.

Инструкция проверки: [docs/POCKETBASE_TEST_SETUP.md](docs/POCKETBASE_TEST_SETUP.md). Контракт авторизации: [docs/AUTH_CONTRACT.md](docs/AUTH_CONTRACT.md). Полный контекст и дорожная карта: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
