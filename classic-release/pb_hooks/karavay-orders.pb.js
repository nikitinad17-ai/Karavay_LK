routerAdd('GET','/service/orders',e=>require(__hooks+'/karavay-checkout.js').handle(e,'list'),$apis.requireAuth('users'));
