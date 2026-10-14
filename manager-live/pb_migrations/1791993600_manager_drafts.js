// Add only ownership of unassigned manager-created accounts. No existing roles or rights change.
migrate(app=>{
  const users=app.findCollectionByNameOrId('users'),old=users.fields.getByName('manager_owner');
  if(old){if(old.type!=='relation'||old.collectionId!==users.id||old.maxSelect!==1||old.required)throw Error('Unexpected manager_owner field');return;}
  users.fields.add(new RelationField({name:'manager_owner',collectionId:users.id,maxSelect:1,required:false,cascadeDelete:false,hidden:true}));
  app.save(users);
},app=>{throw Error('Automatic deletion of manager ownership is disabled. Restore the verified backup if needed.');});
