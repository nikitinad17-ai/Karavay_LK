migrate(app=>{
  // A new private journal only. Existing business collections are not modified.
  let existing=null;try{existing=app.findCollectionByNameOrId('lk_order_requests');}catch(_){}
  if(existing)throw Error('lk_order_requests already exists; review before migration');
  app.save(new Collection({name:'lk_order_requests',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[
    {name:'payer_id',type:'text',required:true,max:15},
    {name:'client_id',type:'number',required:true,onlyInt:true},
    {name:'user_id',type:'text',required:true,max:15},
    {name:'request_key',type:'text',required:true,max:64},
    {name:'request_hash',type:'text',required:true,max:64},
    {name:'lock_tag',type:'text',max:100},
    {name:'state',type:'select',required:true,maxSelect:1,values:['pending','unknown','success','rejected']},
    {name:'result_json',type:'text',max:4096},
    {name:'http_status',type:'number',onlyInt:true},
    {name:'created_ms',type:'number',onlyInt:true},
    {name:'updated_ms',type:'number',onlyInt:true}
  ],indexes:[
    'CREATE UNIQUE INDEX idx_lk_order_request_key ON lk_order_requests (user_id, request_key)',
    "CREATE UNIQUE INDEX idx_lk_order_request_lock ON lk_order_requests (lock_tag) WHERE lock_tag != ''"
  ]}));
},app=>{
  // Keep the journal on rollback: deleting uncertain submissions could create duplicates.
  throw Error('Order request journal is retained. Roll back application files only.');
});
