/* Каравай · Личный кабинет — SPA · v3.2
   Работает поверх API КИС (ТЗ «Личный кабинет клиента» ver.2).
   Ответы КИС проходят через слой адаптеров adapt* — интерфейс оперирует
   своими именами полей, поэтому смена схемы КИС затрагивает только адаптеры.
   Модель:
   - state.buyer   — покупатель (юрлицо)
   - state.role    — "buyer" | "outlet"
   - state.outlets — доступные точки (для buyer — все, для outlet — одна)
   - state.currentOutletId — активная точка (для отображения истории/оформления)
*/
(function(){
'use strict';

// ================ STATE ================
var state = {
  buyer: null,
  role: null,
  outlets: [],
  currentOutletId: null,
  profileOutletId: null, // v1.3: раскрытая карточка точки в Профиле
  products: [],
  ordersAll: [],       // все заказы покупателя
  documents: [],
  cart: {},
  cartDetails: {}, // v1.5.4: {pid: {lots, pcs}} — независимые слагаемые; итого = lots*piecesPerLot + pcs
  categories: [],       // v1.9: мультивыбор категорий; пустой массив = все
  filter: 'all',        // тип: all | in-cart | regular | promo
  route: 'login',
  loading: false,
  toast: null,
  modalOrder: null,
  reviewOpen: false,
  submittingOrder: false,
  reviewError: '',
  menuOpen: false,
  productSearch: '',
  deviceClient: null,
  prefillCode: '',
  confirm: null,        // {title, body, okText, cancelText, danger, onOk}
  filtersOpen: false,   // v1.9: аккордеон фильтров на мобильных
  ordersOutletFilter: 'all',  // фильтр Истории по точке: 'all' | id точки
  // --- v2.0: КИС ---
  orderGroup: 1,        // 1 — ХБИ, 0 — ЗПФ. Заказ целиком в одной группе
  orderDate: null,      // дата поставки YYYY-MM-DD; от неё зависит матрица
  matrixLoading: false,
  matrixError: null,
  detailsCache: {},     // {Id_ord: [позиции]}
  // v2.1: прайс-лист на «Оформить заказ» открывается только после того, как
  // указаны получатель/дата/заморозка — до этого момента показываем экран параметров.
  orderReady: false,
  // v2.3: кэш последнего принятого заказа для экрана параметров (GET .../orders?last=1)
  setupLastOrder: null,
  setupLastOrderOutlet: null,
};

// ================ АДАПТЕРЫ КИС → ИНТЕРФЕЙС ================
// Слева поля ТЗ, справа — имена, которыми оперирует UI.
var GROUPS = [{key:1, label:'Хлебобулочные'}, {key:0, label:'Замороженные'}];
function groupLabel(g){ var f=GROUPS.find(function(x){return x.key===Number(g)}); return f?f.label:'—'; }

// Состояния заказа КИС → внутренний код и стиль плашки
var STATE_MAP = {
  'Принят':          {code:'accepted',  pill:'accepted'},
  'Маршрутизирован': {code:'routed',    pill:'picked'},
  'В пути':          {code:'onway',     pill:'shipped'},
  'Отгружен':        {code:'shipped',   pill:'delivered'},
  'Удален':          {code:'deleted',   pill:'cancelled'}
};
function stateInfo(st){ return STATE_MAP[st] || {code:'accepted', pill:'accepted'}; }
function unixToISO(t){
  if(!t) return null;
  var d = new Date(Number(t)*1000);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function isoToUnix(iso){
  if(!iso) return null;
  var a = String(iso).split('-').map(Number);
  return Math.floor(new Date(a[0], a[1]-1, a[2]).getTime()/1000);
}

function adaptPayer(k){
  if(!k) return null;
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
    shipmentEffective: k.lk_shipmentEffective,
    shipmentEffectiveReason: k.lk_shipmentEffectiveReason,
    shipmentEffectiveCause: k.lk_shipmentEffectiveCause,
    outlets: (k.Clients || []).map(adaptClient)
  };
}
function adaptClient(k){
  if(!k) return null;
  return {
    id: k.lk_id, id_clt: k.id_clt,
    code: k.KodClt, name: k.NameClt, address: k.Adres,
    minOrderSum: k.OrdLimitMinSum, rep: k.TorgPred,
    days: k.lk_days || [], daysLabel: (k.ClientDayOfWeek || []).join(', '),
    phones: k.lk_phones || [], repPhone: k.lk_repPhone,
    receiver: k.lk_receiver,
    dispatchPhone: k.lk_dispatchPhone, dispatchPlatformName: k.lk_dispatchPlatformName
  };
}
// Позиция матрицы: цена CenaOTP уже со скидкой, BaseCenaOTP — базовая
function adaptProduct(r, baseDisc){
  // Скидка по договору есть у всех позиций — это не акция.
  // Акцией считаем позицию, где ProcSkd заметно выше базовой скидки клиента.
  var promo = (r.ProcSkd || 0) > (baseDisc || 0) + 0.5;
  // ТЗ ver.3: MarketingGroup приходит с числовым префиксом порядка, напр. "2.Современные хлеба" —
  // используем его для стабильной сортировки категорий, а не для отображения
  var rawCat = r.MarketingGroup || '';
  var catM = /^(\d+)\.\s*(.+)$/.exec(rawCat);
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
    group: r.Group
  };
}
function adaptOrder(k){
  var si = stateInfo(k.State);
  return {
    id: k.Id_ord, orderNumber: k.NumOrd,
    buyerId: k.lk_buyerId, outletId: k.lk_outletId,
    outletCode: k.KodClt, outletName: k.NameClt, outletAddress: k.Adres,
    deliveryDate: unixToISO(k.DateOrd),
    createdAt: k.DateOrdClt ? new Date(k.DateOrdClt*1000).toISOString() : null,
    group: k.Group, totalUnits: k.KolSht, total: k.SumAll,
    state: k.State, status: si.code, pill: si.pill,
    source: k.lk_source, items: null   // позиции догружаются по order-details
  };
}
function adaptItem(r){
  return {
    id_prd: r.id_prd, code: r.KodProd, name: r.NameProd,
    price: r.CenaOTP, qty: r.Kolsht, returned: r.KolVzv || 0,
    sum: r.SumAll, piecesPerLot: r.lk_KolUkl || 1
  };
}

// ================ HELPERS ================
var $ = function(sel, root){return (root||document).querySelector(sel)};
var $$ = function(sel, root){return Array.from((root||document).querySelectorAll(sel))};

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]}); }
// Строку "YYYY-MM-DD" трактуем как локальную дату (без UTC-смещения)
function parseDate(v){
  if(!v) return null;
  if(v instanceof Date) return isNaN(v)?null:v;
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  var d = new Date(v);
  return isNaN(d) ? null : d;
}
function fmtDate(iso){ var d=parseDate(iso); if(!d) return '—'; return d.toLocaleDateString('ru-RU', {day:'2-digit',month:'short',year:'numeric'}); }
function fmtDateFull(s){
  var d=parseDate(s); if(!d) return '—';
  var WD=['вс','пн','вт','ср','чт','пт','сб'];
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long'})+', '+WD[d.getDay()];
}
function fmtDateShort(s){ var d=parseDate(s); if(!d) return s ? String(s) : '—'; return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}); }
function fmtDateTime(iso){ if(!iso) return '—'; var d=new Date(iso); return d.toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
function fmtMoney(n){ if(n==null||isNaN(n)) return '—'; return new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+' ₽'; }
function fmtMoneyShort(n){ if(n==null||isNaN(n)) return '—'; return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' ₽'; }
function plural(n, one, few, many){
  var mod10 = n % 10, mod100 = n % 100;
  if(mod10===1 && mod100!==11) return one;
  if(mod10>=2 && mod10<=4 && (mod100<10 || mod100>=20)) return few;
  return many;
}
// v2.0: состояние приходит из КИС уже по-русски
function statusLabel(s){ return s || '—'; }
function sourceLabel(s){ return ({web:'Онлайн',voice:'Голос',operator:'Оператор',edi:'EDI'})[s]||s }
function shipmentModeLabel(m){ return ({allowed:'Отгрузка разрешена',blocked:'Отгрузка запрещена',balance:'По текущему сальдо'})[m]||m }
function initials(name){
  if(!name) return '';
  var parts = name.replace(/[«»""]/g,'').split(/\s+/).filter(Boolean).slice(0,2);
  return parts.map(function(p){return p[0]}).join('').toUpperCase();
}
function toast(msg, type){
  state.toast = {msg:msg, type:type||''};
  render();
  setTimeout(function(){ state.toast=null; render(); }, 3200);
}
function api(path, opts){
  return fetch(path, opts).then(function(r){
    // ТЗ ver.3: 204 (No Content) — тела нет вовсе, .json() на пустом теле упадёт
    if(r.status === 204) return {};
    return r.json().then(function(j){
      if(!r.ok){ j = j || {}; j._status = r.status; throw j; }
      return j;
    });
  });
}
function currentOutlet(){
  if(!state.currentOutletId) return null;
  return state.outlets.find(function(o){return o.id===state.currentOutletId}) || null;
}
function outletMinSum(outlet){
  if(!outlet) return (state.buyer && state.buyer.minOrderSum) || 0;
  return (outlet.minOrderSum != null) ? outlet.minOrderSum : ((state.buyer && state.buyer.minOrderSum) || 0);
}

// ================ v1.3: кратность товара (лотки ↔ штуки) ================
function piecesPerLot(p){ return (p && p.piecesPerLot>0) ? p.piecesPerLot : 1; }
// Лотки из штук — округляем вверх (приоритет у точного количества штук)
function lotsFromPieces(p, pieces){ var ppl=piecesPerLot(p); return ppl>0 ? Math.ceil((pieces||0)/ppl) : 0; }
// Штуки из лотков
function piecesFromLots(p, lots){ return Math.max(0, Math.floor(lots||0)) * piecesPerLot(p); }

// v1.5.4: независимые слагаемые Лотки/Штуки
function cartDetail(pid){ return state.cartDetails[pid] || {lots:0, pcs:0}; }
function totalPiecesFor(p, d){ return (Math.max(0, Math.floor(d.lots||0)) * piecesPerLot(p)) + Math.max(0, Math.floor(d.pcs||0)); }
function setCartDetail(p, lots, pcs){
  var pid = p.id;
  lots = Math.max(0, Math.floor(lots||0));
  pcs = Math.max(0, Math.floor(pcs||0));
  if(p.lotOnly){ pcs = 0; }
  var total = lots * piecesPerLot(p) + pcs;
  if(total===0){ delete state.cart[pid]; delete state.cartDetails[pid]; }
  else { state.cart[pid] = total; state.cartDetails[pid] = {lots:lots, pcs:pcs}; }
  return total;
}
// Синхронизация cart -> cartDetails (для Excel-импорта, повтора заказа, и проч.):
// если в cart[pid] есть число, а details нет — разбиваем по-умному: макс лотков, остаток — в штуки
function syncCartDetails(){
  Object.keys(state.cart).forEach(function(pidStr){
    var pid = Number(pidStr);
    if(state.cartDetails[pid]) return;
    var p = state.products.find(function(x){return x.id===pid});
    if(!p) return;
    var q = state.cart[pid]||0;
    if(p.lotOnly){
      var lots = lotsFromPieces(p, q);
      state.cartDetails[pid] = {lots:lots, pcs:0};
    } else {
      var ppl = piecesPerLot(p);
      var lotsFull = ppl>0 ? Math.floor(q/ppl) : 0;
      var rest = q - lotsFull*ppl;
      state.cartDetails[pid] = {lots:lotsFull, pcs:rest};
    }
  });
  // Очистка сиротских details
  Object.keys(state.cartDetails).forEach(function(pidStr){
    var pid = Number(pidStr);
    if(!state.cart[pid]) delete state.cartDetails[pid];
  });
}
// Промо-товар
function isPromo(p){ return !!(p && p.isPromo); }
function promoOldPrice(p){ return (p && p.oldPrice>0) ? p.oldPrice : null; }
// Последний заказ по точке (ordersAll отсортирован по номеру убыв.)
// Используется для дашборда «Мои точки» — там уже загружена вся история покупателя,
// дёргать API на каждую точку избыточно.
function lastOrderForOutlet(outletId){
  return (state.ordersAll||[]).find(function(o){return o.outletId===outletId}) || null;
}
// ТЗ ver.3: последний ПРИНЯТЫЙ заказ через родной параметр GET /clients/{id_clt}/orders?last=1 —
// используется только на экране параметров заказа (кэш на выбранную точку)
function refreshSetupLastOrder(ol){
  var idClt = ol && ol.id_clt;
  if(!idClt){ state.setupLastOrder = null; state.setupLastOrderOutlet = null; return; }
  if(state.setupLastOrderOutlet === idClt) return; // уже загружено для этой точки
  state.setupLastOrderOutlet = idClt;
  state.setupLastOrder = 'loading';
  api('/api/v1/clients/'+idClt+'/orders?last=1').then(function(resp){
    var list = resp.Orders || [];
    state.setupLastOrder = list.length ? adaptOrder(list[0]) : null;
    render();
  }).catch(function(){
    state.setupLastOrder = null;
    render();
  });
}
// v2.1: копирует позиции заказа в корзину (повтор заказа — из истории или с экрана параметров)
function applyOrderToCart(order){
  state.cart = {};
  state.cartDetails = {};
  (order.items || []).forEach(function(it){ state.cart[it.id_prd] = it.qty; });
  syncCartDetails();
}

// v1.7: Сальдо видит только покупатель (master).
// Получатели (outlet) — не видят никогда, вне зависимости от числа точек.
function showsBalance(){ return state.role === 'buyer'; }

// v2.0 (ТЗ КИС): изменять и удалять заказ можно, пока он не маршрутизирован.
// Решение принимает КИС — на 422 показываем текст из ответа. Клиентская
// проверка нужна только чтобы не показывать заведомо бесполезные кнопки.
function canCancelOrder(o){
  if(!o) return {ok:false, reason:''};
  if(o.status === 'deleted') return {ok:false, reason:'Заказ уже удалён.'};
  if(o.status !== 'accepted'){
    return {ok:false, reason:'Заказ маршрутизирован, изменения запрещены. Свяжитесь с менеджером.'};
  }
  return {ok:true, reason:''};
}

// v1.2: Конфирм-модалка
// v1.5.6: добавлен _onCancel для действия в случае «Отмена» / клик по фону
function askConfirm(opts){
  state.confirm = {
    title: opts.title || 'Подтвердите действие',
    body: opts.body || '',
    okText: opts.okText || 'Подтвердить',
    cancelText: opts.cancelText || 'Отмена',
    danger: !!opts.danger,
    _onOk: opts.onOk || function(){},
    _onCancel: opts.onCancel || function(){}
  };
  render();
}
function closeConfirm(){ state.confirm = null; render(); }

// v1.5.6: helpers для снапшота заказа при редактировании в статусе «Принят»
function snapshotOrder(o){
  if(!o || !o.items) return null;
  if(!o) return null;
  return {
    items: o.items.map(function(it){
      return { qty: it.qty, sum: it.sum, price: it.price, code: it.code, id_prd: it.id_prd };
    }),
    totalUnits: o.totalUnits,
    total: o.total
  };
}
function orderChanged(o, snap){
  if(!o || !snap || !o.items) return false;
  if(o.items.length !== snap.items.length) return true;
  for(var i=0;i<o.items.length;i++){
    var a = o.items[i]; var b = snap.items[i];
    if(!b) return true;
    if(a.qty !== b.qty) return true;
  }
  return false;
}
function restoreOrderFromSnapshot(o, snap){
  if(!o || !snap) return;
  // восстанавливаем qty/sum позиций по code
  o.items.forEach(function(it, idx){
    var s = snap.items[idx];
    if(s && (!s.code || it.code === s.code)){
      it.qty = s.qty;
      it.sum = s.sum;
      delete it.uiLots; delete it.uiPcs;
    }
  });
  o.totalUnits = snap.totalUnits;
  o.total = snap.total;
}
function viewConfirmModal(c){
  if(!c) return '';
  var okCls = c.danger ? 'btn btn--danger' : 'btn btn--primary';
  return ''+
  '<div class="confirm-back" data-action="confirm-back">'+
    '<div class="confirm-modal" data-stop role="dialog" aria-modal="true" aria-labelledby="confirmTitle">'+
      '<div class="confirm-modal__head" id="confirmTitle" tabindex="-1">'+esc(c.title)+'</div>'+
      '<div class="confirm-modal__body">'+c.body+'</div>'+
      '<div class="confirm-modal__foot">'+
        '<button class="btn btn--secondary" type="button" data-action="confirm-cancel">'+esc(c.cancelText)+'</button>'+
        '<button class="'+okCls+'" type="button" data-action="confirm-ok">'+esc(c.okText)+'</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

// ================ SVG ICONS ================
var ICONS = {
  dash:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  cart:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M6 6L4 3H2"/></svg>',
  orders:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 9h16M8 4v16"/></svg>',
  docs:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/></svg>',
  profile:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 5-6 8-6s7 2 8 6"/></svg>',
  outlets:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V10l9-7 9 7v11"/><path d="M9 21v-6h6v6"/></svg>',
  menu:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  close:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6l-12 12"/></svg>',
  plus:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>',
  phone:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.8.3 1.5.6 2.2a2 2 0 0 1-.5 2.1L8 9.1a16 16 0 0 0 6 6l1-1.1a2 2 0 0 1 2.1-.5c.7.2 1.4.4 2.2.5a2 2 0 0 1 1.7 2z"/></svg>',
  download:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  chevron:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  check:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6L20 6"/></svg>',
};

// ================ AUTH / DEVICE ================
var DEVICE_KEY = 'karavay_device_code';
function _store(){ try{ return window['local'+'Storage']; }catch(e){ return null; } }
function getDeviceCode(){ try{ var s=_store(); return s? (s.getItem(DEVICE_KEY)||'') : ''; }catch(e){ return ''; } }
function setDeviceCode(code){ try{ var s=_store(); if(s) s.setItem(DEVICE_KEY, code); }catch(e){} }
function clearDeviceCode(){ try{ var s=_store(); if(s) s.removeItem(DEVICE_KEY); }catch(e){} state.deviceClient=null; state.prefillCode=''; render(); }

function applyLoginResponse(resp){
  state.role = resp.role;
  state.buyer = adaptPayer(resp.payer);
  if(resp.role === "buyer"){
    state.outlets = (state.buyer && state.buyer.outlets) || [];
    // Если человек вошёл кодом точки под мастер-паролем — открываем эту точку
    state.currentOutletId = resp.enteredOutletId || (state.outlets[0] && state.outlets[0].id) || null;
  } else {
    var one = adaptClient(resp.client);
    state.outlets = [one];
    state.currentOutletId = one.id;
  }
  state.route = 'dashboard';
  state.orderReady = false;
  loadBuyerData();
}

function login(code, password, remember){
  return api('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code:code, password:password})})
    .then(function(resp){
      applyLoginResponse(resp);
      if(remember !== false) setDeviceCode(code);
    });
}
function _doLogout(){
  state.reviewOpen=false; state.reviewError=''; state.menuOpen=false;
  state.buyer=null; state.role=null; state.outlets=[]; state.currentOutletId=null;
  state.route='login'; state.cart={}; state.cartDetails={}; state.ordersAll=[]; state.documents=[];
  state.modalOrder=null; state.editSnapshot=null;
  state.productSearch=''; state.categories=[]; state.filtersOpen=false;
  state.ordersOutletFilter='all';
  state.confirm=null;
  state.orderReady=false;
  state.setupLastOrder=null;
  state.setupLastOrderOutlet=null;
  // очистить сохранённый код устройства и траст
  try{ localStorage.removeItem('karavay_device_code'); }catch(e){}
  try{ sessionStorage.removeItem('karavay_pending_login'); }catch(e){}
  state.deviceClient = null; state.prefillCode = '';
  // очистить hash и перерендерить login
  try{ if(location.hash) history.replaceState(null,'',location.pathname+location.search); }catch(e){}
  render();
}
function logout(){
  // v1.2: если в корзине есть позиции — спросить перед выходом
  var hasCart = Object.keys(state.cart||{}).length > 0;
  if(!hasCart){ _doLogout(); return; }
  askConfirm({
    title:'Выйти из кабинета?',
    body:'В корзине есть добавленные позиции. Если выйдете сейчас, корзина будет очищена.',
    okText:'Выйти',
    cancelText:'Остаться',
    danger:true,
    onOk:function(){ _doLogout(); }
  });
}

// ================ ЗАГРУЗКА ДАННЫХ (API КИС) ================
function loadBuyerData(){
  if(!state.buyer) return;
  state.loading = true; render();
  var idPay = state.buyer.Id_pay, bid = state.buyer.id;
  Promise.all([
    // ТЗ ver.3: заказы за последние 14 дней плюс все незавершённые
    api('/api/v1/payers/'+idPay+'/orders'),
    // документов в ТЗ нет — это справочник ЛК
    api('/api/buyers/'+bid+'/documents').catch(function(){ return []; })
  ]).then(function(res){
    state.ordersAll = (res[0].Orders || []).map(adaptOrder);
    state.documents = res[1] || [];
    if(state.role === "outlet"){
      state.ordersAll = state.ordersAll.filter(function(o){ return o.outletId === state.currentOutletId; });
    }
    if(!state.orderDate) state.orderDate = firstAllowedDate(currentOutlet());
    state.loading = false;
    render();
    loadMatrix();
  });
}

// Ближайшая дата, которую получатель принимает по ClientDayOfWeek.
// ТЗ не описывает отсечку, поэтому берём завтрашний день как первый возможный.
function firstAllowedDate(ol){
  var d = new Date(); d.setHours(0,0,0,0);
  for(var i=1;i<=14;i++){
    var t = new Date(d); t.setDate(t.getDate()+i);
    if(outletAcceptsDate(ol, t)) return isoOf(t);
  }
  return isoOf(new Date(d.getTime()+86400000));
}
function isoOf(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function ruDowOf(d){ return (d.getDay()+6)%7; }
function outletAcceptsDate(ol, d){
  if(!ol || !ol.days || !ol.days.length) return true;
  return ol.days.indexOf(ruDowOf(d)) >= 0;
}
function allowedDatesFor(ol, count){
  var out = [], d = new Date(); d.setHours(0,0,0,0);
  for(var i=1;i<=21 && out.length<(count||10);i++){
    var t = new Date(d); t.setDate(t.getDate()+i);
    if(outletAcceptsDate(ol, t)) out.push(isoOf(t));
  }
  return out;
}

// Матрица продукции: GET /api/v1/clients/{id_clt}/matrix?DateOrd=&Group=
function loadMatrix(){
  var ol = currentOutlet();
  if(!ol || !ol.id_clt || !state.orderDate){ state.products = []; return; }
  state.matrixLoading = true; state.matrixError = null; render();
  var url = '/api/v1/clients/'+ol.id_clt+'/matrix?DateOrd='+isoToUnix(state.orderDate)+'&Group='+state.orderGroup;
  api(url).then(function(resp){
    var rows = resp.Product || [];
    // базовая скидка клиента = минимальная ProcSkd в матрице
    var baseDisc = rows.length ? Math.min.apply(null, rows.map(function(r){ return r.ProcSkd || 0; })) : 0;
    state.baseDiscount = baseDisc;
    state.products = rows.map(function(r){ return adaptProduct(r, baseDisc); });
    state.matrixLoading = false;
    pruneCart();
    render();
  }).catch(function(err){
    state.products = [];
    state.matrixLoading = false;
    state.matrixError = (err && err.detail) || 'Не удалось получить матрицу продукции';
    render();
  });
}

// При смене точки, даты или группы часть позиций корзины может исчезнуть из матрицы
function pruneCart(){
  var ids = {};
  state.products.forEach(function(p){ ids[p.id] = 1; });
  var dropped = 0;
  Object.keys(state.cart).forEach(function(pid){
    if(!ids[pid]){ delete state.cart[pid]; delete state.cartDetails[pid]; dropped++; }
  });
  syncCartDetails();
  if(dropped) toast('Из корзины убрано позиций: '+dropped+' — их нет в матрице на эту дату', 'error');
}

// ================ SHIPMENT UI ================
function shipmentPill(buyer){
  if(!buyer) return '';
  var eff = buyer.shipmentEffective || 'allowed';
  var cause = buyer.shipmentEffectiveCause || null;
  var mode = buyer.shipmentMode;
  var label, cls, hint;
  // Приоритет: нет договора — выше всего
  if(cause === 'no_contract'){
    label='Отгрузка — нет договора';
    cls='ship--blocked';
    hint=buyer.shipmentEffectiveReason||'';
  } else if(mode === 'allowed'){ label='Отгрузка разрешена'; cls='ship--ok'; hint=''; }
  else if(mode === 'blocked'){ label='Отгрузка запрещена'; cls='ship--blocked'; hint=buyer.shipmentBlockReason||''; }
  else { // balance
    if(eff === 'allowed'){ label='Отгрузка по сальдо · ОК'; cls='ship--balance-ok'; hint='Проверка по текущему сальдо'; }
    else { label='Отгрузка по сальдо · стоп'; cls='ship--balance-stop'; hint=buyer.shipmentEffectiveReason||''; }
  }
  return '<span class="ship-pill '+cls+'" title="'+esc(hint)+'">'+esc(label)+'</span>';
}
function balancePill(buyer){
  if(!buyer) return '';
  var b = buyer.balance||0;
  var cls = b<0 ? 'bal--neg' : (b>0 ? 'bal--pos' : 'bal--zero');
  return '<span class="bal-pill '+cls+'">Сальдо: '+fmtMoneyShort(b)+'</span>';
}
function ediPill(buyer){
  if(!buyer || !buyer.usesEdi || !buyer.ediClientCode) return '';
  return '<span class="edi-pill" title="Клиент работает по ЭДО. Номер в системе электронного документооборота">EDI: '+esc(buyer.ediClientCode)+'</span>';
}

// ================ VIEWS ================

function viewLogin(){
  var trusted = state.deviceClient;
  var trustedInitials = trusted ? String(trusted.name||'').split(/\s+/).map(function(w){return w[0]||''}).join('').slice(0,2).toUpperCase() : '';
  var formInner = trusted
    ? '<div class="login__trusted">'+
        '<div class="login__trusted-avatar">'+trustedInitials+'</div>'+
        '<div class="login__trusted-name">'+esc(trusted.name)+'</div>'+
        '<div class="login__trusted-code">Код: <strong>'+esc(trusted.code)+'</strong> · устройство запомнено</div>'+
      '</div>'+
      '<input type="hidden" name="code" value="'+esc(trusted.code)+'">'+
      '<div id="loginErr"></div>'+
      '<div class="login__field">'+
        '<label for="loginPass">Пароль</label>'+
        '<input id="loginPass" name="password" type="password" placeholder="Ваш пароль" autocomplete="current-password" autofocus required>'+
      '</div>'+
      '<button class="login__submit" type="submit">Войти</button>'+
      '<button type="button" class="login__switch" data-action="switch-account">Это не я — войти по другому коду</button>'
    : '<h2 class="login__title">Вход в кабинет</h2>'+
      '<p class="login__sub">Введите код покупателя или код точки и пароль, которые вам выдал менеджер.</p>'+
      '<div id="loginErr"></div>'+
      '<div class="login__field">'+
        '<label for="loginCode">Код покупателя или точки</label>'+
        '<input id="loginCode" name="code" type="text" placeholder="B-1024 или P-1024-01" autocomplete="username" value="'+esc(state.prefillCode||'')+'" required>'+
      '</div>'+
      '<div class="login__field">'+
        '<label for="loginPass">Пароль</label>'+
        '<input id="loginPass" name="password" type="password" placeholder="Ваш пароль" autocomplete="current-password" required>'+
      '</div>'+
      '<label class="login__remember"><input type="checkbox" name="remember" checked> Запомнить меня на этом устройстве</label>'+
      '<button class="login__submit" type="submit">Войти</button>'+
      '<div class="login__hint">'+
        '<strong>Демо-доступы:</strong> кликните по коду — подставим в форму. Мастер-пароль покупателя — доступ ко всем его точкам.'+
        '<div style="margin-top:10px;font-size:12px;color:var(--gray-600)">Клиенты на ЭДО (заказывают и через личный кабинет):</div>'+
        '<div class="login__demos">'+
          '<button type="button" class="login__demo login__demo--edi" data-action="fill-demo" data-code="B-1467" data-pass="master1467">B-1467 · Тандер/Магнит · EDI: 4601234000189</button>'+
          '<button type="button" class="login__demo login__demo--edi" data-action="fill-demo" data-code="B-1590" data-pass="master1590">B-1590 · Лента · EDI: 4601234000196</button>'+
        '</div>'+
        '<div style="margin-top:10px;font-size:12px;color:var(--gray-600)">Остальные клиенты:</div>'+
        '<div class="login__demos">'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-2130" data-pass="master2130">B-2130 · Пятёрочка СЗ</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-2015" data-pass="master2015">B-2015 · Дикси</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-2244" data-pass="master2244">B-2244 · Верный</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1024" data-pass="master1024">B-1024 · Перекрёсток</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1928" data-pass="master1928">B-1928 · Ozon Fresh</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1573" data-pass="master1573">B-1573 · Север Север</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1622" data-pass="master1622">B-1622 · Невский Берег</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1287" data-pass="master1287">B-1287 · ЛЭТИ</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1815" data-pass="master1815">B-1815 · детсад</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1156" data-pass="master1156">B-1156 · Хлебница (−сальдо)</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1342" data-pass="master1342">B-1342 · без договора</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="B-1704" data-pass="master1704">B-1704 · отгрузка запрещена</button>'+
        '</div>'+
        '<div style="margin-top:10px;font-size:12px;color:var(--gray-600)">Демо точек-получателей (видят только свою точку, без сальдо):</div>'+
        '<div class="login__demos">'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="P-1024-01" data-pass="grz2026">P-1024-01 · Пятёрочка, Гражданский</button>'+
          '<button type="button" class="login__demo" data-action="fill-demo" data-code="D-2015-01" data-pass="lens2026">D-2015-01 · Дикси, Ленсовета</button>'+
        '</div>'+
      '</div>';
  return ''+
  '<div class="login">'+
    '<div class="login__hero">'+
      '<div class="login__hero-inner">'+
        '<div class="login__logo-circle" style="margin-bottom:32px">'+
          '<img src="../shared/logo-official.svg" alt="КАРАВАЙ" width="150" height="150">'+
        '</div>'+
        '<h1 class="login__slogan">Всё будет<br><span class="accent">хорошо!</span></h1>'+
        '<p class="login__lead">Личный кабинет покупателя ОАО «КАРАВАЙ».<br>Заказы, документы, связь с вашим менеджером — <span class="nowrap">в одном месте</span>.</p>'+
        '<a class="login__site-link login__site-link--bottom" href="https://karavay.spb.ru" target="_blank" rel="noopener">karavay.spb.ru</a>'+
      '</div>'+
    '</div>'+
    '<div class="login__form-side">'+
      '<form class="login__form-card" data-form="login">'+formInner+'</form>'+
    '</div>'+
  '</div>';
}

// v1.9: синяя плашка выбора точки — под шапкой, на страницах где точка имеет значение
// v1.9.2: только там, где выбор что-то меняет: точка отгрузки и фильтр истории.
// На Обзоре сводка идёт по всем точкам, Документы привязаны к покупателю — там выбор бессмыслен.
var OUTLET_BAR_ROUTES = {order:1, orders:1};
function outletBar(){
  if(!OUTLET_BAR_ROUTES[state.route]) return '';
  // v2.1: на экране параметров заказа получателя выбирают в самой карточке —
  // синяя плашка тут была бы дублем, показываем её только после подтверждения
  if(state.route === 'order' && !state.orderReady) return '';
  var ol = currentOutlet();
  if(!ol) return '';
  var multi = (state.role === "buyer") && state.outlets && state.outlets.length > 1;
  // v1.9.1: на Истории заказов плашка фильтрует список и умеет «Все точки»
  if(state.route === 'orders' && multi){
    var f = state.ordersOutletFilter;
    return '<div class="outlet-bar">'+
      '<span class="outlet-bar__tag">ТОЧКА</span>'+
      '<select id="historyOutletSel" class="outlet-bar__select" aria-label="Фильтр заказов по точке">'+
        '<option value="all" '+(f==='all'?'selected':'')+'>Все точки · '+state.outlets.length+'</option>'+
        state.outlets.map(function(o){
          return '<option value="'+o.id+'" '+(String(f)===String(o.id)?'selected':'')+'>'+
            esc(o.name)+' · '+esc(o.code)+(o.address?' — '+esc(o.address):'')+'</option>';
        }).join('')+
      '</select>'+
    '</div>';
  }
  return '<div class="outlet-bar">'+
    '<span class="outlet-bar__tag">ТОЧКА</span>'+
    (multi
      ? '<select id="outletSel" class="outlet-bar__select" aria-label="Выбор точки отгрузки">'+
          state.outlets.map(function(o){
            return '<option value="'+o.id+'" '+(o.id===state.currentOutletId?'selected':'')+'>'+
              esc(o.name)+' · '+esc(o.code)+(o.address?' — '+esc(o.address):'')+'</option>';
          }).join('')+
        '</select>'
      : '<div class="outlet-bar__static">'+
          '<strong>'+esc(ol.name)+'</strong>'+
          '<span class="outlet-bar__code">'+esc(ol.code)+'</span>'+
          (ol.address?'<span class="outlet-bar__addr">'+esc(ol.address)+'</span>':'')+
        '</div>')+
  '</div>';
}

function viewShell(inner){
  var b = state.buyer;
  var badgeCart = Object.keys(state.cart).length ? '<span class="badge">'+Object.keys(state.cart).length+'</span>' : '';
  var titles = {
    dashboard:'Обзор',
    order:'Оформить заказ',
    orders:'История заказов',
    documents:'Документы',
    profile:'Профиль покупателя',
    outlets:'Мои точки (получатели)'
  };
  var isBuyerRole = state.role === "buyer";
  var scopeLabel = isBuyerRole
    ? (state.outlets.length>1 ? state.outlets.length+' точки · доступ покупателя' : '1 точка · доступ покупателя')
    : 'Только эта точка · доступ получателя';
  return ''+
  '<div class="app">'+
    '<aside class="sidebar'+(state.menuOpen?' open':'')+'" id="sidebar"'+((state.reviewOpen||state.modalOrder||state.confirm)?' inert':'')+'>'+
      '<a class="sidebar__logo" href="https://karavay.spb.ru" target="_blank" rel="noopener" title="Перейти на сайт КАРАВАЙ">'+
        '<img src="../shared/logo-official.svg" alt="КАРАВАЙ" class="sidebar__logo-img">'+
        '<div class="sidebar__logo-text">'+
          '<div class="sidebar__logo-title">КАРАВАЙ</div>'+
          '<div class="sidebar__logo-sub">Личный кабинет</div>'+
        '</div>'+
      '</a>'+
      '<ul class="sidebar__nav">'+
        '<li><a data-route="dashboard" class="'+(state.route==='dashboard'?'active':'')+'">'+ICONS.dash+'Обзор</a></li>'+
        '<li><a data-route="order" class="'+(state.route==='order'?'active':'')+'">'+ICONS.cart+'Оформить заказ '+badgeCart+'</a></li>'+
        '<li><a data-route="orders" class="'+(state.route==='orders'?'active':'')+'">'+ICONS.orders+'История заказов</a></li>'+
        (isBuyerRole ? '<li><a data-route="outlets" class="'+(state.route==='outlets'?'active':'')+'">'+ICONS.outlets+'Мои точки</a></li>' : '')+
        '<li><a data-route="documents" class="'+(state.route==='documents'?'active':'')+'">'+ICONS.docs+'Документы</a></li>'+
        '<li><a data-route="profile" class="'+(state.route==='profile'?'active':'')+'">'+ICONS.profile+'Профиль</a></li>'+
      '</ul>'+
      '<div class="sidebar__foot">'+
        '<div class="sidebar__contact">'+
          '<div class="sidebar__contact-title">Стол заказов</div>'+
          '<div class="sidebar__contact-line">'+ICONS.phone+' <a href="tel:+78123200000">+7 (812) 320-00-00</a></div>'+
          '<div class="sidebar__contact-line">Пн–Пт 8:00–18:00</div>'+
        '</div>'+
        '<div>Менеджер: <strong style="color:#FFDD00">'+esc(b.manager)+'</strong></div>'+
        '<div>'+esc(b.managerPhone)+'</div>'+
        '<button data-action="logout">Выйти</button>'+
        '<a class="sidebar__site-link" href="https://karavay.spb.ru" target="_blank" rel="noopener">karavay.spb.ru</a>'+
      '</div>'+
    '</aside>'+
    '<div class="sidebar-overlay'+(state.menuOpen?' is-visible':'')+'" id="sidebarOverlay" data-action="close-menu"></div>'+
    '<div class="main"'+((state.reviewOpen||state.modalOrder||state.confirm)?' inert':'')+'>'+
      '<div class="topbar">'+
        '<button class="menu-toggle" data-action="toggle-menu" aria-label="Меню">'+ICONS.menu+'</button>'+
        '<h1 class="topbar__title">'+esc(titles[state.route]||'')+'</h1>'+
        '<div class="topbar__spacer"></div>'+
        '<div class="topbar__user">'+
          '<div class="avatar">'+initials(b.name)+'</div>'+
          '<div>'+
            '<div class="topbar__user-name">'+esc(b.name)+'</div>'+
            '<div class="topbar__user-code">'+esc(b.code)+' · '+esc(scopeLabel)+'</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="content'+(state.route==='order'?' content--wide':'')+(state.route==='order'&&state.orderReady?' content--has-review':'')+'">'+outletBar()+inner+'</div>'+
      (state.route==='order' && state.orderReady && !state.loading ? viewMobileReview() : '')+
    '</div>'+
    (state.modalOrder ? viewOrderModal(state.modalOrder) : '')+
    (state.reviewOpen ? viewOrderReview() : '')+
    (state.confirm ? viewConfirmModal(state.confirm) : '')+
    (state.toast ? '<div class="toast '+(state.toast.type==='success'?'toast--success':(state.toast.type==='error'?'toast--error':''))+'">'+esc(state.toast.msg)+'</div>' : '')+
  '</div>';
}

function viewDashboard(){
  var b = state.buyer;
  var ol = currentOutlet();
  // v1.9.1: у покупателя Обзор считается по всем его точкам, не только по текущей
  var scope = state.ordersAll || [];
  var multiOutlet = (state.role === 'buyer') && state.outlets && state.outlets.length > 1;
  var pendingOrders = scope.filter(function(o){return o.status!=='shipped' && o.status!=='deleted'})
    .slice().sort(function(a,b){
      var da=parseDate(a.deliveryDate), db=parseDate(b.deliveryDate);
      return (da?da.getTime():0) - (db?db.getTime():0);
    });
  var holdOrders = [];   // в КИС статуса «ожидает разблокировки» нет
  var thisMonthOrders = scope.filter(function(o){
    var d=new Date(o.createdAt); var now=new Date();
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  });
  var totalMonth = thisMonthOrders.reduce(function(a,b){return a+(b.total||0)},0);

  var shipBanner = '';
  var cause = b.shipmentEffectiveCause || null;
  var eff = b.shipmentEffective || 'allowed';
  if(cause === 'no_contract'){
    // Отдельный баннер для случая «нет договора»
    shipBanner = '<div class="banner banner--no-contract">'+
      '<strong>Нет действующего договора поставки.</strong> Отгрузка невозможна до оформления договора. '+
      'Свяжитесь с вашим менеджером: <strong>'+esc(b.manager||'')+'</strong>, '+esc(b.managerPhone||'')+'.'+
    '</div>';
  } else if(eff === 'blocked' || (b.shipmentMode==='balance' && (b.balance||0)<0)){
    var reasonTxt = String(b.shipmentEffectiveReason||b.shipmentBlockReason||'').trim();
    if(reasonTxt && !/[.…!?]$/.test(reasonTxt)) reasonTxt += '.';
    shipBanner = '<div class="banner banner--warn">'+
      '<strong>Отгрузка приостановлена.</strong> '+esc(reasonTxt)+
      ' Заказы можно оформлять — они уйдут в статус «ожидает разблокировки» и будут выпущены после снятия ограничения.'+
    '</div>';
  } else if(b.shipmentMode === 'balance'){
    shipBanner = '<div class="banner banner--info">'+
      '<strong>Отгрузка по текущему сальдо.</strong> Заказ будет отгружен, пока сальдо не уходит в минус.'+
    '</div>';
  }

  var holdBanner = holdOrders.length ?
    '<div class="banner banner--hold">В ожидании разблокировки: <strong>'+holdOrders.length+'</strong> заказ(ов) на сумму <strong>'+fmtMoney(holdOrders.reduce(function(a,b){return a+b.total},0))+'</strong></div>'
    : '';

  var minSum = outletMinSum(ol);

  return ''+
    shipBanner + holdBanner +
    '<div class="hero-card">'+
      '<h2>Здравствуйте, '+esc(b.name)+'!</h2>'+
      (multiOutlet
        ? '<p>Обслуживаем <strong>'+state.outlets.length+' '+plural(state.outlets.length,'точку','точки','точек')+'</strong>. Сводка ниже — по всем.</p>'
        : '<p>Точка отгрузки: <strong>'+esc(ol?ol.name:'—')+'</strong>'+
            (ol ? ' <span class="hero-card__code">'+esc(ol.code)+'</span>' : '')+'</p>')+
      '<div class="ship-row">'+ shipmentPill(b) +'</div>'+
      '<div class="actions">'+
        '<button class="btn btn--primary" data-route="order">'+ICONS.plus+'Оформить заказ</button>'+
        '<button class="btn btn--ghost" data-route="orders">История заказов</button>'+
      '</div>'+
    '</div>'+
    '<div class="grid '+(showsBalance()?'grid-4':'grid-3')+'" style="margin-top:20px">'+
      '<div class="kpi kpi--accent">'+
        '<div class="kpi__label">Заказов в этом месяце</div>'+
        '<div class="kpi__value">'+thisMonthOrders.length+'</div>'+
        '<div class="kpi__hint">'+fmtMoney(totalMonth)+' с НДС</div>'+
      '</div>'+
      '<div class="kpi">'+
        '<div class="kpi__label">Активных заказов</div>'+
        '<div class="kpi__value">'+pendingOrders.length+'</div>'+
      '</div>'+
      (showsBalance()
        ? '<div class="kpi">'+
            '<div class="kpi__label">Сальдо</div>'+
            '<div class="kpi__value" style="color:'+((b.balance||0)<0?'var(--danger)':'var(--blue-ink)')+'">'+fmtMoneyShort(b.balance||0)+'</div>'+
          '</div>'
        : '')+
      (multiOutlet
        ? '<div class="kpi kpi--link" data-route="outlets" role="button" tabindex="0">'+
            '<div class="kpi__label">Точек обслуживания</div>'+
            '<div class="kpi__value">'+state.outlets.length+'</div>'+
            '<div class="kpi__hint">Открыть список получателей</div>'+
          '</div>'
        : '<div class="kpi">'+
            '<div class="kpi__label">Минимальная сумма</div>'+
            '<div class="kpi__value">'+fmtMoneyShort(minSum)+'</div>'+
            '<div class="kpi__hint">Для точки '+esc(ol?ol.code:'—')+'</div>'+
          '</div>')+
    '</div>'+
    '<div style="margin-top:20px">'+
      '<div class="card">'+
        '<h3 class="card__title">Ближайшие поставки'+
          (multiOutlet ? ' <span style="color:var(--gray-600);font-weight:400;font-size:14px">· по всем точкам</span>' : '')+
        '</h3>'+
        (pendingOrders.length?
          '<table class="table"><thead><tr>'+
            '<th>№</th>'+
            (multiOutlet ? '<th>Точка</th>' : '')+
            '<th>Дата</th><th>Позиций</th><th>Сумма</th><th>Статус</th>'+
          '</tr></thead><tbody>'+
          pendingOrders.slice(0, multiOutlet ? 8 : 4).map(function(o){
            return '<tr data-order="'+o.id+'">'+
              '<td><strong>'+o.orderNumber+'</strong></td>'+
              (multiOutlet
                ? '<td><span class="cell-code">'+esc(o.outletCode||'')+'</span><br>'+esc(o.outletName||'')+'</td>'
                : '')+
              '<td>'+fmtDateShort(o.deliveryDate)+'</td>'+
              '<td>'+o.totalUnits+' шт.</td>'+
              '<td>'+fmtMoney(o.total)+'</td>'+
              '<td><span class="pill pill--'+o.pill+'">'+statusLabel(o.state)+'</span></td>'+
            '</tr>';
          }).join('')+
          '</tbody></table>' :
          '<div class="empty">Активных заказов нет. Оформите новый — займёт 1 минуту.</div>'
        )+
      '</div>'+
    '</div>';
}

function categories(){
  var cats = {};
  state.products.forEach(function(p){
    if(!cats[p.category]) cats[p.category] = {name:p.category, order:p.categoryOrder, count:0};
    cats[p.category].count++;
  });
  return Object.keys(cats).map(function(k){return cats[k]}).sort(function(a,b){
    return a.order - b.order || a.name.localeCompare(b.name,'ru');
  });
}

// ================ v1.9: КАТАЛОГ И ФИЛЬТРЫ ================
var ORDER_TYPES = [
  {key:'all',     label:'Вся'},
  {key:'in-cart', label:'В заказе'},
  {key:'promo',   label:'Акция'}
];
function matchType(p, f){
  if(f==='in-cart') return !!state.cart[p.id];
  if(f==='regular') return !isPromo(p);
  if(f==='promo')   return isPromo(p);
  return true;
}
function matchSearch(p, q){
  if(!q) return true;
  return (p.name.toLowerCase().indexOf(q)>=0) || (String(p.code).indexOf(q)>=0);
}
function matchCats(p){
  return !state.categories.length || state.categories.indexOf(p.category)>=0;
}
// Панель категорий: чипсы, мультивыбор, по умолчанию отмечены все. Счётчики фасетные.
// v2.2: «Тип» — в верхней панели параметров; здесь только группа продукций (чипсы),
// с галочкой вместо числа, «Все» — быстрый сброс к «отмечено всё».
function viewFilters(q){
  var byCat  = state.products.filter(function(p){ return matchType(p,state.filter) && matchSearch(p,q); });
  var catCounts = {};
  byCat.forEach(function(p){ catCounts[p.category] = (catCounts[p.category]||0)+1; });
  // ТЗ ver.3: порядок категорий — по числовому префиксу MarketingGroup, не по количеству
  var allCats = categories().map(function(c){return c.name});
  var picked = state.categories.length;
  return '<div class="cat-chips">'+
    '<button type="button" class="cat-chip cat-chip--all'+(picked?'':' is-active')+'" data-action="reset-cats">Все</button>'+
    allCats.map(function(name){
      // по умолчанию (state.categories пуст) считаем отмеченным всё
      var on = !picked || state.categories.indexOf(name)>=0;
      var n = catCounts[name]||0;
      return '<label class="cat-chip'+(on?' is-active':'')+(n?'':' is-empty')+'">'+
        '<input type="checkbox" value="'+esc(name)+'" '+(on?'checked':'')+' data-fcat>'+
        '<span>'+esc(name)+'</span>'+
        (on ? '<span class="cat-chip__check">'+ICONS.check+'</span>' : '')+
      '</label>';
    }).join('')+
  '</div>';
}

// v2.1: баннер про блокировку/отсутствие договора — общий для экрана параметров и каталога
// ТЗ ver.3: блокировка — это 402 (нехватка средств) при отправке, а не приём в статус
// ожидания; баннер честно предупреждает, что попытка оформить заказ будет отклонена.
function orderShipmentBanner(){
  var b = state.buyer;
  var eff = b.shipmentEffective || 'allowed';
  var cause = b.shipmentEffectiveCause || null;
  if(cause === 'no_contract'){
    return '<div class="banner banner--no-contract" style="margin-bottom:14px">'+
      '<strong>Нет действующего договора поставки.</strong> Оформить заказ не получится — обратитесь к менеджеру.'+
    '</div>';
  } else if(eff === 'blocked'){
    return '<div class="banner banner--hold" style="margin-bottom:14px">'+
      '<strong>Отгрузка сейчас приостановлена.</strong> Заказ будет отклонён при отправке (не хватает средств). '+esc(b.shipmentEffectiveReason||b.shipmentBlockReason||'')+' Обратитесь к менеджеру.'+
    '</div>';
  }
  return '';
}

// v2.1: экран параметров заказа — получатель (только у покупателя с несколькими точками),
// дата отгрузки и заморозка. Каталог/прайс-лист открывается только после подтверждения.
function viewOrderSetup(){
  var isBuyerMulti = (state.role === 'buyer') && state.outlets && state.outlets.length > 1;
  var ol = currentOutlet();
  var dates = allowedDatesFor(ol || {}, 10);
  // ТЗ ver.3: последний принятый заказ — родной параметр GET /clients/{id_clt}/orders?last=1,
  // а не поиск по уже загрученной истории; кэшируем на точку, чтобы не дёргать API на каждый рендер
  refreshSetupLastOrder(ol);
  var lastOrder = (state.setupLastOrder && state.setupLastOrder !== 'loading') ? state.setupLastOrder : null;
  var stepN = 0;

  var recipientStep = isBuyerMulti
    ? '<div class="setup-step">'+
        '<div class="setup-step__num">'+(++stepN)+'</div>'+
        '<div class="setup-step__body">'+
          '<label class="setup-step__label" for="setupOutletSel">Получатель</label>'+
          '<div class="setup-select-wrap">'+
            '<select id="setupOutletSel" class="setup-select" aria-label="Выбор получателя">'+
              state.outlets.map(function(o){
                return '<option value="'+o.id+'" '+(o.id===state.currentOutletId?'selected':'')+'>'+
                  esc(o.name)+' · '+esc(o.code)+(o.address?' — '+esc(o.address):'')+'</option>';
              }).join('')+
            '</select>'+
            '<span class="setup-select-wrap__chevron">'+ICONS.chevron+'</span>'+
          '</div>'+
        '</div>'+
      '</div>'
    : '<div class="setup-step setup-step--static">'+
        '<div class="setup-step__body">'+
          '<span class="setup-step__label">Получатель</span>'+
          '<div class="setup-step__static">'+esc(ol?ol.name:'—')+
            (ol&&ol.code?' <span class="outlet-bar__code" style="color:var(--gray-600)">'+esc(ol.code)+'</span>':'')+
          '</div>'+
        '</div>'+
      '</div>';

  var dateStep =
    '<div class="setup-step">'+
      '<div class="setup-step__num">'+(++stepN)+'</div>'+
      '<div class="setup-step__body">'+
        '<label class="setup-step__label" for="setupDateSel">Дата отгрузки</label>'+
        '<div class="setup-select-wrap">'+
          '<select id="setupDateSel" class="setup-select" aria-label="Дата отгрузки">'+
            dates.map(function(d){
              return '<option value="'+d+'" '+(d===state.orderDate?'selected':'')+'>'+fmtDateFull(d)+'</option>';
            }).join('')+
          '</select>'+
          '<span class="setup-select-wrap__chevron">'+ICONS.chevron+'</span>'+
        '</div>'+
      '</div>'+
    '</div>';

  var freezeStep =
    '<div class="setup-step">'+
      '<div class="setup-step__num">'+(++stepN)+'</div>'+
      '<div class="setup-step__body">'+
        '<span class="setup-step__label">Заморозка</span>'+
        '<label class="setup-toggle">'+
          '<input type="checkbox" id="setupFreezeChk" '+(Number(state.orderGroup)===0?'checked':'')+'>'+
          '<span class="setup-toggle__box" aria-hidden="true"></span>'+
          '<span class="setup-toggle__text">'+(Number(state.orderGroup)===0?'Да — замороженная продукция (ЗПФ)':'Нет — хлебобулочные изделия (ХБИ)')+'</span>'+
        '</label>'+
      '</div>'+
    '</div>';

  var repeatBlock = lastOrder
    ? '<div class="setup-repeat">'+
        '<div class="setup-repeat__text">Или повторите последний заказ <strong>№'+esc(lastOrder.orderNumber||lastOrder.id)+'</strong>'+
          (lastOrder.deliveryDate?' от '+fmtDate(lastOrder.deliveryDate):'')+'</div>'+
        '<button type="button" class="btn btn--secondary" data-action="repeat-last">'+ICONS.orders+'Повторить последний заказ</button>'+
      '</div>'
    : '';

  return ''+
    orderShipmentBanner()+
    '<div class="card setup-card">'+
      '<h3 class="card__title">Параметры заказа</h3>'+
      '<div class="setup-steps">'+recipientStep+dateStep+freezeStep+'</div>'+
      repeatBlock+
      '<div class="setup-actions">'+
        '<button type="button" class="btn btn--primary" data-action="confirm-setup">Показать прайс-лист '+ICONS.chevron+'</button>'+
      '</div>'+
    '</div>';
}

function viewOrder(){
  if(!state.orderReady){
    return viewOrderSetup();
  }
  var b = state.buyer;
  var ol = currentOutlet();
  var minSum = outletMinSum(ol);
  var search = (state.productSearch||'').toLowerCase().trim();
  var visible = state.products.filter(function(p){
    return matchType(p, state.filter) && matchCats(p) && matchSearch(p, search);
  });

  var review = orderReviewData();
  var cartItems = review.items;
  var totalUnits = review.units;
  var totalSum = review.total;
  var belowMin = totalSum > 0 && totalSum < minSum;

  var holdWarn = orderShipmentBanner();

  var ol2 = ol || {};
  var paramsBar =
    '<div class="order-params">'+
      '<div class="order-params__item order-params__item--static">'+
        '<label class="order-params__label">Группа</label>'+
        '<div class="order-params__static">'+esc(GROUPS.filter(function(g){return g.key===Number(state.orderGroup)})[0].label)+'</div>'+
      '</div>'+
      '<div class="order-params__item order-params__item--static">'+
        '<label class="order-params__label">Дата отгрузки</label>'+
        '<div class="order-params__static">'+fmtDateFull(state.orderDate)+'</div>'+
      '</div>'+
      '<div class="order-params__spacer"></div>'+
      '<div class="seg seg--type">'+
        ORDER_TYPES.map(function(t){
          return '<button type="button" class="seg__btn'+(state.filter===t.key?' is-active':'')+'" '+
            'data-action="set-type" data-type="'+t.key+'">'+t.label+'</button>';
        }).join('')+
      '</div>'+
    '</div>';

  return ''+
    holdWarn+
    paramsBar+
    viewFilters(search)+
    '<div class="order-form">'+
      '<div class="catalog-col">'+
        '<div class="card">'+
          '<div class="catalog-head">'+
            '<h3 class="card__title" style="margin:0;flex:1;min-width:180px">Каталог продукции'+
              ' <span style="color:var(--gray-600);font-weight:400;font-size:14px">· '+visible.length+'</span></h3>'+
            '<input id="prodSearch" type="text" value="'+esc(state.productSearch||'')+'" placeholder="Поиск по коду или названию..." class="catalog-search">'+
          '</div>'+
          '<div class="product-list-header">'+
            '<div class="plh__name">Наименование</div>'+
            '<div class="plh__price">Цена</div>'+
            '<div class="plh__col">Лотки</div>'+
            '<div class="plh__col">Штуки</div>'+
            '<div class="plh__col">Итого штук</div>'+
          '</div>'+
          '<div class="product-list">'+
            (state.matrixLoading ? '<div class="empty">Загружаем матрицу продукции…</div>' :
             state.matrixError ? '<div class="empty">'+esc(state.matrixError)+'</div>' :
             visible.length? visible.map(function(p){
              var d = cartDetail(p.id);
              var q = state.cart[p.id]||0;
              var oldP = isPromo(p) ? promoOldPrice(p) : null;
              return '<div class="product'+(isPromo(p)?' product--promo':'')+'">'+
                '<div style="display:flex;flex-direction:column;flex:1;min-width:0">'+
                  '<div style="display:flex;gap:8px;align-items:baseline">'+
                    '<span style="font-size:11px;color:var(--gray-400);font-weight:600">'+esc(p.code)+'</span>'+
                    '<span class="product__name">'+esc(p.name)+'</span>'+
                    (isPromo(p)?'<span class="promo-tag">Акция</span>':'')+
                  '</div>'+
                  '<div style="font-size:12px;color:var(--gray-600);margin-top:2px">'+
                    (p.weight?p.weight+' кг · ':'')+(p.shelf?'срок '+esc(p.shelf):'')+
                    (p.lotOnly
                      ? ' · только лотками по '+p.piecesPerLot+' шт'
                      : (p.minOrder>1?' · мин. '+p.minOrder+' шт':''))+
                  '</div>'+
                '</div>'+
                '<div style="text-align:right;min-width:120px">'+
                  (oldP?'<div class="price-old">'+fmtMoney(oldP)+'</div>':'')+
                  '<div class="price'+(isPromo(p)?' price--promo':'')+'">'+fmtMoney(p.price)+'</div>'+
                  (p.discount>0?'<div class="price-disc'+(isPromo(p)?' price-disc--promo':'')+'">−'+p.discount.toFixed(1)+'%</div>':'')+
                  '<div style="font-size:11px;color:var(--gray-600)">за '+esc(p.unit)+'</div>'+
                '</div>'+
                '<div class="qty qty--lotonly'+(p.lotOnly?' qty--2col':'')+'" data-pid="'+p.id+'"'+(p.lotOnly?' data-lotonly="1"':'')+'>'+
                  '<div class="qty__field">'+
                    '<div class="qty__stepper">'+
                      '<button type="button" class="qty__btn" data-step="lots" data-dir="-" aria-label="−">−</button>'+
                      '<input type="text" inputmode="numeric" pattern="[0-9]*" value="'+(d.lots||0)+'" data-lots-input>'+
                      '<button type="button" class="qty__btn" data-step="lots" data-dir="+" aria-label="+">+</button>'+
                    '</div>'+
                  '</div>'+
                  (p.lotOnly ? '<div class="qty__field qty__field--empty"></div>' :
                    '<div class="qty__field">'+
                      '<div class="qty__stepper">'+
                        '<button type="button" class="qty__btn" data-step="pcs" data-dir="-" aria-label="−">−</button>'+
                        '<input type="text" inputmode="numeric" pattern="[0-9]*" value="'+(d.pcs||0)+'" data-pcs-input>'+
                        '<button type="button" class="qty__btn" data-step="pcs" data-dir="+" aria-label="+">+</button>'+
                      '</div>'+
                    '</div>'
                  )+
                  '<div class="qty__field">'+
                    '<div class="qty__total" data-pcs-total>'+q+'</div>'+
                  '</div>'+
                '</div>'+
              '</div>';
            }).join('') : '<div class="empty">Ничего не найдено.</div>')+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="summary-col">'+
        '<div class="card summary">'+
          '<h3 class="card__title">В заказе</h3>'+
          '<div class="summary__ship">'+
            '<div><strong>Точка:</strong> '+esc(ol?ol.name:'—')+' <span style="color:var(--gray-600)">· '+esc(ol?ol.code:'')+'</span></div>'+
            (ol && ol.address ? '<div class="summary__addr">'+esc(ol.address)+'</div>' : '')+
            '<div class="summary__min-line">Минимальная сумма: <strong>'+fmtMoneyShort(minSum)+'</strong></div>'+
            (showsBalance()
              ? '<div style="margin-top:6px">'+shipmentPill(b)+' '+balancePill(b)+(ediPill(b)?' '+ediPill(b):'')+'</div>'
              : '')+
          '</div>'+
          '<div class="summary__totals" id="sumTotals" style="'+(cartItems.length?'':'display:none')+'">'+
            '<div class="summary__total"><span>Итого · <span id="sumUnits">'+totalUnits+'</span> шт.</span><span id="sumSum">'+fmtMoney(totalSum)+'</span></div>'+
            '<div class="summary__error" id="sumError" style="'+(belowMin?'':'display:none')+'">До минимальной суммы не хватает '+fmtMoneyShort(minSum-totalSum)+'.</div>'+
          '</div>'+
          '<div class="summary__empty" id="sumEmpty" style="'+(cartItems.length?'display:none':'')+'">Добавьте позиции из каталога.</div>'+
          '<div>'+
            '<div class="summary__note summary__note--info">'+
              'Поставка <strong>'+fmtDateFull(state.orderDate)+'</strong>, группа <strong>'+groupLabel(state.orderGroup)+'</strong>.'+
              ' ЗПФ и ХБИ оформляются разными заказами.'+
            '</div>'+
            '<button class="btn btn--primary" type="button" data-action="review-order" id="sumSubmit" style="width:100%;justify-content:center;height:48px" '+(review.canReview?'':'disabled')+'>Проверить заказ</button>'+
            (cartItems.length? '<button class="btn btn--secondary btn--sm" type="button" data-action="clear-cart" style="width:100%;justify-content:center;margin-top:8px">Очистить корзину</button>':'')+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>';
}


// Один расчёт для проверки заказа, мобильной панели и отправки.
function orderReviewData(){
  var items = Object.keys(state.cart).map(function(pid){
    var p = state.products.find(function(x){ return x.id === Number(pid); });
    var qty = Number(state.cart[pid]);
    return p && Number.isInteger(qty) && qty > 0 ? {p:p, qty:qty, sum:Math.round(p.price*qty*100)/100} : null;
  }).filter(Boolean);
  var total = Math.round(items.reduce(function(s,it){return s+it.sum;},0)*100)/100;
  var outlet = currentOutlet();
  var missing = Math.max(0, Math.round((outletMinSum(outlet)-total)*100)/100);
  var invalid = items.length !== Object.keys(state.cart).length;
  return {items:items, total:total, outlet:outlet, missing:missing,
    units:items.reduce(function(s,it){return s+it.qty;},0),
    canReview:!!(items.length && outlet && state.orderDate && !state.matrixLoading && !state.matrixError && !invalid),
    canSubmit:!!(items.length && outlet && state.orderDate && !missing && !state.matrixLoading && !state.matrixError && !invalid)};
}
function viewMobileReview(){
  var d = orderReviewData();
  return '<div class="mobile-review" aria-label="Итог заказа">'+
    '<div><strong id="mobileReviewSum">'+fmtMoney(d.total)+'</strong><span id="mobileReviewUnits">'+d.items.length+' поз. · '+d.units+' шт.</span></div>'+
    '<button id="mobileReviewButton" type="button" class="btn btn--primary" data-action="review-order" '+(d.canReview?'':'disabled')+'>Проверить заказ</button></div>';
}
function viewOrderReview(){
  var d = orderReviewData();
  return '<div class="review-back" data-action="close-review">'+
    '<section class="review-panel" role="dialog" aria-modal="true" aria-labelledby="reviewTitle"'+(state.confirm?' inert':'')+'>'+
      '<header class="review-panel__header"><h2 id="reviewTitle" tabindex="-1">Проверить заказ</h2>'+
        '<button type="button" class="modal__close" data-action="close-review" aria-label="Вернуться к заказу" '+(state.submittingOrder?'disabled':'')+'>'+ICONS.close+'</button></header>'+
      '<div class="review-panel__body">'+
        '<dl class="review-details"><dt>Получатель</dt><dd>'+esc(d.outlet?d.outlet.name:'—')+' · '+esc(d.outlet?d.outlet.code:'')+'</dd>'+
        '<dt>Адрес</dt><dd>'+esc(d.outlet?d.outlet.address:'—')+'</dd>'+
        '<dt>Дата поставки</dt><dd>'+fmtDateFull(state.orderDate)+'</dd>'+
        '<dt>Группа</dt><dd>'+groupLabel(state.orderGroup)+'</dd></dl>'+
        '<h3 class="review-caption">Выбранные позиции · '+d.items.length+'</h3>'+
        '<ul class="review-items">'+d.items.map(function(it){
          return '<li class="review-item"><div><strong>'+esc(it.p.name)+'</strong><span>Код '+esc(it.p.code||it.p.id)+' · '+fmtMoney(it.p.price)+' / шт.</span></div>'+
            '<div class="review-item__amount"><span>'+it.qty+' шт.</span><strong>'+fmtMoney(it.sum)+'</strong></div></li>';
        }).join('')+'</ul>'+
        (d.missing?'<p class="summary__error">До минимальной суммы не хватает '+fmtMoneyShort(d.missing)+'. Вернитесь к заказу и добавьте позиции.</p>':'')+
        (state.reviewError?'<p class="summary__error" role="alert">'+esc(state.reviewError)+'</p>':'')+
      '</div>'+
      '<form class="review-panel__footer" data-form="order" aria-busy="'+state.submittingOrder+'">'+
        '<div class="review-total"><span>Итого · '+d.units+' шт.</span><strong>'+fmtMoney(d.total)+'</strong></div>'+
        '<div class="review-actions"><button type="button" class="btn btn--secondary" data-action="close-review" '+(state.submittingOrder?'disabled':'')+'>Вернуться к заказу</button>'+
        '<button id="reviewSubmit" type="submit" class="btn btn--primary" '+(d.canSubmit&&!state.submittingOrder?'':'disabled')+'>'+(state.submittingOrder?'Отправляем…':'Отправить заказ')+'</button></div>'+
      '</form></section></div>';
}

function viewOrders(){
  var scope = (state.ordersAll || []).slice();
  // v1.9.1: фильтр по точке из плашки над списком
  var f = state.ordersOutletFilter;
  var filtered = (state.role === 'buyer') && f && f !== 'all';
  if(filtered) scope = scope.filter(function(o){ return String(o.outletId) === String(f); });
  // v1.2: сортировка по дате доставки, новые сверху
  scope.sort(function(a,b){
    var da = parseDate(a.deliveryDate), db = parseDate(b.deliveryDate);
    var ta = da ? da.getTime() : 0, tb = db ? db.getTime() : 0;
    if(tb !== ta) return tb - ta;
    // тайбрейк по дате создания
    var ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    var cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cb - ca;
  });
  var scopeNote = '<div class="orders-history__scope-note">Показаны заказы за последние 14 дней и все незавершённые.</div>';
  if(!scope.length) return '<div class="card"><div class="empty">'+
    (filtered ? 'По выбранной точке заказов нет. Выберите «Все точки», чтобы увидеть остальные.' : 'Заказов пока нет.')+
    '</div>'+scopeNote+'</div>';
  return ''+
    '<div class="card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;flex-wrap:wrap">'+
        '<h3 style="margin:0">История заказов · <span style="color:var(--gray-600);font-weight:400">'+scope.length+
          (filtered ? ' из '+(state.ordersAll||[]).length : '')+'</span></h3>'+
      '</div>'+
      scopeNote+
      '<table class="table orders-history__table">'+
        '<thead><tr>'+
          '<th>№</th><th>Точка</th><th>Создан</th><th>Доставка</th><th>Позиций</th><th>Сумма</th><th>Статус</th>'+
        '</tr></thead>'+
        '<tbody>'+
          scope.map(function(o){
            return '<tr data-order="'+o.id+'">'+
              '<td><strong>'+o.orderNumber+'</strong></td>'+
              '<td><span style="font-size:12px;color:var(--gray-600);font-family:\'Ubuntu Mono\',monospace">'+esc(o.outletCode||'')+'</span><br>'+esc(o.outletName||'')+'</td>'+
              '<td>'+fmtDateShort(o.createdAt)+'</td>'+
              '<td>'+fmtDateShort(o.deliveryDate)+'</td>'+
              '<td>'+o.totalUnits+' шт.</td>'+
              '<td><strong>'+fmtMoney(o.total)+'</strong></td>'+
              '<td><span class="pill pill--'+o.pill+'">'+statusLabel(o.state)+'</span></td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
      /* v1.6-B: card-layout для <768px */
      '<div class="orders-history__cards">'+
        scope.map(function(o){
          return '<article class="order-card" data-order="'+o.id+'">'+
            '<div class="order-card__top">'+
              '<strong class="order-card__num">№'+o.orderNumber+'</strong>'+
              '<span class="pill pill--'+o.pill+'">'+statusLabel(o.state)+'</span>'+
            '</div>'+
            '<div class="order-card__meta">'+
              '<span>Создан: '+fmtDateShort(o.createdAt)+'</span>'+
              '<span>Доставка: '+fmtDateShort(o.deliveryDate)+'</span>'+
            '</div>'+
            '<div class="order-card__outlet">'+esc(o.outletName||'')+' <span style="color:var(--gray-600);font-family:\'Ubuntu Mono\',monospace;font-size:12px">· '+esc(o.outletCode||'')+'</span></div>'+
            '<div class="order-card__foot">'+
              '<span class="order-card__items">'+o.totalUnits+' шт.</span>'+
              '<strong class="order-card__sum">'+fmtMoney(o.total)+'</strong>'+
            '</div>'+
          '</article>';
        }).join('')+
      '</div>'+
    '</div>';
}

// v2.2: правки позиций заказа в модалке — лотки/штуки, как в оформлении заказа
function findOrderItem(orderId, itemCode){
  var ord = (state.ordersAll||[]).find(function(o){return o.id===orderId});
  if(!ord || !ord.items) return null;
  var it = ord.items.find(function(x){return x.code===itemCode});
  return it ? {order:ord, item:it} : null;
}
function recalcOrderTotals(order){
  order.totalUnits = order.items.reduce(function(s,x){return s+x.qty},0);
  order.total = +order.items.reduce(function(s,x){return s+(x.sum!=null?x.sum:x.qty*x.price)},0).toFixed(2);
}
function applyOrderItemQty(order, it, newQty){
  delete it.uiLots; delete it.uiPcs;
  it.qty = Math.max(0, Math.floor(newQty||0));
  it.sum = +(it.qty*it.price).toFixed(2);
  recalcOrderTotals(order);
}
function orderItemLots(it){ return it.uiLots!=null?it.uiLots:Math.floor((it.qty||0) / (it.piecesPerLot||1)); }
function orderItemPcs(it){ return it.uiPcs!=null?it.uiPcs:(it.qty||0) % (it.piecesPerLot||1); }

function viewOrderModal(o){
  // v1.2: можно ли редактировать заказ (−/+ по позициям)
  var cancelCheck = canCancelOrder(o);
  // Редактирование показываем при любом нефинальном статусе;
  // если срок истёк — клик покажет toast с причиной.
  var canEdit = o.status === 'accepted' && o.items !== null;
  var canCancel = cancelCheck.ok;
  var hasReturns = (o.items || []).some(function(it){ return it.returned > 0; });
  // v2.2: если в открытом (editSnapshot) заказе уже есть несохранённые правки —
  // «Повторить заказ» уступает место прямой кнопке сохранения корректировки
  var hasEdits = !!(state.modalOrder && state.modalOrder.id === o.id && state.editSnapshot && orderChanged(o, state.editSnapshot));
  return ''+
  '<div class="modal-back" data-action="close-modal">'+
    '<div class="modal" data-stop role="dialog" aria-modal="true" aria-label="Карточка заказа"'+(state.confirm?' inert':'')+'>'+
      '<div class="modal__header">'+
        '<h3>Заказ №'+o.orderNumber+'</h3>'+
        '<span class="pill pill--'+o.pill+'" style="background:rgba(255,255,255,.2);color:#fff">'+statusLabel(o.state)+'</span>'+
        '<button class="modal__close" data-action="close-modal">'+ICONS.close+'</button>'+
      '</div>'+
      '<div class="modal__body">'+
        (o.holdReason ? '<div class="banner banner--hold" style="margin-bottom:12px">Причина удержания: '+esc(o.holdReason)+'</div>' : '')+
        (!cancelCheck.ok && o.status!=='deleted' ?
          '<div class="banner banner--info" style="margin-bottom:12px">'+esc(cancelCheck.reason)+'</div>' : '')+
        '<dl class="dl">'+
          '<dt>Получатель</dt><dd>'+esc(o.outletName||'—')+' <span style="color:var(--gray-600)">· '+esc(o.outletCode||'')+'</span></dd>'+
          '<dt>Создан</dt><dd>'+fmtDateTime(o.createdAt)+'</dd>'+
          '<dt>Дата доставки</dt><dd>'+fmtDateShort(o.deliveryDate)+'</dd>'+
          '<dt>Группа</dt><dd>'+groupLabel(o.group)+'</dd>'+
          '<dt>Источник</dt><dd>'+sourceLabel(o.source)+'</dd>'+
          '<dt>Позиций</dt><dd data-order-units>'+(o.items ? o.items.length+' SKU · ' : '')+o.totalUnits+' шт.</dd>'+
          '<dt>Сумма</dt><dd><strong data-order-total style="color:var(--blue-ink)">'+fmtMoney(o.total)+'</strong> с НДС</dd>'+
        '</dl>'+
        (o.items === null
          ? '<div class="empty">Загружаем позиции заказа…</div>'
          : '<table class="table" style="margin-top:8px">'+
          '<thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th>'+
            (hasReturns ? '<th>Возврат</th>' : '')+
            '<th>Цена</th><th>Сумма</th></tr></thead>'+
          '<tbody>'+
            o.items.map(function(it){
              var qtyCell;
              var ppl = it.piecesPerLot || 1;
              if(canEdit && ppl > 1){
                // v2.2: как в оформлении заказа — независимые Лотки/Штуки
                var lots = orderItemLots(it), pcs = orderItemPcs(it);
                qtyCell = ''+
                  '<div class="qty qty--lotonly" data-order-item data-order="'+o.id+'" data-item="'+esc(it.code||'')+'">'+
                    '<div class="qty__field">'+
                      '<div class="qty__stepper">'+
                        '<button type="button" class="qty__btn" data-oi-step="lots" data-dir="-" aria-label="−">−</button>'+
                        '<input type="text" inputmode="numeric" pattern="[0-9]*" value="'+lots+'" data-oi-lots-input>'+
                        '<button type="button" class="qty__btn" data-oi-step="lots" data-dir="+" aria-label="+">+</button>'+
                      '</div>'+
                      '<div class="qty__field-label">лотки</div>'+
                    '</div>'+
                    '<div class="qty__field">'+
                      '<div class="qty__stepper">'+
                        '<button type="button" class="qty__btn" data-oi-step="pcs" data-dir="-" aria-label="−">−</button>'+
                        '<input type="text" inputmode="numeric" pattern="[0-9]*" value="'+pcs+'" data-oi-pcs-input>'+
                        '<button type="button" class="qty__btn" data-oi-step="pcs" data-dir="+" aria-label="+">+</button>'+
                      '</div>'+
                      '<div class="qty__field-label">штуки</div>'+
                    '</div>'+
                    '<div class="qty__field">'+
                      '<div class="qty__total" data-oi-total>'+it.qty+'</div>'+
                      '<div class="qty__field-label">итого шт</div>'+
                    '</div>'+
                  '</div>';
              } else if(canEdit){
                var minusDisabled = it.qty<=1 ? ' disabled' : '';
                qtyCell = ''+
                  '<div class="qty" style="justify-content:flex-start">'+
                    '<button class="qty__btn" type="button" data-action="order-item-dec" data-order="'+o.id+'" data-item="'+esc(it.code||'')+'"'+minusDisabled+'>−</button>'+
                    '<span class="qty__val">'+it.qty+'</span>'+
                    '<button class="qty__btn" type="button" data-action="order-item-inc" data-order="'+o.id+'" data-item="'+esc(it.code||'')+'">+</button>'+
                    '<span style="color:var(--gray-600);font-size:12px;margin-left:4px">шт</span>'+
                  '</div>';
              } else {
                var lots2 = orderItemLots(it), pcs2 = orderItemPcs(it);
                qtyCell = ppl > 1
                  ? (lots2+' лот.'+(pcs2?' + '+pcs2+' шт':'')+' <span style="color:var(--gray-600)">= '+it.qty+' шт</span>')
                  : it.qty+' шт';
              }
              return '<tr>'+
                '<td style="color:var(--gray-600);font-size:12px">'+esc(it.code||'')+'</td>'+
                '<td>'+esc(it.name)+'</td>'+
                '<td>'+qtyCell+'</td>'+
                (hasReturns ? '<td>'+(it.returned ? '<span class="ret-badge">'+it.returned+' шт</span>' : '—')+'</td>' : '')+
                '<td>'+fmtMoney(it.price)+'</td>'+
                '<td><strong data-order-line-sum="'+esc(it.code||'')+'">'+fmtMoney(it.sum||it.price*it.qty)+'</strong></td>'+
              '</tr>';
            }).join('')+
          '</tbody>'+
        '</table>')+
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">'+
          '<div>'+
            (canCancel ? '<button class="btn btn--danger-outline" type="button" data-action="cancel-order" data-order="'+o.id+'">Отменить заказ</button>' : '')+
          '</div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
            '<button class="btn btn--secondary" data-action="close-modal">Закрыть</button>'+
            '<button class="btn btn--primary" data-action="save-order-edits" data-order="'+o.id+'" '+(hasEdits?'':'hidden')+'>Корректировка заказа</button>'+
            '<button class="btn btn--primary" data-action="repeat-order" data-order="'+o.id+'" '+(hasEdits?'hidden':'')+'>Повторить заказ</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function viewDocuments(){
  var kinds = {
    contract:'Договор',
    invoice:'Счёт-фактура',
    act:'Акт',
    pricelist:'Прайс-лист',
    declaration:'Декларации соответствия'
  };
  var icons = {contract:'📄',invoice:'🧾',act:'📋',pricelist:'💰',declaration:'📜'};
  return ''+
    '<div class="card">'+
      '<h3 class="card__title">Все документы</h3>'+
      '<ul class="doclist">'+
        state.documents.map(function(d){
          var hasHref = d.href && d.href !== '#';
          var btn = hasHref
            ? '<a class="btn btn--secondary btn--sm" href="'+esc(d.href)+'" target="_blank" rel="noopener">'+ICONS.download+'Открыть PDF</a>'
            : '<button class="btn btn--secondary btn--sm" data-action="download-doc" data-doc="'+d.id+'">'+ICONS.download+'Скачать</button>';
          return '<li>'+
            '<div class="doclist__icon" style="font-size:20px">'+(icons[d.kind]||'📄')+'</div>'+
            '<div class="doclist__info">'+
              '<div class="doclist__title">'+esc(d.title)+'</div>'+
              '<div class="doclist__meta">'+esc(kinds[d.kind]||'Документ')+' · '+esc(d.number)+' · '+fmtDate(d.date)+(d.orderId?' · к заказу №'+d.orderId:'')+'</div>'+
            '</div>'+
            btn+
          '</li>';
        }).join('')+
      '</ul>'+
    '</div>';
}

function renderOutletCard(o, minBuyer){
  var minSum = (o.minOrderSum != null) ? o.minOrderSum : minBuyer;
  var isCurrent = o.id === state.currentOutletId;
  return '<div class="card outlet-card '+(isCurrent?'outlet-card--current':'')+'">'+
          '<div class="outlet-card__head">'+
            '<div>'+
              '<div class="outlet-card__code">'+esc(o.code)+'</div>'+
              '<div class="outlet-card__name">'+esc(o.name)+'</div>'+
              '<div class="outlet-card__addr">'+esc(o.address)+'</div>'+
            '</div>'+
            (isCurrent
              ? '<span class="outlet-card__current-tag">Текущая точка</span>'
              : '<button class="btn btn--secondary btn--sm" data-action="select-outlet" data-outlet="'+o.id+'">Открыть эту точку</button>'
            )+
          '</div>'+
          '<div class="outlet-card__grid">'+
            '<div>'+
              '<div class="outlet-card__label">Торговый представитель</div>'+
              '<div class="outlet-card__val">'+esc(o.rep||'—')+'</div>'+
              '<div class="outlet-card__sub">'+esc(o.repPhone||'')+'</div>'+
            '</div>'+
            '<div>'+
              '<div class="outlet-card__label">Телефон точки</div>'+
              '<div class="outlet-card__val">'+(o.phones && o.phones.length ? o.phones.map(function(ph){return ICONS.phone+' <a href="tel:'+esc(ph.replace(/[^\d+]/g,''))+'">'+esc(ph)+'</a>'}).join('<br>') : '—')+'</div>'+
            '</div>'+
            '<div>'+
              '<div class="outlet-card__label">Приёмщик товара</div>'+
              '<div class="outlet-card__val">'+esc(o.receiver||'—')+'</div>'+
            '</div>'+
            '<div>'+
              '<div class="outlet-card__label">Диспетчерская · '+esc(o.dispatchPlatformName||'—')+'</div>'+
              '<div class="outlet-card__val">'+(o.dispatchPhone ? '<a href="tel:'+esc(o.dispatchPhone.replace(/[^\d+]/g,''))+'">'+esc(o.dispatchPhone)+'</a>' : '—')+'</div>'+
            '</div>'+
            '<div>'+
              '<div class="outlet-card__label">Минимальная сумма заказа</div>'+
              '<div class="outlet-card__val">'+fmtMoneyShort(minSum)+'</div>'+
            '</div>'+
          '</div>'+
        '</div>';
}

function viewOutlets(){
  var b = state.buyer;
  var minBuyer = b.minOrderSum || 0;
  return ''+
    '<div class="banner banner--info">'+
      '<strong>Настройки точки (минимальная сумма, возможность отгрузки, маршрут доставки) корректируются Караваем.</strong> '+
      'Для изменений свяжитесь с вашим менеджером: <strong>'+esc(b.manager||'—')+'</strong>, '+esc(b.managerPhone||'')+'.'+
    '</div>'+
    // v1.8: свёрнутые карточки — клик по строке раскрывает детали
    '<div class="card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">'+
        '<h3 class="card__title" style="margin:0">'+ (state.outlets.length>1 ? 'Получатели' : 'Получатель') +
        ' <span style="color:var(--gray-600);font-weight:400;font-size:14px">· '+state.outlets.length+' '+plural(state.outlets.length,'точка','точки','точек')+'</span></h3>'+
      '</div>'+
      '<div class="recipient-list">'+
        state.outlets.map(function(o){
          var isCurrent = o.id === state.currentOutletId;
          var isOpen = state.profileOutletId === o.id;
          var last = lastOrderForOutlet(o.id);
          return '<div class="recipient-row '+(isCurrent?'recipient-row--current':'')+(isOpen?' recipient-row--open':'')+'" data-action="toggle-outlet-detail" data-outlet="'+o.id+'" role="button" tabindex="0">'+
            '<div class="recipient-row__main">'+
              '<div class="recipient-row__name">'+esc(o.name)+' <span class="recipient-row__code">'+esc(o.code)+'</span></div>'+
              '<div class="recipient-row__addr">'+esc(o.address||'')+'</div>'+
            '</div>'+
            '<div class="recipient-row__last">'+
              '<div class="recipient-row__label">Последний заказ</div>'+
              (last
                ? '<div class="recipient-row__date">№'+last.orderNumber+' · '+fmtDateShort(last.deliveryDate)+'</div>'+
                  '<div><span class="pill pill--'+last.pill+'">'+statusLabel(last.state)+'</span></div>'
                : '<div class="recipient-row__none">Заказов ещё не было</div>')+
            '</div>'+
            '<div class="recipient-row__go recipient-row__go--'+(isOpen?'open':'closed')+'">'+ICONS.chevron+'</div>'+
          '</div>'+
          (isOpen ? '<div class="recipient-detail">'+renderOutletCard(o, minBuyer)+'</div>' : '');
        }).join('')+
      '</div>'+
    '</div>';
}

function viewProfile(){
  var b = state.buyer;
  var ol = currentOutlet();
  return ''+
    '<div class="grid grid-2">'+
      '<div class="card">'+
        '<h3 class="card__title">Покупатель (плательщик)</h3>'+
        '<dl class="dl">'+
          '<dt>Наименование</dt><dd>'+esc(b.legal||b.name)+'</dd>'+
          '<dt>Код покупателя</dt><dd><strong>'+esc(b.code)+'</strong></dd>'+
          '<dt>ИНН</dt><dd>'+esc(b.inn)+'</dd>'+
          '<dt>Email</dt><dd>'+esc(b.email)+'</dd>'+
          '<dt>С нами с</dt><dd>'+b.sinceYear+' года</dd>'+
          '<dt>Менеджер</dt><dd>'+esc(b.manager)+'<br><span style="color:var(--gray-600)">'+esc(b.managerPhone)+'</span></dd>'+
          '<dt>Договор поставки</dt><dd>'+(b.hasContract
            ? '<span class="pill pill--ok">Действует</span> '+esc(b.contractNumber||'')+(b.contractDate?' от '+fmtDateShort(b.contractDate):'')
            : '<span class="pill pill--stop">Нет</span> — свяжитесь с менеджером'
          )+'</dd>'+
        '</dl>'+
      '</div>'+
      (showsBalance() ?
        '<div class="card">'+
          '<h3 class="card__title">Расчёты и отгрузка</h3>'+
          '<dl class="dl">'+
            '<dt>Сальдо</dt><dd><strong style="color:'+((b.balance||0)<0?'var(--danger)':'var(--blue-ink)')+'">'+fmtMoney(b.balance||0)+'</strong></dd>'+
            '<dt>Отсрочка платежа</dt><dd>'+b.paymentDeferralDays+' дней</dd>'+
            '<dt>Правило отгрузки</dt><dd>'+esc(shipmentModeLabel(b.shipmentMode))+' · '+shipmentPill(b)+'</dd>'+
            (b.shipmentBlockReason?'<dt>Причина</dt><dd style="color:var(--danger)">'+esc(b.shipmentBlockReason)+'</dd>':'')+
            '<dt>Мин. сумма (покупатель)</dt><dd>'+fmtMoneyShort(b.minOrderSum||0)+'</dd>'+
          '</dl>'+
          (b.badges && b.badges.length? '<div style="margin-top:8px">'+b.badges.map(function(x){return '<span class="badge-tag">'+esc(x)+'</span>'}).join('')+'</div>':'')+
        '</div>'
        :
        '<div class="card">'+
          '<h3 class="card__title">Отгрузка</h3>'+
          '<dl class="dl">'+
            '<dt>Правило</dt><dd>'+esc(shipmentModeLabel(b.shipmentMode))+' · '+shipmentPill(b)+'</dd>'+
            (b.shipmentBlockReason?'<dt>Причина</dt><dd style="color:var(--danger)">'+esc(b.shipmentBlockReason)+'</dd>':'')+
            '<dt>Отсрочка платежа</dt><dd>'+b.paymentDeferralDays+' дней</dd>'+
            '<dt>Мин. сумма (покупатель)</dt><dd>'+fmtMoneyShort(b.minOrderSum||0)+'</dd>'+
          '</dl>'+
          (b.badges && b.badges.length? '<div style="margin-top:8px">'+b.badges.map(function(x){return '<span class="badge-tag">'+esc(x)+'</span>'}).join('')+'</div>':'')+
        '</div>'
      )+
    '</div>'+
    // v1.2: точки получателя — все видны сразу, кликабельные карточки
    ((state.outlets && state.outlets.length) ?
      '<div class="card" style="margin-top:20px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">'+
          '<h3 class="card__title" style="margin:0">'+ (state.outlets.length>1 ? 'Получатели' : 'Получатель') +
          ' <span style="color:var(--gray-600);font-weight:400;font-size:14px">· '+state.outlets.length+' '+plural(state.outlets.length,'точка','точки','точек')+'</span></h3>'+
          (state.outlets.length>1 ? '<button class="btn btn--ghost btn--sm" data-route="outlets">'+ICONS.outlets+'Подробнее</button>' : '')+
        '</div>'+
        '<div class="recipient-list">'+
          state.outlets.map(function(o){
            var isCurrent = o.id === state.currentOutletId;
            var isOpen = state.profileOutletId === o.id;
            var last = lastOrderForOutlet(o.id);
            return '<div class="recipient-row '+(isCurrent?'recipient-row--current':'')+(isOpen?' recipient-row--open':'')+'" data-action="toggle-outlet-detail" data-outlet="'+o.id+'" role="button" tabindex="0">'+
              '<div class="recipient-row__main">'+
                '<div class="recipient-row__name">'+esc(o.name)+' <span class="recipient-row__code">'+esc(o.code)+'</span></div>'+
                '<div class="recipient-row__addr">'+esc(o.address||'')+'</div>'+
              '</div>'+
              '<div class="recipient-row__last">'+
                '<div class="recipient-row__label">Последний заказ</div>'+
                (last
                  ? '<div class="recipient-row__date">№'+last.orderNumber+' · '+fmtDateShort(last.deliveryDate)+'</div>'+
                    '<div><span class="pill pill--'+last.pill+'">'+statusLabel(last.state)+'</span></div>'
                  : '<div class="recipient-row__none">Заказов ещё не было</div>')+
              '</div>'+
              '<div class="recipient-row__go recipient-row__go--'+(isOpen?'open':'closed')+'">'+ICONS.chevron+'</div>'+
            '</div>'+
            (isOpen ? '<div class="recipient-detail">'+renderOutletCard(o, b.minOrderSum||0)+'</div>' : '');
          }).join('')+
        '</div>'+
      '</div>'
    : '')+
    '<div class="card" style="margin-top:20px">'+
      '<h3 class="card__title">Как это работает</h3>'+
      '<p style="margin:0;color:var(--gray-600);line-height:1.6">'+
        'Пароль <strong>покупателя</strong> открывает доступ к любой из его точек. Пароль <strong>точки</strong> — только к ней. '+
        'Все настройки (минимальная сумма, возможность отгрузки, маршрут доставки, договор) корректируются <strong>Караваем</strong>. '+
        'По вопросам условий — свяжитесь с менеджером: <strong>'+esc(b.manager)+'</strong>, '+esc(b.managerPhone)+'.'+
      '</p>'+
    '</div>';
}

// ================ RENDER ================
var renderedPage = null;
var renderedOverlay = '';
var overlayReturnFocus = {};
function uiPageKey(){
  return [state.buyer?state.buyer.id:'login', state.route, state.loading,
    state.route==='order'?state.orderReady:''].join('|');
}
// Стабильный адрес элемента: идентификатор товара/заказа важнее его места в списке.
function uiLocator(el){
  if(!el || el===document.body || el===document.documentElement) return null;
  if(el.id) return '#'+CSS.escape(el.id);
  var attrs = ['data-pid','data-order','data-item','data-route','data-action','data-type','data-cat',
    'data-lots-input','data-pcs-input','data-oi-lots-input','data-oi-pcs-input','data-step','data-oi-step','data-dir'];
  var key = attrs.filter(function(a){return el.hasAttribute(a);}).map(function(a){
    return '['+a+'="'+CSS.escape(el.getAttribute(a))+'"]';
  }).join('');
  var tag = el.tagName.toLowerCase();
  var parent = uiLocator(el.parentElement);
  if(!parent) return null;
  if(key) return parent+' > '+tag+key;
  var siblings = Array.from(el.parentElement.children).filter(function(x){return x.tagName===el.tagName;});
  return parent+' > '+tag+':nth-of-type('+(siblings.indexOf(el)+1)+')';
}
function captureUi(root){
  var active = document.activeElement;
  var focus = active && root.contains(active) ? uiLocator(active) : null;
  var result = {x:window.scrollX, y:window.scrollY, focus:focus, scroll:[]};
  if(focus && active.matches('input:not([type=checkbox]):not([type=radio]),textarea')){
    result.input = {value:active.value, start:active.selectionStart, end:active.selectionEnd};
  }
  root.querySelectorAll('*').forEach(function(el){
    if(el.scrollTop || el.scrollLeft) result.scroll.push({selector:uiLocator(el),x:el.scrollLeft,y:el.scrollTop});
  });
  return result;
}
function focusWithoutScroll(selector, input){
  var el = selector && document.querySelector(selector);
  if(!el || el.closest('[inert]')) return;
  if(input){ el.value=input.value; }
  el.focus({preventScroll:true});
  if(input && input.start!=null){ try{el.setSelectionRange(input.start,input.end);}catch(ignore){} }
}
function render(){
  var root = $('#root');
  if(!root) return;
  var previous = captureUi(root);
  var page = uiPageKey();
  var samePage = page === renderedPage;
  var overlay = state.confirm?'confirm':state.reviewOpen?'review':state.modalOrder?'order':'';
  if(overlay && overlay!==renderedOverlay) overlayReturnFocus[overlay] = previous.focus;
  var html;
  if(!state.buyer){ html = viewLogin(); }
  else if(state.loading){ html = viewShell('<div class="page-loader"><div class="loader"></div><div style="margin-top:12px;color:var(--gray-600)">Загрузка данных…</div></div>'); }
  else{
    var inner;
    switch(state.route){
      case 'dashboard': inner = viewDashboard(); break;
      case 'order': inner = viewOrder(); break;
      case 'orders': inner = viewOrders(); break;
      case 'documents': inner = viewDocuments(); break;
      case 'profile': inner = viewProfile(); break;
      case 'outlets': inner = viewOutlets(); break;
      default: inner = viewDashboard();
    }
    html = viewShell(inner);
  }
  root.innerHTML = html;
  document.body.classList.toggle('has-dialog', !!overlay);
  if(samePage){
    if(overlay===renderedOverlay) focusWithoutScroll(previous.focus,previous.input);
    previous.scroll.forEach(function(s){
      var el = s.selector && document.querySelector(s.selector);
      if(el){ el.scrollLeft=s.x; el.scrollTop=s.y; }
    });
    window.scrollTo({left:previous.x,top:previous.y,behavior:'instant'});
  } else {
    window.scrollTo({left:0,top:0,behavior:'instant'});
  }
  if(overlay!==renderedOverlay){
    if(!overlay || (renderedOverlay==='confirm' && overlay)) focusWithoutScroll(overlayReturnFocus[renderedOverlay]);
    else focusWithoutScroll(overlay==='review'?'#reviewTitle':overlay==='confirm'?'#confirmTitle':'.modal__close');
  }
  renderedPage = page;
  renderedOverlay = overlay;
}

// ================ EVENTS ================
document.addEventListener('click', function(e){
  var t = e.target;
  var closest = function(sel){ return t.closest ? t.closest(sel) : null; };
  // v2.2: −/+ по Лотки/Штуки в модалке заказа — ДО определения [data-action],
  // т.к. степперы лежат внутри .modal-back[data-action="close-modal"]
  var stepBtnOI = t.closest && t.closest('.qty__btn');
  if(stepBtnOI && stepBtnOI.closest('[data-order-item]')){
    var wrapOI = stepBtnOI.closest('[data-order-item]');
    var oidOI = Number(wrapOI.getAttribute('data-order'));
    var codeOI = wrapOI.getAttribute('data-item') || '';
    var foundOI = findOrderItem(oidOI, codeOI);
    if(foundOI){
      var chkOI = canCancelOrder(foundOI.order);
      if(!chkOI.ok){ toast(chkOI.reason || 'Редактирование недоступно', 'error'); return; }
      var ppl3 = foundOI.item.piecesPerLot || 1;
      var newQtyOI = foundOI.item.qty;
      var whichOI = stepBtnOI.getAttribute('data-oi-step');
      var dirOI = stepBtnOI.getAttribute('data-dir');
      if(whichOI==='lots'){ newQtyOI = dirOI==='+' ? newQtyOI+ppl3 : Math.max(0, newQtyOI-ppl3); }
      else if(whichOI==='pcs'){ newQtyOI = dirOI==='+' ? newQtyOI+1 : Math.max(0, newQtyOI-1); }
      applyOrderItemQty(foundOI.order, foundOI.item, newQtyOI);
      state.modalOrder = foundOI.order;
      render();
    }
    return;
  }
  var routeEl = closest('[data-route]');
  if(routeEl){
    e.preventDefault();
    var r = routeEl.getAttribute('data-route');
    // v2.1: заходим на «Оформить заказ» заново — начинаем с экрана параметров
    if(r === 'order' && state.route !== 'order'){ state.orderReady = false; }
    state.route = r;
    state.menuOpen = false;
    if(r!=='order') state.productSearch='';
    // v1.2: на мобильных — закрываем сайдбар по клику на пункт меню
    var sbClose = document.getElementById('sidebar');
    var ovClose = document.getElementById('sidebarOverlay');
    if(sbClose) sbClose.classList.remove('open');
    if(ovClose) ovClose.classList.remove('is-visible');
    render();
    return;
  }
  var action = closest('[data-action]');
  // Всплытие от поля/свободной области внутри окна не означает клик по фону.
  if(action && action!==t && action.matches('.modal-back,.confirm-back,.review-back')) return;
  if(action){
    var a = action.getAttribute('data-action');
    if(a==='review-order'){
      if(!orderReviewData().canReview) return;
      state.reviewError=''; state.reviewOpen=true; render(); return;
    }
    if(a==='close-review'){
      if(state.submittingOrder) return;
      state.reviewOpen=false; state.reviewError=''; render(); return;
    }
    if(a==='logout'){ logout(); return; }
    if(a==='switch-account'){ clearDeviceCode(); return; }
    if(a==='fill-demo'){
      var demoCode = action.getAttribute('data-code');
      var demoPass = action.getAttribute('data-pass');
      var codeInp = document.getElementById('loginCode');
      var passInp = document.getElementById('loginPass');
      if(codeInp) codeInp.value = demoCode || '';
      if(passInp) passInp.value = demoPass || '';
      if(codeInp) codeInp.focus();
      return;
    }
    if(a==='toggle-menu'){
      var sb = $('#sidebar'); if(!sb) return;
      var ov = $('#sidebarOverlay');
      sb.classList.toggle('open');
      state.menuOpen = sb.classList.contains('open');
      if(ov) ov.classList.toggle('is-visible', sb.classList.contains('open'));
      return;
    }
    if(a==='close-menu'){
      state.menuOpen = false;
      var sb2 = $('#sidebar'); var ov2 = $('#sidebarOverlay');
      if(sb2) sb2.classList.remove('open');
      if(ov2) ov2.classList.remove('is-visible');
      return;
    }
    if(a==='close-modal'){
      // v1.5.6: если был снапшот и заказ изменён — спросить сохраняем или откатываем
      var mo = state.modalOrder;
      var sn = state.editSnapshot;
      if(mo && sn && orderChanged(mo, sn)){
        askConfirm({
          title:'Сохранить изменения в заказе №'+mo.orderNumber+'?',
          body:'Вы внесли правки в принятый заказ. Сохранить их или отменить?',
          okText:'Сохранить',
          cancelText:'Отменить правки',
          onOk: function(){ saveOrderEdits(mo, sn); },
          onCancel: function(){
            restoreOrderFromSnapshot(mo, sn);
            state.modalOrder = null;
            state.editSnapshot = null;
            render();
          }
        });
        return;
      }
      state.modalOrder=null;
      state.editSnapshot=null;
      render();
      return;
    }
    // v1.2: подтверждение очистки корзины
    if(a==='remove-cart-item'){
      var rpid = Number(action.getAttribute('data-pid'));
      if(rpid && state.cart[rpid]!=null){ delete state.cart[rpid]; updateSummary(); }
      return;
    }
    if(a==='clear-cart'){
      if(!Object.keys(state.cart||{}).length){ return; }
      askConfirm({
        title:'Очистить корзину?',
        body:'Все добавленные позиции будут удалены.',
        okText:'Очистить',
        cancelText:'Отмена',
        danger:true,
        onOk:function(){ state.cart={}; state.cartDetails={}; render(); }
      });
      return;
    }
    // v1.2: кнопки конфирм-модалки
    if(a==='confirm-ok'){
      var c = state.confirm; state.confirm = null;
      if(c && typeof c._onOk === 'function'){ c._onOk(); }
      render();
      return;
    }
    if(a==='confirm-cancel'){
      var cc = state.confirm; state.confirm = null;
      if(cc && typeof cc._onCancel === 'function'){ cc._onCancel(); }
      render(); return;
    }
    if(a==='confirm-back'){
      // закрываем только если клик был именно по фону, а не по внутренности модалки
      if(e.target === action){
        state.confirm = null;
        render();
      }
      return;
    }
    // v1.2: −/+ по позициям в открытом заказе
    if(a==='order-item-inc' || a==='order-item-dec'){
      var oid3 = Number(action.getAttribute('data-order'));
      var pcode = action.getAttribute('data-item') || '';
      var order3 = state.ordersAll.find(function(o){return o.id===oid3});
      if(!order3) return;
      // ТЗ: изменять можно, пока заказ не маршрутизирован
      var chk = canCancelOrder(order3);
      if(!chk.ok){ toast(chk.reason || 'Редактирование недоступно','error'); return; }
      if(!order3.items) return;
      var it3 = order3.items.find(function(x){ return x.code === pcode; });
      if(!it3) return;
      if(a==='order-item-inc'){ it3.qty += 1; }
      else { it3.qty = Math.max(1, it3.qty - 1); }
      it3.sum = +(it3.qty * it3.price).toFixed(2);
      order3.totalUnits = order3.items.reduce(function(s,x){return s + x.qty}, 0);
      order3.total = +order3.items.reduce(function(s,x){return s + (x.sum!=null?x.sum:x.qty*x.price)}, 0).toFixed(2);
      state.modalOrder = order3;
      render();
      return;
    }
    // v1.2: отмена заказа
    if(a==='cancel-order'){
      var oid4 = Number(action.getAttribute('data-order'));
      var order4 = state.ordersAll.find(function(o){return o.id===oid4});
      if(!order4) return;
      var chk2 = canCancelOrder(order4);
      if(!chk2.ok){ toast(chk2.reason || 'Отмена недоступна','error'); return; }
      askConfirm({
        title:'Отменить заказ №'+order4.orderNumber+'?',
        body:'Дата доставки: <strong>'+fmtDateShort(order4.deliveryDate)+'</strong>. Действие необратимо.',
        okText:'Отменить заказ',
        cancelText:'Не отменять',
        danger:true,
        onOk:function(){
          // ТЗ ver.3: DELETE /api/v1/orders/{id_ord}
          api('/api/v1/orders/'+order4.id, {
            method:'DELETE', headers:{'Content-Type':'application/json'}
          }).then(function(resp){
            var si = stateInfo(resp.State);
            order4.state = resp.State; order4.status = si.code; order4.pill = si.pill;
            state.modalOrder = order4;
            toast('Заказ №'+order4.orderNumber+' удалён.', 'success');
            render();
          }).catch(function(err){
            toast(kisError(err, 'Не удалось удалить заказ.'), 'error');
          });
        }
      });
      return;
    }
    if(a==='select-outlet'){
      var newOid = Number(action.getAttribute('data-outlet'));
      if(newOid){
        state.currentOutletId = newOid;
        state.route = 'dashboard';
        render();
        toast('Открыта точка: '+ (currentOutlet()||{}).name, 'success');
      }
      return;
    }
    if(a==='set-group'){
      var g = Number(action.getAttribute('data-group'));
      if(g !== Number(state.orderGroup)){
        state.orderGroup = g;
        state.categories = [];
        loadMatrix();
      }
      return;
    }
    if(a==='set-type'){
      state.filter = action.getAttribute('data-type');
      render();
      return;
    }
    if(a==='toggle-filters'){
      state.filtersOpen = !state.filtersOpen;
      render();
      return;
    }
    if(a==='reset-cats'){
      e.stopPropagation();
      state.categories = [];
      render();
      return;
    }
    if(a==='toggle-outlet-detail'){
      var toggleOid = Number(action.getAttribute('data-outlet'));
      state.profileOutletId = (state.profileOutletId === toggleOid) ? null : toggleOid;
      render();
      return;
    }
    // v2.2: прямое сохранение правок из модалки (кнопка «Корректировка заказа»)
    if(a==='save-order-edits'){
      var oidSE = Number(action.getAttribute('data-order'));
      var orderSE = state.ordersAll.find(function(o){return o.id===oidSE});
      if(orderSE) saveOrderEdits(orderSE, state.editSnapshot);
      return;
    }
    if(a==='repeat-order'){
      var oid = Number(action.getAttribute('data-order'));
      var order = state.ordersAll.find(function(o){return o.id===oid});
      if(order){
        applyOrderToCart(order);
        // если у покупателя — переключим на точку заказа
        if(state.role === 'buyer' && order.outletId){ state.currentOutletId = order.outletId; }
        var olR = currentOutlet();
        if(order.group != null) state.orderGroup = Number(order.group);
        // дата прошлого заказа могла пройти — подставляем ближайшую доступную для получателя
        if(!outletAcceptsDate(olR, parseDate(state.orderDate))){ state.orderDate = firstAllowedDate(olR); }
        state.modalOrder = null;
        state.editSnapshot = null;
        state.route='order';
        // v2.1: повтор из истории возвращает на экран параметров (получатель/дата/заморозка
        // уже подставлены из повторяемого заказа) — формируем заказ заново, а не сразу в каталог
        state.orderReady = false;
        render();
        toast('Заказ скопирован в корзину. Проверьте параметры и нажмите «Показать прайс-лист».', 'success');
      }
      return;
    }
    if(a==='confirm-setup'){
      state.orderReady = true;
      loadMatrix();
      render();
      return;
    }
    if(a==='repeat-last'){
      var lastOl = currentOutlet();
      // ТЗ ver.3: используем уже закэшированный результат GET /clients/{id_clt}/orders?last=1
      var last = (state.setupLastOrder && state.setupLastOrder !== 'loading') ? state.setupLastOrder : null;
      if(!last){ toast('Нет предыдущих заказов для этой точки.'); return; }
      loadOrderDetails(last, function(){
        applyOrderToCart(last);
        if(last.group != null) state.orderGroup = Number(last.group);
        if(!outletAcceptsDate(lastOl, parseDate(state.orderDate))){ state.orderDate = firstAllowedDate(lastOl); }
        state.orderReady = true;
        loadMatrix();
        render();
        toast('Заказ №'+esc(last.orderNumber||last.id)+' скопирован. Проверьте и отправьте.', 'success');
      });
      return;
    }
    if(a==='download-doc'){
      toast('Демо: документ будет скачан в реальной системе.');
      return;
    }
  }
  var tr = closest('[data-order]');
  if(tr && !tr.hasAttribute('data-action')){
    var oid2 = Number(tr.getAttribute('data-order'));
    var o = state.ordersAll.find(function(x){return x.id===oid2});
    if(o){
      // v1.5.6: снапшот только для accepted (единственный редактируемый статус по текущему тз);
      // hold тоже редактируем — к нему тоже актуально
      state.editSnapshot = (o.status === 'accepted' && o.items) ? snapshotOrder(o) : null;
      state.modalOrder = o;
      render();
      loadOrderDetails(o);
    }
    return;
  }
  // v1.5.4: кнопки −/+ в каталоге (Лотки/Штуки) — независимые слагаемые
  var stepBtn = t.closest && t.closest('.qty__btn');
  if(stepBtn){
    var wrapS = stepBtn.closest('[data-pid]');
    if(wrapS){
      var pidS = Number(wrapS.getAttribute('data-pid'));
      var pS = state.products.find(function(x){return x.id===pidS});
      if(pS){
        var which = stepBtn.getAttribute('data-step'); // 'lots' | 'pcs'
        var dir = stepBtn.getAttribute('data-dir');    // '+' | '-'
        var d = Object.assign({lots:0, pcs:0}, cartDetail(pidS));
        if(which==='lots'){
          d.lots = dir==='+' ? d.lots+1 : Math.max(0, d.lots-1);
        } else if(which==='pcs'){
          d.pcs = dir==='+' ? d.pcs+1 : Math.max(0, d.pcs-1);
        }
        var total = setCartDetail(pS, d.lots, d.pcs);
        var lotsInp = wrapS.querySelector('[data-lots-input]');
        var pcsInp = wrapS.querySelector('[data-pcs-input]');
        var totEl = wrapS.querySelector('[data-pcs-total]');
        if(lotsInp) lotsInp.value = d.lots;
        if(pcsInp) pcsInp.value = d.pcs;
        if(totEl) totEl.textContent = total;
        refreshSummary();
      }
    }
    return;
  }
  // Легаси: [data-qty] — кнопки ∓/+ в сводке «В заказе» (меняют штуки целиком)
  var qbtn = t.closest && t.closest('[data-qty]');
  if(qbtn){
    var wrap = qbtn.closest('[data-pid]');
    var pid = Number(wrap.getAttribute('data-pid'));
    var op = qbtn.getAttribute('data-qty');
    var cur = state.cart[pid]||0;
    var newQty = op==='+' ? cur+1 : Math.max(0, cur-1);
    var pL = state.products.find(function(x){return x.id===pid});
    // Сводка оперирует в штуках; разложим в lots+pcs
    if(pL){
      if(pL.lotOnly){
        var lots2 = lotsFromPieces(pL, newQty);
        setCartDetail(pL, lots2, 0);
      } else {
        var d0 = Object.assign({lots:0, pcs:0}, cartDetail(pid));
        // в сводке шаг по-штучно — меняем штуки, лотки остаются
        var basePcs = d0.pcs;
        var newPcs = op==='+' ? basePcs+1 : Math.max(0, basePcs-1);
        var totalCheck = d0.lots*piecesPerLot(pL) + newPcs;
        if(totalCheck===0){ setCartDetail(pL, 0, 0); }
        else { setCartDetail(pL, d0.lots, newPcs); }
      }
    } else {
      if(newQty===0) delete state.cart[pid]; else state.cart[pid] = newQty;
    }
    refreshSummary();
    return;
  }
});

// Escape закрывает только верхнее окно. Фон и Escape никогда не отменяют правки.
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    if(state.confirm){ e.preventDefault(); closeConfirm(); return; }
    if(state.reviewOpen){
      e.preventDefault();
      if(!state.submittingOrder){ state.reviewOpen=false; state.reviewError=''; render(); }
      return;
    }
    if(state.modalOrder){
      e.preventDefault();
      var close=$('.modal__close'); if(close) close.click();
      return;
    }
    if(state.menuOpen){
      e.preventDefault(); state.menuOpen=false; render();
      focusWithoutScroll('[data-action="toggle-menu"]');
    }
  }
  var dialog = state.confirm?$('.confirm-modal'):state.reviewOpen?$('.review-panel'):state.modalOrder?$('.modal'):null;
  if(e.key==='Tab' && dialog){
    var controls=Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'))
      .filter(function(el){return !el.closest('[hidden],[inert]') && el.getClientRects().length;});
    if(!controls.length){e.preventDefault();return;}
    var index=controls.indexOf(document.activeElement);
    if(index===-1 || (e.shiftKey && index===0) || (!e.shiftKey && index===controls.length-1)){
      e.preventDefault(); controls[e.shiftKey?controls.length-1:0].focus({preventScroll:true});
    }
  }
  if((e.key==='Enter' || e.key===' ') && e.target.matches('[role="button"][data-action]')){
    e.preventDefault(); e.target.click();
  }
});

// select outlet from top switcher
document.addEventListener('change', function(e){
  var t = e.target;
  // v2.1: экран параметров заказа — получатель/дата/заморозка до открытия прайс-листа
  if(t && t.id === 'setupOutletSel'){
    var newOidS = Number(t.value);
    if(newOidS && newOidS !== state.currentOutletId){
      state.currentOutletId = newOidS;
      var nolS = currentOutlet();
      if(!outletAcceptsDate(nolS, parseDate(state.orderDate))){
        state.orderDate = firstAllowedDate(nolS);
      }
      render();
    }
    return;
  }
  if(t && t.id === 'setupDateSel'){
    state.orderDate = t.value;
    render();
    return;
  }
  if(t && t.id === 'setupFreezeChk'){
    state.orderGroup = t.checked ? 0 : 1;
    render();
    return;
  }
  if(t && t.id === 'orderDateSel'){
    state.orderDate = t.value;
    loadMatrix();
    return;
  }
  if(t && t.id === 'historyOutletSel'){
    state.ordersOutletFilter = (t.value === 'all') ? 'all' : Number(t.value);
    render();
    return;
  }
  if(t && t.id === 'outletSel'){
    var newOid = Number(t.value);
    if(newOid && newOid !== state.currentOutletId){
      state.currentOutletId = newOid;
      // матрица, цены и минимальная сумма у каждого получателя свои
      var nol = currentOutlet();
      if(!outletAcceptsDate(nol, parseDate(state.orderDate))){
        state.orderDate = firstAllowedDate(nol);
      }
      loadMatrix();
    }
    return;
  }
  // v1.9: тип продукции — одиночный выбор
  if(t && t.hasAttribute && t.hasAttribute('data-ftype')){
    state.filter = t.value;
    render();
    return;
  }
  // v1.9: категории — мультивыбор
  if(t && t.hasAttribute && t.hasAttribute('data-fcat')){
    var cname = t.value;
    var allNames = categories().map(function(c){return c.name});
    // v2.2: пустой state.categories означает «неявно выбрано всё»; при первом
    // снятии галочки материализуем полный список минус то, что сняли
    if(!state.categories.length && !t.checked){ state.categories = allNames.slice(); }
    var idx = state.categories.indexOf(cname);
    if(t.checked && idx < 0) state.categories.push(cname);
    if(!t.checked && idx >= 0) state.categories.splice(idx, 1);
    // если в итоге отмечены все — возвращаемся к неявному «всё» (пустой массив)
    if(state.categories.length === allNames.length) state.categories = [];
    render();
    return;
  }
});

document.addEventListener('input', function(e){
  var t = e.target;
  // v2.2: прямой ввод в поля Лотки/Штуки в модалке заказа
  if(t.matches && t.matches('[data-oi-lots-input],[data-oi-pcs-input]')){
    var wrapOI2 = t.closest('[data-order-item]');
    if(!wrapOI2) return;
    var oidOI2 = Number(wrapOI2.getAttribute('data-order'));
    var codeOI2 = wrapOI2.getAttribute('data-item') || '';
    var foundOI2 = findOrderItem(oidOI2, codeOI2);
    if(!foundOI2) return;
    if(!canCancelOrder(foundOI2.order).ok) return;
    var ppl4 = foundOI2.item.piecesPerLot || 1;
    var curLots = Math.max(0,Math.floor(Number(wrapOI2.querySelector('[data-oi-lots-input]').value)||0));
    var curPcs = Math.max(0,Math.floor(Number(wrapOI2.querySelector('[data-oi-pcs-input]').value)||0));
    var v = Math.max(0, Math.floor(Number(t.value)||0));
    var newQtyOI2;
    if(t.matches('[data-oi-lots-input]')){ newQtyOI2 = v*ppl4 + curPcs; }
    else { newQtyOI2 = curLots*ppl4 + v; }
    applyOrderItemQty(foundOI2.order, foundOI2.item, newQtyOI2);
    foundOI2.item.uiLots=curLots; foundOI2.item.uiPcs=curPcs;
    var totEl3 = wrapOI2.querySelector('[data-oi-total]');
    if(totEl3) totEl3.textContent = foundOI2.item.qty;
    refreshOrderModal(foundOI2.order);
    return;
  }
  // v1.5.4: прямой ввод в поля Штуки — Лотки НЕ пересчитываются
  if(t.matches && t.matches('[data-pcs-input]')){
    var wrap = t.closest('[data-pid]');
    var pid = Number(wrap.getAttribute('data-pid'));
    var p = state.products.find(function(x){return x.id===pid});
    if(!p) return;
    var vP = Math.max(0, Math.floor(Number(t.value)||0));
    var dP = Object.assign({lots:0, pcs:0}, cartDetail(pid));
    var totalP = setCartDetail(p, dP.lots, vP);
    var totEl = wrap.querySelector('[data-pcs-total]');
    if(totEl) totEl.textContent = totalP;
    refreshSummary();
    return;
  }
  // v1.5.4: прямой ввод в поле Лотки — Штуки НЕ меняются
  if(t.matches && t.matches('[data-lots-input]')){
    var wrap2 = t.closest('[data-pid]');
    var pid2 = Number(wrap2.getAttribute('data-pid'));
    var p2 = state.products.find(function(x){return x.id===pid2});
    if(!p2) return;
    var vL = Math.max(0, Math.floor(Number(t.value)||0));
    var dL = Object.assign({lots:0, pcs:0}, cartDetail(pid2));
    var totalL = setCartDetail(p2, vL, dL.pcs);
    var totEl2 = wrap2.querySelector('[data-pcs-total]');
    if(totEl2) totEl2.textContent = totalL;
    refreshSummary();
    return;
  }
  if(t.id==='prodSearch'){
    state.productSearch = t.value;
    render();
  }
});

function refreshOrderModal(o){
  var total = $('[data-order-total]');
  var units = $('[data-order-units]');
  if(total) total.textContent=fmtMoney(o.total);
  if(units) units.textContent=o.items.length+' SKU · '+o.totalUnits+' шт.';
  $$('[data-order-line-sum]').forEach(function(el){
    var it=o.items.find(function(x){return x.code===el.getAttribute('data-order-line-sum');});
    if(it) el.textContent=fmtMoney(it.sum);
  });
  var edited=orderChanged(o,state.editSnapshot);
  var save=$('.modal [data-action="save-order-edits"]');
  var repeat=$('.modal [data-action="repeat-order"]');
  if(save) save.hidden=!edited;
  if(repeat) repeat.hidden=edited;
}

// v1.3: обновляем итоги корзины на месте (без перерисовки — сохраняем фокус в полях)
function refreshSummary(){
  if(state.route!=='order') return;
  var review=orderReviewData();
  var cartItems=review.items;
  var totalUnits=review.units;
  var totalSum=review.total;
  var ol = currentOutlet();
  var minSum = outletMinSum(ol);
  var belowMin = totalSum > 0 && totalSum < minSum;
  var u = document.getElementById('sumUnits');
  var s = document.getElementById('sumSum');
  var e = document.getElementById('sumError');
  var em = document.getElementById('sumEmpty');
  var t = document.getElementById('sumTotals');
  var sub = document.getElementById('sumSubmit');
  if(u) u.textContent = totalUnits;
  if(s) s.textContent = fmtMoney(totalSum);
  if(t) t.style.display = cartItems.length ? '' : 'none';
  if(em) em.style.display = cartItems.length ? 'none' : '';
  if(e){ e.style.display = belowMin ? '' : 'none'; e.innerHTML = 'До минимальной суммы не хватает '+fmtMoneyShort(minSum-totalSum)+'.'; }
  if(sub) sub.disabled = !review.canReview;
  var mobileSum=$('#mobileReviewSum');
  var mobileUnits=$('#mobileReviewUnits');
  var mobileButton=$('#mobileReviewButton');
  if(mobileSum) mobileSum.textContent=fmtMoney(review.total);
  if(mobileUnits) mobileUnits.textContent=review.items.length+' поз. · '+review.units+' шт.';
  if(mobileButton) mobileButton.disabled=!review.canReview;
}
function updateSummary(){
  if(state.route!=='order') return;
  var scroll = document.querySelector('.product-list') ? document.querySelector('.product-list').scrollTop : 0;
  render();
  var pl = document.querySelector('.product-list');
  if(pl && scroll) pl.scrollTop = scroll;
}

document.addEventListener('submit', function(e){
  var f = e.target;
  if(!f.dataset || !f.dataset.form) return;
  e.preventDefault();
  var data = {};
  Array.from(f.elements).forEach(function(el){ if(el.name) data[el.name]=el.value; });
  var form = f.dataset.form;
  if(form==='login'){
    var errEl = document.getElementById('loginErr');
    errEl.innerHTML='';
    var trusted = !!state.deviceClient;
    var remember = trusted ? true : (f.elements['remember'] && f.elements['remember'].checked);
    var codeVal = trusted ? state.deviceClient.code : data.code;
    login(codeVal, data.password, remember).catch(function(err){
      errEl.innerHTML = '<div class="login__error">Неверный '+(trusted?'пароль':'код или пароль')+'. Попробуйте ещё раз.</div>';
    });
    return;
  }
  if(form==='order'){
    if(!state.reviewOpen || state.submittingOrder) return;
    var review = orderReviewData();
    if(!review.canSubmit){
      state.reviewError=review.missing?'Добавьте позиции до минимальной суммы.':'Проверьте получателя, дату и позиции заказа.';
      render(); return;
    }
    var ol = currentOutlet();
    if(!ol){ toast('Не выбрана точка отгрузки.', 'error'); return; }
    // ТЗ: POST /api/v1/orders/ — Id_clt, DateOrd (Unix), Product[{Id_prd, KolSht}]
    var products = Object.keys(state.cart).map(function(pid){
      return {Id_prd: Number(pid), KolSht: state.cart[pid]};
    });
    if(!products.length){ toast('Добавьте хотя бы одну позицию.', 'error'); return; }
    if(!state.orderDate){ toast('Выберите дату поставки.', 'error'); return; }
    state.submittingOrder=true; state.reviewError=''; render();
    api('/api/v1/orders/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      Id_clt: ol.id_clt,
      DateOrd: isoToUnix(state.orderDate),
      Product: products
    })}).then(function(resp){
      var o = adaptOrder(resp);
      state.submittingOrder=false; state.reviewOpen=false;
      state.cart = {};
      state.cartDetails = {};
      state.ordersAll.unshift(o);
      state.route = 'orders';
      render();
      toast('Заказ №'+o.orderNumber+' принят на '+fmtDateShort(o.deliveryDate)+'. Сумма '+fmtMoney(o.total), 'success');
    }).catch(function(err){
      state.submittingOrder=false;
      state.reviewError=kisError(err, 'Не удалось отправить заказ. Попробуйте ещё раз.');
      render();
    });
    return;
  }

});

// ТЗ: PATCH /api/v1/orders/{id_ord} — Product[{Id_prd, KolSht}].
// КИС отвечает 422, если заказ уже маршрутизирован.
function saveOrderEdits(o, snap){
  if(!o) return;
  var products = (o.items || [])
    .filter(function(it){ return it.qty > 0; })
    .map(function(it){ return {Id_prd: it.id_prd, KolSht: it.qty}; });
  if(!products.length){
    toast('В заказе должна остаться хотя бы одна позиция.', 'error');
    return;
  }
  api('/api/v1/orders/'+o.id, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({Product: products})
  }).then(function(resp){
    o.totalUnits = resp.KolSht;
    o.total = resp.SumAll;
    var si = stateInfo(resp.State);
    o.state = resp.State; o.status = si.code; o.pill = si.pill;
    state.detailsCache[o.id] = o.items;
    state.modalOrder = null;
    state.editSnapshot = null;
    toast('Заказ №'+o.orderNumber+' изменён. Сумма '+fmtMoney(o.total), 'success');
    render();
  }).catch(function(err){
    if(snap) restoreOrderFromSnapshot(o, snap);
    state.modalOrder = null;
    state.editSnapshot = null;
    toast(kisError(err, 'Не удалось изменить заказ.'), 'error');
    render();
  });
}

// Ошибки КИС приходят в поле detail; 422 — сумма доверия или маршрутизация
function kisError(err, fallback){
  if(!err) return fallback;
  if(err.lk_error === 'below_min_sum'){
    return 'Сумма ниже минимальной для получателя: '+fmtMoneyShort(err.lk_minSum)+'.';
  }
  return err.detail || fallback;
}

// Позиции заказа: GET /api/v1/orders/{id_ord}
// v2.1: опциональный cb(order) — вызывается, когда позиции точно загружены
// (используется для «Повторить последний заказ», где нужен колбэк после загрузки)
function loadOrderDetails(o, cb){
  if(!o) return;
  if(o.items){ if(cb) cb(o); return; }
  if(state.detailsCache[o.id]){ o.items = state.detailsCache[o.id]; render(); if(cb) cb(o); return; }
  api('/api/v1/orders/'+o.id).then(function(resp){
    var items = (resp.Product || []).map(adaptItem);
    state.detailsCache[o.id] = items;
    o.items = items;
    if(state.modalOrder && state.modalOrder.id === o.id && !state.editSnapshot && o.status === 'accepted'){
      state.editSnapshot = snapshotOrder(o);
    }
    render();
    if(cb) cb(o);
  }).catch(function(){
    o.items = [];
    render();
    if(cb) cb(o);
  });
}

// ================ INIT ================
(function tryHashLogin(){
  var h = String(location.hash||'');
  var code = '', pass = '';

  // Новый канал: sessionStorage (логин/пароль не в URL). Флаг: #login.
  if(h === '#login' || /^#login(?:$|\?)/.test(h)){
    try {
      var raw = sessionStorage.getItem('karavay_pending_login');
      if(raw){
        var pending = JSON.parse(raw);
        sessionStorage.removeItem('karavay_pending_login');
        // Сбросим данные старше 5 минут.
        if(pending && (Date.now() - (pending.ts||0) < 5*60*1000)){
          code = (pending.code||'').trim().toUpperCase();
          pass = pending.password || '';
        }
      }
    } catch(_){}
  }

  // Легаси-канал: #login?code=...&password=... (старые букмарки).
  if(!code){
    var m = h.match(/^#login\?(.+)$/);
    if(m){
      var p = new URLSearchParams(m[1]);
      code = (p.get('code')||'').trim().toUpperCase();
      pass = p.get('password')||'';
    }
  }

  history.replaceState(null,'',location.pathname);
  if(code && pass){
    login(code, pass).catch(function(err){
      state.route='login';
      state.prefillCode = code;
      render();
      var errEl = document.getElementById('loginErr');
      if(errEl) errEl.innerHTML = '<div class="login__error">Неверный код или пароль. Попробуйте ещё раз.</div>';
    });
  }
})();

if(state.buyer){ loadBuyerData(); }
else{
  var savedCode = getDeviceCode();
  if(savedCode){
    api('/api/lookup?code='+encodeURIComponent(savedCode))
      .then(function(info){ state.deviceClient = info; render(); })
      .catch(function(){ clearDeviceCode(); });
  }
  render();
}

})();
