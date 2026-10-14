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
fs.writeFileSync('classic-release/MANIFEST.json',JSON.stringify({version:'3.8-preparation',status:'awaiting-kis-order-contract',html_sha256:crypto.createHash('sha256').update(html).digest('hex'),base_client:'3.7.3',design:'3.6.4',create_order_enabled:false,order_lines_enabled:false,manager_modified:false},null,2)+'\n');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){const expected="sha256-"+crypto.createHash('sha256').update(m[1]).digest('base64');if(!html.includes(expected))throw Error('CSP hash mismatch');}
console.log('CLASSIC_HTML_BUILT: exact script CSP hashes verified');
