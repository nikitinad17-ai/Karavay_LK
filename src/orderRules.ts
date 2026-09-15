import { outletMinSum, piecesPerLot } from './utils';
import type { AppState, CartDetail, InvalidCartItem, Order, OrderItem, OrderSnapshot, Outlet, Product, ReviewData } from './types';

type QuantityProduct = Pick<Product, 'minOrder' | 'piecesPerLot' | 'lotOnly'> | Pick<OrderItem, 'minOrder' | 'piecesPerLot' | 'lotOnly'>;

export function quantityError(product: QuantityProduct | null | undefined, quantity: number): string {
  const qty = Number(quantity);
  if (!product || !Number.isInteger(qty) || qty <= 0) return 'Укажите целое количество больше нуля.';
  const minimum = Math.max(1, Number(product.minOrder) || 1);
  if (qty < minimum) return 'Минимальное количество: ' + minimum + ' шт.';
  const perLot = piecesPerLot(product);
  if (product.lotOnly && qty % perLot !== 0) return 'Товар отгружается только полными лотками по ' + perLot + ' шт.';
  return '';
}

export function normalizeCartDetail(product: Product, lots: number, pieces: number): CartDetail & { total: number } {
  const safeLots = Math.max(0, Math.floor(Number(lots) || 0));
  const safePieces = product && product.lotOnly ? 0 : Math.max(0, Math.floor(Number(pieces) || 0));
  return {
    lots: safeLots,
    pcs: safePieces,
    total: safeLots * piecesPerLot(product) + safePieces,
  };
}

export function reviewData(state: Pick<AppState, 'cart' | 'products' | 'buyer' | 'orderDate' | 'matrixLoading' | 'matrixError'>, outlet: Outlet | null): ReviewData {
  const cart = state.cart || {};
  const products = state.products || [];
  const invalidCart: InvalidCartItem[] = [];
  const items = Object.keys(cart).map((pid) => {
    const product = products.find((candidate) => candidate.id === Number(pid));
    const quantity = Number(cart[pid]);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) {
      invalidCart.push({ pid: Number(pid), error: 'В корзине есть недоступная позиция.' });
      return null;
    }
    const error = quantityError(product, quantity);
    if (error) invalidCart.push({ pid: product.id, product, error });
    return {
      p: product,
      qty: quantity,
      sum: Math.round(product.price * quantity * 100) / 100,
      error,
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const total = Math.round(items.reduce((sum, item) => sum + item.sum, 0) * 100) / 100;
  const minimum = outletMinSum(outlet, state.buyer);
  const missing = Math.max(0, Math.round((minimum - total) * 100) / 100);
  const baseReady = Boolean(items.length && outlet && state.orderDate && !state.matrixLoading && !state.matrixError);
  return {
    items,
    total,
    units: items.reduce((sum, item) => sum + item.qty, 0),
    outlet,
    minimum,
    missing,
    invalidCart,
    canReview: baseReady && items.length === Object.keys(cart).length,
    canSubmit: baseReady && items.length === Object.keys(cart).length && !missing && invalidCart.length === 0,
  };
}

export function cloneOrder<T extends Order | null>(order: T): T {
  if (!order) return order;
  return {
    ...order,
    items: order.items == null ? order.items : order.items.map((item) => ({ ...item })),
  } as T;
}

export function orderWithItemQuantity(order: Order, itemId: number, quantity: number): Order {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const items = (order.items || []).map((item) => {
    if (String(item.id_prd) !== String(itemId)) return { ...item };
    return { ...item, qty, sum: Math.round(qty * item.price * 100) / 100 };
  });
  return {
    ...order,
    items,
    totalUnits: items.reduce((sum, item) => sum + item.qty, 0),
    total: Math.round(items.reduce((sum, item) => sum + (item.sum ?? item.qty * item.price), 0) * 100) / 100,
  };
}

export function orderItemsEqual(order: Order | null, snapshot: OrderSnapshot | null): boolean {
  if (!order || !snapshot || !order.items) return false;
  if (order.items.length !== snapshot.items.length) return false;
  return order.items.every((item, index) => snapshot.items[index] && item.qty === snapshot.items[index].qty);
}
