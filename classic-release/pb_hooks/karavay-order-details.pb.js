// Current PB auth; business data stay behind same-origin /service routes.
routerAdd('GET','/service/order-options',e=>require(__hooks+'/karavay-checkout.js').handle(e,'options'),$apis.requireAuth('users'));
routerAdd('GET','/service/orders/{id}',e=>require(__hooks+'/karavay-checkout.js').handle(e,'detail'),$apis.requireAuth('users'));
routerAdd('POST','/service/orders',e=>require(__hooks+'/karavay-checkout.js').handle(e,'create'),$apis.requireAuth('users'),$apis.bodyLimit(65536));
routerAdd('GET','/service/order-requests/{key}',e=>require(__hooks+'/karavay-checkout.js').handle(e,'status'),$apis.requireAuth('users'));
