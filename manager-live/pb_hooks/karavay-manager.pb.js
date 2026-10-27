routerAdd('GET','/service/manager/kis-clients',e=>require(__hooks+'/karavay-manager.js').route(e,'kis_clients'),$apis.requireAuth('users'));
routerAdd('GET','/service/manager/directory',e=>require(__hooks+'/karavay-manager.js').route(e,'directory'),$apis.requireAuth('users'));
routerAdd('GET','/service/manager/buyers',e=>require(__hooks+'/karavay-manager.js').route(e,'buyers'),$apis.requireAuth('users'));
/// <reference path="../pb_data/types.d.ts" />
routerAdd('GET','/service/manager/test-login',e=>require(__hooks+'/karavay-manager-test.js').route(e,false));
routerAdd('POST','/service/manager/test-login',e=>require(__hooks+'/karavay-manager-test.js').route(e,true));
routerAdd('GET','/service/manager/demo-accounts',e=>require(__hooks+'/karavay-manager-demos.js').route(e,false),$apis.requireAuth('users'));
routerAdd('POST','/service/manager/demo-login',e=>require(__hooks+'/karavay-manager-demos.js').route(e,true),$apis.requireAuth('users'));
routerAdd('GET','/service/manager/state',e=>require(__hooks+'/karavay-manager.js').route(e,'state'),$apis.requireAuth('users'));
routerAdd('GET','/service/manager/clients',e=>require(__hooks+'/karavay-manager.js').route(e,'clients'),$apis.requireAuth('users'));
routerAdd('POST','/service/manager/action',e=>require(__hooks+'/karavay-manager.js').route(e,'action'),$apis.requireAuth('users'));
routerAdd('POST','/service/account/change-password',e=>require(__hooks+'/karavay-manager.js').route(e,'password'),$apis.requireAuth('users'));
onRecordConfirmPasswordResetRequest(e=>{e.record.set('must_change_password',false);e.next();},'users');

// Ownership of an unassigned account is server-managed, including native API writes.
onRecordCreateRequest(e=>{if(!e.hasSuperuserAuth()&&e.record.get('manager_owner'))throw new ForbiddenError('Managed field.');e.next();},'users');
onRecordUpdateRequest(e=>{if(!e.hasSuperuserAuth()&&e.record.get('manager_owner')!==e.record.original().get('manager_owner'))throw new ForbiddenError('Managed field.');e.next();},'users');
