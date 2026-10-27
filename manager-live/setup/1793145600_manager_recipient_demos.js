// PocketBase executes a migration in a transaction. No schema changes.
migrate(app=>require(__hooks+'/karavay-manager-demos.js').bootstrap(app),()=>{});
