// Persist the selected Client/Payer label without replacing auth roles or rights.
migrate(app=>{
  const users=app.findCollectionByNameOrId('users'),old=users.fields.getByName('account_type');
  if(old){if(old.type()!=='select'||old.maxSelect!==1||old.required||JSON.stringify(old.values)!==JSON.stringify(['client','payer']))throw Error('Unexpected account_type field');return;}
  users.fields.add(new SelectField({name:'account_type',values:['client','payer'],maxSelect:1,required:false,hidden:true}));
  app.save(users);
},()=>{throw Error('Account type is retained to preserve user records.');});
