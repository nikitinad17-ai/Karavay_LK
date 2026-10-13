const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../dist/model.js');
const baseUser = { name: 'Тестовый пользователь', email: 'test@demo.example', role: 'viewer', accesses: [{ payer: 'p1', allClients: true }, { payer: 'p2', allClients: false, clients: ['c4'] }] };
const newClient = { payer: 'p1', name_clt: 'Новая точка', kod_clt: 'DEMO-TEST-C', address: 'Тестовая улица, 1', email: 'point@demo.example', phone: '000', contact: 'Тест', days: 'Ежедневно' };

test('Административный просмотр сохраняет отключённые записи и не раскрывает чужие', () => {
  const db = M.seed();
  assert.equal(M.managedPayers(db).length, 4);
  assert.equal(M.managedClients(db).length, 9);
  assert.ok(M.managedClients(db).some(c => c.id === 'inactive-client'));
  assert.ok(!M.managedPayers(db).some(p => ['foreign', 'inactive'].includes(p.id)));
  assert.ok(!M.managedUsers(db).some(u => u.id === 'foreign-user'));
});
test('Отключённый покупатель остаётся у менеджера, но закрывает бизнес-доступ дочерних точек', () => {
  const old = M.seed(); const before = JSON.stringify(old);
  const db = M.setActive(old, 'payers', 'p1', false);
  assert.equal(JSON.stringify(old), before);
  assert.equal(M.managedClients(db, 'p1').length, 4);
  assert.equal(M.managedOrders(db, 'p1').length, 3);
  assert.equal(M.clientsFor(db, 'p1').length, 0);
  assert.equal(M.ordersFor(db, 'p1').length, 0);
  assert.equal(M.businessStatus(db, 'clients', 'c1').reason, 'Покупатель отключён');
  const back = M.setActive(db, 'payers', 'p1', true);
  assert.equal(M.clientsFor(back, 'p1').length, 3);
  assert.equal(back.clients.find(c => c.id === 'inactive-client').active, false);
});
test('Включение получателя под отключённым покупателем не открывает клиентский доступ', () => {
  let db = M.setActive(M.seed(), 'payers', 'p1', false);
  db = M.setActive(db, 'clients', 'inactive-client', true);
  assert.equal(M.businessStatus(db, 'clients', 'inactive-client').active, false);
  assert.equal(M.clientsFor(db, 'p1').length, 0);
});
test('Пользователь получает разные области у нескольких покупателей и должен завершить первый вход', () => {
  const old = M.seed(), before = JSON.stringify(old);
  const result = M.createUser(old, baseUser);
  assert.equal(JSON.stringify(old), before);
  assert.equal(result.record.must_change_password, true);
  assert.equal(M.payersFor(result.db, result.record.id).length, 0);
  const reset = M.requestReset(result.db, result.record.id);
  const db = M.completeReset(reset.db, reset.record.id);
  assert.deepEqual(M.payersFor(db, result.record.id).map(p => p.id), ['p1', 'p2']);
  assert.deepEqual(M.clientsFor(db, '', result.record.id).map(c => c.id), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(M.ordersFor(db, '', '', result.record.id).length, 4);
});
test('Нельзя назначить чужого покупателя, несовпадающую точку или неизвестную роль', () => {
  const db = M.seed();
  assert.throws(() => M.createUser(db, { ...baseUser, accesses: [{ payer: 'foreign', allClients: true }] }), /недоступен/);
  assert.throws(() => M.createUser(db, { ...baseUser, accesses: [{ payer: 'p1', clients: ['c4'], allClients: false }] }), /не принадлежит/);
  assert.throws(() => M.createUser(db, { ...baseUser, role: 'admin' }), /роль/);
  assert.throws(() => M.createUser(db, { ...baseUser, accesses: [] }), /хотя бы/);
  assert.throws(() => M.createUser(db, { ...baseUser, accesses: [{ payer: 'p1', allClients: false, clients: [] }] }), /Выберите получателей/);
  assert.throws(() => M.createUser(db, { ...baseUser, email: 'ANNA@DEMO.EXAMPLE' }), /уже существует/);
});
test('Редактирование пользователя заменяет старые назначения без сохранения лишних прав', () => {
  const old = M.seed(); const before = JSON.stringify(old);
  const result = M.updateUser(old, 'u1', { name: 'Анна Демина', email: 'anna@demo.example', role: 'viewer', accesses: [{ payer: 'p2', allClients: false, clients: ['c5'] }] });
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(M.clientsFor(result.db, '', 'u1').map(c => c.id), ['c5']);
  assert.ok(!result.db.rights.some(r => r.user === 'u1' && r.payer === 'p1'));
  assert.equal(M.ordersFor(result.db, '', '', 'u1').length, 1);
});
test('Смена email отменяет незавершённый сброс и требует нового восстановления', () => {
  const reset = M.requestReset(M.seed(), 'u1');
  const changed = M.updateUser(reset.db, 'u1', { ...baseUser, name: 'Анна', email: 'new@demo.example' });
  assert.equal(changed.db.resets[0].status, 'cancelled');
  assert.equal(changed.record.must_change_password, true);
  assert.throws(() => M.completeReset(changed.db, reset.record.id), /недоступен/);
  const next = M.requestReset(changed.db, 'u1');
  assert.equal(next.record.email, 'new@demo.example');
});
test('Отключение пользователя отменяет сброс и запрещает последующие действия до включения', () => {
  const reset = M.requestReset(M.seed(), 'u1');
  const db = M.setActive(reset.db, 'users', 'u1', false);
  assert.equal(db.resets[0].status, 'cancelled');
  assert.equal(M.payersFor(db, 'u1').length, 0);
  assert.ok(M.managedUsers(db).some(u => u.id === 'u1'));
  assert.throws(() => M.requestReset(db, 'u1'), /недоступен/);
  assert.throws(() => M.completeReset(db, reset.record.id), /недоступен/);
  assert.equal(M.setActive(db, 'users', 'u1', true).users.find(u => u.id === 'u1').active, true);
});
test('Перепривязка получателя КИС отклоняется без изменения связей', () => {
  const db = M.seed(), before = JSON.stringify(db);
  const c = db.clients.find(c => c.id === 'c1');
  assert.throws(() => M.updateClient(db, c.id, { ...c, payer: 'p2', confirm_move: true }), /Перепривязка/);
  assert.equal(JSON.stringify(db), before);
});
test('Менеджер отдельной точки не меняет общую учётную запись с доступом к другим точкам', () => {
  const db = M.seed();
  db.rights = db.rights.filter(r => r.user !== db.managerId);
  db.rights.push({ id: 'restricted-manager', user: db.managerId, payer: 'p1', client: 'c1', active: true });
  assert.deepEqual(M.managedClients(db).map(c => c.id), ['c1']);
  assert.throws(() => M.setActive(db, 'users', 'u1', false), /область администрирования/);
  assert.throws(() => M.requestReset(db, 'u1'), /область администрирования/);
  assert.equal(M.setActive(db, 'users', 'u2', false).users.find(u => u.id === 'u2').active, false);
});
test('Подключение существующей карточки проверяет КИС ID, покупателя и дубли, сохраняя источник', () => {
  const db = M.seed(), before = JSON.stringify(db);
  const result = M.attachClient(db, { payer: 'p1', kis_client_id: '90210', name_clt: 'Подмена' });
  assert.equal(JSON.stringify(db), before);
  assert.equal(result.record.id_clt, 90210);
  assert.equal(result.record.name_clt, 'Северная лавка · Новая точка');
  assert.equal(result.record.payer, 'p1');
  assert.throws(() => M.attachClient(db, { payer: 'p2', kis_client_id: '90210' }), /другому покупателю/);
  assert.throws(() => M.attachClient(result.db, { payer: 'p1', kis_client_id: '90210' }), /уже подключён/);
  assert.throws(() => M.attachClient(db, { payer: 'foreign', kis_client_id: '90210' }), /недоступен/);
  assert.throws(() => M.attachClient(db, { payer: 'p1', kis_client_id: '90210.5' }), /Выберите/);
  assert.throws(() => M.updateClient(result.db, result.record.id, { ...result.record, payer: 'p2', confirm_move: true }), /Перепривязка/);
});
test('Редактирование покупателя и точки сохраняет ID и историю, проверяет реквизиты', () => {
  const old = M.seed();
  const result = M.updatePayer(old, 'p1', { ...old.payers[0], name_pay: 'Новое имя', inn: '1234567890' });
  assert.equal(result.record.id_pay, old.payers[0].id_pay);
  assert.equal(result.db.orders, old.orders);
  assert.throws(() => M.updatePayer(old, 'p1', { ...old.payers[0], inn: '123' }), /ИНН/);
  assert.throws(() => M.updateClient(old, 'c1', { ...old.clients[0], kod_clt: 'DEMO-C-004' }), /уже используется/);
  const point = M.updateClient(old, 'c1', { ...old.clients[0], address: 'Новый тестовый адрес' });
  assert.equal(point.record.id_clt, old.clients[0].id_clt);
  assert.equal(point.db.orders, old.orders);
});
test('Административные изменения недоступны чужим записям и роли просмотра', () => {
  const db = M.seed();
  assert.throws(() => M.setActive(db, 'payers', 'foreign', false));
  assert.throws(() => M.updateUser(db, 'foreign-user', baseUser));
  db.users.find(u => u.id === db.managerId).role = 'viewer';
  assert.equal(M.managedPayers(db).length, 0);
  assert.equal(M.managedUsers(db).length, 0);
  assert.throws(() => M.createUser(db, baseUser), /роли/);
  assert.throws(() => M.setActive(db, 'clients', 'c1', false), /роли/);
});
test('Обновление старого демо сохраняет созданные записи и результаты восстановления', () => {
  const old = M.createUser(M.seed(), baseUser).db; old.version = 1;
  const migrated = M.upgrade(old);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.users.length, old.users.length);
  assert.equal(migrated.users.at(-1).email, baseUser.email);
  assert.ok(M.validate(migrated));
  assert.equal(M.upgrade({ version: 0 }), null);
});
