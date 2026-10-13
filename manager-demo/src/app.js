(() => {
  'use strict';
  const M = window.KaravayDemo;
  const STORAGE = 'karavay-manager-demo-v1';
  const icons = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    payer: '<path d="M4 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M2 21h20M9 21v-4h4v4M8 7h1m4 0h1M8 11h1m4 0h1"/>',
    client: '<path d="M3 10v11h18V10M2 10l2-7h16l2 7M3 10a3 3 0 0 0 4 0 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 4 0M9 21v-7h6v7"/>',
    user: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/><path d="M12 7v5l3 2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    package: '<path d="m12 3 9 5-9 5-9-5 9-5Zm9 5v9l-9 5-9-5V8m9 5v9M7 5.5l9 5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.user) + '</svg>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Keep previously saved journal entries and generated captions in the current UI terminology.
  const buyerLabel = value => String(value ?? '').replace(/плательщик(?:ами|ов|ам|ах|ом|а|у|и)?/gi, word => {
    const labels = { плательщик: 'покупатель', плательщика: 'покупателя', плательщику: 'покупателю', плательщиком: 'покупателем', плательщики: 'покупатели', плательщиков: 'покупателей', плательщикам: 'покупателям', плательщиками: 'покупателями', плательщиках: 'покупателях' };
    const result = labels[word.toLowerCase()];
    return word === word.toUpperCase() ? result.toUpperCase() : word[0] === word[0].toUpperCase() ? result[0].toUpperCase() + result.slice(1) : result;
  });
  const date = value => value ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) : '—';
  const time = value => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const roleName = { owner: 'Владелец', manager: 'Менеджер', viewer: 'Просмотр' };
  let db = M.seed();
  let storageWorks = true;
  try { const saved = JSON.parse(localStorage.getItem(STORAGE)); const migrated = M.upgrade(saved); if (migrated) db = migrated; } catch (_) { storageWorks = false; }
  let state = { view: 'dashboard', query: '', payer: '', client: '', status: '', detailTab: 'clients' };
  let toastTimer;
  let dialogReturnFocus;
  let submitted = false;
  let formInitial = '';
  let editing = { kind: '', id: '' };
  let pendingToggle = null;
  const $ = selector => document.querySelector(selector);
  const actionButton = (action, label, id = '', cls = 'btn', symbol = '') => '<button class="' + cls + '" data-action="' + action + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + (symbol ? icon(symbol) : '') + label + '</button>';
  const payerName = id => M.managedPayers(db).find(p => p.id === id)?.name_pay || '—';
  const clientName = id => M.managedClients(db).find(c => c.id === id)?.name_clt || '—';
  function badge(label, color = '', dot = false) { return '<span class="badge ' + color + '">' + (dot ? '<i></i>' : '') + esc(label) + '</span>'; }
  const recordBadge = (kind, record) => {
    const status = M.businessStatus(db, kind, record.id);
    return badge(status.reason, !record.active ? 'gray' : status.reason === 'Активен' ? 'green' : 'amber', status.reason === 'Активен');
  };
  const fullPayers = () => M.managedPayers(db).filter(p => db.rights.some(r => r.user === db.managerId && r.payer === p.id && r.active && !r.client));
  function save(next) {
    db = next;
    try { localStorage.setItem(STORAGE, JSON.stringify(db)); } catch (_) { storageWorks = false; }
    if (!storageWorks) $('.demo-banner>span:nth-child(2)').textContent = 'Тестовые данные. Сохранение недоступно: изменения действуют до обновления страницы.';
  }
  function toast(message, error = false) {
    const el = $('#toast'); el.textContent = message; el.className = 'toast' + (error ? ' error' : ''); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4700);
  }
  function closeMenu() { $('#sidebar').classList.remove('open'); $('#menu-backdrop').hidden = true; $('#menu').setAttribute('aria-expanded', 'false'); }
  function navigate(view, context = {}) {
    if (!['dashboard', 'payers', 'clients', 'users', 'log', 'payer-detail'].includes(view)) return;
    state = { view, query: '', payer: '', client: '', status: '', detailTab: 'clients', ...context };
    closeMenu(); render(); $('#main').focus({ preventScroll: true });
  }
  function renderNav() {
    const activeView = state.view === 'payer-detail' ? 'payers' : state.view;
    const nav = [['dashboard', 'Обзор', 'dashboard'], ['payers', 'Покупатели', 'payer'], ['clients', 'Получатели', 'client'], ['users', 'Пользователи', 'user'], ['log', 'Журнал действий', 'clock']];
    $('#navigation').innerHTML = nav.map(([view, label, sym]) => '<button class="nav-button' + (activeView === view ? ' active' : '') + '" data-view="' + view + '"' + (activeView === view ? ' aria-current="page"' : '') + '>' + icon(sym) + label + (view === 'payers' ? '<span class="nav-count">' + M.managedPayers(db).length + '</span>' : '') + '</button>').join('');
    $('#crumb').textContent = nav.find(n => n[0] === activeView)?.[1] || 'Покупатели';
  }
  function kpis() {
    const payers = M.managedPayers(db), clients = M.managedClients(db), users = M.managedUsers(db);
    const pending = users.filter(u => u.must_change_password || db.resets.some(r => r.user === u.id && r.status === 'pending')).length;
    const items = [['Мои покупатели', payers.length, payers.filter(p => p.active).length + ' активных юридических лиц', 'payer', '', 'payers'], ['Получатели', clients.length, clients.filter(c => c.active && db.payers.find(p => p.id === c.payer)?.active).length + ' с действующим доступом', 'client', '', 'clients'], ['Пользователи', users.length, 'Учётные записи и назначения', 'user', 'good', 'users'], ['Восстановление доступа', pending, pending ? 'Есть незавершённые сценарии' : 'Нет незавершённых сценариев', 'lock', pending ? 'warning' : 'good', 'users']];
    return '<div class="kpis">' + items.map(([label, n, note, sym, color, view]) => '<button class="kpi" data-view="' + view + '"><div class="kpi-top"><span>' + label + '</span><span class="kpi-icon">' + icon(sym) + '</span></div><div class="kpi-value">' + n + '</div><div class="kpi-note ' + color + '">' + note + '</div></button>').join('') + '</div>';
  }
  const visibleActivities = () => db.activities.filter(a => a.type !== 'order');
  function heading(title, subtitle, actions = '') { return '<div class="page-heading"><div><div class="eyebrow">ПРОСТРАНСТВО МЕНЕДЖЕРА</div><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + '</p></div><div class="heading-actions">' + actions + '</div></div>'; }
  function activities() {
    return '<section class="panel"><div class="panel-head"><h2>Последние действия</h2><span class="cell-sub">Тестовый журнал</span></div><ul class="activity">' + visibleActivities().slice(0, 3).map(a => '<li><span class="activity-icon">' + icon(a.type) + '</span><div><strong>' + esc(buyerLabel(a.text)) + '</strong><small>' + esc(buyerLabel(a.detail)) + '</small></div><time>' + esc(time(a.time)) + '</time></li>').join('') + '</ul></section>';
  }
  function quickPanel() { return '<section class="panel quick-panel"><div class="eyebrow">ПОМОЩЬ ВХОДУ В КАБИНЕТ</div><h2>Клиент забыл пароль?</h2><p>Выберите пользователя и пройдите сценарий восстановления по email.</p>' + actionButton('goto-users', 'Восстановить доступ', '', 'btn subtle', 'lock') + '<div class="mini-steps"><span><b class="step-num">1</b>Пользователь</span><span><b class="step-num">2</b>Демо-письмо</span><span><b class="step-num">3</b>Результат</span></div></section>'; }
  function creationPanel() {
    const actions = [['user', 'Новый пользователь', 'Создайте учётную запись и назначьте покупателей и получателей.', 'create-user', 'Добавить пользователя'], ['payer', 'Новый покупатель', 'Добавьте юридическое лицо в свою область ответственности.', 'create-payer', 'Добавить покупателя'], ['client', 'Получатель из КИС', 'Выберите существующую торговую точку выбранного покупателя.', 'create-client', 'Выбрать получателя']];
    return '<section class="panel"><div class="panel-head"><h2>Добавление записей</h2></div><div class="create-grid">' + actions.map(([sym, title, note, action, label]) => '<article class="create-card"><span class="company-icon">' + icon(sym) + '</span><h3>' + title + '</h3><p>' + note + '</p>' + actionButton(action, label, '', 'btn subtle', 'plus') + '</article>').join('') + '</div></section>';
  }
  function searchBar(kind) {
    const placeholder = { payers: 'Название, код или email покупателя', clients: 'Название, код или адрес получателя', users: 'Имя или email пользователя' }[kind];
    const payerOptions = '<option value="">Все мои покупатели</option>' + M.managedPayers(db).map(p => '<option value="' + esc(p.id) + '"' + (state.payer === p.id ? ' selected' : '') + '>' + esc(p.name_pay) + '</option>').join('');
    const filter = kind === 'payers' ? '' : '<select id="payer-filter" class="filter" aria-label="Фильтр по покупателю">' + payerOptions + '</select>';
    const options = [['on', 'Действующий доступ'], ['off', 'Отключённые / недоступные'], ...(kind === 'payers' ? [['new', 'Без получателей']] : kind === 'users' ? [['pending', 'Первый вход / восстановление']] : [])];
    const statuses = '<select id="status-filter" class="filter" aria-label="Фильтр по статусу"><option value="">Все статусы</option>' + options.map(([key, label]) => '<option value="' + key + '"' + (state.status === key ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>';
    return '<div class="toolbar"><label class="search-box">' + icon('search') + '<input id="search" type="search" aria-label="Поиск" autocomplete="off" placeholder="' + placeholder + '" value="' + esc(state.query) + '"></label>' + filter + statuses + '<span class="result-count" id="result-count"></span></div>';
  }
  function rows(kind, records) {
    if (kind === 'payers') return records.map(p => {
      const count = M.managedClients(db, p.id).length;
      return '<tr><td><div class="company-cell"><span class="company-icon">' + icon('payer') + '</span><div>' + actionButton('open-payer', esc(p.name_pay), p.id, 'row-link') + '<small>' + esc(buyerLabel(p.segment)) + '</small></div></div></td><td><span class="cell-code">' + esc(p.kod_pay) + '</span></td><td><b>' + count + '</b><span class="cell-sub">получателей</span></td><td class="contact-column">' + esc(p.contact) + '<span class="cell-sub">' + esc(p.contact_email) + '</span></td><td>' + recordBadge('payers', p) + '</td><td><button class="icon-btn" data-action="open-payer" data-id="' + esc(p.id) + '" aria-label="Открыть ' + esc(p.name_pay) + '">' + icon('arrow') + '</button></td></tr>';
    }).join('');
    if (kind === 'clients') return records.map(c => '<tr><td><div class="company-cell"><span class="company-icon">' + icon('client') + '</span><div>' + actionButton('open-client', esc(c.name_clt), c.id, 'row-link') + '<small>' + esc(c.kod_clt) + '</small></div></div></td><td>' + esc(payerName(c.payer)) + '</td><td>' + esc(c.address) + '<span class="cell-sub">' + esc(c.days) + '</span></td><td>' + recordBadge('clients', c) + '</td><td>' + actionButton('edit-client', 'Изменить', c.id, 'btn') + '</td></tr>').join('');
    return records.map(u => {
      const reset = db.resets.find(r => r.user === u.id && r.status === 'pending');
      const userPayers = M.managedPayers(db).filter(p => db.rights.some(r => r.user === u.id && r.active && r.payer === p.id));
      const scope = userPayers.map(p => {
        const rights = db.rights.filter(r => r.user === u.id && r.payer === p.id && r.active);
        const allowedClients = M.managedClients(db, p.id);
        const names = rights.some(r => !r.client) ? 'Все получатели' : allowedClients.filter(c => rights.some(r => r.client === c.id)).map(c => c.name_clt).join(', ');
        return esc(p.name_pay) + '<span class="cell-sub">' + esc(names) + '</span>';
      }).join('<br>');
      return '<tr><td><div class="company-cell"><span class="avatar">' + esc(u.name.split(' ').map(x => x[0]).slice(0, 2).join('')) + '</span><div>' + actionButton('edit-user', esc(u.name), u.id, 'row-link') + '<small>' + esc(u.email) + '</small></div></div></td><td class="user-scope">' + (scope || '<span class="cell-sub">Нет действующих назначений</span>') + '</td><td>' + badge(roleName[u.role] || 'Неизвестна', 'gray') + '</td><td>' + recordBadge('users', u) + '</td><td><div class="row-actions">' + actionButton('reset-user', reset ? 'Продолжить' : 'Сбросить пароль', u.id, 'btn', 'reset').replace('<button', !u.active ? '<button disabled' : '<button') + actionButton('toggle-user', u.active ? 'Отключить' : 'Включить', u.id, 'text-btn') + '</div></td></tr>';
    }).join('');
  }
  const headers = { payers: ['Покупатель', 'Код', 'Получатели', '<span class="contact-column">Контактное лицо</span>', 'Статус', ''], clients: ['Получатель', 'Покупатель', 'Адрес доставки', 'Статус', ''], users: ['Пользователь', 'Доступ к покупателям', 'Роль', 'Статус', ''] };
  function table(kind, data, searchable = true, label = '') {
    return '<section class="panel"><div class="panel-head"><h2>' + (label || { payers: 'Покупатели', clients: 'Получатели', users: 'Пользователи' }[kind]) + '<span class="small-count" id="total-count">' + data.length + '</span></h2>' + (kind === 'payers' ? '<span class="access-label cell-sub">' + icon('shield') + 'Моя зона ответственности</span>' : '') + '</div>' + (searchable ? searchBar(kind) : '') + '<div class="table-scroll"><table class="data-table' + (kind === 'users' ? ' compact' : '') + '" aria-label="' + kind + '"><thead><tr>' + headers[kind].map((h, i) => '<th' + (kind === 'payers' && i === 3 ? ' class="contact-column"' : '') + ' scope="col">' + h + '</th>').join('') + '</tr></thead><tbody id="rows">' + rows(kind, data) + '</tbody></table></div><div id="empty-state"' + (data.length ? ' hidden' : '') + '></div><div class="table-foot"><span id="table-result">Показано ' + data.length + '</span><span>Только назначенные вам записи</span></div></section>';
  }
  function matches(values) { const q = state.query.trim().toLocaleLowerCase('ru-RU'); return !q || values.some(v => String(v ?? '').toLocaleLowerCase('ru-RU').includes(q)); }
  function filtered(kind) {
    const activeMatches = (collection, record) => state.status !== 'on' && state.status !== 'off' || M.businessStatus(db, collection, record.id).active === (state.status === 'on');
    if (kind === 'payers') return M.managedPayers(db).filter(p => activeMatches('payers', p) && matches([p.name_pay, p.kod_pay, p.contact_email, p.contact]) && (state.status !== 'new' || !M.managedClients(db, p.id).length));
    if (kind === 'clients') return M.managedClients(db, state.payer).filter(c => activeMatches('clients', c) && matches([c.name_clt, c.kod_clt, c.address, c.email, payerName(c.payer)]));
    return M.managedUsers(db, state.payer).filter(u => activeMatches('users', u) && (state.status !== 'pending' || u.must_change_password || db.resets.some(r => r.user === u.id && r.status === 'pending')) && matches([u.name, u.email]));
  }
  function updateResults() {
    const kind = state.view;
    if (!['payers', 'clients', 'users'].includes(kind)) return;
    const data = filtered(kind);
    $('#rows').innerHTML = rows(kind, data);
    $('#result-count').textContent = 'Найдено: ' + data.length;
    $('#table-result').textContent = 'Показано ' + data.length;
    const empty = $('#empty-state'); empty.hidden = data.length > 0;
    empty.innerHTML = '<div class="empty">' + icon('search') + '<h3>' + (state.query || state.status || state.payer || state.client ? 'Ничего не найдено' : 'Записей пока нет') + '</h3><p>' + (state.query || state.status ? 'Измените поиск или сбросьте фильтры.' : 'Здесь появятся доступные вам записи.') + '</p>' + actionButton('clear-filters', 'Сбросить фильтры', '', 'btn') + '</div>';
    if (kind === 'users') document.querySelectorAll('.disabled-user').forEach(btn => { btn.disabled = true; });
  }
  function clientCards(clients) {
    if (!clients.length) return '<div class="empty">' + icon('client') + '<h3>Добавьте первого получателя</h3><p>Укажите точку доставки для этого покупателя.</p>' + actionButton('create-client', 'Добавить получателя', state.payer, 'btn primary', 'plus') + '</div>';
    return '<div class="client-grid">' + clients.map(c => '<article class="client-card"><h3>' + actionButton('open-client', esc(c.name_clt), c.id, 'row-link') + '</h3><span class="cell-code">' + esc(c.kod_clt) + '</span>' + recordBadge('clients', c) + '<p class="client-address">' + esc(c.address) + '<br>Доставка: ' + esc(c.days) + '</p><div class="card-actions">' + actionButton('edit-client', 'Редактировать', c.id, 'text-btn') + '</div></article>').join('') + '</div>';
  }
  function payerDetail() {
    const p = M.managedPayers(db).find(p => p.id === state.payer);
    const clients = M.managedClients(db, p.id), users = M.managedUsers(db, p.id);
    const extra = state.detailTab === 'users' ? '<div class="detail-add">' + actionButton('create-user', 'Добавить пользователя', p.id, 'btn subtle', 'plus') + '</div>' : '';
    const contents = state.detailTab === 'clients' ? clientCards(clients) : users.length ? '<div class="table-scroll"><table class="data-table compact"><thead><tr>' + headers.users.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows('users', users) + '</tbody></table></div>' : '<div class="empty"><h3>Пользователи не назначены</h3><p>Контактный email не создаёт учётную запись для входа.</p></div>';
    return '<button class="back-link" data-action="back-payers">' + icon('back') + 'Все покупатели</button><div class="page-heading"><div class="detail-head"><span class="company-icon">' + icon('payer') + '</span><div><div class="eyebrow">ПОКУПАТЕЛЬ · ' + esc(p.kod_pay) + '</div><h1>' + esc(p.name_pay) + '</h1><p>' + esc(buyerLabel(p.segment)) + ' &nbsp; ' + recordBadge('payers', p) + '</p></div></div><div class="heading-actions">' + actionButton('edit-payer', 'Редактировать', p.id, 'btn') + actionButton('toggle-payer', p.active ? 'Отключить' : 'Включить', p.id, 'btn ' + (p.active ? '' : 'subtle')) + '</div></div>' + (!p.active ? '<div class="form-note">Покупатель отключён. Клиенты не могут пользоваться его получателями; менеджер видит записи и историю для администрирования.</div>' : '') + '<dl class="info-strip"><div><dt>Контактное лицо</dt><dd>' + esc(p.contact) + '</dd></div><div><dt>Телефон</dt><dd>' + esc(p.phone) + '</dd></div><div><dt>Контактный email</dt><dd>' + esc(p.contact_email) + '</dd></div><div><dt>ИНН</dt><dd>' + esc(p.inn || 'Не указан в демо') + '</dd></div></dl><section class="panel"><div class="detail-toolbar"><div class="tabs" role="tablist" aria-label="Карточка покупателя">' + [['clients', 'Получатели', clients.length], ['users', 'Пользователи', users.length]].map(([key, label, n]) => '<button id="tab-' + key + '" class="tab' + (state.detailTab === key ? ' active' : '') + '" role="tab" aria-selected="' + (state.detailTab === key) + '" aria-controls="detail-panel" data-tab="' + key + '" tabindex="' + (state.detailTab === key ? 0 : -1) + '">' + label + ' <span class="small-count">' + n + '</span></button>').join('') + '</div>' + (p.active ? actionButton('create-client', 'Получатель', p.id, 'btn subtle', 'plus') : '') + '</div><div id="detail-panel" role="tabpanel" aria-labelledby="tab-' + state.detailTab + '">' + extra + contents + '</div></section>';
  }
  function journal() {
    return '<section class="panel"><div class="panel-head"><h2>Действия менеджера</h2>' + badge(visibleActivities().length + ' записей', 'gray') + '</div><ul class="journal">' + visibleActivities().map(a => '<li><span class="activity-icon">' + icon(a.type) + '</span><div><strong>' + esc(buyerLabel(a.text)) + '</strong><p>' + esc(buyerLabel(a.detail)) + '</p><small>Мария Соколова · демонстрация</small></div><time>' + date(a.time) + '<br>' + time(a.time) + '</time></li>').join('') + '</ul></section>';
  }
  function render() {
    if (state.view === 'payer-detail' && !M.managedPayers(db).some(p => p.id === state.payer)) state = { view: 'payers', query: '', payer: '', client: '', status: '', detailTab: 'clients' };
    renderNav();
    let html;
    if (state.view === 'dashboard') {
      html = '<section class="welcome"><div><div class="eyebrow">ДОБРЫЙ ДЕНЬ, МАРИЯ</div><h1>Всё для работы с клиентами</h1><p>Пользователи, покупатели и получатели — в одном пространстве.</p></div>' + actionButton('create-payer', 'Добавить покупателя', '', 'btn yellow', 'plus') + '</section>' + kpis() + creationPanel() + '<div class="bottom-grid">' + activities() + quickPanel() + '</div>';
    } else if (state.view === 'payer-detail') html = payerDetail();
    else if (state.view === 'log') html = heading('Журнал действий', 'Создание, изменения, доступы и восстановление — с датой и временем.') + journal();
    else {
      const text = { payers: ['Мои покупатели', 'Юридические лица и связанные получатели в вашей зоне ответственности.'], clients: ['Мои получатели', 'Адреса доставки, редактирование и управление доступом торговых точек.'], users: ['Пользователи и доступ', 'Создание учётных записей, несколько покупателей и восстановление входа.'] }[state.view];
      const actions = state.view === 'payers' ? actionButton('create-payer', 'Добавить покупателя', '', 'btn primary', 'plus') : state.view === 'clients' ? actionButton('create-client', 'Добавить получателя', state.payer, 'btn primary', 'plus') : state.view === 'users' ? actionButton('create-user', 'Добавить пользователя', state.payer, 'btn primary', 'plus') : '';
      const all = state.view === 'payers' ? M.managedPayers(db) : state.view === 'clients' ? M.managedClients(db) : M.managedUsers(db);
      html = heading(text[0], state.client ? 'Получатель: ' + clientName(state.client) : text[1], actions) + (state.view === 'payers' ? kpis() : '') + table(state.view, all) + (state.view === 'users' ? '<div class="section-note">Вход и восстановление относятся к пользователю. Покупатель и получатель — связанные справочники. Отключённые записи видны менеджеру для восстановления доступа.</div>' : '') + (state.view === 'payers' ? '<div class="bottom-grid">' + activities() + quickPanel() + '</div>' : '');
    }
    $('#content').innerHTML = html;
    updateResults();
  }
  function formSnapshot(form) { return JSON.stringify([...new FormData(form)]); }
  function showDialog(title, subtitle, body, foot = '', formId = '') {
    dialogReturnFocus = document.activeElement;
    const dialog = $('#dialog');
    dialog.innerHTML = (formId ? '<form id="' + formId + '">' : '') + '<div class="dialog-head"><div><h2 id="dialog-title">' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Закрыть окно">' + icon('close') + '</button></div><div class="dialog-body">' + body + '</div><div class="dialog-foot">' + foot + '</div>' + (formId ? '</form><div id="discard-guard" class="discard-guard" hidden role="alert"><strong>Есть несохранённые изменения</strong><p>Закрыть форму и отменить правки?</p><div>' + actionButton('keep-editing', 'Продолжить редактирование') + actionButton('discard-form', 'Закрыть без сохранения', '', 'btn danger') + '</div></div>' : '');
    formInitial = formId ? formSnapshot($('#' + formId)) : '';
    if (!dialog.open) dialog.showModal();
    if (formId) dialog.querySelector('input,select')?.focus({ preventScroll: true });
  }
  function closeDialog(force = false) {
    const form = $('#dialog').querySelector('form');
    if (!force && form && formInitial !== formSnapshot(form)) { $('#discard-guard').hidden = false; $('#discard-guard button').focus(); return false; }
    $('#dialog').close(); submitted = false; formInitial = ''; return true;
  }
  const field = (name, label, placeholder = '', type = 'text', full = false, value = '', required = true) => '<label class="field' + (full ? ' full' : '') + '"><span>' + label + (required ? ' <span aria-hidden="true">*</span>' : '') + '</span><input name="' + name + '" type="' + type + '"' + (required ? ' required' : '') + ' maxlength="' + (name === 'address' ? 240 : type === 'tel' || name.includes('kod') ? 40 : 160) + '" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" autocomplete="off"></label>';
  const formFoot = existing => '<button type="button" class="btn" data-action="close-dialog">Отмена</button><button type="submit" class="btn primary">' + icon(existing ? 'check' : 'plus') + (existing ? 'Сохранить изменения' : 'Создать запись') + '</button>';
  function payerForm(id = '') {
    const x = id ? M.managedPayers(db).find(p => p.id === id) : {};
    if (!x) return toast('Покупатель недоступен.', true);
    editing = { kind: 'payers', id }; submitted = false;
    const code = x.kod_pay || 'DEMO-P-' + String(M.managedPayers(db).length + 1).padStart(3, '0');
    const body = '<div class="form-note">Демо-запись остаётся в вашем браузере. Контактный email не создаёт пользователя для входа. Используйте вымышленные реквизиты.</div><div class="form-grid">' + field('name_pay', 'Наименование покупателя', 'ООО «Название»', 'text', true, x.name_pay) + field('kod_pay', 'Код покупателя', '', 'text', false, code) + field('inn', 'ИНН (необязательно)', '10 или 12 цифр', 'text', false, x.inn, false) + field('contact', 'Контактное лицо', 'Имя и фамилия', 'text', true, x.contact) + field('phone', 'Телефон', '+7 (000) 000-00-00', 'tel', false, x.phone) + field('contact_email', 'Контактный email', 'contact@demo.example', 'email', false, x.contact_email) + '</div><div id="form-error" class="form-error" role="alert"></div>';
    showDialog(id ? 'Редактировать покупателя' : 'Новый покупатель', 'Юридическое лицо · тестовые данные', body, formFoot(id), 'payer-form');
  }
  function clientForm(id = '', payerId = '') {
    const x = id ? M.managedClients(db).find(c => c.id === id) : { payer: payerId };
    if (!x) return toast('Получатель недоступен.', true);
    if (!id) return clientImportForm(payerId);
    const payers = fullPayers().filter(p => p.id === x.payer);
    if (!payers.length || !id && payerId && !payers.some(p => p.id === payerId)) return toast('Для создания нужен активный покупатель с полным доступом.', true);
    editing = { kind: 'clients', id }; submitted = false;
    const code = x.kod_clt || 'DEMO-C-' + String(M.managedClients(db).length + 1).padStart(3, '0');
    const select = '<label class="field full"><span>Покупатель *</span><select id="form-payer" name="payer" required><option value="">Выберите покупателя</option>' + payers.map(p => '<option value="' + esc(p.id) + '"' + (x.payer === p.id ? ' selected' : '') + '>' + esc(p.name_pay) + (p.active ? '' : ' · отключён') + '</option>').join('') + '</select></label>';
    const movedNote = '';
    const body = '<div class="form-note">Торговая точка связана с покупателем в КИС. Здесь редактируются только тестовые данные; рабочая версия использует карточку КИС.</div><div class="form-grid">' + select + field('name_clt', 'Название получателя', 'Магазин · Адрес', 'text', true, x.name_clt) + field('kod_clt', 'Код получателя', '', 'text', false, code) + field('contact', 'Контактное лицо', 'Имя и фамилия', 'text', false, x.contact) + field('address', 'Адрес доставки', 'Санкт-Петербург, улица, дом', 'text', true, x.address) + field('phone', 'Телефон', '+7 (000) 000-00-00', 'tel', false, x.phone) + field('email', 'Контактный email', 'shop@demo.example', 'email', false, x.email) + '<label class="field full"><span>Дни доставки *</span><select name="days" required>' + [...new Set(['Ежедневно', 'Пн, Ср, Пт', 'Вт, Чт, Сб', 'Пн–Пт', x.days].filter(Boolean))].map(day => '<option' + (x.days === day ? ' selected' : '') + '>' + esc(day) + '</option>').join('') + '</select></label></div>' + movedNote + '<div id="form-error" class="form-error" role="alert"></div>';
    showDialog(id ? 'Редактировать получателя' : 'Новый получатель', 'Торговая точка / адрес доставки · тестовые данные', body, formFoot(id), 'client-form');
  }
  function kisOptions(payerId) {
    const cards = M.kisCandidates(db, payerId);
    return '<option value="">' + (cards.length ? 'Выберите получателя' : 'Нет новых доступных точек') + '</option>' + cards.map(c => '<option value="' + c.id_clt + '">' + esc(c.name_clt + ' · ' + c.kod_clt + ' · ' + c.address) + '</option>').join('');
  }
  function clientImportForm(payerId = '') {
    const payers = fullPayers().filter(p => p.active);
    if (!payers.length || payerId && !payers.some(p => p.id === payerId)) return toast('Нужен активный покупатель с полным доступом.', true);
    const selected = payerId || payers[0].id;
    editing = { kind: 'clients', id: '' }; submitted = false;
    const body = '<div class="form-note">Выберите существующего получателя покупателя. В этом приватном превью показаны тестовые карточки КИС. Рабочий кабинет будет получать их через PocketBase.</div><div class="form-grid"><label class="field full"><span>Покупатель *</span><select id="import-payer" name="payer" required>' + payers.map(p => '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name_pay) + '</option>').join('') + '</select></label><label class="field full"><span>Получатель из КИС *</span><select id="kis-client" name="kis_client_id" required>' + kisOptions(selected) + '</select></label></div><p class="muted" style="margin-top:18px">В КИС новая торговая точка не создаётся. Подключается выбранная существующая карточка.</p><div id="form-error" class="form-error" role="alert"></div>';
    showDialog('Добавить получателя из КИС', 'Существующая торговая точка · тестовое превью', body, '<button type="button" class="btn" data-action="close-dialog">Отмена</button><button type="submit" class="btn primary">Подключить получателя</button>', 'client-form');
  }
  function accessEditor(userId = '', selectedPayer = '') {
    return '<fieldset class="access-editor"><legend>Доступ к покупателям и получателям</legend><p class="muted">Выберите один или несколько покупателей. Для каждого можно разрешить все точки или отдельные получатели.</p>' + M.managedPayers(db).map(p => {
      const rights = db.rights.filter(r => r.user === userId && r.payer === p.id && r.active);
      const selected = rights.length > 0 || !userId && p.id === selectedPayer;
      const full = fullPayers().some(z => z.id === p.id);
      const all = full && (!rights.length || rights.some(r => !r.client));
      return '<div class="access-card"><label class="checkline access-payer"><input type="checkbox" name="access-payer" value="' + esc(p.id) + '" data-scope="' + esc(p.id) + '"' + (selected ? ' checked' : '') + '><strong>' + esc(p.name_pay) + '</strong>' + (p.active ? '' : badge('Отключён', 'gray')) + '</label><div id="scope-' + esc(p.id) + '" class="scope-controls"' + (selected ? '' : ' hidden') + '><label class="field"><span>Область доступа</span><select name="scope-mode-' + esc(p.id) + '" data-mode="' + esc(p.id) + '">' + (full ? '<option value="all"' + (all ? ' selected' : '') + '>Все получатели покупателя</option>' : '') + '<option value="specific"' + (!all ? ' selected' : '') + '>Только выбранные получатели</option></select></label><div id="scope-clients-' + esc(p.id) + '" class="scope-client-list"' + (all ? ' hidden' : '') + '>' + M.managedClients(db, p.id).map(c => '<label class="checkline"><input type="checkbox" name="scope-clients-' + esc(p.id) + '" value="' + esc(c.id) + '"' + (rights.some(r => r.client === c.id) ? ' checked' : '') + '><span>' + esc(c.name_clt) + (c.active ? '' : ' · отключён') + '</span></label>').join('') + (M.managedClients(db, p.id).length ? '' : '<p class="cell-sub">Получателей пока нет. Выберите общий доступ или создайте получателя.</p>') + '</div></div></div>';
    }).join('') + '</fieldset>';
  }
  function userForm(id = '', payerId = '') {
    const x = id ? M.managedUsers(db).find(u => u.id === id) : { role: 'viewer' };
    if (!x) return toast('Пользователь недоступен.', true);
    editing = { kind: 'users', id }; submitted = false;
    const body = '<div class="form-note">Пароль в демо не вводится. Новый пользователь получает статус «Первый вход». После создания можно пройти сценарий восстановления. Изменение email отменяет ранее запущенный сброс.</div><div class="form-grid">' + field('name', 'Имя пользователя', 'Имя и фамилия', 'text', true, x.name) + field('email', 'Email для входа', 'user@demo.example', 'email', false, x.email) + '<label class="field"><span>Роль *</span><select name="role" required>' + Object.entries(roleName).map(([code, label]) => '<option value="' + code + '"' + (x.role === code ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div><p class="role-note">Владелец и менеджер — действия в назначенной области; просмотр — только чтение.</p>' + accessEditor(id, payerId) + '<div id="form-error" class="form-error" role="alert"></div>';
    showDialog(id ? 'Редактировать пользователя' : 'Новый пользователь', 'Учётная запись и назначения · тестовые данные', body, formFoot(id), 'user-form');
  }
  function toggleDialog(kind, id) {
    const records = kind === 'payers' ? M.managedPayers(db) : kind === 'clients' ? M.managedClients(db) : M.managedUsers(db);
    const record = records.find(r => r.id === id); if (!record) return toast('Запись недоступна.', true);
    pendingToggle = { kind, id, active: !record.active };
    const consequence = kind === 'payers' ? 'Изменение повлияет на клиентский доступ ко всем получателям этого покупателя. Записи останутся доступны менеджеру.' : kind === 'clients' ? 'Изменение повлияет на доступ к этой торговой точке. Запись остаётся в кабинете менеджера.' : 'Изменение повлияет на вход этого пользователя. При отключении незавершённый демо-сброс будет отменён.';
    showDialog(record.active ? 'Отключить доступ?' : 'Включить доступ?', 'Подтверждение изменения · только демо', '<p><strong>' + esc(record.name_pay || record.name_clt || record.name) + '</strong></p><p class="muted" style="margin-top:14px">' + consequence + '</p><div class="form-note" style="margin-top:20px">Данные на сервере не меняются. Действие будет записано в журнал.</div>', actionButton('close-dialog', 'Отмена') + actionButton('confirm-toggle', 'Подтвердить', '', 'btn ' + (record.active ? 'danger' : 'primary')));
  }
  function openClient(id) {
    const c = M.managedClients(db).find(c => c.id === id);
    if (!c) { toast('Получатель недоступен.', true); return; }
    const body = '<dl class="meta-grid"><div><dt>Покупатель</dt><dd>' + esc(payerName(c.payer)) + '</dd></div><div><dt>Код получателя</dt><dd>' + esc(c.kod_clt) + '</dd></div><div><dt>Адрес доставки</dt><dd>' + esc(c.address) + '</dd></div><div><dt>Дни доставки</dt><dd>' + esc(c.days) + '</dd></div><div><dt>Контактное лицо</dt><dd>' + esc(c.contact) + '</dd></div><div><dt>Телефон</dt><dd>' + esc(c.phone) + '</dd></div><div><dt>Контактный email</dt><dd>' + esc(c.email) + '</dd></div><div><dt>Статус</dt><dd>' + recordBadge('clients', c) + '</dd></div></dl><div class="form-note">Пользователи для входа управляются в разделе «Пользователи». Получатель — это торговая точка, а не отдельная учётная запись.</div>';
    showDialog(c.name_clt, 'Карточка получателя', body, actionButton('toggle-client', c.active ? 'Отключить' : 'Включить', c.id, 'btn') + actionButton('edit-client', 'Редактировать', c.id, 'btn primary'));
  }

  function resetDialog(userId) {
    const u = M.managedUsers(db).find(u => u.id === userId && u.active);
    if (!u) { toast('Пользователь недоступен.', true); return; }
    const pending = db.resets.find(r => r.user === userId && r.status === 'pending');
    if (pending) { resetReceipt(pending.id); return; }
    const body = '<div class="reset-person"><span class="avatar">' + icon('user') + '</span><div><strong>' + esc(u.name) + '</strong><small>' + esc(u.email) + '</small></div></div><p class="muted">Восстановление запускается для пользователя. Контактный email покупателя или получателя не заменяет email для входа.</p><ol class="reset-steps"><li><b class="step-num">1</b><div><strong>Проверить пользователя</strong><small>Выбранный email: ' + esc(u.email) + '</small></div></li><li><b class="step-num">2</b><div><strong>Подготовить письмо восстановления</strong><small>Демо покажет письмо. Отправки не будет.</small></div></li><li><b class="step-num">3</b><div><strong>Смоделировать результат</strong><small>Пользователь завершает смену пароля по ссылке.</small></div></li></ol><div class="form-note">В рабочем кабинете потребуются настроенная почта и проверка ссылки восстановления. В демо пароль не вводится и не изменяется.</div>';
    showDialog('Восстановление доступа', 'Шаг 1 из 3 · проверка пользователя', body, actionButton('close-dialog', 'Отмена') + actionButton('start-reset', 'Запустить демо-сброс', u.id, 'btn primary', 'reset'));
  }
  function resetReceipt(resetId) {
    const reset = db.resets.find(r => r.id === resetId && r.status === 'pending');
    if (!reset) { toast('Сценарий уже завершён или недоступен.', true); return; }
    const u = M.managedUsers(db).find(u => u.id === reset.user && u.active);
    if (!u) { toast('Пользователь недоступен.', true); return; }
    const body = '<div class="success-icon">' + icon('mail') + '</div><h3 class="success-title">Демо-письмо подготовлено</h3><p class="muted">Сценарий запущен для ' + esc(u.name) + '. Письмо никуда не отправлено.</p><div class="mail-preview" style="margin-top:19px"><div class="eyebrow">ПРЕДПРОСМОТР · ПИСЬМО ВОССТАНОВЛЕНИЯ</div><strong>Кому: ' + esc(reset.email) + '</strong><p>Тема: Восстановление доступа в кабинет КАРАВАЙ</p><p>Здравствуйте, ' + esc(u.name.split(' ')[0]) + '!<br>Вы запросили восстановление доступа. В рабочем письме здесь будет ссылка для установки нового пароля.</p><span class="badge gray">Демонстрационный образец</span></div><p class="muted" style="margin-top:16px">Нажмите кнопку ниже, чтобы смоделировать завершение смены пароля пользователем.</p>';
    showDialog('Сценарий сброса пароля', 'Шаг 2 из 3 · письмо восстановления', body, actionButton('close-dialog', 'Закрыть') + actionButton('complete-reset', 'Смоделировать смену пароля', reset.id, 'btn primary', 'check'));
  }
  function about() {
    const body = '<p class="muted">Интерактивный прототип кабинета менеджера КАРАВАЙ: назначенные покупатели, получатели, создание и редактирование записей, управление пользователями, восстановление доступа и журнал действий.</p><ul class="about-list"><li>Объединены функции автономного HTML 0.1 и демо в Sites.</li><li>Все организации и пользователи — тестовые.</li><li>Несколько покупателей у пользователя, все или отдельные получатели у каждого.</li><li>Отключённые записи видны менеджеру для администрирования; клиентский доступ учитывает активность.</li><li>Изменения сохраняются в этом браузере. «Начать заново» восстанавливает исходное демо.</li><li>Сброс пароля демонстрирует процесс без отправки письма и изменения паролей.</li><li>Демо не подключено к PocketBase и КИС.</li></ul><div class="form-note">В актуальной спецификации покупатели и получатели не входят в кабинет напрямую. Вход и восстановление относятся к пользователям. Права менеджера в этом демо являются предложением интерфейса; серверные операции администрирования ещё требуют согласования.</div><p class="source-link"><a href="https://github.com/nikitinad17-ai/Karavay_LK/blob/818a0c11cf34c0cf33c816d762126cc07e568296/docs/POCKETBASE_ACCESS_MODEL.md" target="_blank" rel="noopener noreferrer">Модель доступа в GitHub ↗</a></p><p class="cell-sub" style="margin-top:9px">Основа: main / 818a0c1 · документация от 08.10.2026<br>Фирменный логотип и цвета сохранены из репозитория.</p>';
    showDialog('О прототипе', 'КАРАВАЙ · демо администрирования 0.3', body, actionButton('close-dialog', 'Понятно', '', 'btn primary'));
  }
  const handlers = {
    'goto-users': () => navigate('users'),
    'goto-payers': () => navigate('payers'),
    'back-payers': () => navigate('payers'),
    'open-payer': id => { if (!M.managedPayers(db).some(p => p.id === id)) return toast('Покупатель недоступен.', true); navigate('payer-detail', { payer: id }); },
    'open-client': openClient,
    'create-payer': () => payerForm(),
    'edit-payer': id => payerForm(id),
    'create-client': id => clientForm('', id),
    'edit-client': id => clientForm(id),
    'create-user': id => userForm('', id),
    'edit-user': id => userForm(id),
    'toggle-payer': id => toggleDialog('payers', id),
    'toggle-client': id => toggleDialog('clients', id),
    'toggle-user': id => toggleDialog('users', id),
    'confirm-toggle': () => {
      if (!pendingToggle) return;
      try { save(M.setActive(db, pendingToggle.kind, pendingToggle.id, pendingToggle.active)); pendingToggle = null; closeDialog(true); render(); toast('Статус изменён. Запись добавлена в журнал.'); }
      catch (e) { toast(e.message, true); }
    },
    'blocked-clients': () => navigate('clients', { status: 'off' }),
    'keep-editing': () => { $('#discard-guard').hidden = true; $('#dialog').querySelector('input,select')?.focus({ preventScroll: true }); },
    'discard-form': () => closeDialog(true),
    'reset-user': resetDialog,
    'close-dialog': () => closeDialog(),
    'start-reset': id => {
      try { const result = M.requestReset(db, id); save(result.db); render(); resetReceipt(result.record.id); } catch (e) { toast(e.message, true); }
    },
    'complete-reset': id => {
      try {
        const reset = db.resets.find(r => r.id === id); const name = db.users.find(u => u.id === reset?.user)?.name;
        save(M.completeReset(db, id)); render();
        showDialog('Демо-сценарий завершён', 'Шаг 3 из 3 · результат', '<div class="success-icon">' + icon('check') + '</div><h3 class="success-title">Доступ восстановлен в демо</h3><p class="muted">Смоделирована смена пароля для ' + esc(name) + '. Статус пользователя обновлён, действие добавлено в журнал.</p><div class="form-note" style="margin-top:20px">Реальный пароль не менялся. Письма не отправлялись.</div>', actionButton('close-dialog', 'Готово', '', 'btn primary'));
      } catch (e) { toast(e.message, true); }
    },
    'clear-filters': () => { state.query = ''; state.payer = ''; state.client = ''; state.status = ''; render(); },
    'about': about,
    'restart': () => showDialog('Начать демо заново?', 'Восстановление тестовых данных', '<p class="muted">Созданные покупатели, получатели и результаты демо-сбросов будут удалены из этого браузера. Исходные тестовые записи вернутся.</p>', actionButton('close-dialog', 'Отмена') + actionButton('confirm-restart', 'Восстановить демо', '', 'btn danger', 'reset')),
    'confirm-restart': () => { save(M.seed()); closeDialog(true); navigate('dashboard'); toast('Исходные тестовые данные восстановлены.'); }
  };
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action && !action.disabled) { handlers[action.dataset.action]?.(action.dataset.id || ''); return; }
    const nav = event.target.closest('[data-view]'); if (nav) { navigate(nav.dataset.view); return; }
    const tab = event.target.closest('[data-tab]'); if (tab) { const key = tab.dataset.tab; if (!['clients', 'users'].includes(key)) return; state.detailTab = key; render(); $('#tab-' + key)?.focus({ preventScroll: true }); }
  });
  document.addEventListener('input', event => { if (event.target.id === 'search') { state.query = event.target.value; updateResults(); } });
  document.addEventListener('change', event => {
    if (event.target.id === 'payer-filter') { state.payer = event.target.value; state.client = ''; render(); }
    if (event.target.id === 'status-filter') { state.status = event.target.value; updateResults(); }
    if (event.target.dataset?.scope) $('#scope-' + event.target.dataset.scope).hidden = !event.target.checked;
    if (event.target.dataset?.mode) $('#scope-clients-' + event.target.dataset.mode).hidden = event.target.value === 'all';
    if (event.target.id === 'import-payer') {
      $('#kis-client').innerHTML = kisOptions(event.target.value);
    }
  });
  document.addEventListener('submit', event => {
    if (!['payer-form', 'client-form', 'user-form'].includes(event.target.id)) return;
    event.preventDefault(); if (submitted) return;
    const form = event.target; if (!form.reportValidity()) return;
    submitted = true; const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
    try {
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      if (form.id === 'user-form') data.accesses = M.managedPayers(db).filter(p => formData.getAll('access-payer').includes(p.id)).map(p => ({ payer: p.id, allClients: formData.get('scope-mode-' + p.id) === 'all', clients: formData.getAll('scope-clients-' + p.id) }));
      const wasEditing = !!editing.id;
      const result = form.id === 'payer-form' ? wasEditing ? M.updatePayer(db, editing.id, data) : M.createPayer(db, data) : form.id === 'client-form' ? wasEditing ? M.updateClient(db, editing.id, data) : M.attachClient(db, data) : wasEditing ? M.updateUser(db, editing.id, data) : M.createUser(db, data);
      save(result.db); closeDialog(true);
      if (form.id === 'user-form') { navigate('users'); toast(wasEditing ? 'Пользователь и доступы обновлены.' : 'Пользователь создан. Можно пройти сценарий восстановления.'); }
      else { navigate('payer-detail', { payer: form.id === 'payer-form' ? result.record.id : result.record.payer }); toast(wasEditing ? 'Изменения сохранены в демо.' : form.id === 'payer-form' ? 'Покупатель создан. Можно добавить получателя.' : 'Получатель подключён к покупателю.'); }
    } catch (e) { $('#form-error').textContent = e.message; submitted = false; btn.disabled = false; }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
    const tab = event.target.closest('[data-tab]');
    if (tab && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const keys = ['clients', 'users']; const index = keys.indexOf(tab.dataset.tab);
      state.detailTab = keys[event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + 1) % keys.length]; render(); $('#tab-' + state.detailTab).focus();
    }
  });
  $('#dialog').addEventListener('close', () => { submitted = false; if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({ preventScroll: true }); });
  $('#dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  window.addEventListener?.('beforeunload', event => {
    const form = $('#dialog').querySelector('form');
    if (form && formInitial !== formSnapshot(form)) { event.preventDefault(); event.returnValue = ''; }
  });
  $('#menu').innerHTML = icon('menu');
  $('#menu').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-backdrop').hidden = !open; $('#menu').setAttribute('aria-expanded', String(open)); });
  $('#menu-backdrop').addEventListener('click', closeMenu);
  if (!storageWorks) $('.demo-banner>span:nth-child(2)').textContent = 'Тестовые данные. Изменения действуют до обновления страницы.';
  render();
})();
