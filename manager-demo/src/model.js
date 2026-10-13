(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaravayDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MANAGER_ID = 'manager-demo';
  const VERSION = 2;
  const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const copy = value => JSON.parse(JSON.stringify(value));
  const requireValue = (value, label, max = 160) => {
    const text = String(value || '').trim();
    if (!text) throw new Error('Укажите ' + label + '.');
    if (text.length > max) throw new Error('Поле «' + label + '» слишком длинное.');
    return text;
  };
  function seed() {
    const payers = [
      { id: 'p1', id_pay: 90101, kod_pay: 'DEMO-P-001', name_pay: 'ООО «Северная лавка»', phone: '+7 (000) 100-01-01', contact_email: 'sever@demo.example', contact: 'Анна Демина', active: true, segment: 'Розничная сеть' },
      { id: 'p2', id_pay: 90102, kod_pay: 'DEMO-P-002', name_pay: 'ООО «Невский маркет»', phone: '+7 (000) 100-02-02', contact_email: 'nevsky@demo.example', contact: 'Игорь Волков', active: true, segment: 'Розничная сеть' },
      { id: 'p3', id_pay: 90103, kod_pay: 'DEMO-P-003', name_pay: 'ИП Орлова Е. А.', phone: '+7 (000) 100-03-03', contact_email: 'orlova@demo.example', contact: 'Елена Орлова', active: true, segment: 'Магазин у дома' },
      { id: 'p4', id_pay: 90104, kod_pay: 'DEMO-P-004', name_pay: 'ООО «Утренний кофе»', phone: '+7 (000) 100-04-04', contact_email: 'coffee@demo.example', contact: 'Павел Крылов', active: true, segment: 'Кафе и пекарни' },
      { id: 'foreign', id_pay: 99999, kod_pay: 'FOREIGN-P', name_pay: 'Тест изоляции — другой менеджер', active: true },
      { id: 'inactive', id_pay: 99998, kod_pay: 'INACTIVE-P', name_pay: 'Тест неактивного покупателя', active: false }
    ];
    const clients = [
      { id: 'c1', payer: 'p1', id_clt: 90201, kod_clt: 'DEMO-C-001', name_clt: 'Северная лавка · Васильевский', address: 'Санкт-Петербург, 7-я линия В. О., 24', email: 'vo@demo.example', contact: 'Ольга Миронова', phone: '+7 (000) 200-01-01', days: 'Пн, Ср, Пт', active: true },
      { id: 'c2', payer: 'p1', id_clt: 90202, kod_clt: 'DEMO-C-002', name_clt: 'Северная лавка · Петроградская', address: 'Санкт-Петербург, Большой пр. П. С., 38', email: 'ps@demo.example', contact: 'Антон Котов', phone: '+7 (000) 200-02-02', days: 'Ежедневно', active: true },
      { id: 'c3', payer: 'p1', id_clt: 90203, kod_clt: 'DEMO-C-003', name_clt: 'Северная лавка · Приморская', address: 'Санкт-Петербург, ул. Кораблестроителей, 12', email: 'prim@demo.example', contact: 'Ирина Павлова', phone: '+7 (000) 200-03-03', days: 'Вт, Чт, Сб', active: true },
      { id: 'c4', payer: 'p2', id_clt: 90204, kod_clt: 'DEMO-C-004', name_clt: 'Невский маркет · Лиговский', address: 'Санкт-Петербург, Лиговский пр., 74', email: 'lig@demo.example', contact: 'Игорь Волков', phone: '+7 (000) 200-04-04', days: 'Ежедневно', active: true },
      { id: 'c5', payer: 'p2', id_clt: 90205, kod_clt: 'DEMO-C-005', name_clt: 'Невский маркет · Московский', address: 'Санкт-Петербург, Московский пр., 119', email: 'mos@demo.example', contact: 'Алла Полякова', phone: '+7 (000) 200-05-05', days: 'Пн, Ср, Пт', active: true },
      { id: 'c6', payer: 'p3', id_clt: 90206, kod_clt: 'DEMO-C-006', name_clt: 'Магазин «У дома»', address: 'Санкт-Петербург, ул. Бабушкина, 42', email: 'shop@demo.example', contact: 'Елена Орлова', phone: '+7 (000) 200-06-06', days: 'Пн, Вт, Чт, Сб', active: true },
      { id: 'c7', payer: 'p4', id_clt: 90207, kod_clt: 'DEMO-C-007', name_clt: 'Утренний кофе · Центр', address: 'Санкт-Петербург, ул. Марата, 16', email: 'center@demo.example', contact: 'Павел Крылов', phone: '+7 (000) 200-07-07', days: 'Ежедневно', active: true },
      { id: 'c8', payer: 'p4', id_clt: 90208, kod_clt: 'DEMO-C-008', name_clt: 'Утренний кофе · Парк', address: 'Санкт-Петербург, ул. Заставская, 8', email: 'park@demo.example', contact: 'Вера Семина', phone: '+7 (000) 200-08-08', days: 'Вт, Чт, Сб', active: true },
      { id: 'foreign-client', payer: 'foreign', name_clt: 'Чужой получатель', active: true },
      { id: 'inactive-client', payer: 'p1', id_clt: null, kod_clt: 'DEMO-C-009', name_clt: 'Северная лавка · Резерв', address: 'Санкт-Петербург, тестовый адрес, 9', email: 'reserve@demo.example', contact: 'Анна Демина', phone: '+7 (000) 200-09-09', days: 'Пн, Ср, Пт', active: false }
    ];
    const users = [
      { id: MANAGER_ID, name: 'Мария Соколова', email: 'manager@demo.example', role: 'manager', active: true },
      { id: 'u1', name: 'Анна Демина', email: 'anna@demo.example', role: 'owner', active: true, must_change_password: false, last_seen: 'Сегодня, 09:42' },
      { id: 'u2', name: 'Ольга Миронова', email: 'olga@demo.example', role: 'manager', active: true, must_change_password: false, last_seen: 'Сегодня, 08:17' },
      { id: 'u3', name: 'Игорь Волков', email: 'igor@demo.example', role: 'owner', active: true, must_change_password: false, last_seen: 'Вчера, 17:03' },
      { id: 'u4', name: 'Елена Орлова', email: 'elena@demo.example', role: 'owner', active: true, must_change_password: true, last_seen: 'Первый вход ожидается' },
      { id: 'u5', name: 'Павел Крылов', email: 'pavel@demo.example', role: 'owner', active: true, must_change_password: false, last_seen: 'Сегодня, 10:05' },
      { id: 'foreign-user', name: 'Чужой пользователь', email: 'foreign@demo.example', role: 'owner', active: true }
    ];
    const rights = payers.filter(p => /^p\d+$/.test(p.id)).map(p => ({ id: 'r-m-' + p.id, user: MANAGER_ID, payer: p.id, client: '', active: true })).concat([
      { id: 'r1', user: 'u1', payer: 'p1', client: '', active: true },
      { id: 'r2', user: 'u2', payer: 'p1', client: 'c1', active: true },
      { id: 'r3', user: 'u3', payer: 'p2', client: '', active: true },
      { id: 'r4', user: 'u4', payer: 'p3', client: '', active: true },
      { id: 'r5', user: 'u5', payer: 'p4', client: '', active: true },
      { id: 'r6', user: 'u5', payer: 'p3', client: 'c6', active: true },
      { id: 'rf', user: 'foreign-user', payer: 'foreign', client: '', active: true }
    ]);
    const products = [
      { name: 'Батон нарезной, 400 г', code: 'DEMO-SKU-01', price: 54, qty: 60 },
      { name: 'Хлеб Дарницкий, 700 г', code: 'DEMO-SKU-02', price: 69, qty: 36 },
      { name: 'Булочка с маком, 100 г', code: 'DEMO-SKU-03', price: 32, qty: 48 }
    ];
    const statuses = ['accepted', 'routed', 'onway', 'shipped', 'accepted', 'shipped', 'routed', 'accepted'];
    const orders = clients.filter(c => /^c\d+$/.test(c.id)).map((c, i) => {
      const items = products.map((p, n) => ({ ...p, qty: p.qty + i * (n + 1) * 6 }));
      return { id: 'o' + (i + 1), orderNumber: 10241 + i, payer: c.payer, client: c.id, deliveryDate: i < 3 ? '2026-10-11' : '2026-10-10', createdAt: '2026-10-10T08:' + String(12 + i * 5).padStart(2, '0') + ':00', status: statuses[i], items, note: i === 0 ? 'Приёмка с 07:00 до 10:00. Позвонить перед доставкой.' : 'Стандартная поставка.', source: 'Личный кабинет' };
    });
    orders.push({ id: 'foreign-order', orderNumber: 99999, payer: 'foreign', client: 'foreign-client', status: 'accepted', items: products, deliveryDate: '2026-10-10' });
    return { version: VERSION, managerId: MANAGER_ID, roles: ['owner', 'manager', 'viewer'].map(code => ({ code_role: code, active: true })), payers, clients, users, rights, orders, resets: [], activities: [{ id: 'a1', time: '2026-10-10T10:05:00', type: 'order', text: 'Заказ №10248 принят', detail: 'Утренний кофе · Парк' }, { id: 'a2', time: '2026-10-10T09:42:00', type: 'user', text: 'Анна Демина вошла в кабинет', detail: 'Северная лавка' }, { id: 'a3', time: '2026-10-10T08:30:00', type: 'user', text: 'Ожидается первый вход', detail: 'Елена Орлова · ИП Орлова Е. А.' }] };
  }
  function activeIdentity(db, userId) {
    const user = db.users.find(u => u.id === userId);
    return user && user.active && !user.must_change_password && db.roles.some(r => r.code_role === user.role && r.active);
  }
  function payersFor(db, userId = db.managerId) {
    if (!activeIdentity(db, userId)) return [];
    return db.payers.filter(p => p.active && db.rights.some(r => r.user === userId && r.payer === p.id && r.active && (!r.client || db.clients.some(c => c.id === r.client && c.payer === p.id && c.active))));
  }
  function clientsFor(db, payerId = '', userId = db.managerId) {
    const allowed = new Set(payersFor(db, userId).map(p => p.id));
    return db.clients.filter(c => c.active && allowed.has(c.payer) && (!payerId || c.payer === payerId) && db.rights.some(r => r.user === userId && r.active && r.payer === c.payer && (!r.client || r.client === c.id)));
  }
  function ordersFor(db, payerId = '', clientId = '', userId = db.managerId) {
    const clients = new Map(clientsFor(db, payerId, userId).map(c => [c.id, c]));
    return db.orders.filter(o => clients.has(o.client) && clients.get(o.client).payer === o.payer && (!clientId || o.client === clientId));
  }
  function usersFor(db, payerId = '') {
    const payers = new Set(payersFor(db).filter(p => !payerId || p.id === payerId).map(p => p.id));
    const clients = new Set(clientsFor(db, payerId).map(c => c.id));
    return db.users.filter(u => u.id !== db.managerId && db.rights.some(r => r.user === u.id && r.active && payers.has(r.payer) && (!r.client || clients.has(r.client) && db.clients.find(c => c.id === r.client)?.payer === r.payer)));
  }
  // Administrative visibility keeps inactive assigned records available for recovery.
  // Business visibility above remains fail-closed and is a separate calculation.
  function managedPayers(db) {
    if (!activeIdentity(db, db.managerId)) return [];
    const user = db.users.find(u => u.id === db.managerId);
    if (!['manager', 'owner'].includes(user.role)) return [];
    return db.payers.filter(p => db.rights.some(r => r.user === db.managerId && r.active && r.payer === p.id && (!r.client || db.clients.some(c => c.id === r.client && c.payer === p.id))));
  }
  function managedClients(db, payerId = '') {
    const payers = new Set(managedPayers(db).map(p => p.id));
    return db.clients.filter(c => payers.has(c.payer) && (!payerId || c.payer === payerId) && db.rights.some(r => r.user === db.managerId && r.active && r.payer === c.payer && (!r.client || r.client === c.id)));
  }
  function managedOrders(db, payerId = '', clientId = '') {
    const clients = new Map(managedClients(db, payerId).map(c => [c.id, c]));
    return db.orders.filter(o => clients.has(o.client) && clients.get(o.client).payer === o.payer && (!clientId || o.client === clientId));
  }
  function managedUsers(db, payerId = '') {
    if (!activeIdentity(db, db.managerId) || !['owner', 'manager'].includes(db.users.find(u => u.id === db.managerId)?.role)) return [];
    const payers = new Set(managedPayers(db).filter(p => !payerId || p.id === payerId).map(p => p.id));
    const clients = new Map(managedClients(db, payerId).map(c => [c.id, c]));
    return db.users.filter(u => u.id !== db.managerId && ((!payerId && u.created_by === db.managerId && activeIdentity(db, db.managerId)) || db.rights.some(r => r.user === u.id && payers.has(r.payer) && (!r.client || clients.get(r.client)?.payer === r.payer))));
  }
  function businessStatus(db, kind, id) {
    const record = db[kind].find(r => r.id === id);
    if (!record) return { active: false, reason: 'Запись недоступна' };
    if (!record.active) return { active: false, reason: 'Отключён' };
    if (kind === 'payers') return { active: true, reason: 'Активен' };
    if (kind === 'clients') return db.payers.some(p => p.id === record.payer && p.active) ? { active: true, reason: 'Активен' } : { active: false, reason: 'Покупатель отключён' };
    if (!db.roles.some(r => r.code_role === record.role && r.active)) return { active: false, reason: 'Роль недоступна' };
    if (db.resets.some(r => r.user === id && r.status === 'pending')) return { active: !record.must_change_password && payersFor(db, id).length > 0, reason: 'Ожидает сброса' };
    if (record.must_change_password) return { active: false, reason: 'Первый вход' };
    return payersFor(db, id).length ? { active: true, reason: 'Активен' } : { active: false, reason: 'Нет действующего доступа' };
  }
  function requireManager(db) {
    const u = db.users.find(u => u.id === db.managerId);
    if (!activeIdentity(db, db.managerId) || !['manager', 'owner'].includes(u.role)) throw new Error('Действие недоступно для этой роли.');
  }
  function requirePayer(db, id) {
    const p = payersFor(db).find(p => p.id === id);
    if (!p) throw new Error('Покупатель недоступен.');
    return p;
  }
  function requireManagedPayer(db, id) {
    const p = managedPayers(db).find(p => p.id === id);
    if (!p) throw new Error('Покупатель недоступен.');
    return p;
  }
  function requireFullPayer(db, id) {
    const p = requireManagedPayer(db, id);
    if (!db.rights.some(r => r.user === db.managerId && r.payer === id && r.active && !r.client)) throw new Error('Нужен доступ ко всем получателям покупателя.');
    return p;
  }
  function requireManagedUser(db, id) {
    const user = managedUsers(db).find(u => u.id === id);
    if (!user) throw new Error('Пользователь недоступен.');
    const ownPayers = new Set(managedPayers(db).map(p => p.id));
    const ownClients = new Map(managedClients(db).map(c => [c.id, c.payer]));
    const fullPayers = new Set(db.rights.filter(r => r.user === db.managerId && r.active && !r.client).map(r => r.payer));
    if (db.rights.some(r => r.user === id && (!ownPayers.has(r.payer) || !fullPayers.has(r.payer) && (!r.client || ownClients.get(r.client) !== r.payer)))) throw new Error('Общая учётная запись выходит за вашу область администрирования.');
    return user;
  }
  function addActivity(db, type, text, detail) {
    return [{ id: uid('activity'), type, text, detail, actor: db.users.find(u => u.id === db.managerId)?.name || 'Менеджер', time: new Date().toISOString() }, ...db.activities].slice(0, 100);
  }
  function createPayer(db, input) {
    requireManager(db);
    const record = { id: uid('payer'), id_pay: null, ...payerFields(db, input), active: true, segment: 'Новый покупатель' };
    const next = { ...db, payers: [...db.payers, record], rights: [...db.rights, { id: uid('right'), user: db.managerId, payer: record.id, client: '', active: true }], activities: addActivity(db, 'payer', 'Создан покупатель', record.name_pay) };
    return { db: next, record };
  }
  function createClient(db, input) {
    requireManager(db);
    const payer = requirePayer(db, input.payer);
    const record = { id: uid('client'), id_clt: null, ...clientFields(db, input), active: true };
    return { db: { ...db, clients: [...db.clients, record], activities: addActivity(db, 'client', 'Создан получатель', record.name_clt + ' · ' + payer.name_pay) }, record };
  }
  // Local fixtures represent existing KIS cards; this preview never calls KIS.
  function kisCandidates(db, payerId) {
    if (!managedPayers(db).some(p => p.id === payerId)) return [];
    const templates = [
      { id_clt: 90210, payer: 'p1', kod_clt: 'DEMO-C-010', name_clt: 'Северная лавка · Новая точка', address: 'Санкт-Петербург, тестовая улица, 10', email: 'new-point@demo.example', phone: '+7 (000) 200-10-10', contact: 'Тестовый контакт', days: 'Ежедневно' },
      { id_clt: 90211, payer: 'p2', kod_clt: 'DEMO-C-011', name_clt: 'Невский маркет · Новая точка', address: 'Санкт-Петербург, тестовая улица, 11', email: 'new-nevsky@demo.example', phone: '+7 (000) 200-11-11', contact: 'Тестовый контакт', days: 'Пн–Пт' }
    ];
    return templates.filter(c => c.payer === payerId && !db.clients.some(existing => existing.id_clt === c.id_clt));
  }
  function attachClient(db, input) {
    requireManager(db);
    const payer = requireFullPayer(db, input.payer);
    if (!payer.active) throw new Error('Покупатель отключён.');
    if (!/^[1-9]\d*$/.test(String(input.kis_client_id || ''))) throw new Error('Выберите получателя из КИС.');
    const card = kisCandidates(db, payer.id).find(c => c.id_clt === Number(input.kis_client_id));
    if (!card) throw new Error('Получатель недоступен, уже подключён или принадлежит другому покупателю.');
    const record = { ...card, id: uid('client'), active: true };
    return { db: { ...db, clients: [...db.clients, record], activities: addActivity(db, 'client', 'Подключён получатель из КИС · демонстрация', record.name_clt + ' · ' + payer.name_pay) }, record };
  }
  function payerFields(db, input, exceptId = '') {
    const name_pay = requireValue(input.name_pay, 'наименование');
    const kod_pay = requireValue(input.kod_pay, 'код покупателя', 40);
    const contact_email = requireValue(input.contact_email, 'email').toLowerCase();
    if (!emailOK(contact_email)) throw new Error('Укажите корректный email.');
    if (db.payers.some(p => p.id !== exceptId && String(p.kod_pay).toLowerCase() === kod_pay.toLowerCase())) throw new Error('Этот код покупателя уже используется.');
    const inn = String(input.inn || '').trim();
    if (inn && !/^\d{10}(\d{2})?$/.test(inn)) throw new Error('ИНН должен содержать 10 или 12 цифр.');
    return { name_pay, kod_pay, contact_email, inn, phone: requireValue(input.phone, 'телефон', 40), contact: requireValue(input.contact, 'контактное лицо') };
  }
  function updatePayer(db, id, input) {
    requireManager(db); const old = requireFullPayer(db, id);
    const record = { ...old, ...payerFields(db, input, id) };
    return { db: { ...db, payers: db.payers.map(p => p.id === id ? record : p), activities: addActivity(db, 'payer', 'Изменён покупатель', record.name_pay) }, record };
  }
  function clientFields(db, input, exceptId = '') {
    const payer = requireFullPayer(db, input.payer);
    const name_clt = requireValue(input.name_clt, 'наименование');
    const kod_clt = requireValue(input.kod_clt, 'код получателя', 40);
    const email = requireValue(input.email, 'контактный email').toLowerCase();
    if (!emailOK(email)) throw new Error('Укажите корректный email.');
    if (db.clients.some(c => c.id !== exceptId && String(c.kod_clt || '').toLowerCase() === kod_clt.toLowerCase())) throw new Error('Этот код получателя уже используется.');
    return { payer: payer.id, name_clt, kod_clt, email, address: requireValue(input.address, 'адрес доставки', 240), phone: requireValue(input.phone, 'телефон', 40), contact: requireValue(input.contact, 'контактное лицо'), days: requireValue(input.days, 'дни доставки', 40) };
  }
  function updateClient(db, id, input) {
    requireManager(db);
    const old = managedClients(db).find(c => c.id === id);
    if (!old) throw new Error('Получатель недоступен.');
    requireFullPayer(db, old.payer);
    const fields = clientFields(db, input, id);
    const moved = fields.payer !== old.payer;
    if (moved) throw new Error('Перепривязка этой точки недоступна. Выберите получателя нужного покупателя из КИС.');
    const record = { ...old, ...fields };
    return { db: { ...db, clients: db.clients.map(c => c.id === id ? record : c), activities: addActivity(db, 'client', 'Изменён получатель', record.name_clt) }, record };
  }
  function accessFields(db, input, userId) {
    if (!Array.isArray(input.accesses) || !input.accesses.length) throw new Error('Назначьте хотя бы одного покупателя.');
    const seen = new Set(); const rights = [];
    for (const access of input.accesses) {
      const p = requireManagedPayer(db, access.payer);
      if (seen.has(p.id)) throw new Error('Покупатель указан дважды.');
      seen.add(p.id);
      if (access.allClients) {
        requireFullPayer(db, p.id);
        rights.push({ id: uid('right'), user: userId, payer: p.id, client: '', active: true });
      } else {
        if (!Array.isArray(access.clients) || !access.clients.length) throw new Error('Выберите получателей для ' + p.name_pay + '.');
        const allowed = new Set(managedClients(db, p.id).map(c => c.id));
        for (const id of new Set(access.clients)) {
          if (!allowed.has(id)) throw new Error('Получатель не принадлежит выбранному покупателю или недоступен.');
          rights.push({ id: uid('right'), user: userId, payer: p.id, client: id, active: true });
        }
      }
    }
    return rights;
  }
  function userFields(db, input, exceptId = '') {
    const name = requireValue(input.name, 'имя пользователя');
    const email = requireValue(input.email, 'email для входа').toLowerCase();
    if (!emailOK(email)) throw new Error('Укажите корректный email.');
    if (db.users.some(u => u.id !== exceptId && u.email.toLowerCase() === email)) throw new Error('Пользователь с таким email уже существует.');
    if (!db.roles.some(r => r.code_role === input.role && r.active)) throw new Error('Выберите активную роль.');
    return { name, email, role: input.role };
  }
  function createUser(db, input) {
    requireManager(db);
    const record = { id: uid('user'), ...userFields(db, input), active: true, must_change_password: true, created_by: db.managerId, last_seen: 'Первый вход ожидается' };
    const rights = accessFields(db, input, record.id);
    return { db: { ...db, users: [...db.users, record], rights: [...db.rights, ...rights], activities: addActivity(db, 'user', 'Создан пользователь', record.name + ' · назначено покупателей: ' + input.accesses.length) }, record };
  }
  function updateUser(db, id, input) {
    requireManager(db); const old = requireManagedUser(db, id);
    const fields = userFields(db, input, id); const rights = accessFields(db, input, id);
    const emailChanged = old.email !== fields.email;
    const record = { ...old, ...fields, must_change_password: emailChanged || old.must_change_password };
    return { db: { ...db, users: db.users.map(u => u.id === id ? record : u), rights: [...db.rights.filter(r => r.user !== id), ...rights], resets: emailChanged ? db.resets.map(r => r.user === id && r.status === 'pending' ? { ...r, status: 'cancelled' } : r) : db.resets, activities: addActivity(db, 'user', 'Изменён пользователь и его доступы', record.name) }, record };
  }
  function setActive(db, kind, id, active) {
    requireManager(db);
    if (typeof active !== 'boolean') throw new Error('Некорректный статус.');
    let old;
    if (kind === 'payers') old = requireFullPayer(db, id);
    else if (kind === 'clients') { old = managedClients(db).find(c => c.id === id); if (old) requireFullPayer(db, old.payer); }
    else if (kind === 'users') old = requireManagedUser(db, id);
    if (!old) throw new Error('Запись недоступна.');
    const label = old.name_pay || old.name_clt || old.name;
    return { ...db, [kind]: db[kind].map(r => r.id === id ? { ...r, active } : r), resets: kind === 'users' && !active ? db.resets.map(r => r.user === id && r.status === 'pending' ? { ...r, status: 'cancelled' } : r) : db.resets, activities: addActivity(db, kind === 'payers' ? 'payer' : kind === 'clients' ? 'client' : 'user', (active ? 'Включён доступ' : 'Отключён доступ'), label) };
  }
  function requestReset(db, userId) {
    requireManager(db);
    const user = requireManagedUser(db, userId);
    if (!user || !user.active) throw new Error('Пользователь недоступен.');
    if (!emailOK(user.email)) throw new Error('Для сброса нужен корректный email пользователя.');
    if (db.resets.some(r => r.user === userId && r.status === 'pending')) throw new Error('Сценарий сброса уже запущен.');
    const record = { id: uid('reset'), user: userId, email: user.email, status: 'pending', createdAt: new Date().toISOString() };
    return { db: { ...db, resets: [...db.resets, record], activities: addActivity(db, 'reset', 'Запущен демо-сброс пароля', user.name) }, record };
  }
  function completeReset(db, resetId) {
    requireManager(db);
    const reset = db.resets.find(r => r.id === resetId && r.status === 'pending');
    if (!reset || !managedUsers(db).some(u => u.id === reset.user && u.active)) throw new Error('Сценарий сброса недоступен.');
    const user = db.users.find(u => u.id === reset.user);
    requireManagedUser(db, user.id);
    if (user.email !== reset.email) throw new Error('Email изменился. Запустите новый сценарий сброса.');
    return { ...db, resets: db.resets.map(r => r.id === resetId ? { ...r, status: 'completed', completedAt: new Date().toISOString() } : r), users: db.users.map(u => u.id === user.id ? { ...u, must_change_password: false } : u), activities: addActivity(db, 'reset', 'Демо-сброс пароля завершён', user.name) };
  }
  function total(order) { return order.items.reduce((sum, item) => sum + item.qty * item.price, 0); }
  function validate(saved) {
    return saved && saved.version === VERSION && saved.managerId === MANAGER_ID && ['roles', 'payers', 'clients', 'users', 'rights', 'orders', 'resets', 'activities'].every(k => Array.isArray(saved[k]));
  }
  function upgrade(saved) {
    if (validate(saved)) return saved;
    if (saved && saved.version === 1 && saved.managerId === MANAGER_ID && ['roles', 'payers', 'clients', 'users', 'rights', 'orders', 'resets', 'activities'].every(k => Array.isArray(saved[k]))) {
      const fixture = seed().clients.find(c => c.id === 'inactive-client');
      return { ...saved, version: VERSION, clients: saved.clients.map(c => c.id === 'inactive-client' ? fixture : c), rights: saved.rights.filter(r => !(r.user === MANAGER_ID && r.payer === 'inactive')) };
    }
    return null;
  }
  return { seed, copy, payersFor, clientsFor, ordersFor, usersFor, managedPayers, managedClients, managedOrders, managedUsers, businessStatus, createPayer, createClient, kisCandidates, attachClient, updatePayer, updateClient, createUser, updateUser, setActive, requestReset, completeReset, total, validate, upgrade, emailOK };
});
