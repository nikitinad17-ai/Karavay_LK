migrate(app=>require(__hooks+'/karavay-test-access.js').bootstrap(app),()=>{
  throw Error('Retain user/order data; restore the previous test configuration and helper to roll back.');
});
