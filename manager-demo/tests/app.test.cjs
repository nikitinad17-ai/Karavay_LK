// Event-handler smoke harness. This is not browser/visual QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../dist/model.js');

function harness(initialStorage) {
  const nodes = new Map(), events = new Map(), storage = new Map(initialStorage ? [['karavay-manager-demo-v1', JSON.stringify(initialStorage)]] : []);
  function node(key) {
    if (!nodes.has(key)) {
      const classes = new Set();
      nodes.set(key, { id: key.replace('#', ''), innerHTML: '', textContent: '', values: {}, hidden: false, open: false, isConnected: true, dataset: {}, listeners: new Map(), querySelector() { return null; }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: c => { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; } }, focus() {}, setAttribute() {}, addEventListener(k, fn) { this.listeners.set(k, fn); }, showModal() { this.open = true; }, close() { this.open = false; this.listeners.get('close')?.(); } });
    }
    return nodes.get(key);
  }
  const document = { activeElement: null, querySelector: node, querySelectorAll: () => [], addEventListener(k, fn) { events.set(k, fn); } };
  const window = { KaravayDemo: M };
  const context = { window, document, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }, Intl, Date, Object, String, Number, Set, Map, clearTimeout() {}, setTimeout() { return 1; }, FormData: class { constructor(form) { this.values = form.values || {}; } get(k) { const value = this.values[k]; return Array.isArray(value) ? value[0] : value ?? null; } getAll(k) { const value = this.values[k]; return value == null ? [] : Array.isArray(value) ? value : [value]; } *[Symbol.iterator]() { for (const [k,v] of Object.entries(this.values)) { for (const item of Array.isArray(v) ? v : [v]) yield [k,item]; } } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), context);
  function click(data, type = 'action') {
    const target = { dataset: type === 'action' ? { action: data.action, id: data.id } : type === 'tab' ? { tab: data.tab } : { view: data.view }, disabled: false, closest(selector) { return selector === '[data-' + type + ']' ? this : null; } };
    events.get('click')({ target });
  }
  function submit(id, values) {
    const button = {};
    const form = { id, values, reportValidity: () => true, querySelector: () => button };
    events.get('submit')({ target: form, preventDefault() {} });
  }
  return { node, click, submit, events, storage, saved: () => JSON.parse(storage.get('karavay-manager-demo-v1')) };
}

test('Первый экран, поиск и переходы показывают доступные записи', () => {
  const h = harness();
  assert.match(h.node('#content').innerHTML, /Всё для работы с клиентами/);
  h.click({ view: 'payers' }, 'view');
  assert.match(h.node('#rows').innerHTML, /Северная лавка/);
  assert.doesNotMatch(h.node('#rows').innerHTML, /FOREIGN-P|INACTIVE-P/);
  h.events.get('input')({ target: { id: 'search', value: 'Орлова' } });
  assert.match(h.node('#rows').innerHTML, /Орлова/);
  assert.doesNotMatch(h.node('#rows').innerHTML, /Невский маркет/);
  h.click({ view: 'clients' }, 'view');
  assert.match(h.node('#rows').innerHTML, /DEMO-C-008/);
  h.events.get('change')({ target: { id: 'payer-filter', value: 'p2' } });
  assert.match(h.node('#rows').innerHTML, /Невский маркет/);
  assert.doesNotMatch(h.node('#rows').innerHTML, /Северная лавка/);
});
test('Карточка покупателя связывает получателей и пользователей без раздела заказов', () => {
  const h = harness();
  h.click({ action: 'open-payer', id: 'p1' });
  assert.match(h.node('#content').innerHTML, /DEMO-C-001/);
  assert.doesNotMatch(h.node('#content').innerHTML, /DEMO-C-004|Заказ|заказ|data-tab="orders"/);
  h.click({ tab: 'users' }, 'tab');
  assert.match(h.node('#content').innerHTML, /Анна Демина/);
  assert.doesNotMatch(h.node('#content').innerHTML, /elena@demo.example/);
  h.click({ action: 'open-client', id: 'c1' });
  assert.equal(h.node('#dialog').open, true);
  assert.match(h.node('#dialog').innerHTML, /7-я линия/);
  assert.doesNotMatch(h.node('#dialog').innerHTML, /Заказ|заказ|client-orders/);
  h.click({ action: 'close-dialog' });
  h.click({ action: 'open-client', id: 'foreign-client' });
  assert.equal(h.node('#dialog').open, false);
  assert.match(h.node('#toast').textContent, /недоступен/);
});
test('Покупатель создаётся, получатель выбирается из КИС, изменения восстанавливаются после перезапуска', () => {
  const h = harness();
  h.click({ action: 'create-payer' });
  assert.match(h.node('#dialog').innerHTML, /name="contact_email" type="email" required/);
  h.submit('payer-form', { name_pay: '<img src=x onerror=alert(1)>', kod_pay: 'DEMO-CUSTOM-P', contact_email: 'contact@demo.example', phone: '+7 (000) 000-00-00', contact: 'Тест' });
  assert.equal(h.node('#dialog').open, false);
  assert.match(h.node('#content').innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const saved = h.saved();
  const created = saved.payers.find(p => p.kod_pay === 'DEMO-CUSTOM-P');
  assert.ok(created);
  h.click({ action: 'create-client', id: 'p1' });
  assert.match(h.node('#dialog').innerHTML, /name="kis_client_id"/);
  assert.doesNotMatch(h.node('#dialog').innerHTML, /name="name_clt"|name="kod_clt"/);
  h.submit('client-form', { payer: 'p1', kis_client_id: '90210' });
  assert.match(h.node('#content').innerHTML, /Северная лавка · Новая точка/);
  const next = harness(h.saved());
  next.click({ action: 'open-payer', id: 'p1' });
  assert.match(next.node('#content').innerHTML, /Северная лавка · Новая точка/);
  next.click({ action: 'open-payer', id: created.id });
  assert.match(next.node('#content').innerHTML, /DEMO-CUSTOM-P/);
});
test('Дубли кодов оставляют форму открытой и показывают ошибку', () => {
  const h = harness();
  h.click({ action: 'create-payer' });
  h.submit('payer-form', { name_pay: 'Тест', kod_pay: 'DEMO-P-001', contact_email: 'contact@demo.example', phone: '123', contact: 'Тест' });
  assert.equal(h.node('#dialog').open, true);
  assert.match(h.node('#form-error').textContent, /уже используется/);
});
test('Полный сброс, продолжение после обновления и восстановление начального демо', () => {
  const h = harness();
  h.click({ view: 'users' }, 'view');
  h.click({ action: 'reset-user', id: 'u4' });
  assert.match(h.node('#dialog').innerHTML, /Шаг 1 из 3/);
  h.click({ action: 'start-reset', id: 'u4' });
  assert.match(h.node('#dialog').innerHTML, /Письмо никуда не отправлено/);
  assert.match(h.node('#rows').innerHTML, /Ожидает сброса/);
  const id = h.saved().resets[0].id;
  const resumed = harness(h.saved());
  resumed.click({ action: 'reset-user', id: 'u4' });
  assert.match(resumed.node('#dialog').innerHTML, /Шаг 2 из 3/);
  resumed.click({ action: 'complete-reset', id });
  assert.match(resumed.node('#dialog').innerHTML, /Шаг 3 из 3/);
  assert.equal(resumed.saved().users.find(u => u.id === 'u4').must_change_password, false);
  resumed.click({ action: 'close-dialog' });
  resumed.click({ action: 'restart' });
  assert.equal(resumed.saved().resets.length, 1);
  resumed.click({ action: 'confirm-restart' });
  assert.equal(resumed.saved().resets.length, 0);
  assert.equal(resumed.saved().users.find(u => u.id === 'u4').must_change_password, true);
});
test('Прототип не выполняет сетевые вызовы или отправку писем', () => {
  const code = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../dist/model.js'), 'utf8');
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|mailto:/);
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
});
test('Форма пользователя создаёт несколько назначений и сохраняет их после обновления', () => {
  const h = harness();
  h.click({ action: 'create-user', id: 'p1' });
  assert.match(h.node('#dialog').innerHTML, /name="access-payer" value="p1" data-scope="p1" checked/);
  assert.match(h.node('#dialog').innerHTML, /scope-clients-p2/);
  h.submit('user-form', { name: 'Демо Оператор', email: 'operator@demo.example', role: 'viewer', 'access-payer': ['p1', 'p2'], 'scope-mode-p1': 'all', 'scope-mode-p2': 'specific', 'scope-clients-p2': ['c4'] });
  const saved = h.saved(), user = saved.users.find(u => u.email === 'operator@demo.example');
  assert.ok(user.must_change_password);
  assert.deepEqual(saved.rights.filter(r => r.user === user.id).map(r => [r.payer, r.client]), [['p1', ''], ['p2', 'c4']]);
  assert.match(h.node('#rows').innerHTML, /Демо Оператор/);
  const restored = harness(saved);
  restored.click({ action: 'edit-user', id: user.id });
  assert.match(restored.node('#dialog').innerHTML, /name="scope-clients-p2" value="c4" checked/);
  assert.match(restored.node('#dialog').innerHTML, /name="access-payer" value="p2" data-scope="p2" checked/);
});
test('Редактирование пользователя отменяет старый сброс и заменяет назначения', () => {
  const reset = M.requestReset(M.seed(), 'u1');
  const h = harness(reset.db);
  h.click({ action: 'edit-user', id: 'u1' });
  h.submit('user-form', { name: 'Анна Новая', email: 'new-anna@demo.example', role: 'viewer', 'access-payer': ['p2'], 'scope-mode-p2': 'specific', 'scope-clients-p2': ['c5'] });
  const db = h.saved();
  assert.equal(db.resets[0].status, 'cancelled');
  assert.deepEqual(db.rights.filter(r => r.user === 'u1').map(r => r.client), ['c5']);
  assert.equal(db.users.find(u => u.id === 'u1').must_change_password, true);
  h.click({ action: 'reset-user', id: 'u1' });
  assert.match(h.node('#dialog').innerHTML, /new-anna@demo.example/);
  assert.match(h.node('#dialog').innerHTML, /Шаг 1 из 3/);
});
test('Редактирование и отключение покупателя отражаются в связанных карточках и журнале', () => {
  const h = harness();
  h.click({ action: 'edit-payer', id: 'p1' });
  h.submit('payer-form', { ...M.seed().payers[0], name_pay: 'Северная лавка · новое имя', inn: '1234567890' });
  assert.match(h.node('#content').innerHTML, /новое имя/);
  h.click({ action: 'toggle-payer', id: 'p1' });
  assert.match(h.node('#dialog').innerHTML, /Записи останутся/);
  h.click({ action: 'confirm-toggle' });
  assert.equal(h.saved().payers.find(p => p.id === 'p1').active, false);
  assert.match(h.node('#content').innerHTML, /Покупатель отключён/);
  h.click({ tab: 'users' }, 'tab');
  assert.match(h.node('#content').innerHTML, /Анна Демина/);
  h.click({ view: 'log' }, 'view');
  assert.match(h.node('#content').innerHTML, /новое имя/);
  assert.match(h.node('#content').innerHTML, /Мария Соколова/);
  assert.doesNotMatch(h.node('#content').innerHTML, /FOREIGN/);
});
test('Редактирование не меняет принадлежность точки в КИС', () => {
  const db = M.seed(), h = harness(db), c = db.clients.find(c => c.id === 'c1');
  h.click({ action: 'edit-client', id: 'c1' });
  assert.doesNotMatch(h.node('#dialog').innerHTML, /option value="p2"/);
  h.submit('client-form', { ...c, payer: 'p2' });
  assert.equal(h.node('#dialog').open, true);
  assert.match(h.node('#form-error').textContent, /Перепривязка/);
  assert.equal(h.saved().clients.find(c => c.id === 'c1').payer, 'p1');
});
test('Выбор другого покупателя обновляет кандидатов, повторное и чужое подключение отклоняются', () => {
  const h = harness(M.seed());
  h.click({ action: 'create-client', id: 'p1' });
  h.events.get('change')({ target: { id: 'import-payer', value: 'p2' } });
  assert.match(h.node('#kis-client').innerHTML, /90211/);
  assert.doesNotMatch(h.node('#kis-client').innerHTML, /90210/);
  h.submit('client-form', { payer: 'p2', kis_client_id: '90210' });
  assert.match(h.node('#form-error').textContent, /другому покупателю/);
  h.submit('client-form', { payer: 'p2', kis_client_id: '90211' });
  assert.equal(h.node('#dialog').open, false);
  const count = h.saved().clients.length;
  h.click({ action: 'create-client', id: 'p2' });
  assert.doesNotMatch(h.node('#dialog').innerHTML, /option value="90211"/);
  h.submit('client-form', { payer: 'p2', kis_client_id: '90211' });
  assert.match(h.node('#form-error').textContent, /уже подключён/);
  assert.equal(h.saved().clients.length, count);
});
test('Закрытие изменённой формы и Escape требуют решения о несохранённых правках', () => {
  const h = harness(), form = h.node('#payer-form');
  form.values = { name_pay: '', kod_pay: 'DEMO-P-005' };
  h.node('#dialog').querySelector = selector => selector === 'form' ? form : null;
  h.click({ action: 'create-payer' });
  form.values.name_pay = 'Несохранённое имя';
  h.click({ action: 'close-dialog' });
  assert.equal(h.node('#dialog').open, true);
  assert.equal(h.node('#discard-guard').hidden, false);
  h.click({ action: 'keep-editing' });
  assert.equal(h.node('#discard-guard').hidden, true);
  let prevented = false;
  h.node('#dialog').listeners.get('cancel')({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(h.node('#dialog').open, true);
  assert.equal(h.node('#discard-guard').hidden, false);
  h.click({ action: 'discard-form' });
  assert.equal(h.node('#dialog').open, false);
  assert.equal(h.storage.size, 0);
});
test('Переключатели области раскрывают нужные поля, а неполный доступ отклоняется', () => {
  const h = harness();
  h.click({ action: 'create-user' });
  h.events.get('change')({ target: { dataset: { scope: 'p2' }, checked: true } });
  assert.equal(h.node('#scope-p2').hidden, false);
  h.events.get('change')({ target: { dataset: { mode: 'p2' }, value: 'specific' } });
  assert.equal(h.node('#scope-clients-p2').hidden, false);
  h.submit('user-form', { name: 'Демо', email: 'empty@demo.example', role: 'viewer', 'access-payer': ['p2'], 'scope-mode-p2': 'specific' });
  assert.match(h.node('#form-error').textContent, /Выберите получателей/);
  assert.equal(h.node('#dialog').open, true);
  assert.equal(h.storage.size, 0);
});

test('Все поверхности менеджерского интерфейса исключают заказы, включая старый журнал и маршруты', () => {
  const h = harness();
  const clean = value => assert.doesNotMatch(value, /Заказ|заказ|data-view="orders"|open-order|client-orders/);
  clean(h.node('#navigation').innerHTML); clean(h.node('#content').innerHTML);
  for (const view of ['payers', 'clients', 'users', 'log']) { h.click({ view }, 'view'); clean(h.node('#content').innerHTML); }
  h.click({ action: 'about' }); clean(h.node('#dialog').innerHTML); h.click({ action: 'close-dialog' });
  const before = h.node('#content').innerHTML;
  h.click({ view: 'orders' }, 'view'); h.click({ action: 'open-order', id: 'o1' });
  assert.equal(h.node('#content').innerHTML, before); assert.equal(h.node('#dialog').open, false);
  h.click({ action: 'open-payer', id: 'p1' }); clean(h.node('#content').innerHTML);
  h.click({ tab: 'orders' }, 'tab'); clean(h.node('#content').innerHTML);
});
