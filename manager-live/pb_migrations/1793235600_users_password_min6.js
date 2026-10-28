// Owner-requested temporary policy for both cabinets; existing password hashes stay intact.
migrate(app=>{
  const users=app.findCollectionByNameOrId('users'),password=users.fields.getByName('password');
  if(!password||password.type()!=='password')throw Error('Expected users.password field');
  if(password.min===6)return;
  password.min=6;
  app.save(users);
},()=>{throw Error('Restore the prior password minimum explicitly; existing passwords are retained.');});
