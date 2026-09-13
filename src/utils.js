// Портировано из app.js (vanilla-версия) — вся ПУРАЯ логика без DOM/render().
// Адаптеры adapt* оставлены как есть: интерфейс оперирует своими именами полей,
// смена схемы КИС затрагивает только их.

export const GROUPS = [
  { key: 1, label: 'Хлебобулочные' },
  { key: 0, label: 'Замороженные' },
];
export function groupLabel(g) {
  const f = GROUPS.find((x) => x.key === Number(g));
  return f ? f.label : '—';
}

export const ORDER_TYPES = [
  { key: 'all', label: 'Вся' },
  { key: 'in-cart', label: 'В заказе' },
  { key: 'promo', label: 'Акция' },
];

const STATE_MAP = {
  'Принят': { code: 'accepted', pill: 'accepted' },
  'Маршрутизирован': { code: 'routed', pill: 'picked' },
  'В пути': { code: 'onway', pill: 'shipped' },
  'Отгружен': { code: 'shipped', pill: 'delivered' },
  'Удален': { code: 'deleted', pill: 'cancelled' },
};
export function stateInfo(st) {
  return STATE_MAP[st] || { code: 'accepted', pill: 'accepted' };
}

export function unixToISO(t) {
  if (!t) return null;
  const d = new Date(Number(t) * 1000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function isoToUnix(iso) {
  if (!iso) return null;
  const a = String(iso).split('-').map(Number);
  return Math.floor(new Date(a[0], a[1] - 1, a[2]).getTime() / 1000);
}

// ================ АДАПТЕРЫ КИС → ИНТЕРФЕЙС ================
export function adaptPayer(k) {
  if (!k) return null;
  return {
    id: k.lk_id, Id_pay: k.Id_pay,
    code: k.KodPay, name: k.NamePay, legal: k.Adres,
    manager: k.Manager, managerPhone: k.lk_managerPhone,
    balance: k.SumOutSaldoCalc, minOrderSum: k.OrdLimitMinSum,
    shipmentRule: k.NamePRV,
    inn: k.lk_inn, segment: k.lk_segment,
    hasContract: k.lk_hasContract !== false,
    contractNumber: k.lk_contractNumber, contractDate: k.lk_contractDate,
    paymentDeferralDays: k.lk_paymentDeferralDays,
    email: k.lk_email, sinceYear: k.lk_sinceYear,
    shipmentMode: k.lk_shipmentMode,
    shipmentBlockReason: k.lk_shipmentBlockReason,
    shipmentEffective: k.lk_shipmentEffective,
    shipmentEffectiveReason: k.lk_shipmentEffectiveReason,
    shipmentEffectiveCause: k.lk_shipmentEffectiveCause,
    usesEdi: k.lk_usesEdi, ediClientCode: k.lk_ediClientCode,
    badges: k.lk_badges || [],
    outlets: (k.Clients || []).map(adaptClient),
  };
}
export function adaptClient(k) {
  if (!k) return null;
  return {
    id: k.lk_id, id_clt: k.id_clt,
    code: k.KodClt, name: k.NameClt, address: k.Adres,
    minOrderSum: k.OrdLimitMinSum, rep: k.TorgPred,
    days: k.lk_days || [], daysLabel: (k.ClientDayOfWeek || []).join(', '),
    phones: k.lk_phones || [], repPhone: k.lk_repPhone,
    receiver: k.lk_receiver,
    dispatchPhone: k.lk_dispatchPhone, dispatchPlatformName: k.lk_dispatchPlatformName,
  };
}
// Позиция матрицы: цена CenaOTP уже со скидкой, BaseCenaOTP — базовая
export function adaptProduct(r, baseDisc) {
  // Скидка по договору есть у всех позиций — это не акция.
  // Акцией считаем позицию, где ProcSkd заметно выше базовой скидки клиента.
  const promo = (r.ProcSkd || 0) > (baseDisc || 0) + 0.5;
  // ТЗ ver.3: MarketingGroup приходит с числовым префиксом порядка, напр. "2.Современные хлеба" —
  // используем его для стабильной сортировки категорий, а не для отображения
  const rawCat = r.MarketingGroup || '';
  const catM = /^(\d+)\.\s*(.+)$/.exec(rawCat);
  return {
    id: r.id_prd, id_prd: r.id_prd,
    code: r.KodProd, name: r.NameProd,
    category: catM ? catM[2] : rawCat,
    categoryOrder: catM ? Number(catM[1]) : 999,
    weight: r.Vesprod, shelf: r.Srok,
    unit: 'шт', piecesPerLot: r.KolUkl || 1,
    price: r.CenaOTP, oldPrice: r.BaseCenaOTP > r.CenaOTP ? r.BaseCenaOTP : null,
    isPromo: promo, discount: r.ProcSkd || 0,
    // ТЗ: пустой KolshtOrdmin — продукция грузится только лотками
    lotOnly: r.KolshtOrdmin == null,
    minOrder: r.KolshtOrdmin || r.KolUkl || 1,
    group: r.Group,
  };
}
export function adaptOrder(k) {
  const si = stateInfo(k.State);
  return {
    id: k.Id_ord, orderNumber: k.NumOrd,
    buyerId: k.lk_buyerId, outletId: k.lk_outletId,
    outletCode: k.KodClt, outletName: k.NameClt, outletAddress: k.Adres,
    deliveryDate: unixToISO(k.DateOrd),
    createdAt: k.DateOrdClt ? new Date(k.DateOrdClt * 1000).toISOString() : null,
    group: k.Group, totalUnits: k.KolSht, total: k.SumAll,
    state: k.State, status: si.code, pill: si.pill,
    source: k.lk_source, items: null, // позиции догружаются по /orders/{id}
  };
}
export function adaptItem(r) {
  const piecesInLot = r.lk_KolUkl || 1;
  const lotOnly = r.lk_lotOnly === true;
  return {
    id_prd: r.id_prd, code: r.KodProd, name: r.NameProd,
    price: r.CenaOTP, qty: r.Kolsht, returned: r.KolVzv || 0,
    sum: r.SumAll, piecesPerLot: piecesInLot,
    lotOnly,
    minOrder: r.lk_minOrder == null ? (lotOnly ? piecesInLot : 1) : r.lk_minOrder,
  };
}

// ================ ФОРМАТИРОВАНИЕ ================
export function esc(s) {
  // В React экранирование не нужно (JSX сам это делает) — оставлено для
  // мест, где текст собирается в обычную строку (напр. window.confirm).
  return String(s == null ? '' : s);
}
// Строку "YYYY-MM-DD" трактуем как локальную дату (без UTC-смещения)
export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
export function fmtDate(iso) {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateFull(s) {
  const d = parseDate(s);
  if (!d) return '—';
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) + ', ' + WD[d.getDay()];
}
export function fmtDateShort(s) {
  const d = parseDate(s);
  if (!d) return s ? String(s) : '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₽';
}
export function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}
export function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
export function sourceLabel(s) {
  return ({ web: 'Онлайн', voice: 'Голос', operator: 'Оператор', edi: 'EDI' })[s] || s;
}
export function shipmentModeLabel(m) {
  return ({ allowed: 'Отгрузка разрешена', blocked: 'Отгрузка запрещена', balance: 'По текущему сальдо' })[m] || m;
}
export function initials(name) {
  if (!name) return '';
  const parts = name.replace(/[«»""]/g, '').split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

// ================ API ================
export function api(path, opts) {
  return fetch(path, opts).then((r) => {
    // ТЗ ver.3: 204 (No Content) — тела нет вовсе, .json() на пустом теле упадёт
    if (r.status === 204) return {};
    return r.json().then((j) => {
      if (!r.ok) { j = j || {}; j._status = r.status; throw j; }
      return j;
    });
  });
}

// ================ ЛОТКИ ↔ ШТУКИ ================
export function piecesPerLot(p) { return p && p.piecesPerLot > 0 ? p.piecesPerLot : 1; }
// Лотки из штук — округляем вверх (приоритет у точного количества штук)
export function lotsFromPieces(p, pieces) {
  const ppl = piecesPerLot(p);
  return ppl > 0 ? Math.ceil((pieces || 0) / ppl) : 0;
}
export function totalPiecesFor(p, d) {
  return Math.max(0, Math.floor(d.lots || 0)) * piecesPerLot(p) + Math.max(0, Math.floor(d.pcs || 0));
}

export function isPromo(p) { return !!(p && p.isPromo); }
export function promoOldPrice(p) { return p && p.oldPrice > 0 ? p.oldPrice : null; }

// ================ ДАТЫ ОТГРУЗКИ ================
export function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function ruDowOf(d) { return (d.getDay() + 6) % 7; }
export function outletAcceptsDate(ol, d) {
  if (!ol || !ol.days || !ol.days.length) return true;
  return ol.days.indexOf(ruDowOf(d)) >= 0;
}
// Ближайшая дата, которую получатель принимает по ClientDayOfWeek.
// ТЗ не описывает отсечку, поэтому берём завтрашний день как первый возможный.
export function firstAllowedDate(ol) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    const t = new Date(d); t.setDate(t.getDate() + i);
    if (outletAcceptsDate(ol, t)) return isoOf(t);
  }
  return isoOf(new Date(d.getTime() + 86400000));
}
export function allowedDatesFor(ol, count) {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 21 && out.length < (count || 10); i++) {
    const t = new Date(d); t.setDate(t.getDate() + i);
    if (outletAcceptsDate(ol, t)) out.push(isoOf(t));
  }
  return out;
}

export function outletMinSum(outlet, buyer) {
  if (!outlet) return (buyer && buyer.minOrderSum) || 0;
  return outlet.minOrderSum != null ? outlet.minOrderSum : (buyer && buyer.minOrderSum) || 0;
}

// ТЗ (КИС): изменять и удалять заказ можно, пока он не маршрутизирован.
// Решение принимает КИС — на 422 показываем текст из ответа. Клиентская
// проверка нужна только чтобы не показывать заведомо бесполезные кнопки.
export function canCancelOrder(o) {
  if (!o) return { ok: false, reason: '' };
  if (o.status === 'deleted') return { ok: false, reason: 'Заказ уже удалён.' };
  if (o.status !== 'accepted') {
    return { ok: false, reason: 'Заказ маршрутизирован, изменения запрещены. Свяжитесь с менеджером.' };
  }
  return { ok: true, reason: '' };
}

// Снапшот заказа при редактировании в статусе «Принят»
export function snapshotOrder(o) {
  if (!o || !o.items) return null;
  return {
    items: o.items.map((it) => ({ qty: it.qty, sum: it.sum, price: it.price, code: it.code, id_prd: it.id_prd })),
    totalUnits: o.totalUnits,
    total: o.total,
  };
}
export function orderChanged(o, snap) {
  if (!o || !snap || !o.items) return false;
  if (o.items.length !== snap.items.length) return true;
  for (let i = 0; i < o.items.length; i++) {
    const a = o.items[i]; const b = snap.items[i];
    if (!b) return true;
    if (a.qty !== b.qty) return true;
  }
  return false;
}

export function orderItemLots(it) { return Math.floor((it.qty || 0) / (it.piecesPerLot || 1)); }
export function orderItemPcs(it) { return (it.qty || 0) % (it.piecesPerLot || 1); }

const DEVICE_KEY = 'karavay_device_code';
export function getDeviceCode() { try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; } }
export function setDeviceCode(code) { try { localStorage.setItem(DEVICE_KEY, code); } catch {} }
export function clearDeviceCode() { try { localStorage.removeItem(DEVICE_KEY); } catch {} }
