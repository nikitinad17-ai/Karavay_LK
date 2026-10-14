routerAdd('GET','/service/manager/buyers',e=>require(__hooks+'/karavay-manager.js').route(e,'buyers'),$apis.requireAuth('users'));
/// <reference path="../pb_data/types.d.ts" />
routerAdd('GET','/service/manager/state',e=>require(__hooks+'/karavay-manager.js').route(e,'state'),$apis.requireAuth('users'));
routerAdd('GET','/service/manager/clients',e=>require(__hooks+'/karavay-manager.js').route(e,'clients'),$apis.requireAuth('users'));
routerAdd('POST','/service/manager/action',e=>require(__hooks+'/karavay-manager.js').route(e,'action'),$apis.requireAuth('users'));
routerAdd('POST','/service/account/change-password',e=>require(__hooks+'/karavay-manager.js').route(e,'password'),$apis.requireAuth('users'));
onRecordConfirmPasswordResetRequest(e=>{e.record.set('must_change_password',false);e.next();},'users');
