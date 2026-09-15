import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  cloneOrder, normalizeCartDetail, orderItemsEqual, orderWithItemQuantity, quantityError, reviewData,
} from '../src/orderRules';
import { createRequestGate } from '../src/requestGate';
import { snapshotOrder } from '../src/utils';
import type { AppState, Order, Outlet, Product } from '../src/types';

const outlet: Outlet = {
  id: 1, id_clt: 1001, minOrderSum: 100, name: 'Точка', code: 'M-1', address: '', rep: null,
  days: [], daysLabel: '', phones: [], repPhone: null, receiver: null, dispatchPhone: null, dispatchPlatformName: null,
};
const products: Product[] = [
  { id: 1, code: 'P-1', name: 'Хлеб', category: 'Хлеб', weight: 0.5, price: 25, unit: 'шт', shelf: '3 сут.', piecesPerLot: 10, minOrder: 5, lotOnly: false, isPromo: false, oldPrice: null },
  { id: 2, code: 'P-2', name: 'Лоточный товар', category: 'Хлеб', weight: 0.5, price: 10, unit: 'шт', shelf: '3 сут.', piecesPerLot: 6, minOrder: 6, lotOnly: true, isPromo: false, oldPrice: null },
];

function state(cart: Record<string, number>): Pick<AppState, 'cart' | 'products' | 'buyer' | 'orderDate' | 'matrixLoading' | 'matrixError'> {
  return { cart, products, buyer: null, orderDate: '2026-09-14', matrixLoading: false, matrixError: '' };
}

test('проверка заказа содержит только выбранные позиции и единый итог', () => {
  const data = reviewData(state({ 1: 10, 2: 12 }), outlet);
  assert.equal(data.items.length, 2);
  assert.equal(data.units, 22);
  assert.equal(data.total, 370);
  assert.equal(data.canReview, true);
  assert.equal(data.canSubmit, true);
});

test('минимальная сумма не мешает открыть проверку, но блокирует отправку', () => {
  outlet.minOrderSum = 200;
  const belowMinimum = reviewData(state({ 1: 5 }), outlet);
  assert.equal(belowMinimum.canReview, true);
  assert.equal(belowMinimum.canSubmit, false);
  assert.equal(belowMinimum.missing, 75);
  outlet.minOrderSum = 100;
});

test('контролируются минимум товара и полные лотки', () => {
  assert.match(quantityError(products[0], 1), /Минимальное количество/);
  assert.equal(quantityError(products[0], 5), '');
  assert.match(quantityError(products[1], 7), /только полными лотками/);
  assert.equal(quantityError(products[1], 12), '');
  const invalid = reviewData(state({ 2: 7 }), outlet);
  assert.equal(invalid.canReview, true);
  assert.equal(invalid.canSubmit, false);
  assert.equal(invalid.invalidCart.length, 1);
});

test('ввод лоточного товара отбрасывает отдельные штуки', () => {
  assert.deepEqual(normalizeCartDetail(products[1], 2, 3), { lots: 2, pcs: 0, total: 12 });
  assert.deepEqual(normalizeCartDetail(products[0], 2, 3), { lots: 2, pcs: 3, total: 23 });
});

test('редактирование заказа создаёт новую структуру и не мутирует исходник', () => {
  const original: Order = {
    id: 7, orderNumber: 7, buyerId: 1, outletId: 1, outletCode: 'M-1', outletName: 'Точка', outletAddress: '',
    deliveryDate: '2026-09-14', createdAt: '2026-09-13T09:00:00.000Z', group: 1, totalUnits: 2, total: 50,
    state: 'Принят', status: 'accepted', pill: 'accepted', source: 'web',
    items: [{ id_prd: 1, code: 'P-1', name: 'Хлеб', qty: 2, price: 25, sum: 50, returned: 0, piecesPerLot: 10, lotOnly: false, minOrder: 1 }],
  };
  const snapshot = snapshotOrder(original);
  const copy = cloneOrder(original);
  const changed = orderWithItemQuantity(original, 1, 5);
  assert.equal(original.items?.[0].qty, 2);
  assert.notEqual(changed, original);
  assert.notEqual(changed.items, original.items);
  assert.equal(changed.items?.[0].qty, 5);
  assert.equal(changed.total, 125);
  assert.notEqual(copy, original);
  assert.equal(orderItemsEqual(original, snapshot), true);
  assert.equal(orderItemsEqual(changed, snapshot), false);
});

test('старый ответ запроса перестаёт считаться актуальным', () => {
  const gate = createRequestGate();
  const first = gate.begin('matrix');
  const second = gate.begin('matrix');
  assert.equal(gate.isLatest('matrix', first), false);
  assert.equal(gate.isLatest('matrix', second), true);
  const independent = gate.begin('buyer');
  assert.equal(gate.isLatest('buyer', independent), true);
});
