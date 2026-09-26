(function () {
  "use strict";

  var VERSION = "3.6.4";
  var DEMO_PAYERS = {
    991100: {
      id: 991100,
      code: "DEMO-P100",
      name: "ООО «Северная торговая сеть»",
      legal: "ООО «Северная торговая сеть»",
      manager: "Анна Смирнова",
      managerPhone: "+7 (000) 000-01-00",
      balance: 186420.7,
      minOrderSum: 2500,
      shipmentRule: "Без ограничений",
      inn: "7800000100",
      segment: "Розничная сеть",
      hasContract: true,
      contractNumber: "ДЕМО-100/26",
      contractDate: "2026-01-15",
      paymentDeferralDays: 14,
      email: "finance.p100@example.invalid",
      sinceYear: 2018,
      shipmentMode: "allowed",
      shipmentBlockReason: null,
      shipmentEffective: "allowed",
      shipmentEffectiveReason: null,
      shipmentEffectiveCause: null,
      usesEdi: true,
      ediClientCode: "DEMO-EDI-P100",
      badges: ["Демо-данные", "Договор действует"]
    },
    991200: {
      id: 991200,
      code: "DEMO-P200",
      name: "ООО «Городские кафе»",
      legal: "ООО «Городские кафе»",
      manager: "Михаил Орлов",
      managerPhone: "+7 (000) 000-02-00",
      balance: 48750.25,
      minOrderSum: 1800,
      shipmentRule: "Без ограничений",
      inn: "7800000200",
      segment: "HoReCa",
      hasContract: true,
      contractNumber: "ДЕМО-200/26",
      contractDate: "2026-02-03",
      paymentDeferralDays: 7,
      email: "finance.p200@example.invalid",
      sinceYear: 2021,
      shipmentMode: "allowed",
      shipmentBlockReason: null,
      shipmentEffective: "allowed",
      shipmentEffectiveReason: null,
      shipmentEffectiveCause: null,
      usesEdi: false,
      ediClientCode: null,
      badges: ["Демо-данные", "HoReCa"]
    }
  };

  var DEMO_CLIENTS = {
    991101: {
      id: 991101,
      id_clt: 991101,
      buyerId: 991100,
      code: "DEMO-C101",
      name: "Магазин «Северный» · Невский",
      address: "Санкт-Петербург, Невский проспект, демонстрационная точка 1",
      minOrderSum: 2500,
      rep: "Ирина Лебедева",
      days: [0, 1, 2, 3, 4, 5, 6],
      daysLabel: "Ежедневно",
      phones: ["+7 (000) 000-01-01"],
      repPhone: "+7 (000) 000-01-11",
      receiver: "Ольга Кузнецова",
      dispatchPhone: "+7 (000) 000-01-21",
      dispatchPlatformName: "Каравай"
    },
    991102: {
      id: 991102,
      id_clt: 991102,
      buyerId: 991100,
      code: "DEMO-C102",
      name: "Магазин «Северный» · Парнас",
      address: "Санкт-Петербург, Парнас, демонстрационная точка 2",
      minOrderSum: 2500,
      rep: "Ирина Лебедева",
      days: [0, 1, 2, 3, 4, 5, 6],
      daysLabel: "Ежедневно",
      phones: ["+7 (000) 000-01-02"],
      repPhone: "+7 (000) 000-01-12",
      receiver: "Светлана Морозова",
      dispatchPhone: "+7 (000) 000-01-22",
      dispatchPlatformName: "Кушелевка"
    },
    991201: {
      id: 991201,
      id_clt: 991201,
      buyerId: 991200,
      code: "DEMO-C201",
      name: "Кафе «Маяк» · Московский",
      address: "Санкт-Петербург, Московский проспект, демонстрационная точка 3",
      minOrderSum: 1800,
      rep: "Сергей Волков",
      days: [0, 1, 2, 3, 4, 5, 6],
      daysLabel: "Ежедневно",
      phones: ["+7 (000) 000-02-01"],
      repPhone: "+7 (000) 000-02-11",
      receiver: "Мария Соколова",
      dispatchPhone: "+7 (000) 000-02-21",
      dispatchPlatformName: "Заря"
    },
    991202: {
      id: 991202,
      id_clt: 991202,
      buyerId: 991200,
      code: "DEMO-C202",
      name: "Кафе «Маяк» · Купчино",
      address: "Санкт-Петербург, Купчино, демонстрационная точка 4",
      minOrderSum: 1800,
      rep: "Сергей Волков",
      days: [0, 1, 2, 3, 4, 5, 6],
      daysLabel: "Ежедневно",
      phones: ["+7 (000) 000-02-02"],
      repPhone: "+7 (000) 000-02-12",
      receiver: "Елена Попова",
      dispatchPhone: "+7 (000) 000-02-22",
      dispatchPlatformName: "Каравай"
    }
  };

  var PRODUCTS = __KARAVAY_PRODUCTS_JSON__;
  var CATALOG = PRODUCTS.map(function (product, index) {
    var frozen = /заморо/i.test(product.category || "") || /^П\/ф/i.test(product.name || "");
    var price = Number(product.price) || 0;
    var basePrice = Number(product.oldPrice || product.price) || price;
    return {
      id_prd: 700001 + index,
      KodProd: String(product.code),
      NameProd: product.name,
      Vesprod: Number(product.weight) || 0,
      MarketingGroup: product.category || "Прочее",
      Srok: product.shelf || "",
      KolUkl: Math.max(1, Number(product.piecesPerLot) || 1),
      BaseCenaOTP: round2(basePrice),
      KolshtOrdmin: product.lotOnly ? null : Math.max(1, Number(product.minOrder) || 1),
      Group: frozen ? 0 : 1,
      demoPrice: round2(price),
      promo: Boolean(product.isPromo)
    };
  });

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function dateAtNoon(offsetDays) {
    var date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return date;
  }

  function unix(date) {
    return Math.floor(date.getTime() / 1000);
  }

  function isoDate(offsetDays) {
    var date = dateAtNoon(offsetDays);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function payerByCode(code) {
    return Object.values(DEMO_PAYERS).find(function (payer) { return payer.code === code; }) || null;
  }

  function clientByCode(code) {
    return Object.values(DEMO_CLIENTS).find(function (client) { return client.code === code; }) || null;
  }

  function clientsForPayer(payerId) {
    return Object.values(DEMO_CLIENTS).filter(function (client) { return client.buyerId === Number(payerId); });
  }

  function currentContext() {
    var value = globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__;
    return value && typeof value === "object" ? value : null;
  }

  function isPayerAllowed(payerId) {
    var context = currentContext();
    return !globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__ || !context || Number(context.payerId) === Number(payerId);
  }

  function isClientAllowed(clientId) {
    var context = currentContext();
    if (!globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__ || !context) return true;
    return Array.isArray(context.clientIds) && context.clientIds.map(Number).indexOf(Number(clientId)) >= 0;
  }

  function visibleClientsForPayer(payerId) {
    return clientsForPayer(payerId).filter(function (client) { return isClientAllowed(client.id); });
  }

  function canMutateOrders() {
    var context = currentContext();
    return Boolean(context && context.role !== "viewer");
  }

  function matrixFor(clientId, group) {
    var id = Number(clientId);
    var client = DEMO_CLIENTS[id];
    if (!client) return [];
    var payer = DEMO_PAYERS[client.buyerId];
    var baseDiscount = payer.id === 991100 ? 8 : 5;
    return CATALOG.filter(function (row, index) {
      if (Number(row.Group) !== Number(group)) return false;
      return (index + id) % 7 !== 0;
    }).map(function (row, index) {
      var discount = baseDiscount + ((index + id) % 4) + (row.promo ? 7 : 0);
      var price = round2(row.demoPrice * (1 - discount / 100));
      var realDiscount = row.BaseCenaOTP ? round2((1 - price / row.BaseCenaOTP) * 100) : 0;
      return {
        id_prd: row.id_prd,
        KodProd: row.KodProd,
        NameProd: row.NameProd,
        Vesprod: row.Vesprod,
        MarketingGroup: row.MarketingGroup,
        Srok: row.Srok,
        KolUkl: row.KolUkl,
        BaseCenaOTP: row.BaseCenaOTP,
        ProcSkd: realDiscount,
        CenaOTP: price,
        KolshtOrdmin: row.KolshtOrdmin,
        Group: row.Group
      };
    });
  }

  function productForClient(clientId, productId) {
    var all = matrixFor(clientId, 1).concat(matrixFor(clientId, 0));
    return all.find(function (row) { return row.id_prd === Number(productId); }) || null;
  }

  function quantityFor(row, multiplier) {
    if (row.KolshtOrdmin == null) return row.KolUkl * Math.max(1, multiplier);
    return Math.max(Number(row.KolshtOrdmin) || 1, multiplier * 4);
  }

  var ORDERS = [];
  var nextOrderId = 9960000;

  function addSeedOrder(client, index, state, offsetDays, group) {
    var pool = matrixFor(client.id, group);
    var start = (client.id + index * 5) % Math.max(1, pool.length);
    var items = [];
    for (var itemIndex = 0; itemIndex < 5 && itemIndex < pool.length; itemIndex += 1) {
      var row = pool[(start + itemIndex) % pool.length];
      var quantity = quantityFor(row, 1 + ((index + itemIndex) % 2));
      items.push({
        id_prd: row.id_prd,
        KodProd: row.KodProd,
        NameProd: row.NameProd,
        KolUkl: row.KolUkl,
        Kolsht: quantity,
        CenaOTP: row.CenaOTP,
        KolVzv: state === "Отгружен" && itemIndex === 2 ? 1 : 0
      });
    }
    var totalUnits = items.reduce(function (sum, item) { return sum + item.Kolsht; }, 0);
    var total = round2(items.reduce(function (sum, item) { return sum + item.Kolsht * item.CenaOTP; }, 0));
    var id = 9900000 + (client.id - 991000) * 100 + index;
    ORDERS.push({
      id: id,
      orderNumber: 640000 + (client.id - 991000) * 10 + index,
      buyerId: client.buyerId,
      outletId: client.id,
      group: group,
      deliveryUnix: unix(dateAtNoon(offsetDays)),
      createdAtUnix: unix(dateAtNoon(offsetDays - 1)),
      state: state,
      source: ["web", "operator", "edi", "voice"][index % 4],
      items: items,
      totalUnits: totalUnits,
      total: total
    });
  }

  Object.values(DEMO_CLIENTS).forEach(function (client) {
    addSeedOrder(client, 1, "Принят", 2, 1);
    addSeedOrder(client, 2, "Маршрутизирован", 1, 1);
    addSeedOrder(client, 3, "В пути", 0, 1);
    addSeedOrder(client, 4, "Отгружен", -3, 1);
    addSeedOrder(client, 5, "Отгружен", -7, 0);
    addSeedOrder(client, 6, "Отгружен", -12, 1);
  });

  function ordersForPayer(payerId) {
    return ORDERS.filter(function (order) { return order.buyerId === Number(payerId) && isClientAllowed(order.outletId); })
      .sort(function (left, right) { return right.createdAtUnix - left.createdAtUnix; });
  }

  function ordersForClient(clientId) {
    return ORDERS.filter(function (order) { return order.outletId === Number(clientId); })
      .sort(function (left, right) { return right.createdAtUnix - left.createdAtUnix; });
  }

  function findOrder(orderId) {
    return ORDERS.find(function (order) { return order.id === Number(orderId); }) || null;
  }

  function serializeOrder(order) {
    var client = DEMO_CLIENTS[order.outletId];
    return {
      id_clt: order.outletId,
      KodClt: client ? client.code : "",
      NameClt: client ? client.name : "",
      Adres: client ? client.address : "",
      Id_ord: order.id,
      NumOrd: order.orderNumber,
      DateOrdClt: order.createdAtUnix,
      DateOrd: order.deliveryUnix,
      Group: order.group,
      KolSht: order.totalUnits,
      SumAll: order.total,
      State: order.state,
      lk_outletId: order.outletId,
      lk_buyerId: order.buyerId,
      lk_source: order.source
    };
  }

  function serializeOrderDetails(order) {
    return {
      id_ord: order.id,
      Group: order.group,
      Product: order.items.map(function (item) {
        var row = productForClient(order.outletId, item.id_prd);
        return {
          id_prd: item.id_prd,
          KodProd: item.KodProd,
          NameProd: item.NameProd,
          CenaOTP: item.CenaOTP,
          Kolsht: item.Kolsht,
          KolVzv: item.KolVzv || 0,
          SumAll: round2(item.CenaOTP * item.Kolsht),
          lk_KolUkl: item.KolUkl || 1,
          lk_minOrder: row ? row.KolshtOrdmin : 1,
          lk_lotOnly: Boolean(row && row.KolshtOrdmin == null)
        };
      })
    };
  }

  function clientKis(client) {
    return {
      Id_pay: client.buyerId,
      id_clt: client.id_clt,
      KodClt: client.code,
      NameClt: client.name,
      Adres: client.address,
      OrdLimitMinSum: client.minOrderSum,
      TorgPred: client.rep,
      ClientDayOfWeek: ["Ежедневно"],
      lk_id: client.id,
      lk_buyerId: client.buyerId,
      lk_days: client.days.slice(),
      lk_phones: client.phones.slice(),
      lk_repPhone: client.repPhone,
      lk_receiver: client.receiver,
      lk_dispatchPhone: client.dispatchPhone,
      lk_dispatchPlatformName: client.dispatchPlatformName
    };
  }

  function payerKis(payer) {
    return {
      Id_pay: payer.id,
      KodPay: payer.code,
      NamePay: payer.name,
      Adres: payer.legal,
      NamePRV: payer.shipmentRule,
      SumOutSaldoCalc: payer.balance,
      OrdLimitMinSum: payer.minOrderSum,
      Manager: payer.manager,
      lk_id: payer.id,
      lk_managerPhone: payer.managerPhone,
      lk_inn: payer.inn,
      lk_hasContract: payer.hasContract,
      lk_contractNumber: payer.contractNumber,
      lk_contractDate: payer.contractDate,
      lk_paymentDeferralDays: payer.paymentDeferralDays,
      lk_segment: payer.segment,
      lk_shipmentEffective: payer.shipmentEffective,
      lk_shipmentEffectiveReason: payer.shipmentEffectiveReason,
      lk_shipmentEffectiveCause: payer.shipmentEffectiveCause,
      lk_email: payer.email,
      lk_sinceYear: payer.sinceYear,
      lk_shipmentMode: payer.shipmentMode,
      lk_shipmentBlockReason: payer.shipmentBlockReason,
      lk_usesEdi: payer.usesEdi,
      lk_ediClientCode: payer.ediClientCode,
      lk_badges: payer.badges.slice(),
      Clients: visibleClientsForPayer(payer.id).map(clientKis)
    };
  }

  function documentsForPayer(payerId) {
    var firstOrder = ordersForPayer(payerId)[0];
    return [
      { id: payerId + 1, kind: "contract", number: "ДЕМО-ДОГ-" + String(payerId).slice(-3), orderId: null, title: "Договор поставки (демонстрационный документ)", date: isoDate(-120), href: "#" },
      { id: payerId + 2, kind: "invoice", number: "ДЕМО-СФ-" + String(payerId).slice(-3), orderId: firstOrder ? firstOrder.id : null, title: "Счёт-фактура по последней поставке", date: isoDate(-3), href: "#" },
      { id: payerId + 3, kind: "declaration", number: "ДЕМО-РЕЕСТР-2026", orderId: null, title: "Реестр деклараций соответствия", date: isoDate(-14), href: "#" },
      { id: payerId + 4, kind: "pricelist", number: "Прайс-лист", orderId: null, title: "Индивидуальный прайс-лист", date: isoDate(0), href: "#" }
    ];
  }

  globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__ = false;
  globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__ = null;
  globalThis.__KARAVAY_DEMO_ENRICH_PAYER__ = function (base) {
    var profile = payerByCode(base && base.code);
    if (!profile) return base;
    return Object.assign({}, base, profile, {
      recordId: base.recordId,
      id: base.id,
      Id_pay: base.Id_pay,
      code: base.code,
      outlets: base.outlets || []
    });
  };
  globalThis.__KARAVAY_DEMO_ENRICH_CLIENT__ = function (base) {
    var profile = clientByCode(base && base.code);
    if (!profile) return base;
    return Object.assign({}, base, profile, {
      recordId: base.recordId,
      buyerRecordId: base.buyerRecordId,
      id: base.id,
      id_clt: base.id_clt,
      code: base.code
    });
  };

  function jsonResponse(value, status) {
    return new Response(JSON.stringify(value), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Karavay-Demo": VERSION }
    });
  }

  function emptyResponse(status) {
    return new Response(null, { status: status || 204, headers: { "X-Karavay-Demo": VERSION } });
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input && input.url ? input.url : String(input || "");
  }

  function requestMethod(input, init) {
    return String((init && init.method) || (input instanceof Request && input.method) || "GET").toUpperCase();
  }

  function requestBody(init) {
    try {
      return init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    } catch (_) {
      return {};
    }
  }

  function pathFromUrl(url) {
    try {
      return new URL(url, location.origin === "null" ? "http://demo.local" : location.origin).pathname.replace(/^\/port\/\d+/, "");
    } catch (_) {
      return String(url).split("?")[0];
    }
  }

  function queryFromUrl(url, name) {
    try {
      return new URL(url, location.origin === "null" ? "http://demo.local" : location.origin).searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  function buildItems(client, body) {
    var products = Array.isArray(body.Product) ? body.Product : [];
    return products.map(function (item) {
      var id = item.Id_prd != null ? item.Id_prd : item.id_prd;
      var row = productForClient(client.id, id);
      if (!row) return null;
      var quantity = Number(item.KolSht);
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      if (row.KolshtOrdmin == null && quantity % row.KolUkl !== 0) return null;
      if (row.KolshtOrdmin != null && quantity < row.KolshtOrdmin) return null;
      return {
        id_prd: row.id_prd,
        KodProd: row.KodProd,
        NameProd: row.NameProd,
        KolUkl: row.KolUkl,
        Kolsht: quantity,
        CenaOTP: row.CenaOTP,
        KolVzv: 0
      };
    }).filter(Boolean);
  }

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = requestUrl(input);
    var path = pathFromUrl(url);
    var method = requestMethod(input, init);
    if (!/^\/api\/v1\//.test(path)) return originalFetch(input, init);

    var payerOrdersMatch = path.match(/^\/api\/v1\/payers\/(\d+)\/orders$/);
    if (payerOrdersMatch && method === "GET") {
      var payerOrdersId = Number(payerOrdersMatch[1]);
      if (!DEMO_PAYERS[payerOrdersId]) return originalFetch(input, init);
      if (!isPayerAllowed(payerOrdersId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к плательщику" }, 403));
      return Promise.resolve(jsonResponse({ id_pay: payerOrdersId, Orders: ordersForPayer(payerOrdersId).map(serializeOrder) }));
    }

    var payerDocumentsMatch = path.match(/^\/api\/v1\/payers\/(\d+)\/documents$/);
    if (payerDocumentsMatch && method === "GET") {
      var payerDocumentsId = Number(payerDocumentsMatch[1]);
      if (!DEMO_PAYERS[payerDocumentsId]) return originalFetch(input, init);
      if (!isPayerAllowed(payerDocumentsId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к плательщику" }, 403));
      return Promise.resolve(jsonResponse(documentsForPayer(payerDocumentsId)));
    }

    var payerClientsMatch = path.match(/^\/api\/v1\/payers\/(\d+)\/clients$/);
    if (payerClientsMatch && method === "GET") {
      var payerClientsId = Number(payerClientsMatch[1]);
      if (!DEMO_PAYERS[payerClientsId]) return originalFetch(input, init);
      if (!isPayerAllowed(payerClientsId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к плательщику" }, 403));
      return Promise.resolve(jsonResponse({ Id_pay: payerClientsId, Clients: visibleClientsForPayer(payerClientsId).map(clientKis) }));
    }

    var payerMatch = path.match(/^\/api\/v1\/payers\/(\d+)$/);
    if (payerMatch && method === "GET") {
      var payerId = Number(payerMatch[1]);
      if (!DEMO_PAYERS[payerId]) return originalFetch(input, init);
      if (!isPayerAllowed(payerId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к плательщику" }, 403));
      return Promise.resolve(jsonResponse(payerKis(DEMO_PAYERS[payerId])));
    }

    var matrixMatch = path.match(/^\/api\/v1\/clients\/(\d+)\/matrix$/);
    if (matrixMatch && method === "GET") {
      var matrixClientId = Number(matrixMatch[1]);
      if (!DEMO_CLIENTS[matrixClientId]) return originalFetch(input, init);
      if (!isClientAllowed(matrixClientId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к получателю" }, 403));
      var group = Number(queryFromUrl(url, "Group"));
      var dateOrd = Number(queryFromUrl(url, "DateOrd"));
      return Promise.resolve(jsonResponse({
        id_clt: matrixClientId,
        DateOrd: dateOrd,
        Group: group,
        Product: matrixFor(matrixClientId, group)
      }));
    }

    var clientOrdersMatch = path.match(/^\/api\/v1\/clients\/(\d+)\/orders$/);
    if (clientOrdersMatch && method === "GET") {
      var clientOrdersId = Number(clientOrdersMatch[1]);
      if (!DEMO_CLIENTS[clientOrdersId]) return originalFetch(input, init);
      if (!isClientAllowed(clientOrdersId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к получателю" }, 403));
      var clientOrders = ordersForClient(clientOrdersId);
      if (queryFromUrl(url, "last") === "1") {
        var accepted = clientOrders.find(function (order) { return order.state === "Принят"; });
        clientOrders = accepted ? [accepted] : [];
      }
      return Promise.resolve(jsonResponse({ id_clt: clientOrdersId, Orders: clientOrders.map(serializeOrder) }));
    }

    var clientMatch = path.match(/^\/api\/v1\/clients\/(\d+)$/);
    if (clientMatch && method === "GET") {
      var clientId = Number(clientMatch[1]);
      if (!DEMO_CLIENTS[clientId]) return originalFetch(input, init);
      if (!isClientAllowed(clientId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к получателю" }, 403));
      return Promise.resolve(jsonResponse(clientKis(DEMO_CLIENTS[clientId])));
    }

    var orderMatch = path.match(/^\/api\/v1\/orders\/(\d+)$/);
    if (orderMatch && method === "GET") {
      var detailOrder = findOrder(orderMatch[1]);
      if (!detailOrder && !globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__) return originalFetch(input, init);
      if (detailOrder && !isClientAllowed(detailOrder.outletId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к заказу" }, 403));
      return Promise.resolve(detailOrder ? jsonResponse(serializeOrderDetails(detailOrder)) : jsonResponse({ detail: "Демо-заказ не найден" }, 404));
    }

    if ((path === "/api/v1/orders" || path === "/api/v1/orders/") && method === "POST" && globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__) {
      if (!canMutateOrders()) return Promise.resolve(jsonResponse({ detail: "Роль пользователя разрешает только просмотр" }, 403));
      var createBody = requestBody(init);
      var createClient = DEMO_CLIENTS[Number(createBody.Id_clt)];
      if (!createClient) return Promise.resolve(jsonResponse({ detail: "Получатель не найден" }, 404));
      if (!isClientAllowed(createClient.id)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к получателю" }, 403));
      var createItems = buildItems(createClient, createBody);
      if (!createItems.length) return Promise.resolve(jsonResponse({ detail: "Проверьте количество товаров в заказе" }, 422));
      var groups = {};
      createItems.forEach(function (item) {
        var row = productForClient(createClient.id, item.id_prd);
        if (row) groups[row.Group] = true;
      });
      if (Object.keys(groups).length !== 1) return Promise.resolve(jsonResponse({ detail: "ХБИ и замороженную продукцию нужно оформить отдельными заказами" }, 422));
      var createTotal = round2(createItems.reduce(function (sum, item) { return sum + item.Kolsht * item.CenaOTP; }, 0));
      if (createTotal < createClient.minOrderSum) {
        return Promise.resolve(jsonResponse({ detail: "Сумма заказа ниже минимальной для получателя", lk_error: "below_min_sum", lk_minSum: createClient.minOrderSum, lk_total: createTotal }, 400));
      }
      nextOrderId += 1;
      var createdOrder = {
        id: nextOrderId,
        orderNumber: nextOrderId,
        buyerId: createClient.buyerId,
        outletId: createClient.id,
        group: Number(Object.keys(groups)[0]),
        deliveryUnix: Number(createBody.DateOrd),
        createdAtUnix: unix(new Date()),
        state: "Принят",
        source: "web",
        items: createItems,
        totalUnits: createItems.reduce(function (sum, item) { return sum + item.Kolsht; }, 0),
        total: createTotal
      };
      ORDERS.push(createdOrder);
      return Promise.resolve(jsonResponse(serializeOrder(createdOrder)));
    }

    if (orderMatch && method === "PUT" && globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__) {
      if (!canMutateOrders()) return Promise.resolve(jsonResponse({ detail: "Роль пользователя разрешает только просмотр" }, 403));
      var updateOrder = findOrder(orderMatch[1]);
      if (!updateOrder) return Promise.resolve(jsonResponse({ detail: "Демо-заказ не найден" }, 404));
      if (!isClientAllowed(updateOrder.outletId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к заказу" }, 403));
      if (updateOrder.state !== "Принят") return Promise.resolve(jsonResponse({ detail: "Заказ маршрутизирован, изменения запрещены" }, 422));
      var updateClient = DEMO_CLIENTS[updateOrder.outletId];
      var updateItems = buildItems(updateClient, requestBody(init));
      if (!updateItems.length) return Promise.resolve(jsonResponse({ detail: "В заказе должна остаться хотя бы одна позиция" }, 422));
      updateOrder.items = updateItems;
      updateOrder.totalUnits = updateItems.reduce(function (sum, item) { return sum + item.Kolsht; }, 0);
      updateOrder.total = round2(updateItems.reduce(function (sum, item) { return sum + item.Kolsht * item.CenaOTP; }, 0));
      return Promise.resolve(jsonResponse({ Id_ord: updateOrder.id, KolSht: updateOrder.totalUnits, SumAll: updateOrder.total, State: updateOrder.state }));
    }

    if (orderMatch && method === "DELETE" && globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__) {
      if (!canMutateOrders()) return Promise.resolve(jsonResponse({ detail: "Роль пользователя разрешает только просмотр" }, 403));
      var deleteOrder = findOrder(orderMatch[1]);
      if (!deleteOrder) return Promise.resolve(jsonResponse({ detail: "Демо-заказ не найден" }, 404));
      if (!isClientAllowed(deleteOrder.outletId)) return Promise.resolve(jsonResponse({ detail: "Нет доступа к заказу" }, 403));
      if (deleteOrder.state !== "Принят") return Promise.resolve(jsonResponse({ detail: "Заказ маршрутизирован, изменения запрещены" }, 422));
      deleteOrder.state = "Удален";
      return Promise.resolve(jsonResponse({ Id_ord: deleteOrder.id, State: deleteOrder.state }));
    }

    if (globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__) {
      return Promise.resolve(jsonResponse({ detail: "Демо-контур не поддерживает маршрут: " + path }, 404));
    }
    return originalFetch(input, init);
  };

  globalThis.__KARAVAY_DEMO_SHOWCASE_TEST__ = {
    version: VERSION,
    payerIds: Object.keys(DEMO_PAYERS).map(Number),
    clientIds: Object.keys(DEMO_CLIENTS).map(Number),
    productCount: CATALOG.length,
    orderCount: ORDERS.length,
    matrixCount: function (clientId, group) { return matrixFor(clientId, group).length; },
    context: function () { return currentContext(); }
  };
})();
