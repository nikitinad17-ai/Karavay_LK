import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir='classic-dist';
let html=fs.readFileSync(path.join(dir,'classic.html'),'utf8');
html=html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,url)=>'<script type="module">'+fs.readFileSync(path.join(dir,url),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g,(_,url)=>'<style>'+fs.readFileSync(path.join(dir,url),'utf8')+'</style>');
const hashes=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+crypto.createHash('sha256').update(m[1]).digest('base64')+"'");
html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: 'self'; font-src data: 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'">`);
fs.mkdirSync('classic-release/pb_public',{recursive:true});
fs.writeFileSync('classic-release/pb_public/index.html',html);
const packageFiles=['pb_public/index.html','pb_hooks/karavay-checkout.js','pb_hooks/karavay-order-details.pb.js','pb_hooks/karavay-orders.pb.js','pb_hooks/karavay-test-access.js','pb_hooks/karavay-test-access.pb.js','pb_migrations/1792000000_classic_order_requests.js'];
const digest=name=>crypto.createHash('sha256').update(fs.readFileSync('classic-release/'+name)).digest('hex');
const required_fields={users:{id:'text',email:'email',active:'bool',must_change_password:'bool',role:'relation',role_code:'select'},roles:{code_role:'text',active:'bool'},payers:{id_pay:'number',active:'bool'},clients:{id_clt:'number',payer:'relation',active:'bool'},rights:{user:'relation',payer:'relation',client:'relation',scope:'select',kis_client_id:'number',active:'bool'}};
fs.writeFileSync('classic-release/MANIFEST.json',JSON.stringify({version:'3.8.2',status:'ready-for-vm-verification',html_sha256:digest('pb_public/index.html'),design:'3.6.4',create_order_enabled:true,order_lines_enabled:true,live_kis_post_verified:false,manager_modified:false,
 package:Object.fromEntries(packageFiles.map(name=>[name,digest(name)])),
 gateway_preserved:{'karavay-context.pb.js':'f72ef461d7b34d4e97f84c461b3d2ff9dd4f1c9402b2f7dfa1ea796270ff9d0f','karavay-catalog.pb.js':'cd2a21fbc2346611eb3d62883964cc150b4730965fc57f914fe76fdf397a7516','karavay-clients.pb.js':'c670f7eee3ab3cba316c83cca7a2d28ef438bfef601c5858f6cde9114abccdbc'},
 previous:{'pb_hooks/karavay-checkout.js':['0e645047adbdae5b004c752e11ddb32e43fd76e5b243802200cc9b7e4061b750','dbf3abc45b85692d1dc5bfe5e9293198a737d996e7ec862dd6b20ba8681ea40b'],'pb_hooks/karavay-test-access.js':['664c97a27bde4a91a6b6f9ea8d9a38c7dda799ec0a89b8dbf484901bc7929d8f'],'pb_public/index.html':['7d838873ecdc7ee5ae959bc3153d5c30772b7bf2779e9cae5be52bc8a46c7537','b79b6009c6804ddbf941566d77bc1a24fc5b51fc84c98fd14ae9b6c7b3eaaca6','899f81157a6204251fb2348af8b244ac8a465ecb3186a0aa08be951306f49f0b','02574f1c1d0a98684aa8550ff5b3dccf1a5d9867bcddca3a4672c91518c4c12e','54d6097346efb055507ae669697159a80cf13a73350c9cd50837a0571106ed2c'],'pb_hooks/karavay-orders.pb.js':['85fde8d50f1a979ee0a3491d0df2d86d89f7307c3b3743b3f4ca46d37b346561']},required_fields,installer_sha256:digest('scripts/install.py')},null,2)+'\n');

for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){const expected="sha256-"+crypto.createHash('sha256').update(m[1]).digest('base64');if(!html.includes(expected))throw Error('CSP hash mismatch');}
console.log('CLASSIC_HTML_BUILT: exact script CSP hashes verified');
