/* Демо-бэкенд v1.9: перехват fetch к /api/*
   Модель:
   - BUYERS (покупатели, юрлица-плательщики): hasContract, сальдо, shipmentMode, minOrderSum
   - OUTLETS (получатели/точки): ТП, телефон, minOrderSum
   v1.9: графики доставки и слоты убраны — дату назначает Каравай (маршрут).
   Все свойства контроля (hasContract, shipmentMode, minOrderSum, deliverySchedule) корректируются на стороне Каравая, в лк-е клиента — read-only.
   Логика блокировки отгрузки (по приоритету):
   1. hasContract=false → «Нет действующего договора»
   2. shipmentMode="blocked" → причина из shipmentBlockReason
   3. shipmentMode="balance" и balance<0 → «Отрицательное сальдо»
   4. иначе → отгрузка разрешена
   Демо-вход: известный обезличенный код + одноразовый ключ, созданный интерфейсом.
*/
import { PRODUCTS } from './products';
import type { ShipmentMode } from './types';

type PlatformKey = 'karavay' | 'kush' | 'zarya';

interface MockBuyer {
  id: number;
  code: string;
  name: string;
  legal: string;
  inn: string;
  sinceYear: number;
  manager: string;
  managerPhone: string;
  email: string;
  paymentDeferralDays: number;
  hasContract: boolean;
  contractNumber: string | null;
  contractDate: string | null;
  balance: number;
  shipmentMode: ShipmentMode;
  shipmentBlockReason?: string;
  minOrderSum: number;
  segment: string;
  badges: string[];
  usesEdi: boolean;
  ediClientCode?: string;
}

interface MockOutlet {
  id: number;
  platform: PlatformKey;
  buyerId: number;
  code: string;
  name: string;
  address: string;
  phones: string[];
  deliverySchedule: number[][];
  rep: string;
  repPhone: string;
  minOrderSum: number;
  receiver: string;
}

interface CatalogRow {
  id_prd: number;
  KodProd: string;
  NameProd: string;
  Vesprod: number;
  MarketingGroup: string;
  Srok: string;
  KolUkl: number;
  BaseCenaOTP: number;
  KolshtOrdmin: number | null;
  Group: number;
  lk_basePrice: number;
  lk_promo: boolean;
}

interface MatrixRow extends Omit<CatalogRow, 'lk_basePrice' | 'lk_promo'> {
  ProcSkd: number;
  CenaOTP: number;
}

interface MockOrderLine {
  id_prd: number;
  KodProd: string;
  NameProd: string;
  KolUkl: number;
  Kolsht: number;
  CenaOTP: number;
  KolVzv: number;
}

interface MockOrder {
  id: number;
  orderNumber: number;
  buyerId: number;
  outletId: number;
  group: number;
  deliveryUnix: number;
  createdAtUnix: number;
  state: string;
  source: string;
  items: MockOrderLine[];
  totalUnits: number;
  total: number;
}

interface MockDocument {
  id: number;
  kind: string;
  number: string;
  orderId: number | null;
  title: string;
  date: string;
  href: string;
}

interface RequestProductInput {
  Id_prd?: unknown;
  id_prd?: unknown;
  KolSht?: unknown;
}

interface MockRequestBody {
  code?: unknown;
  password?: unknown;
  Id_clt?: unknown;
  DateOrd?: unknown;
  Product?: RequestProductInput[];
}

(function(){
  // PRODUCTS теперь приходит из ES-модуля (products.js), а не из window.__PRODUCTS__ —
  // единственное отличие от vanilla-версии мок-бэкенда, всё остальное 1:1

  // ---------- ПОКУПАТЕЛИ (юрлица-плательщики) ----------
  // shipmentMode: "allowed" | "blocked" | "balance"
  //   allowed — отгрузка разрешена
  //   blocked — отгрузка запрещена, заказ уходит в статус "ожидает разблокировки"
  //   balance — проверка по текущему сальдо: если < 0, ведёт себя как blocked
  var BUYERS: MockBuyer[] = Array.from({length:16}, function(_, index): MockBuyer {
    var id = index + 1;
    var blocked = id === 8;
    var balanceControlled = id === 2;
    return {
      id:id, code:"DEMO-B-" + String(id).padStart(2,"0"),
      name:"Демо-покупатель " + String(id).padStart(2,"0"),
      legal:"Учебная организация " + String(id).padStart(2,"0"), inn:"ДЕМО",
      sinceYear:2020, manager:"Демо-менеджер", managerPhone:"+7 (000) 000-00-00",
      email:"buyer" + id + "@example.invalid", paymentDeferralDays:14,
      hasContract:id !== 4, contractNumber:id === 4 ? null : "DEMO-" + id, contractDate:id === 4 ? null : "2020-01-01",
      balance:balanceControlled ? -8400 : id * 10000,
      shipmentMode:blocked ? "blocked" : (balanceControlled ? "balance" : "allowed"),
      shipmentBlockReason:blocked ? "Демонстрационная блокировка отгрузки" : undefined,
      minOrderSum:2500 + (id % 4) * 1500, segment:"Демо", badges:["Учебные данные"],
      usesEdi:id === 15 || id === 16, ediClientCode:id === 15 || id === 16 ? "DEMO-EDI-" + id : undefined
    };
  });

  // Без персональных и договорных данных: структура и масштаб сохранены для UI-тестов.
  var OUTLET_COUNTS = [4,1,1,1,1,3,2,4,1,2,3,3,2,1,2,1];
  var OUTLETS: MockOutlet[] = [];
  BUYERS.forEach(function(buyer, buyerIndex){
    var count = OUTLET_COUNTS[buyerIndex];
    for(var number=1; number<=count; number++){
      var id = buyer.id * 100 + number;
      OUTLETS.push({
        id:id, platform:["karavay","kush","zarya"][id % 3] as PlatformKey, buyerId:buyer.id,
        code:"DEMO-O-" + String(id).padStart(4,"0"),
        name:"Демо-точка " + String(id).padStart(4,"0"),
        address:"Учебный адрес, точка " + id, phones:["+7 (000) 000-00-00"],
        deliverySchedule:[[7],[7],[7],[7],[7],[],[]],
        rep:"Демо-представитель", repPhone:"+7 (000) 000-00-00",
        minOrderSum:buyer.minOrderSum, receiver:"Демо-получатель"
      });
    }
  });

  // Справочники для UI
  // Площадки отгрузки и телефоны диспетчерской (заглушки — заполнить актуальными номерами)
  var PLATFORMS: Record<PlatformKey, { name: string; phone: string }> = {
    kush:    {name:"Кушелевка", phone:"+7 (000) 000-00-01"},
    zarya:   {name:"Заря",      phone:"+7 (000) 000-00-02"},
    karavay: {name:"Каравай",   phone:"+7 (000) 000-00-03"}
  };

  // ===== v2.0: модель КИС (ТЗ «Личный кабинет клиента» ver.2) =====
  // Состояния заказа — как в КИС
  var STATE_ACCEPTED = "Принят";
  var STATE_ROUTED   = "Маршрутизирован";
  var STATE_ONWAY    = "В пути";
  var STATE_SHIPPED  = "Отгружен";
  var STATE_DELETED  = "Удален";
  var STATES = [STATE_ACCEPTED, STATE_ROUTED, STATE_ONWAY, STATE_SHIPPED];
  // Группы продукции: 0 — ЗПФ (замороженные полуфабрикаты), 1 — ХБИ (хлебобулочные)
  var GROUP_ZPF = 0, GROUP_HBI = 1;
  var SOURCES = ["web","voice","operator","edi"];
  var WD_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  // Идентификаторы КИС строим детерминированно от внутренних id демо-данных
  function payerKisId(id: number): number { return 288336 + id; }
  function clientKisId(id: number): number { return 299655 + id; }
  function prodKisId(i: number): number { return 425430 + i; }
  function toUnix(d: Date): number { return Math.floor(d.getTime()/1000); }
  function fromUnix(t: unknown): Date { return new Date(Number(t)*1000); }

  function seed(s: number): () => number {return function(){s=(s*9301+49297)%233280;return s/233280}}
  function daysAgo(n: number): Date {var d=new Date();d.setHours(9,0,0,0);d.setDate(d.getDate()-n);return d}
  function fmt(d: Date): string {return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
  function round2(x: number): number {return Math.round(x*100)/100}
  function norm(s: unknown): string { return String(s||'').trim().toUpperCase().replace(/\u041a/g,"K").replace(/\u0412/g,"B"); }

  function outletsOfBuyer(bid: number): MockOutlet[] { return OUTLETS.filter(function(o){return o.buyerId===bid}); }

  // ---------- НОМЕНКЛАТУРА ----------
  // Обогащаем прайс полями КИС: id_prd, Group, KolUkl (укладка), KolshtOrdmin (мин. заказ).
  // Пустой KolshtOrdmin означает, что продукция грузится только лотками.
  var CATALOG: CatalogRow[] = PRODUCTS.map(function(p, i): CatalogRow {
    return {
      id_prd: prodKisId(i),
      KodProd: String(p.code),
      NameProd: p.name,
      Vesprod: Number(p.weight) || 0,
      MarketingGroup: p.category || "Прочее",
      Srok: p.shelf || "",
      KolUkl: (p.piecesPerLot > 0) ? p.piecesPerLot : 1,
      // BaseCenaOTP — базовая цена с НДС; для акционных позиций базой служит старая цена
      BaseCenaOTP: round2(Number(p.oldPrice || p.price) || 0),
      // ТЗ: пустой KolshtOrdmin означает, что продукция грузится только лотками
      KolshtOrdmin: p.lotOnly ? null : (Number(p.minOrder) || 1),
      Group: /Заморо/i.test(p.category || "") ? GROUP_ZPF : GROUP_HBI,
      lk_basePrice: round2(Number(p.price) || 0),
      lk_promo: !!p.isPromo
    };
  });
  function findProd(idPrd: unknown): CatalogRow | undefined { return CATALOG.find(function(x){ return x.id_prd === Number(idPrd); }); }

  // ---------- МАТРИЦА ПРОДУКЦИИ ПО ПОЛУЧАТЕЛЯМ ----------
  // В КИС ассортимент и цена индивидуальны для каждого получателя:
  // у сети своя скидка, у точки — свой набор позиций.
  var MATRIX: Record<number, MatrixRow[]> = {};   // {outletId: [{id_prd, ProcSkd, CenaOTP, ...}]}
  function buildMatrix(){
    OUTLETS.forEach(function(o){
      var b = findBuyer(o.buyerId);
      var rb = seed(o.buyerId * 37 + 11);
      // скидка покупателя: у сетей глубже
      var disc = round2((b?.segment === "Сеть" ? 12 : 4) + rb() * 7);
      var ro = seed(o.id * 13 + 7);
      var rows: MatrixRow[] = [];
      CATALOG.forEach(function(p){
        // ~80% ассортимента у точки; «Современные хлеба» есть почти везде (бывшая «Новая продукция»)
        var always = /Современные хлеба/i.test(p.MarketingGroup);
        if(!always && ro() > 0.8) return;
        // Скидка клиента действует на весь ассортимент; на промо-позициях она глубже.
        // Признака акции в ТЗ нет — он выводится из того, что ProcSkd выше базовой.
        var pDisc = disc + (p.lk_promo ? 8 + ro()*7 : 0);
        var cena = round2(p.lk_basePrice * (1 - pDisc/100));
        var realDisc = p.BaseCenaOTP > 0 ? round2((1 - cena/p.BaseCenaOTP) * 100) : 0;
        rows.push({
          id_prd: p.id_prd, KodProd: p.KodProd, NameProd: p.NameProd,
          Vesprod: p.Vesprod, MarketingGroup: p.MarketingGroup, Srok: p.Srok,
          KolUkl: p.KolUkl, BaseCenaOTP: p.BaseCenaOTP,
          ProcSkd: realDisc, CenaOTP: cena,
          KolshtOrdmin: p.KolshtOrdmin, Group: p.Group
        });
      });
      MATRIX[o.id] = rows;
    });
  }
  function matrixFor(outletId: number, group: unknown): MatrixRow[] {
    var rows = MATRIX[Number(outletId)] || [];
    if(group === null || group === undefined || group === '') return rows;
    return rows.filter(function(r){ return r.Group === Number(group); });
  }
  function priceFor(outletId: number, idPrd: unknown): MatrixRow | null {
    var row = (MATRIX[Number(outletId)] || []).find(function(r){ return r.id_prd === Number(idPrd); });
    return row || null;
  }
  function quantityRuleError(row: MatrixRow | null, qty: unknown): string {
    if (!row) return "Товар отсутствует в матрице получателя";
    var q = Number(qty), perLot = Number(row && row.KolUkl) || 1;
    if(!Number.isInteger(q) || q <= 0) return "Количество должно быть целым и больше нуля";
    var minimum = row.KolshtOrdmin == null ? perLot : Math.max(1, Number(row.KolshtOrdmin) || 1);
    if(q < minimum) return "Минимальное количество для товара " + row.KodProd + ": " + minimum + " шт.";
    if(row.KolshtOrdmin == null && q % perLot !== 0) return "Товар " + row.KodProd + " отгружается только лотками по " + perLot + " шт.";
    return "";
  }

  // ---------- ОГРАНИЧЕНИЯ ПО ДНЯМ НЕДЕЛИ ----------
  // В КИС приходит ClientDayOfWeek. Демо-данные выводим из старого графика точки.
  function clientDaysOfWeek(o: MockOutlet): number[] {
    var sch = o.deliverySchedule || [];
    var days: number[] = [];
    for(var i=0;i<7;i++){ if(sch[i] && sch[i].length) days.push(i); }
    if(!days.length) days = [0,1,2,3,4];
    return days;
  }
  function daysLabel(days: number[]): string[] {
    if(days.length === 7) return ["Ежедневно"];
    return days.map(function(i){ return WD_SHORT[i]; });
  }
  // Пн=0..Вс=6
  function ruDow(d: Date): number { return (d.getDay() + 6) % 7; }
  function outletAcceptsDate(o: MockOutlet, dateObj: Date): boolean {
    return clientDaysOfWeek(o).indexOf(ruDow(dateObj)) >= 0;
  }
  function findBuyerByCode(code: unknown): MockBuyer | undefined { var c=norm(code); return BUYERS.find(function(b){return norm(b.code)===c}); }
  function findOutletByCode(code: unknown): MockOutlet | undefined { var c=norm(code); return OUTLETS.find(function(o){return norm(o.code)===c}); }
  function findBuyer(id: unknown): MockBuyer | undefined { return BUYERS.find(function(b){return b.id===Number(id)}); }
  function findOutlet(id: unknown): MockOutlet | undefined { return OUTLETS.find(function(o){return o.id===Number(id)}); }

  // Расчёт эффективного статуса отгрузки
  // Приоритет:
  //   1. нет договора (hasContract=false) → blocked
  //   2. shipmentMode=blocked → blocked (с ручной причиной)
  //   3. shipmentMode=balance и balance<0 → blocked (по сальдо)
  //   4. иначе → allowed
  // Самое первое срабатывает — остальные проверки не выполняются.
  function effectiveShipment(buyer: MockBuyer): { state: 'allowed' | 'blocked'; reason: string | null; cause: 'no_contract' | 'manual' | 'balance' | null } {
    if(buyer.hasContract === false){
      return {state:"blocked", reason:"Нет действующего договора поставки", cause:"no_contract"};
    }
    if(buyer.shipmentMode==="blocked") return {state:"blocked", reason: buyer.shipmentBlockReason || "Отгрузка временно приостановлена", cause:"manual"};
    if(buyer.shipmentMode==="balance"){
      if((buyer.balance||0) < 0) return {state:"blocked", reason:"Отрицательное сальдо: "+ new Intl.NumberFormat('ru-RU').format(buyer.balance) +" ₽", cause:"balance"};
      return {state:"allowed", reason:null, cause:null};
    }
    return {state:"allowed", reason:null, cause:null};
  }

  // ---------- СЕРИАЛИЗАТОРЫ КИС ----------
  // Поля и имена — как в ТЗ ver.2. Локальные поля (договор, телефоны, площадка)
  // КИС не отдаёт: они приходят из справочника ЛК и помечены префиксом lk_.
  function payerKIS(b: MockBuyer) {
    var eff = effectiveShipment(b);
    return {
      Id_pay: payerKisId(b.id),
      KodPay: b.code,
      NamePay: b.name,
      Adres: b.legal || b.name,
      NamePRV: b.shipmentMode === "balance" ? "Расчет текущего сальдо"
             : (b.shipmentMode === "blocked" ? "Отгрузка запрещена" : "Без ограничений"),
      SumOutSaldoCalc: round2(b.balance || 0),
      OrdLimitMinSum: round2(b.minOrderSum || 0),
      Manager: b.manager,
      // -- поля ЛК, которых нет в КИС --
      lk_id: b.id,
      lk_managerPhone: b.managerPhone || null,
      lk_inn: b.inn || null,
      lk_hasContract: b.hasContract !== false,
      lk_contractNumber: b.contractNumber || null,
      lk_contractDate: b.contractDate || null,
      lk_paymentDeferralDays: b.paymentDeferralDays || 0,
      lk_segment: b.segment || null,
      lk_shipmentEffective: eff.state,
      lk_shipmentEffectiveReason: eff.reason,
      lk_shipmentEffectiveCause: eff.cause || null,
      // -- баг, унаследованный от vanilla-версии: эти поля нужны Профилю,
      // но adaptPayer их не читал, т.к. payerKIS их не отдавал вовсе --
      lk_email: b.email || null,
      lk_sinceYear: b.sinceYear || null,
      lk_shipmentMode: b.shipmentMode || null,
      lk_shipmentBlockReason: b.shipmentBlockReason || null,
      lk_usesEdi: !!b.usesEdi,
      lk_ediClientCode: b.ediClientCode || null,
      lk_badges: b.badges || [],
      Clients: outletsOfBuyer(b.id).map(clientKIS)
    };
  }
  function clientKIS(o: MockOutlet) {
    var days = clientDaysOfWeek(o);
    return {
      Id_pay: payerKisId(o.buyerId),
      id_clt: clientKisId(o.id),
      KodClt: o.code,
      NameClt: o.name,
      Adres: o.address,
      OrdLimitMinSum: round2(o.minOrderSum || 0),
      TorgPred: o.rep || null,
      ClientDayOfWeek: daysLabel(days),
      // -- поля ЛК --
      lk_id: o.id,
      lk_buyerId: o.buyerId,
      lk_days: days,
      lk_phones: o.phones || [],
      lk_repPhone: o.repPhone || null,
      lk_receiver: o.receiver || null,
      lk_dispatchPhone: (PLATFORMS[o.platform] && PLATFORMS[o.platform].phone) || null,
      lk_dispatchPlatformName: (PLATFORMS[o.platform] && PLATFORMS[o.platform].name) || null
    };
  }
  function orderKIS(o: MockOrder) {
    var ol = findOutlet(o.outletId);
    return {
      id_clt: clientKisId(o.outletId),
      KodClt: ol?.code || '',
      NameClt: ol?.name || '',
      Adres: ol?.address || '',
      Id_ord: o.id,
      NumOrd: o.orderNumber,
      DateOrdClt: o.createdAtUnix,
      DateOrd: o.deliveryUnix,
      Group: o.group,
      KolSht: o.totalUnits,
      SumAll: round2(o.total),
      State: o.state,
      // -- поля ЛК --
      lk_outletId: o.outletId,
      lk_buyerId: o.buyerId,
      lk_source: o.source
    };
  }
  function orderDetailsKIS(o: MockOrder) {
    return {
      id_ord: o.id,
      Group: o.group,
      Product: o.items.map(function(it: MockOrderLine){
        return {
          id_prd: it.id_prd,
          KodProd: it.KodProd,
          NameProd: it.NameProd,
          CenaOTP: round2(it.CenaOTP),
          Kolsht: it.Kolsht,
          KolVzv: it.KolVzv || 0,
          SumAll: round2(it.CenaOTP * it.Kolsht),
          lk_KolUkl: it.KolUkl || 1,
          lk_minOrder: priceFor(o.outletId, it.id_prd)?.KolshtOrdmin ?? null,
          lk_lotOnly: priceFor(o.outletId, it.id_prd)?.KolshtOrdmin == null
        };
      })
    };
  }

  // ---------- ЗАКАЗЫ ----------
  // Заказ принадлежит покупателю И конкретной точке
  var ORDERS_BY_BUYER: Record<number, MockOrder[]> = {};   // {buyerId: [orders]}
  var ORDERS_BY_OUTLET: Record<number, MockOrder[]> = {};  // {outletId: [orders]}
  function findOrderById(id: unknown): MockOrder | null {
    var want = Number(id);
    for (const orders of Object.values(ORDERS_BY_BUYER)) {
      const found = orders.find(function(o){ return o.id === want; });
      if (found) return found;
    }
    return null;
  }
  function _pushOrder(o: MockOrder): void {
    (ORDERS_BY_BUYER[o.buyerId] = ORDERS_BY_BUYER[o.buyerId]||[]).push(o);
    (ORDERS_BY_OUTLET[o.outletId] = ORDERS_BY_OUTLET[o.outletId]||[]).push(o);
  }

  function buildOrders(){
    BUYERS.forEach(function(b){
      outletsOfBuyer(b.id).forEach(function(ol){
        var r = seed(ol.id*137), base = 100000 + b.id*1000 + (ol.id%1000)*10;
        var rows = matrixFor(ol.id, null);
        if(!rows.length) return;
        // ТЗ: история — заказы за последние 14 дней плюс все незавершённые
        for(var i=0;i<6;i++){
          var back = i===0 ? -2 : i===1 ? -1 : (i-1)*3 + Math.floor(r()*2);
          var delivery = daysAgo(back), created = daysAgo(back+1);
          // дата поставки должна попадать в разрешённые дни недели точки
          var guard = 0;
          while(!outletAcceptsDate(ol, delivery) && guard++ < 7){
            delivery.setDate(delivery.getDate() + (back < 0 ? 1 : -1));
          }
          var state = back < 0 ? (back <= -2 ? STATE_ACCEPTED : STATE_ONWAY)
                               : (back <= 1 ? STATE_SHIPPED : STATE_SHIPPED);
          if(back === 0) state = STATE_ROUTED;
          // заказ целиком в одной группе — в КИС ЗПФ и ХБИ не смешиваются
          var grp = (i % 4 === 3) ? GROUP_ZPF : GROUP_HBI;
          var pool = rows.filter(function(x){ return x.Group === grp; }).slice();
          if(!pool.length){ grp = GROUP_HBI; pool = rows.filter(function(x){ return x.Group === grp; }).slice(); }
          if(!pool.length) continue;
          var cnt = 3 + Math.floor(r()*5), chosen: MockOrderLine[] = [];
          for(var j=0;j<cnt && pool.length;j++){
            var row = pool.splice(Math.floor(r()*pool.length), 1)[0];
            var minQ = row.KolshtOrdmin || row.KolUkl;
            var qty = Math.max(minQ, 5 + Math.floor(r()*40));
            if(row.KolshtOrdmin == null) qty = Math.max(1, Math.round(qty/row.KolUkl)) * row.KolUkl;
            chosen.push({
              id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
              KolUkl: row.KolUkl, Kolsht: qty, CenaOTP: row.CenaOTP,
              KolVzv: (state === STATE_SHIPPED && r() > 0.75) ? Math.floor(r()*3) : 0
            });
          }
          var totalUnits = chosen.reduce(function(a,c){ return a + c.Kolsht; }, 0);
          var totalSum = round2(chosen.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
          _pushOrder({
            id: base+i, orderNumber: base+i, buyerId: b.id, outletId: ol.id,
            group: grp,
            deliveryUnix: toUnix(delivery), createdAtUnix: toUnix(created),
            state: state, source: SOURCES[Math.floor(r()*SOURCES.length)] || 'web',
            items: chosen, totalUnits: totalUnits, total: totalSum
          });
        }
      });
    });
    Object.keys(ORDERS_BY_BUYER).forEach(function(k){ ORDERS_BY_BUYER[Number(k)].sort(function(a,b){return b.orderNumber-a.orderNumber}) });
    Object.keys(ORDERS_BY_OUTLET).forEach(function(k){ ORDERS_BY_OUTLET[Number(k)].sort(function(a,b){return b.orderNumber-a.orderNumber}) });
  }

  var DOCS: Record<number, MockDocument[]> = {};
  function buildDocs(){
    BUYERS.forEach(function(b){
      var firstOrder = (ORDERS_BY_BUYER[b.id]||[])[0];
      DOCS[b.id]=[
        {
          id:1,
          kind:"declaration",
          number:"Приложение к ТТН №1438025",
          orderId: firstOrder?.id ?? null,
          title:"Перечень действующих документов о соответствии на поставляемую продукцию",
          date:"2026-08-06",
          href:"docs/Reestr-deklaratsii-sootvetstviia.pdf"
        },
        {
          id:2,
          kind:"pricelist",
          number:"Прайс-лист",
          orderId:null,
          title:"Прайс-лист на продукцию",
          date:"2026-08-01",
          href:"#"
        }
      ];
    });
  }

  buildMatrix();
  buildOrders();
  buildDocs();
  var nextOrderNum = 200999;

  // ---------- FETCH ----------
  function jsonResp(obj: unknown, status = 200): Response {return new Response(JSON.stringify(obj), {status, headers:{"Content-Type":"application/json"}})}
  // ТЗ ver.3: 204 (No Content) — ответ без тела (реальный fetch не даёт создать Response
  // с телом и статусом 204/205/304 — поэтому пустой ответ строим отдельно)
  function emptyResp(status = 204): Response { return new Response(null, {status}); }
  function parsePath(url: string): string {
    try{ var u = new URL(url, location.origin); return u.pathname.replace(/^\/port\/5000/, ""); }catch(e){ return String(url).replace(/^\/port\/5000/, ""); }
  }

  var _fetch: typeof window.fetch = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    var url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    var path = parsePath(url);
    var method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!/^\/api\//.test(path) || /^\/api\/(collections|files)\//.test(path)) return _fetch(input, init);

    // query-параметр запроса
    function qp(name: string): string | null {
      try { return new URL(url, location.origin || "http://x").searchParams.get(name); }
      catch(e){
        var m = String(url).match(new RegExp("[?&]" + name + "=([^&]*)"));
        return m ? decodeURIComponent(m[1]) : null;
      }
    }
    function body(): MockRequestBody {
      try{ return typeof init?.body === 'string' ? JSON.parse(init.body) as MockRequestBody : {}; }catch(e){ return {}; }
    }

    // ---------- LOGIN ----------
    // Возможные комбинации (см. шапку файла).
    if (path === "/api/login" && method === "POST") {
      var b0 = body();
      var code = norm(b0.code);
      var hasDemoKey = Boolean(String(b0.password||""));

      // Демо-контур проверяет известный код и наличие одноразового ключа из UI.
      // Реальные учётные данные здесь намеренно не хранятся.
      var buyerByCode = findBuyerByCode(code);
      if(buyerByCode && hasDemoKey){
        return Promise.resolve(jsonResp({
          role:"buyer", scope:"all-outlets",
          payer: payerKIS(buyerByCode)
        }));
      }

      // Код точки открывает роль получателя только для этой точки.
      var outlet = findOutletByCode(code);
      if(outlet && hasDemoKey){
        var buyer = findBuyer(outlet.buyerId);
        if (!buyer) return Promise.resolve(jsonResp({error:"buyer_not_found"}, 404));
        return Promise.resolve(jsonResp({
          role:"outlet", scope:"single-outlet",
          payer: payerKIS(buyer),
          client: clientKIS(outlet)
        }));
      }

      return Promise.resolve(jsonResp({error:"invalid_credentials"}, 401));
    }

    // ---------- LOOKUP (для доверенного вида) ----------
    if (path === "/api/lookup" && method === "GET") {
      var lq;
      try{ lq = new URL(url, location.origin).searchParams.get('code')||''; }catch(e){ lq = ''; }
      var lcode = norm(lq);
      var lb = findBuyerByCode(lcode);
      if(lb) return Promise.resolve(jsonResp({kind:"buyer", id:lb.id, code:lb.code, name:lb.name, segment:lb.segment}));
      var lo = findOutletByCode(lcode);
      if(lo){
        var lbo = findBuyer(lo.buyerId);
        return Promise.resolve(jsonResp({kind:"outlet", id:lo.id, code:lo.code, name:lo.name, buyerName: lbo && lbo.name}));
      }
      return Promise.resolve(jsonResp({error:"not_found"}, 404));
    }

    // =====================================================================
    // API v1 — методы КИС по ТЗ «Личный кабинет клиента» ver.3
    // Ресурсы сгруппированы как /payers, /clients, /orders. Даты — Unix-таймстемпы.
    // =====================================================================
    var V1 = "/api/v1";

    // I.1 Данные покупателя: GET /api/v1/payers/{id_pay}
    var mPayer = path.match(/^\/api\/v1\/payers\/(\d+)$/);
    if (mPayer && method === "GET") {
      var payerId = Number(mPayer[1]);
      var pb = BUYERS.find(function(x){ return payerKisId(x.id) === payerId; });
      if(!pb) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      return Promise.resolve(jsonResp(payerKIS(pb)));
    }

    // I.2 Получатели покупателя: GET /api/v1/payers/{id_pay}/clients
    var mPayerClients = path.match(/^\/api\/v1\/payers\/(\d+)\/clients$/);
    if (mPayerClients && method === "GET") {
      var payerClientsId = Number(mPayerClients[1]);
      var cb = BUYERS.find(function(x){ return payerKisId(x.id) === payerClientsId; });
      if(!cb) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      return Promise.resolve(jsonResp({
        Id_pay: payerKisId(cb.id),
        Clients: outletsOfBuyer(cb.id).map(clientKIS)
      }));
    }

    // I.3 Заказы покупателя (по всем получателям): GET /api/v1/payers/{id_pay}/orders?offset=&limit=
    var mPayerOrders = path.match(/^\/api\/v1\/payers\/(\d+)\/orders$/);
    if (mPayerOrders && method === "GET") {
      var payerOrdersId = Number(mPayerOrders[1]);
      var ob = BUYERS.find(function(x){ return payerKisId(x.id) === payerOrdersId; });
      if(!ob) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет покупателя
      var list = (ORDERS_BY_BUYER[ob.id] || []).slice();
      // ТЗ: заказы за последние 14 дней плюс все незавершённые
      var edge = toUnix(daysAgo(14));
      list = list.filter(function(o){
        return o.deliveryUnix >= edge || (o.state !== STATE_SHIPPED && o.state !== STATE_DELETED);
      });
      if(!list.length) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет заказов за 14 дней
      var total = list.length;
      var off = Number(qp('offset') || 0), lim = Number(qp('limit') || 0);
      if(off) list = list.slice(off);
      if(lim) list = list.slice(0, lim);
      return Promise.resolve(jsonResp({
        id_pay: payerKisId(ob.id),
        lk_total: total,
        Orders: list.map(orderKIS)
      }));
    }

    // II.1 Информация по получателю: GET /api/v1/clients/{id_clt}
    var mClientOne = path.match(/^\/api\/v1\/clients\/(\d+)$/);
    if (mClientOne && method === "GET") {
      var clientOneId = Number(mClientOne[1]);
      var co1 = OUTLETS.find(function(x){ return clientKisId(x.id) === clientOneId; });
      if(!co1) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      return Promise.resolve(jsonResp(clientKIS(co1)));
    }

    // II.2 Матрица продукции с ценами: GET /api/v1/clients/{id_clt}/matrix?DateOrd=&Group=
    var mMatrix = path.match(/^\/api\/v1\/clients\/(\d+)\/matrix$/);
    if (mMatrix && method === "GET") {
      var matrixClientId = Number(mMatrix[1]);
      var mo = OUTLETS.find(function(x){ return clientKisId(x.id) === matrixClientId; });
      if(!mo) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      var dateOrd = qp('DateOrd'), grp = qp('Group');
      if(!dateOrd) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(grp === null || grp === '') return Promise.resolve(jsonResp({detail:"Некорректный параметр Group"}, 400));
      var dObj = fromUnix(dateOrd);
      if(isNaN(dObj.getTime())) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(!outletAcceptsDate(mo, dObj)){
        return Promise.resolve(jsonResp({
          detail: "Получатель не принимает поставку в этот день недели",
          ClientDayOfWeek: daysLabel(clientDaysOfWeek(mo))
        }, 400));
      }
      return Promise.resolve(jsonResp({
        id_clt: clientKisId(mo.id),
        DateOrd: Number(dateOrd),
        Group: Number(grp),
        Product: matrixFor(mo.id, grp)
      }));
    }

    // II.3 Заказы получателя: GET /api/v1/clients/{id_clt}/orders?last=1
    // За 14 дней + незавершённые. last=1 — только последний принятый заказ.
    var mClientOrders = path.match(/^\/api\/v1\/clients\/(\d+)\/orders$/);
    if (mClientOrders && method === "GET") {
      var clientOrdersId = Number(mClientOrders[1]);
      var co2 = OUTLETS.find(function(x){ return clientKisId(x.id) === clientOrdersId; });
      if(!co2) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      var list2 = (ORDERS_BY_OUTLET[co2.id] || []).slice();
      var edge2 = toUnix(daysAgo(14));
      list2 = list2.filter(function(o){
        return o.deliveryUnix >= edge2 || (o.state !== STATE_SHIPPED && o.state !== STATE_DELETED);
      });
      if(qp('last') === '1'){
        var lastAcc = list2.filter(function(o){ return o.state === STATE_ACCEPTED; })
                          .sort(function(a,b){ return b.createdAtUnix - a.createdAtUnix; })[0];
        list2 = lastAcc ? [lastAcc] : [];
      }
      if(!list2.length) return Promise.resolve(emptyResp(204)); // ТЗ: 204 — нет заказов за 14 дней
      return Promise.resolve(jsonResp({
        id_clt: clientKisId(co2.id),
        Orders: list2.map(orderKIS)
      }));
    }

    // III.2 Детализация заказа: GET /api/v1/orders/{id_ord}
    var mDet = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mDet && method === "GET") {
      var dord = findOrderById(mDet[1]);
      if(!dord) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      return Promise.resolve(jsonResp(orderDetailsKIS(dord)));
    }

    // III.1 Создать заказ: POST /api/v1/orders/
    if ((path === V1 + "/orders" || path === V1 + "/orders/") && method === "POST") {
      var nb = body();
      const nOut = OUTLETS.find(function(x){ return clientKisId(x.id) === Number(nb.Id_clt); });
      if(!nOut) return Promise.resolve(jsonResp({detail:"Некорректный параметр Id_clt"}, 400));
      const nBuyer = findBuyer(nOut.buyerId);
      if(!nBuyer) return Promise.resolve(jsonResp({detail:"Покупатель не найден"}, 404));
      if(!nb.DateOrd) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      var nDate = fromUnix(nb.DateOrd);
      if(isNaN(nDate.getTime())) return Promise.resolve(jsonResp({detail:"Некорректный параметр DateOrd"}, 400));
      if(!outletAcceptsDate(nOut, nDate)){
        return Promise.resolve(jsonResp({
          detail: "Получатель не принимает поставку в этот день недели",
          ClientDayOfWeek: daysLabel(clientDaysOfWeek(nOut))
        }, 422));
      }
      var nItems = (nb.Product || []).map(function(it): MockOrderLine | null {
        var row = priceFor(nOut.id, it.Id_prd != null ? it.Id_prd : it.id_prd);
        if(!row) return null;
        return {
          id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
          KolUkl: row.KolUkl, Kolsht: Number(it.KolSht) || 0,
          CenaOTP: row.CenaOTP, KolVzv: 0
        };
      }).filter((x): x is MockOrderLine => Boolean(x && x.Kolsht > 0));
      if(!nItems.length) return Promise.resolve(jsonResp({detail:"Некорректный параметр Product"}, 400));
      var invalidN = nItems.find(function(it){ return quantityRuleError(priceFor(nOut.id, it.id_prd), it.Kolsht); });
      if(invalidN){
        return Promise.resolve(jsonResp({detail:quantityRuleError(priceFor(nOut.id, invalidN.id_prd), invalidN.Kolsht), lk_error:"invalid_quantity"}, 422));
      }
      // все позиции заказа должны быть из одной группы
      var grpSet: Record<number, true> = {};
      nItems.forEach(function(it){
        var row = priceFor(nOut.id, it.id_prd);
        if(row) grpSet[row.Group] = true;
      });
      if(Object.keys(grpSet).length > 1){
        return Promise.resolve(jsonResp({detail:"Некорректный параметр Group: ЗПФ и ХБИ нельзя смешивать в одном заказе"}, 400));
      }
      var nGroup = Number(Object.keys(grpSet)[0]);
      var nUnits = nItems.reduce(function(a,c){ return a + c.Kolsht; }, 0);
      var nSum = round2(nItems.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
      // минимальная сумма: приоритет у получателя
      var nMin = (nOut.minOrderSum != null ? nOut.minOrderSum : nBuyer.minOrderSum) || 0;
      if(nSum < nMin){
        return Promise.resolve(jsonResp({
          detail: "Сумма заказа ниже минимальной для получателя",
          lk_error: "below_min_sum", lk_minSum: nMin, lk_total: nSum
        }, 400));
      }
      // ТЗ ver.3: 402 — не хватает средств (нет договора / ручная блокировка / отрицательное сальдо)
      var nEff = effectiveShipment(nBuyer);
      if(nEff.state === "blocked"){
        return Promise.resolve(jsonResp({
          detail: "Не хватает средств для оплаты заказа. Обратитесь к менеджеру",
          lk_cause: nEff.cause, lk_reason: nEff.reason
        }, 402));
      }
      nextOrderNum++;
      var nOrder: MockOrder = {
        id: nextOrderNum, orderNumber: nextOrderNum,
        buyerId: nBuyer.id, outletId: nOut.id, group: nGroup,
        deliveryUnix: Number(nb.DateOrd), createdAtUnix: toUnix(new Date()),
        state: STATE_ACCEPTED, source: "web",
        items: nItems, totalUnits: nUnits, total: nSum
      };
      _pushOrder(nOrder);
      ORDERS_BY_BUYER[nBuyer.id].sort(function(a,b){ return b.orderNumber - a.orderNumber; });
      ORDERS_BY_OUTLET[nOut.id].sort(function(a,b){ return b.orderNumber - a.orderNumber; });
      return Promise.resolve(jsonResp(orderKIS(nOrder)));
    }

    // III.4 Удалить заказ: DELETE /api/v1/orders/{id_ord}
    var mDelete = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mDelete && method === "DELETE") {
      var sOrd = findOrderById(mDelete[1]);
      if(!sOrd) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      if(sOrd.state !== STATE_ACCEPTED){
        return Promise.resolve(jsonResp({detail:"Заказ маршрутизирован, изменения запрещены"}, 422));
      }
      sOrd.state = STATE_DELETED;
      return Promise.resolve(jsonResp({Id_ord: sOrd.id, State: sOrd.state}));
    }

    // III.3 Изменить заказ: PUT /api/v1/orders/{id_ord}
    var mPut = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (mPut && method === "PUT") {
      const uOrd = findOrderById(mPut[1]);
      if(!uOrd) return Promise.resolve(jsonResp({detail:"Заказ не найден"}, 404));
      if(uOrd.state !== STATE_ACCEPTED){
        return Promise.resolve(jsonResp({detail:"Заказ маршрутизирован, изменения запрещены"}, 422));
      }
      var ub = body();
      var uOut = findOutlet(uOrd.outletId);
      if (!uOut) return Promise.resolve(jsonResp({detail:"Получатель не найден"}, 404));
      var uItems = (ub.Product || []).map(function(it): MockOrderLine | null {
        var row = priceFor(uOrd.outletId, it.Id_prd != null ? it.Id_prd : it.id_prd);
        if(!row) return null;
        return {
          id_prd: row.id_prd, KodProd: row.KodProd, NameProd: row.NameProd,
          KolUkl: row.KolUkl, Kolsht: Number(it.KolSht) || 0,
          CenaOTP: row.CenaOTP, KolVzv: 0
        };
      }).filter((x): x is MockOrderLine => Boolean(x && x.Kolsht > 0));
      if(!uItems.length) return Promise.resolve(jsonResp({detail:"Некорректный параметр Product"}, 400));
      var invalidU = uItems.find(function(it){ return quantityRuleError(priceFor(uOrd.outletId, it.id_prd), it.Kolsht); });
      if(invalidU){
        return Promise.resolve(jsonResp({detail:quantityRuleError(priceFor(uOrd.outletId, invalidU.id_prd), invalidU.Kolsht), lk_error:"invalid_quantity"}, 422));
      }
      var uBuyer = findBuyer(uOrd.buyerId);
      if (!uBuyer) return Promise.resolve(jsonResp({detail:"Покупатель не найден"}, 404));
      var uSum = round2(uItems.reduce(function(a,c){ return a + c.CenaOTP*c.Kolsht; }, 0));
      var uMin = (uOut.minOrderSum != null ? uOut.minOrderSum : uBuyer.minOrderSum) || 0;
      if(uSum < uMin){
        return Promise.resolve(jsonResp({
          detail: "Сумма заказа ниже минимальной для получателя",
          lk_error: "below_min_sum", lk_minSum: uMin, lk_total: uSum
        }, 400));
      }
      // ТЗ ver.3: 402 — не хватает средств (правка заказа тоже упирается в баланс)
      var uEff = effectiveShipment(uBuyer);
      if(uEff.state === "blocked"){
        return Promise.resolve(jsonResp({
          detail: "Не хватает средств для оплаты заказа. Обратитесь к менеджеру",
          lk_cause: uEff.cause, lk_reason: uEff.reason
        }, 402));
      }
      uOrd.items = uItems;
      uOrd.totalUnits = uItems.reduce(function(a,c){ return a + c.Kolsht; }, 0);
      uOrd.total = uSum;
      return Promise.resolve(jsonResp({
        Id_ord: uOrd.id, KolSht: uOrd.totalUnits, SumAll: uOrd.total, State: uOrd.state
      }));
    }

    // ---------- ДОКУМЕНТЫ (нет в ТЗ, справочник ЛК) ----------
    var mDocs = path.match(/^\/api\/buyers\/(\d+)\/documents$/);
    if (mDocs && method === "GET") {
      return Promise.resolve(jsonResp(DOCS[Number(mDocs[1])] || []));
    }

    return Promise.resolve(jsonResp({detail:"Не найдено: "+path}, 404));
  };

})();
