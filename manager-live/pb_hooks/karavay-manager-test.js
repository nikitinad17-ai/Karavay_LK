// Explicitly enabled test-server entry. No credentials or account provisioning.
const CONFIG='manager-test-login.json';
function config(app){
  let value;
  try{value=JSON.parse(toString($os.readFile(app.dataDir()+'/'+CONFIG)));}catch(_){return null;}
  if(value.enabled!==true||value.version!==1||typeof value.manager_id!=='string'||!/^[a-z0-9]{15}$/.test(value.manager_id)||typeof value.origin!=='string'||!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(value.origin))return null;
  return value;
}
function route(e,login){
  e.response.header().set('Cache-Control','no-store');
  try{
    if(e.request.url.rawQuery)return e.json(400,{code:'INVALID_PARAMETERS'});
    const settings=config(e.app);
    if(!settings)return e.json(login?404:200,login?{code:'TEST_LOGIN_DISABLED'}:{version:'0.9.0',enabled:false});
    const m=require(__hooks+'/karavay-manager.js').manager(e.app,settings.manager_id),u=m.user;
    if(!login)return e.json(200,{version:'0.9.0',enabled:true,label:u.get('name')});
    if(e.request.header.get('Origin')!==settings.origin)return e.json(403,{code:'TEST_LOGIN_ORIGIN'});
    const body=e.requestInfo().body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return e.json(400,{code:'INVALID_PARAMETERS'});
    const token=u.newStaticAuthToken(8*60*60*1000000000);
    e.app.logger().info('manager.test_login','actor',u.id);
    return e.json(200,{token,record:{id:u.id,name:u.get('name'),email:u.get('email'),role_code:u.get('role_code'),active:u.get('active'),must_change_password:u.get('must_change_password')}});
  }catch(error){
    if(!login)return e.json(200,{version:'0.9.0',enabled:false});
    return e.json(error&&[400,403,502].includes(error.status)?error.status:403,{code:error&&typeof error.code==='string'?error.code:'TEST_LOGIN_UNAVAILABLE'});
  }
}
module.exports={route};
