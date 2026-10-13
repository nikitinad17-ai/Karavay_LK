const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../dist/model.js');
const payerInput = { name_pay: 'ООО «Тестовая пекарня»', kod_pay: 'DEMO-NEW-P', contact_email: 'test@demo.example', contact: 'Тестовый контакт', phone: '+7 (000) 123-45-67' };
const clientInput = { payer: 'p1', name_clt: 'Новая точка', kod_clt: 'DEMO-NEW-C', address: 'Тестовая улица, 1', email: 'point@demo.example', phone: '+7 (000) 123-45-67', contact: 'Контакт', days: 'Ежедневно' };

test('Менеджер видит только четыре назначенных покупателя, восемь получателей и восемь заказов', () => {
  const db = M.seed();
  assert.equal(M.payersFor(db).length, 4);
  assert.equal(M.clientsFor(db).length, 8);
  assert.equal(M.ordersFor(db).length, 8);
  assert.equal(M.usersFor(db).length, 5);
  assert.equal(M.clientsFor(db, 'foreign').length, 0);
  assert.equal(M.ordersFor(db, 'foreign').length, 0);
  assert.equal(M.usersFor(db, 'foreign').length, 0);
  assert.ok(!M.usersFor(db).some(u => u.id === 'foreign-user'));
});
test('Общее право открывает только активных получателей одного покупателя', () => {
  const db = M.seed();
  assert.deepEqual(M.payersFor(db, 'u1').map(p => p.id), ['p1']);
  assert.deepEqual(M.clientsFor(db, '', 'u1').map(c => c.id), ['c1', 'c2', 'c3']);
});
test('Конкретное право ограничивает получателя и его заказы', () => {
  const db = M.seed();
  assert.deepEqual(M.clientsFor(db, '', 'u2').map(c => c.id), ['c1']);
  assert.deepEqual(M.ordersFor(db, '', '', 'u2').map(o => o.id), ['o1']);
  db.rights.push({ id: 'bad', user: 'u2', payer: 'p1', client: 'c4', active: true });
  assert.deepEqual(M.clientsFor(db, '', 'u2').map(c => c.id), ['c1']);
  db.orders.push({ id: 'mismatch', payer: 'p2', client: 'c1', items: [] });
  assert.ok(!M.ordersFor(db).some(o => o.id === 'mismatch'));
});
test('Отзыв прав и неактивность каждого звена закрывают доступ', () => {
  for (const disable of [
    db => { db.users.find(u => u.id === db.managerId).active = false; },
    db => { db.roles.find(r => r.code_role === 'manager').active = false; },
    db => { db.users.find(u => u.id === db.managerId).role = 'unknown'; },
    db => { db.users.find(u => u.id === db.managerId).must_change_password = true; },
    db => { db.rights.filter(r => r.user === db.managerId).forEach(r => { r.active = false; }); }
  ]) { const db = M.seed(); disable(db); assert.equal(M.payersFor(db).length, 0); assert.equal(M.clientsFor(db).length, 0); assert.equal(M.ordersFor(db).length, 0); }
  const db = M.seed(); db.payers.find(p => p.id === 'p1').active = false;
  assert.equal(M.clientsFor(db, 'p1').length, 0);
  assert.equal(M.ordersFor(db, 'p1').length, 0);
  const db2 = M.seed(); db2.clients.find(c => c.id === 'c1').active = false;
  assert.ok(!M.ordersFor(db2).some(o => o.client === 'c1'));
});
test('Создание покупателя назначает его менеджеру, не создаёт учётную запись, не меняет исходные данные', () => {
  const db = M.seed(); const before = JSON.stringify(db);
  const result = M.createPayer(db, payerInput);
  assert.equal(JSON.stringify(db), before);
  assert.ok(M.payersFor(result.db).some(p => p.id === result.record.id));
  assert.equal(result.record.id_pay, null);
  assert.equal(result.db.users.length, db.users.length);
  const client = M.createClient(result.db, { ...clientInput, payer: result.record.id });
  assert.equal(client.record.payer, result.record.id);
  assert.ok(M.clientsFor(client.db, result.record.id).some(c => c.id === client.record.id));
});
test('Обязательные email, дубли кодов и чужие покупатели не допускаются', () => {
  const db = M.seed();
  for (const contact_email of ['', 'invalid']) assert.throws(() => M.createPayer(db, { ...payerInput, contact_email }));
  assert.throws(() => M.createPayer(db, { ...payerInput, kod_pay: ' demo-p-001 ' }), /уже используется/);
  assert.throws(() => M.createClient(db, { ...clientInput, payer: 'foreign' }), /недоступен/);
  assert.throws(() => M.createClient(db, { ...clientInput, payer: 'inactive' }), /недоступен/);
  assert.throws(() => M.createClient(db, { ...clientInput, kod_clt: 'DEMO-C-001' }), /уже используется/);
  assert.throws(() => M.createClient(db, { ...clientInput, email: 'invalid' }), /корректный email/);
  const restricted = M.seed(); restricted.managerId = 'u2';
  assert.throws(() => M.createClient(restricted, clientInput), /ко всем/);
});
test('Роль просмотра не может создавать записи или запускать сброс', () => {
  const db = M.seed(); db.users.find(u => u.id === db.managerId).role = 'viewer';
  assert.equal(M.payersFor(db).length, 4);
  assert.throws(() => M.createPayer(db, payerInput), /роли/);
  assert.throws(() => M.createClient(db, clientInput), /роли/);
  assert.throws(() => M.requestReset(db, 'u1'), /роли/);
});
test('Сброс работает для назначенного пользователя, защищён от повтора и завершается без паролей', () => {
  const db = M.seed(); const before = JSON.stringify(db);
  assert.throws(() => M.requestReset(db, 'foreign-user'), /недоступен/);
  const result = M.requestReset(db, 'u4');
  assert.equal(JSON.stringify(db), before);
  assert.equal(result.record.status, 'pending');
  assert.equal(result.record.email, 'elena@demo.example');
  assert.throws(() => M.requestReset(result.db, 'u4'), /уже запущен/);
  const next = M.completeReset(result.db, result.record.id);
  assert.equal(next.resets[0].status, 'completed');
  assert.equal(next.users.find(u => u.id === 'u4').must_change_password, false);
  assert.equal(result.db.users.find(u => u.id === 'u4').must_change_password, true);
  assert.throws(() => M.completeReset(next, result.record.id), /недоступен/);
  assert.ok(next.users.every(u => !Object.hasOwn(u, 'password')));
  assert.ok(next.resets.every(r => !Object.hasOwn(r, 'token')));
});
test('Отзыв доступа после запуска сброса блокирует завершение', () => {
  const result = M.requestReset(M.seed(), 'u1');
  result.db.rights.filter(r => r.user === result.db.managerId && r.payer === 'p1').forEach(r => { r.active = false; });
  assert.throws(() => M.completeReset(result.db, result.record.id), /недоступен/);
});
test('Итог заказа соответствует составу и демо-состояние проходит сериализацию', () => {
  const db = M.seed();
  assert.equal(M.total(db.orders[0]), 7260);
  assert.ok(M.validate(JSON.parse(JSON.stringify(db))));
  assert.ok(!M.validate({ version: 1 }));
  assert.ok(!M.validate({ ...db, version: 0 }));
});
