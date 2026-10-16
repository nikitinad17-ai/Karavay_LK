routerAdd('GET','/service/test-access',e=>require(__hooks+'/karavay-test-access.js').handle(e,false));
routerAdd('POST','/service/test-access',e=>require(__hooks+'/karavay-test-access.js').handle(e,true));
