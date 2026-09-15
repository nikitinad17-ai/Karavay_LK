// Портировано из app.js (vanilla-версия) — вся ПУРАЯ логика без DOM/render().
// Адаптеры adapt* оставлены как есть: интерфейс оперирует своими именами полей,
// смена схемы КИС затрагивает только их.

import type {
  ApiErrorPayload, Buyer, CartDetail, KisClient, KisOrder, KisOrderItem, KisPayer, KisProduct,
  Order, OrderItem, OrderPill, OrderSnapshot, OrderStatus, Outlet, Product, ShipmentMode,
} from './types';

export const GROUPS: ReadonlyArray<{ key: 0 | 1; label: string }> = [
  { key: 1, label: 'Хлебобулочные' },
  { key: 0, label: 'Замороженные' },
];
export function groupLabel(g: number | string | null | undefined): string {
  const f = GROUPS.find((x) => x.key === Number(g));
  return f ? f.label : '—';
}

export const ORDER_TYPES = [
  { key: 'all', label: 'Вся' },
  { key: 'in-cart', label: 'В заказе' },
  { key: 'promo', label: 'Акция' },
] as const;

const STATE_MAP: Record<string, { code: OrderStatus; pill: OrderPill }> = {
  'Принят': { code: 'accepted', pill: 'accepted' },
  'Маршрутизирован': { code: 'routed', pill: 'picked' },
  'В пути': { code: 'onway', pill: 'shipped' },
  'Отгружен': { code: 'shipped', pill: 'delivered' },
  'Удален': { code: 'deleted', pill: 'cancelled' },
};
export function stateInfo(st: string | null | undefined): { code: OrderStatus; pill: OrderPill } {
  return STATE_MAP[st || ''] || { code: 'accepted', pill: 'accepted' };
}

export function unixToISO(t: number | string | null | undefined): string | null {
  if (!t) return null;
  const d = new Date(Number(t) * 1000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function isoToUnix(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const a = String(iso).split('-').map(Number);
  return Math.floor(new Date(a[0], a[1] - 1, a[2]).getTime() / 1000);
}

// ================ АДАПТЕРЫ КИС → ИНТЕРФЕЙС ================
export function adaptPayer(k: KisPayer): Buyer {
  return {
    id: k.lk_id, Id_pay: k.Id_pay,
    code: k.KodPay, name: k.NamePay, legal: k.Adres,
    manager: k.Manager || null, managerPhone: k.lk_managerPhone || null,
    balance: k.SumOutSaldoCalc || 0, minOrderSum: k.OrdLimitMinSum || 0,
    shipmentRule: k.NamePRV || null,
    inn: k.lk_inn || null, segment: k.lk_segment || null,
    hasContract: k.lk_hasContract !== false,
    contractNumber: k.lk_contractNumber || null, contractDate: k.lk_contractDate || null,
    paymentDeferralDays: k.lk_paymentDeferralDays || 0,
    email: k.lk_email || null, sinceYear: k.lk_sinceYear || null,
    shipmentMode: k.lk_shipmentMode || 'allowed',
    shipmentBlockReason: k.lk_shipmentBlockReason || null,
    shipmentEffective: k.lk_shipmentEffective || 'allowed',
    shipmentEffectiveReason: k.lk_shipmentEffectiveReason || null,
    shipmentEffectiveCause: k.lk_shipmentEffectiveCause || null,
    usesEdi: Boolean(k.lk_usesEdi), ediClientCode: k.lk_ediClientCode || null,
    badges: k.lk_badges || [],
    outlets: (k.Clients || []).map(adaptClient),
  };
}
export function adaptClient(k: KisClient): Outlet {
  return {
    id: k.lk_id, id_clt: k.id_clt,
    code: k.KodClt, name: k.NameClt, address: k.Adres,
    minOrderSum: k.OrdLimitMinSum, rep: k.TorgPred || null,
    days: k.lk_days || [], daysLabel: (k.ClientDayOfWeek || []).join(', '),
    phones: k.lk_phones || [], repPhone: k.lk_repPhone || null,
    receiver: k.lk_receiver || null,
    dispatchPhone: k.lk_dispatchPhone || null, dispatchPlatformName: k.lk_dispatchPlatformName || null,
  };
}
// Позиция матрицы: цена CenaOTP уже со скидкой, BaseCenaOTP — базовая
export function adaptProduct(r: KisProduct, baseDisc: number): Product {
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
    weight: r.Vesprod || 0, shelf: r.Srok || '',
    unit: 'шт', piecesPerLot: r.KolUkl || 1,
    price: r.CenaOTP, oldPrice: (r.BaseCenaOTP || 0) > r.CenaOTP ? r.BaseCenaOTP || null : null,
    isPromo: promo, discount: r.ProcSkd || 0,
    // ТЗ: пустой KolshtOrdmin — продукция грузится только лотками
    lotOnly: r.KolshtOrdmin == null,
    minOrder: r.KolshtOrdmin || r.KolUkl || 1,
    group: r.Group,
  };
}
export function adaptOrder(k: KisOrder): Order {
  const si = stateInfo(k.State);
  return {
    id: k.Id_ord, orderNumber: k.NumOrd,
    buyerId: k.lk_buyerId, outletId: k.lk_outletId,
    outletCode: k.KodClt || '', outletName: k.NameClt || '', outletAddress: k.Adres || '',
    deliveryDate: unixToISO(k.DateOrd),
    createdAt: k.DateOrdClt ? new Date(k.DateOrdClt * 1000).toISOString() : null,
    group: k.Group ?? 1, totalUnits: k.KolSht || 0, total: k.SumAll || 0,
    state: k.State, status: si.code, pill: si.pill,
    source: k.lk_source || null, items: null, // позиции догружаются по /orders/{id}
  };
}
export function adaptItem(r: KisOrderItem): OrderItem {
  const piecesInLot = r.lk_KolUkl || 1;
  const lotOnly = r.lk_lotOnly === true;
  return {
    id_prd: r.id_prd, code: r.KodProd || String(r.id_prd), name: r.NameProd || '',
    price: r.CenaOTP || 0, qty: r.Kolsht || 0, returned: r.KolVzv || 0,
    sum: r.SumAll || 0, piecesPerLot: piecesInLot,
    lotOnly,
    minOrder: r.lk_minOrder == null ? (lotOnly ? piecesInLot : 1) : r.lk_minOrder,
  };
}

// ================ ФОРМАТИРОВАНИЕ ================
export function esc(s: unknown): string {
  // В React экранирование не нужно (JSX сам это делает) — оставлено для
  // мест, где текст собирается в обычную строку (напр. window.confirm).
  return String(s == null ? '' : s);
}
// Строку "YYYY-MM-DD" трактуем как локальную дату (без UTC-смещения)
export function parseDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtDate(iso: string | Date | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateFull(s: string | Date | null | undefined): string {
  const d = parseDate(s);
  if (!d) return '—';
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) + ', ' + WD[d.getDay()];
}
export function fmtDateShort(s: string | Date | null | undefined): string {
  const d = parseDate(s);
  if (!d) return s ? String(s) : '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₽';
}
export function fmtMoneyShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
export function sourceLabel(s: string | null | undefined): string {
  const labels: Record<string, string> = { web: 'Онлайн', voice: 'Голос', operator: 'Оператор', edi: 'EDI' };
  return labels[s || ''] || s || '—';
}
export function shipmentModeLabel(m: ShipmentMode | null | undefined): string {
  const labels: Record<ShipmentMode, string> = { allowed: 'Отгрузка разрешена', blocked: 'Отгрузка запрещена', balance: 'По текущему сальдо' };
  return m ? labels[m] : '—';
}
export function initials(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.replace(/[«»""]/g, '').split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

// ================ API ================
function asApiError(value: unknown, status: number): ApiErrorPayload {
  const payload: ApiErrorPayload = value && typeof value === 'object' ? { ...(value as ApiErrorPayload) } : {};
  payload._status = status;
  return payload;
}

export function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  return fetch(path, opts).then((r) => {
    // ТЗ ver.3: 204 (No Content) — тела нет вовсе, .json() на пустом теле упадёт
    if (r.status === 204) return {} as T;
    return r.json().then((j: unknown) => {
      if (!r.ok) throw asApiError(j, r.status);
      return j as T;
    });
  });
}

// ================ ЛОТКИ ↔ ШТУКИ ================
export function piecesPerLot(p: Pick<Product, 'piecesPerLot'> | Pick<OrderItem, 'piecesPerLot'> | null | undefined): number { return p && p.piecesPerLot > 0 ? p.piecesPerLot : 1; }
// Лотки из штук — округляем вверх (приоритет у точного количества штук)
export function lotsFromPieces(p: Pick<Product, 'piecesPerLot'>, pieces: number): number {
  const ppl = piecesPerLot(p);
  return ppl > 0 ? Math.ceil((pieces || 0) / ppl) : 0;
}
export function totalPiecesFor(p: Pick<Product, 'piecesPerLot'>, d: CartDetail): number {
  return Math.max(0, Math.floor(d.lots || 0)) * piecesPerLot(p) + Math.max(0, Math.floor(d.pcs || 0));
}

export function isPromo(p: Product | null | undefined): boolean { return Boolean(p?.isPromo); }
export function promoOldPrice(p: Product | null | undefined): number | null { return p?.oldPrice && p.oldPrice > 0 ? p.oldPrice : null; }

// ================ ДАТЫ ОТГРУЗКИ ================
export function isoOf(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function ruDowOf(d: Date): number { return (d.getDay() + 6) % 7; }
export function outletAcceptsDate(ol: Outlet | null | undefined, d: Date | null): boolean {
  if (!d) return false;
  if (!ol || !ol.days || !ol.days.length) return true;
  return ol.days.indexOf(ruDowOf(d)) >= 0;
}
// Ближайшая дата, которую получатель принимает по ClientDayOfWeek.
// ТЗ не описывает отсечку, поэтому берём завтрашний день как первый возможный.
export function firstAllowedDate(ol: Outlet | null | undefined): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    const t = new Date(d); t.setDate(t.getDate() + i);
    if (outletAcceptsDate(ol, t)) return isoOf(t);
  }
  return isoOf(new Date(d.getTime() + 86400000));
}
export function allowedDatesFor(ol: Outlet | null | undefined, count = 10): string[] {
  const out: string[] = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 21 && out.length < (count || 10); i++) {
    const t = new Date(d); t.setDate(t.getDate() + i);
    if (outletAcceptsDate(ol, t)) out.push(isoOf(t));
  }
  return out;
}

export function outletMinSum(outlet: Outlet | null | undefined, buyer: Buyer | null | undefined): number {
  if (!outlet) return (buyer && buyer.minOrderSum) || 0;
  return outlet.minOrderSum != null ? outlet.minOrderSum : (buyer && buyer.minOrderSum) || 0;
}

// ТЗ (КИС): изменять и удалять заказ можно, пока он не маршрутизирован.
// Решение принимает КИС — на 422 показываем текст из ответа. Клиентская
// проверка нужна только чтобы не показывать заведомо бесполезные кнопки.
export function canCancelOrder(o: Order | null | undefined): { ok: boolean; reason: string } {
  if (!o) return { ok: false, reason: '' };
  if (o.status === 'deleted') return { ok: false, reason: 'Заказ уже удалён.' };
  if (o.status !== 'accepted') {
    return { ok: false, reason: 'Заказ маршрутизирован, изменения запрещены. Свяжитесь с менеджером.' };
  }
  return { ok: true, reason: '' };
}

// Снапшот заказа при редактировании в статусе «Принят»
export function snapshotOrder(o: Order | null | undefined): OrderSnapshot | null {
  if (!o || !o.items) return null;
  return {
    items: o.items.map((it) => ({ qty: it.qty, sum: it.sum, price: it.price, code: it.code, id_prd: it.id_prd })),
    totalUnits: o.totalUnits,
    total: o.total,
  };
}
export function orderChanged(o: Order | null | undefined, snap: OrderSnapshot | null | undefined): boolean {
  if (!o || !snap || !o.items) return false;
  if (o.items.length !== snap.items.length) return true;
  for (let i = 0; i < o.items.length; i++) {
    const a = o.items[i]; const b = snap.items[i];
    if (!b) return true;
    if (a.qty !== b.qty) return true;
  }
  return false;
}

export function orderItemLots(it: OrderItem): number { return Math.floor((it.qty || 0) / (it.piecesPerLot || 1)); }
export function orderItemPcs(it: OrderItem): number { return (it.qty || 0) % (it.piecesPerLot || 1); }

const DEVICE_KEY = 'karavay_device_code';
export function getDeviceCode() { try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; } }
export function setDeviceCode(code: string) { try { localStorage.setItem(DEVICE_KEY, code); } catch {} }
export function clearDeviceCode() { try { localStorage.removeItem(DEVICE_KEY); } catch {} }
