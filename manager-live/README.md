# КАРАВАЙ — менеджер 0.9.1

Экран и форма повторяют предоставленные владельцем скриншоты:

- Один раздел «Пользователи», синяя боковая панель, фильтр ролей и таблица.
- Кнопка «Создать пользователя» открывает только логин, email, роль и пароль.
- Роли: «Получатель (Client)» и «Покупатель (Payer)». Администратор/менеджер в
  списке недоступны для назначения из кабинета менеджера.
- После создания окно закрывается и пользователь появляется в списке.
- Кнопки таблицы: «Инфо», «Изменить», «Удалить»; у доступного демо также «Войти».
- Назначения покупателей/получателей находятся внутри «Изменить».

**Существующие демо сохранены. Стандартный установщик не запускает создание или
перенастройку демо и не меняет их пароли.** Поддержан также уже установленный
клиентский тестовый вход `/service/test-access`.

[Технические изменения и сохранность данных](RELEASE_0.9.1.md).

## Установка из Windows PowerShell

Скачать `Karavay-Manager-0.9.1-Users-20261028.ps1` в «Загрузки»:

```powershell
cd ([environment]::getfolderpath('userprofile') + '\downloads')
powershell -noprofile -executionpolicy bypass -file .\karavay-manager-0.9.1-users-20261028.ps1
```

Успех: `MANAGER_RELEASE_INSTALLED: 0.9.1`, затем `TEST LOGIN READY`.
Открыть `http://192.168.25.98:8090/manager/` и обновить Ctrl+F5.
Пакет самодостаточный; VM не скачивает исходники из интернета. Нужен только
обычный SSH/sudo, пароль администратора PocketBase не требуется.

`-PreflightOnly` — проверка без установки. `-TestLoginOnly` оставлен совместимым
именем стандартного сценария. Старый явный `-ResumeSetup` запускает отдельно
запрошенную настройку шести демо 0.9.0; для обновления интерфейса его не использовать.

## Данные

Добавляется необязательный скрытый `users.account_type` для выбранного Client/Payer.
Auth-роли `owner/manager/viewer`, действующие пароли и права не заменяются.
Существующим записям метка вычисляется по их текущим правам. Выбор роли сам по себе
не выдаёт прав на компании/точки; аккаунт без назначений остаётся без бизнес-доступа.
Прежний минимум пароля 12 символов сохранён. Клиентский HTML, тестовая конфигурация,
история и обработчики заказов не заменяются. Перед установкой есть проверка
коллекций/конфликтов, резервная копия и контроль сохранённых файлов.

## Проверки

```bash
npm run check
PB_BINARY=/path/to/pocketbase python3 manager-live/tests/integration.py
node manager-live/tests/session.cjs
node manager-live/tests/demo-compat.cjs
python3 manager-live/tests/installer.py
PB_BINARY=/path/to/pocketbase python3 manager-live/tests/recipients.py
PB_BINARY=/path/to/pocketbase python3 manager-live/tests/workspace.py
PWSH=/path/to/pwsh python3 manager-live/tests/powershell.py
```

Браузерная проверка: добавить `MANAGER_CHROME=/path/to/chrome-headless-shell` и
`CLIENT_HTML=/path/to/built-client.html` к запуску `recipients.py`. Проверяются
таблица/форма по образцу, создание обеих ролей, сохранение после F5, назначения,
Инфо/Удалить, сохранность и входы шести демо, мобильный экран. КИС/служба в тестах —
локальные фикстуры; PocketBase 0.40.3 и Chromium настоящие. Windows PowerShell 5.1
нативно не запускался; установщик проверяется PowerShell 7.4.6/Linux с Legacy argv.
Фактическая установка на внутреннюю VM и её данные из среды разработки недоступны.

Сборка:

```bash
python3 manager-live/scripts/build-release.py /path/to/output
```
