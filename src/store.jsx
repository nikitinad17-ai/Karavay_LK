import { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import {
  api, adaptPayer, adaptClient, adaptOrder, adaptProduct, adaptItem,
  firstAllowedDate, isoToUnix, getDeviceCode, setDeviceCode, clearDeviceCode,
  piecesPerLot, snapshotOrder, stateInfo, outletAcceptsDate, parseDate,
  fmtMoney, fmtMoneyShort, fmtDateShort,
} from './utils.js';
import {
  cloneOrder, normalizeCartDetail, orderItemsEqual, orderWithItemQuantity, quantityError, reviewData,
} from './orderRules.js';
import { createRequestGate } from './requestGate.js';

// Форма state — 1:1 с исходным объектом state из app.js (vanilla), чтобы
// перенос экранов был максимально механическим.
const initialState = {
  buyer: null,
  role: null,
  outlets: [],
  currentOutletId: null,
  profileOutletId: null,
  products: [],
  baseDiscount: 0,
  ordersAll: [],
  documents: [],
  cart: {},
  cartDetails: {},
  categories: [],
  filter: 'all',
  route: 'login',
  loading: false,
  toast: null,
  modalOrder: null,
  editSnapshot: null,
  productSearch: '',
  deviceClient: null,
  prefillCode: '',
  confirm: null,
  filtersOpen: false,
  ordersOutletFilter: 'all',
  orderGroup: 1,
  orderDate: null,
  matrixLoading: false,
  matrixError: null,
  detailsCache: {},
  orderReady: false,
  setupLastOrder: null,
  setupLastOrderOutlet: null,
  reviewOpen: false,
  reviewError: '',
  submittingOrder: false,
  initialLoadError: '',
  orderEditError: '',
};

// Один общий PATCH-экшен покрывает почти все переходы (как в vanilla-версии,
// где просто менялось state.x и звался render()) — это осознанное упрощение,
// а не Redux-стиль на 40 экшенов под каждую мелочь.
function reducer(state, action) {
  switch (action.type) {
    case 'PATCH':
      return { ...state, ...action.payload };
    case 'LOGOUT':
      return { ...initialState, deviceClient: state.deviceClient, prefillCode: state.prefillCode };
    default:
      return state;
  }
}

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const requestGateRef = useRef(null);
  if (!requestGateRef.current) requestGateRef.current = createRequestGate();
  // patch — короткая обёртка над dispatch({type:'PATCH', payload}). Синхронно
  // мержим и в stateRef тоже: dispatch применяется асинхронно (на следующий
  // рендер), а getState() внутри действий (login → loadBuyerData и т.п.)
  // должен видеть свежее значение СРАЗУ после patch(), а не после коммита React.
  const patch = useCallback((payload) => {
    stateRef.current = { ...stateRef.current, ...payload };
    dispatch({ type: 'PATCH', payload });
  }, []);
  // На каждый рендер синхронизируем ref с «официальным» React-стейтом — после
  // коммита оба пути (наш мерж и reducer) дают одинаковый результат.
  stateRef.current = state;
  const getState = useCallback(() => stateRef.current, []);
  const beginRequest = useCallback((key) => {
    return requestGateRef.current.begin(key);
  }, []);
  const isLatestRequest = useCallback((key, id) => requestGateRef.current.isLatest(key, id), []);
  const value = { state, patch, dispatch, getState, beginRequest, isLatestRequest };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore должен использоваться внутри <StoreProvider>');
  return ctx;
}

// ================ ТОСТЫ ================
let toastTimer = null;
export function useToast() {
  const { patch } = useStore();
  return useCallback((msg, type) => {
    patch({ toast: { msg, type: type || '' } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => patch({ toast: null }), 3200);
  }, [patch]);
}

// ================ ЗАГРУЗКА ДАННЫХ КИС ================
// Вынесено в независимые функции (а не методы компонентов), т.к. в оригинале
// это тоже были свободные функции, вызывающие render() — здесь вместо
// render() дёргаем patch(getState()).

export function currentOutletOf(state) {
  if (!state.currentOutletId) return null;
  return state.outlets.find((o) => o.id === state.currentOutletId) || null;
}

// Последний заказ по точке — для дашборда «Мои точки»/«Профиль», где уже загружена
// вся история покупателя одним запросом; дёргать API на каждую точку было бы избыточно.
export function lastOrderForOutlet(state, outletId) {
  return (state.ordersAll || []).find((o) => o.outletId === outletId) || null;
}

export function useLoaders() {
  const { patch, getState, beginRequest, isLatestRequest } = useStore();

  const loadMatrix = useCallback(() => {
    const state = getState();
    const ol = currentOutletOf(state);
    if (!ol || !ol.id_clt || !state.orderDate) { patch({ products: [] }); return; }
    const requestId = beginRequest('matrix');
    const requestKey = [ol.id_clt, state.orderDate, Number(state.orderGroup)].join(':');
    patch({ matrixLoading: true, matrixError: null });
    const url = '/api/v1/clients/' + ol.id_clt + '/matrix?DateOrd=' + isoToUnix(state.orderDate) + '&Group=' + state.orderGroup;
    return api(url).then((resp) => {
      const latest = getState();
      const latestOutlet = currentOutletOf(latest);
      const latestKey = latestOutlet ? [latestOutlet.id_clt, latest.orderDate, Number(latest.orderGroup)].join(':') : '';
      if (!isLatestRequest('matrix', requestId) || latestKey !== requestKey) return;
      const rows = resp.Product || [];
      const baseDisc = rows.length ? Math.min(...rows.map((r) => r.ProcSkd || 0)) : 0;
      const products = rows.map((r) => adaptProduct(r, baseDisc));
      // При смене точки/даты/группы часть корзины может исчезнуть из матрицы
      const ids = {}; products.forEach((p) => { ids[p.id] = 1; });
      const cur = getState();
      const cart = { ...cur.cart }; const cartDetails = { ...cur.cartDetails };
      let dropped = 0;
      Object.keys(cart).forEach((pid) => { if (!ids[pid]) { delete cart[pid]; delete cartDetails[pid]; dropped++; } });
      Object.keys(cart).forEach((pid) => {
        if (cartDetails[pid]) return;
        const product = products.find((candidate) => candidate.id === Number(pid));
        if (!product) return;
        const quantity = Number(cart[pid]) || 0;
        const perLot = piecesPerLot(product);
        if (product.lotOnly && quantity % perLot !== 0) {
          delete cart[pid];
          dropped++;
          return;
        }
        cartDetails[pid] = product.lotOnly
          ? { lots: quantity / perLot, pcs: 0 }
          : { lots: Math.floor(quantity / perLot), pcs: quantity % perLot };
      });
      patch({ products, baseDiscount: baseDisc, matrixLoading: false, cart, cartDetails });
      if (dropped) {
        patch({ toast: { msg: 'Из корзины убрано позиций: ' + dropped + ' — их нет в матрице на эту дату', type: 'error' } });
      }
    }).catch((err) => {
      if (!isLatestRequest('matrix', requestId)) return;
      patch({ products: [], matrixLoading: false, matrixError: (err && err.detail) || 'Не удалось получить матрицу продукции' });
    });
  }, [patch, getState, beginRequest, isLatestRequest]);

  const loadBuyerData = useCallback(() => {
    const state = getState();
    if (!state.buyer) return;
    const requestId = beginRequest('buyer');
    const buyerId = state.buyer.id;
    patch({ loading: true, initialLoadError: '' });
    const idPay = state.buyer.Id_pay, bid = state.buyer.id;
    return Promise.all([
      api('/api/v1/payers/' + idPay + '/orders'),
      api('/api/buyers/' + bid + '/documents').catch(() => []),
    ]).then(([ordersResp, docs]) => {
      if (!isLatestRequest('buyer', requestId) || getState().buyer?.id !== buyerId) return;
      let ordersAll = (ordersResp.Orders || []).map(adaptOrder);
      const cur = getState();
      if (cur.role === 'outlet') {
        ordersAll = ordersAll.filter((o) => o.outletId === cur.currentOutletId);
      }
      const patchObj = { ordersAll, documents: docs || [], loading: false };
      if (!cur.orderDate) patchObj.orderDate = firstAllowedDate(currentOutletOf(cur));
      patch(patchObj);
      return loadMatrix();
    }).catch((err) => {
      if (!isLatestRequest('buyer', requestId)) return;
      patch({
        loading: false,
        initialLoadError: (err && err.detail) || 'Не удалось загрузить данные кабинета. Проверьте соединение и повторите попытку.',
      });
    });
  }, [patch, getState, loadMatrix, beginRequest, isLatestRequest]);

  const refreshSetupLastOrder = useCallback((ol) => {
    const state = getState();
    const idClt = ol && ol.id_clt;
    if (!idClt) { patch({ setupLastOrder: null, setupLastOrderOutlet: null }); return; }
    if (state.setupLastOrderOutlet === idClt) return; // уже загружено для этой точки
    const requestId = beginRequest('lastOrder');
    patch({ setupLastOrderOutlet: idClt, setupLastOrder: 'loading' });
    return api('/api/v1/clients/' + idClt + '/orders?last=1').then((resp) => {
      if (!isLatestRequest('lastOrder', requestId) || currentOutletOf(getState())?.id_clt !== idClt) return;
      const list = resp.Orders || [];
      patch({ setupLastOrder: list.length ? adaptOrder(list[0]) : null });
    }).catch(() => {
      if (isLatestRequest('lastOrder', requestId)) patch({ setupLastOrder: null });
    });
  }, [patch, getState, beginRequest, isLatestRequest]);

  return { loadBuyerData, loadMatrix, refreshSetupLastOrder };
}

// ================ АВТОРИЗАЦИЯ ================
export function useAuth() {
  const { patch, getState } = useStore();
  const { loadBuyerData } = useLoaders();

  const applyLoginResponse = useCallback((resp) => {
    const buyer = adaptPayer(resp.payer);
    const patchObj = { role: resp.role, buyer, route: 'dashboard', orderReady: false };
    if (resp.role === 'buyer') {
      patchObj.outlets = (buyer && buyer.outlets) || [];
      patchObj.currentOutletId = resp.enteredOutletId || (patchObj.outlets[0] && patchObj.outlets[0].id) || null;
    } else {
      const one = adaptClient(resp.client);
      patchObj.outlets = [one];
      patchObj.currentOutletId = one.id;
    }
    patch(patchObj);
    // loadBuyerData читает getState() внутри setTimeout(0), чтобы patch успел примениться
    setTimeout(loadBuyerData, 0);
  }, [patch, loadBuyerData]);

  const login = useCallback((code, password, remember) => {
    return api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password }) })
      .then((resp) => {
        applyLoginResponse(resp);
        if (remember !== false) setDeviceCode(code);
      });
  }, [applyLoginResponse]);

  const doLogout = useCallback(() => {
    clearDeviceCode();
    try { sessionStorage.removeItem('karavay_pending_login'); } catch {}
    patch({ ...initialState, deviceClient: null, prefillCode: '' });
  }, [patch]);

  const logout = useCallback(() => {
    const state = getState();
    const hasCart = Object.keys(state.cart || {}).length > 0;
    if (!hasCart) { doLogout(); return; }
    patch({
      confirm: {
        title: 'Выйти из кабинета?',
        body: 'В корзине есть добавленные позиции. Если выйдете сейчас, корзина будет очищена.',
        okText: 'Выйти', cancelText: 'Остаться', danger: true,
        onOk: doLogout,
      },
    });
  }, [getState, patch, doLogout]);

  return { login, logout, doLogout, applyLoginResponse, getDeviceCode };
}

// ================ КОРЗИНА: лотки/штуки ================
export function useCart() {
  const { patch, getState } = useStore();

  const cartDetail = useCallback((pid) => getState().cartDetails[pid] || { lots: 0, pcs: 0 }, [getState]);

  const setCartDetail = useCallback((p, lots, pcs) => {
    const state = getState();
    const pid = p.id;
    const normalized = normalizeCartDetail(p, lots, pcs);
    const total = normalized.total;
    const cart = { ...state.cart }; const cartDetails = { ...state.cartDetails };
    if (total === 0) { delete cart[pid]; delete cartDetails[pid]; }
    else { cart[pid] = total; cartDetails[pid] = { lots: normalized.lots, pcs: normalized.pcs }; }
    patch({ cart, cartDetails });
    return total;
  }, [getState, patch]);

  // cart -> cartDetails: если в cart[pid] есть число, а details нет — разбиваем
  // по-умному (макс лотков, остаток — в штуки). Нужно после повтора заказа/импорта.
  const syncCartDetails = useCallback(() => {
    const state = getState();
    const cart = { ...state.cart };
    const cartDetails = { ...state.cartDetails };
    Object.keys(state.cart).forEach((pidStr) => {
      const pid = Number(pidStr);
      if (cartDetails[pid]) return;
      const p = state.products.find((x) => x.id === pid);
      if (!p) return;
      const q = state.cart[pid] || 0;
      if (p.lotOnly) {
        const ppl = piecesPerLot(p);
        const lots = Math.floor(q / ppl);
        const remainder = q % ppl;
        cartDetails[pid] = { lots, pcs: 0 };
        if (remainder) {
          delete cart[pid];
          delete cartDetails[pid];
        }
      } else {
        const ppl = piecesPerLot(p);
        const lotsFull = ppl > 0 ? Math.floor(q / ppl) : 0;
        cartDetails[pid] = { lots: lotsFull, pcs: q - lotsFull * ppl };
      }
    });
    Object.keys(cartDetails).forEach((pidStr) => {
      if (!state.cart[Number(pidStr)]) delete cartDetails[Number(pidStr)];
    });
    patch({ cart, cartDetails });
  }, [getState, patch]);

  const applyOrderToCart = useCallback((order) => {
    const cart = {};
    (order.items || []).forEach((it) => { cart[it.id_prd] = it.qty; });
    patch({ cart, cartDetails: {} });
    setTimeout(syncCartDetails, 0);
  }, [patch, syncCartDetails]);

  return { cartDetail, setCartDetail, syncCartDetails, applyOrderToCart };
}

// Ошибки КИС приходят в поле detail; below_min_sum — отдельный случай с суммой
function kisError(err, fallback) {
  if (!err) return fallback;
  if (err.lk_error === 'below_min_sum') {
    return 'Сумма ниже минимальной для получателя: ' + fmtMoneyShort(err.lk_minSum) + '.';
  }
  return err.detail || fallback;
}

// ================ ДЕЙСТВИЯ НАД ЗАКАЗАМИ (модалка, отправка, правка, отмена, повтор) ================
export function useOrderActions() {
  const { patch, getState } = useStore();
  const toast = useToast();
  const { loadMatrix, refreshSetupLastOrder } = useLoaders();
  const { applyOrderToCart } = useCart();

  // Позиции заказа: GET /api/v1/orders/{id_ord}. cb(order) — когда позиции точно загружены
  // (нужен для «Повторить последний заказ», где дальше сразу открываем прайс-лист)
  const loadOrderDetails = useCallback((o, cb) => {
    if (!o) return;
    if (o.items) { if (cb) cb(cloneOrder(o)); return Promise.resolve(cloneOrder(o)); }
    const state = getState();
    if (state.detailsCache[o.id]) {
      const cachedOrder = { ...o, items: state.detailsCache[o.id].map((item) => ({ ...item })) };
      patch({ modalOrder: state.modalOrder && state.modalOrder.id === o.id ? cloneOrder(cachedOrder) : state.modalOrder });
      if (cb) cb(cloneOrder(cachedOrder));
      return Promise.resolve(cachedOrder);
    }
    return api('/api/v1/orders/' + o.id).then((resp) => {
      const items = (resp.Product || []).map(adaptItem);
      const loadedOrder = { ...o, items: items.map((item) => ({ ...item })) };
      const cur = getState();
      const detailsCache = { ...cur.detailsCache, [o.id]: items.map((item) => ({ ...item })) };
      const patchObj = { detailsCache };
      if (cur.modalOrder && cur.modalOrder.id === o.id) {
        patchObj.modalOrder = cloneOrder(loadedOrder);
        if (!cur.editSnapshot && o.status === 'accepted') patchObj.editSnapshot = snapshotOrder(loadedOrder);
      }
      patch(patchObj);
      if (cb) cb(cloneOrder(loadedOrder));
      return loadedOrder;
    }).catch(() => {
      const failedOrder = { ...o, items: [] };
      const cur = getState();
      if (cur.modalOrder && cur.modalOrder.id === o.id) {
        patch({ modalOrder: failedOrder, orderEditError: 'Не удалось загрузить позиции заказа.' });
      }
      if (cb) cb(cloneOrder(failedOrder));
      return failedOrder;
    });
  }, [getState, patch]);

  // Открыть модалку заказа (клик по строке в Истории/на Обзоре) + лениво догрузить позиции
  const openOrderModal = useCallback((o) => {
    if (!o) return;
    const editSnapshot = (o.status === 'accepted' && o.items) ? snapshotOrder(o) : null;
    patch({ modalOrder: cloneOrder(o), editSnapshot, orderEditError: '' });
    loadOrderDetails(o);
  }, [patch, loadOrderDetails]);

  const discardOrderEdits = useCallback(() => {
    patch({ modalOrder: null, editSnapshot: null, orderEditError: '' });
  }, [patch]);

  const closeOrderModal = useCallback(() => {
    const state = getState();
    if (!state.modalOrder) return;
    const hasEdits = Boolean(state.editSnapshot && !orderItemsEqual(state.modalOrder, state.editSnapshot));
    if (!hasEdits) { discardOrderEdits(); return; }
    patch({
      confirm: {
        title: 'Отменить несохранённые правки?',
        body: 'Количество позиций изменено, но корректировка ещё не отправлена.',
        okText: 'Отменить правки', cancelText: 'Продолжить редактирование', danger: true,
        onOk: discardOrderEdits,
      },
    });
  }, [getState, patch, discardOrderEdits]);

  // Правка позиции в открытой модалке (степперы Лотки/Штуки или обычный +/-)
  const applyOrderItemQty = useCallback((order, it, newQty) => {
    patch({ modalOrder: orderWithItemQuantity(order, it.id_prd, newQty), orderEditError: '' });
  }, [patch]);

  // ТЗ: PUT /api/v1/orders/{id_ord} — Product[{Id_prd, KolSht}]. 422 — заказ уже маршрутизирован.
  const saveOrderEdits = useCallback((o, snap) => {
    if (!o) return;
    const invalidQuantity = (o.items || []).filter((it) => it.qty > 0).map((it) => quantityError(it, it.qty)).find(Boolean);
    if (invalidQuantity) { patch({ orderEditError: invalidQuantity }); toast(invalidQuantity, 'error'); return; }
    const products = (o.items || []).filter((it) => it.qty > 0).map((it) => ({ Id_prd: it.id_prd, KolSht: it.qty }));
    if (!products.length) { toast('В заказе должна остаться хотя бы одна позиция.', 'error'); return; }
    patch({ orderEditError: '' });
    return api('/api/v1/orders/' + o.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Product: products }) })
      .then((resp) => {
        const si = stateInfo(resp.State);
        const saved = {
          ...cloneOrder(o), totalUnits: resp.KolSht, total: resp.SumAll,
          state: resp.State, status: si.code, pill: si.pill,
        };
        const cur = getState();
        const ordersAll = cur.ordersAll.map((x) => (x.id === saved.id ? cloneOrder(saved) : x));
        patch({
          detailsCache: { ...cur.detailsCache, [saved.id]: saved.items.map((item) => ({ ...item })) },
          modalOrder: null, editSnapshot: null, orderEditError: '', ordersAll,
        });
        toast('Заказ №' + saved.orderNumber + ' изменён. Сумма ' + fmtMoney(saved.total), 'success');
      }).catch((err) => {
        const message = kisError(err, 'Не удалось изменить заказ. Правки сохранены на экране — попробуйте ещё раз.');
        patch({ orderEditError: message });
        toast(message, 'error');
      });
  }, [getState, patch, toast]);

  // ТЗ: DELETE /api/v1/orders/{id_ord}
  const cancelOrder = useCallback((o) => {
    if (!o) return;
    return api('/api/v1/orders/' + o.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
      .then((resp) => {
        const si = stateInfo(resp.State);
        const cancelled = { ...cloneOrder(o), state: resp.State, status: si.code, pill: si.pill };
        const cur = getState();
        const ordersAll = cur.ordersAll.map((x) => (x.id === cancelled.id ? cloneOrder(cancelled) : x));
        patch({ modalOrder: cancelled, editSnapshot: null, orderEditError: '', ordersAll });
        toast('Заказ №' + cancelled.orderNumber + ' удалён.', 'success');
      }).catch((err) => {
        toast(kisError(err, 'Не удалось удалить заказ.'), 'error');
      });
  }, [getState, patch, toast]);

  const askCancelOrder = useCallback((o) => {
    patch({
      confirm: {
        title: 'Отменить заказ №' + o.orderNumber + '?',
        body: 'Действие нельзя отменить. Заказ перейдёт в статус «Удалён».',
        okText: 'Отменить заказ', cancelText: 'Не отменять', danger: true,
        onOk: () => cancelOrder(o),
      },
    });
  }, [patch, cancelOrder]);

  // ТЗ: POST /api/v1/orders/ — Id_clt, DateOrd (Unix), Product[{Id_prd, KolSht}]
  const submitOrder = useCallback(() => {
    const state = getState();
    if (state.submittingOrder) return Promise.resolve(false);
    const ol = currentOutletOf(state);
    const review = reviewData(state, ol);
    if (!review.canSubmit) {
      const message = review.invalidCart[0]?.error || (review.missing
        ? 'До минимальной суммы не хватает ' + fmtMoneyShort(review.missing) + '.'
        : 'Проверьте параметры и состав заказа.');
      patch({ reviewOpen: true, reviewError: message });
      return Promise.resolve(false);
    }
    const products = review.items.map((item) => ({ Id_prd: item.p.id, KolSht: item.qty }));
    patch({ submittingOrder: true, reviewError: '' });
    return api('/api/v1/orders/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Id_clt: ol.id_clt, DateOrd: isoToUnix(state.orderDate), Product: products }),
    }).then((resp) => {
      const o = adaptOrder(resp);
      const cur = getState();
      patch({
        cart: {}, cartDetails: {}, ordersAll: [o, ...cur.ordersAll], route: 'orders',
        reviewOpen: false, reviewError: '', submittingOrder: false,
      });
      toast('Заказ №' + o.orderNumber + ' принят на ' + fmtDateShort(o.deliveryDate) + '. Сумма ' + fmtMoney(o.total), 'success');
      return true;
    }).catch((err) => {
      const message = kisError(err, 'Не удалось отправить заказ. Корзина сохранена — попробуйте ещё раз.');
      patch({ submittingOrder: false, reviewOpen: true, reviewError: message });
      toast(message, 'error');
      return false;
    });
  }, [getState, patch, toast]);

  const openOrderReview = useCallback(() => {
    const state = getState();
    const review = reviewData(state, currentOutletOf(state));
    if (!review.canReview) {
      toast('Проверьте получателя, дату и состав заказа.', 'error');
      return;
    }
    patch({ reviewOpen: true, reviewError: '' });
  }, [getState, patch, toast]);

  const closeOrderReview = useCallback(() => {
    if (getState().submittingOrder) return;
    patch({ reviewOpen: false, reviewError: '' });
  }, [getState, patch]);

  // Повтор заказа из истории — возвращает на экран параметров (получатель/дата/заморозка
  // уже подставлены из повторяемого заказа), формируем заказ заново, а не сразу в каталог
  const repeatOrderFromHistory = useCallback((order) => {
    const state = getState();
    applyOrderToCart(order);
    const patchObj = {};
    if (state.role === 'buyer' && order.outletId) patchObj.currentOutletId = order.outletId;
    const olR = state.outlets.find((o) => o.id === (patchObj.currentOutletId || state.currentOutletId));
    if (order.group != null) patchObj.orderGroup = Number(order.group);
    if (!outletAcceptsDate(olR, parseDate(state.orderDate))) patchObj.orderDate = firstAllowedDate(olR);
    patchObj.modalOrder = null; patchObj.editSnapshot = null;
    patchObj.route = 'order'; patchObj.orderReady = false;
    patch(patchObj);
    toast('Заказ скопирован в корзину. Проверьте параметры и нажмите «Показать прайс-лист».', 'success');
  }, [getState, patch, applyOrderToCart, toast]);

  // «Повторить последний заказ» с экрана параметров — сразу открывает прайс-лист
  const repeatLastOrder = useCallback(() => {
    const state = getState();
    const lastOl = currentOutletOf(state);
    const last = state.setupLastOrder && state.setupLastOrder !== 'loading' ? state.setupLastOrder : null;
    if (!last) { toast('Нет предыдущих заказов для этой точки.'); return; }
    loadOrderDetails(last, () => {
      applyOrderToCart(last);
      const patchObj = { orderReady: true };
      if (last.group != null) patchObj.orderGroup = Number(last.group);
      if (!outletAcceptsDate(lastOl, parseDate(state.orderDate))) patchObj.orderDate = firstAllowedDate(lastOl);
      patch(patchObj);
      setTimeout(loadMatrix, 0);
      toast('Заказ №' + (last.orderNumber || last.id) + ' скопирован. Проверьте и отправьте.', 'success');
    });
  }, [getState, patch, toast, loadOrderDetails, applyOrderToCart, loadMatrix]);

  return {
    loadOrderDetails, openOrderModal, closeOrderModal, applyOrderItemQty,
    saveOrderEdits, cancelOrder, askCancelOrder, submitOrder,
    repeatOrderFromHistory, repeatLastOrder, openOrderReview, closeOrderReview,
  };
}
