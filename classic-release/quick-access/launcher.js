// This template contains no credentials. The provisioner inserts only the
// three newly created test accounts into a private, local copy of the client.
(() => {
  'use strict';
  const data = __QUICK_DATA__;
  const nativeFetch = window.fetch.bind(window);
  const base = data.base;
  const key = 'karavay_classic_session_v1';
  // The original standalone client keeps its relative routes and all checks.
  window.fetch = (input, options) => nativeFetch(
    typeof input === 'string' && input.startsWith('/')
      ? new URL(input, base).href : input, options);
  window.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('details');
    panel.className = 'quick-access';
    const summary = document.createElement('summary');
    summary.textContent = 'КАРАВАЙ · Тестовые пользователи';
    panel.append(summary);
    const hint = document.createElement('p');
    hint.textContent = 'Выберите сценарий — пароль вводить не требуется.';
    panel.append(hint);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const buttons = [];
    let current = null;
    try { current = JSON.parse(sessionStorage.getItem(key) || 'null'); }
    catch { /* The regular client will also reject an invalid saved session. */ }
    panel.open = !current;
    for (const account of data.accounts) {
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('strong');
      title.textContent = account.name;
      const email = document.createElement('span');
      email.textContent = account.email;
      const detail = document.createElement('small');
      detail.textContent = account.description;
      button.append(title, email, detail);
      button.addEventListener('click', async () => {
        try { current = JSON.parse(sessionStorage.getItem(key) || 'null'); }
        catch { current = null; }
        if (current && current.id !== account.id &&
            !window.confirm('Переключить тестового пользователя? Несохранённая корзина будет очищена.')) return;
        buttons.forEach(b => { b.disabled = true; });
        status.textContent = 'Входим…';
        try {
          const response = await nativeFetch(base + '/api/collections/users/auth-with-password', {
            method: 'POST', credentials: 'omit', cache: 'no-store',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({identity: account.email, password: account.password}),
            signal: AbortSignal.timeout(60000)
          });
          if (!response.ok) throw new Error('Не удалось войти. Проверьте доступность сервера и активность аккаунта.');
          const auth = await response.json();
          if (!auth.token || auth.record?.id !== account.id ||
              auth.record.email !== account.email || auth.record.active !== true ||
              auth.record.must_change_password === true)
            throw new Error('Тестовый аккаунт изменён. Выполните проверку на VM.');
          const check = await nativeFetch(base + '/service/context', {
            headers: {Authorization: auth.token}, credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.timeout(60000)
          });
          if (!check.ok) throw new Error('Вход подтверждён, но доступ к кабинету запрещён. Проверьте роль и права.');
          const context = await check.json();
          const actual = context.payers?.map(p => p.id).sort();
          if (JSON.stringify(actual) !== JSON.stringify([...account.payers].sort()))
            throw new Error('Назначения изменились. Выполните повторную проверку на VM.');
          sessionStorage.setItem(key, JSON.stringify({token: auth.token, id: account.id, email: account.email}));
          location.reload();
        } catch (error) {
          status.textContent = error instanceof TypeError
            ? 'Сервер недоступен или браузер блокирует запрос. Откройте файл в Chrome или Edge в сети КАРАВАЯ.'
            : error instanceof Error ? error.message : 'Не удалось выполнить вход.';
          buttons.forEach(b => { b.disabled = false; });
        }
      });
      buttons.push(button);
      panel.append(button);
    }
    const note = document.createElement('small');
    note.textContent = 'Личный файл содержит доступ к тестовым аккаунтам. Не пересылайте его. Данные и заказы — из рабочей КИС.';
    panel.append(status, note);
    document.body.append(panel);
  }, {once: true});
})();
