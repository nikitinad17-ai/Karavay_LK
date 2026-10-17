#!/usr/bin/env python3
"""Client 3.8.2 installation. Existing user/manager data are preserved.
Adds one private order journal. Rollback restores application files, not business data.
"""
import argparse,datetime,hashlib,json,os,pathlib,shutil,sqlite3,subprocess,time,urllib.request,urllib.error
SOURCE=pathlib.Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True)
def health():
 for _ in range(50):
  try:
   with urllib.request.urlopen('http://127.0.0.1:8090/api/health',timeout=2) as r:
    if r.status==200:return
  except Exception:time.sleep(.2)
 raise RuntimeError('PocketBase health check failed')
def restore(root,backup):
 state=json.loads((backup/'restore.json').read_text())
 if state['root']!=str(root):raise RuntimeError('Backup is for a different directory')
 for name in state['files']:
  if name.startswith('pb_migrations/'):continue # Retain the private journal and its migration.
  target=root/name;old=backup/name
  if old.is_file():shutil.copy2(old,target)
  elif target.is_file():target.unlink()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--rollback');args=parser.parse_args();root=pathlib.Path('/opt/pocketbase')
 if args.rollback:
  if os.geteuid()!=0:raise RuntimeError('Use sudo')
  backup=pathlib.Path(args.rollback).resolve()
  if backup.parent!=pathlib.Path('/opt') or not backup.name.startswith('.karavay-classic-before-'):raise RuntimeError('Unexpected backup path')
  state=json.loads((backup/'restore.json').read_text())
  for name in state['files']:
   if name not in state['deployed_hashes'] or '..' in pathlib.Path(name).parts or pathlib.Path(name).is_absolute():raise RuntimeError('Invalid restore file')
   if not name.startswith('pb_migrations/') and (root/name).is_file() and sha(root/name)!=state['deployed_hashes'][name]:raise RuntimeError('A file changed after this release; review before rollback: '+name)
  run('systemctl','stop','pocketbase')
  try:restore(root,backup)
  finally:run('systemctl','start','pocketbase')
  health();print('ROLLBACK_OK: application restored; current users, rights and order journal retained.');return
 manifest=json.loads((SOURCE/'MANIFEST.json').read_text())
 for name,digest in manifest['package'].items():
  if sha(SOURCE/name)!=digest:raise RuntimeError('Package hash mismatch: '+name)
 for name,digest in manifest['gateway_preserved'].items():
  if sha(root/'pb_hooks'/name)!=digest:raise RuntimeError('Gateway changed: '+name+'. Send the current hooks for comparison.')
 for name in manifest['package']:
  target=root/name
  if target.is_symlink():raise RuntimeError('Unexpected symbolic link: '+name)
  if target.exists() and sha(target) not in [manifest['package'][name],*manifest['previous'].get(name,[])]:raise RuntimeError('Installed file differs: '+name+'. It has not been replaced.')
 if '0.40.3' not in run(str(root/'pocketbase'),'--version').stdout:raise RuntimeError('This package expects PocketBase 0.40.3')
 con=sqlite3.connect('file:'+str(root/'pb_data/data.db')+'?mode=ro',uri=True)
 definitions={row[0]:json.loads(row[1]) for row in con.execute('SELECT name, fields FROM _collections')}
 applied={r[0] for r in con.execute('SELECT file FROM _migrations')};con.close()
 for collection,fields in manifest['required_fields'].items():
  actual={f['name']:f['type'] for f in definitions.get(collection,[])}
  for name,kind in fields.items():
   if actual.get(name)!=kind:raise RuntimeError('Schema mismatch: '+collection+'.'+name)
 pending=[p.name for p in (root/'pb_migrations').glob('*.js') if p.name not in applied and p.name not in ('1792000000_classic_order_requests.js','1792180000_test_access_users.js','1792260000_test_history_users.js')]
 if pending:raise RuntimeError('Other pending migrations need review: '+', '.join(pending))
 if 'lk_order_requests' in definitions and '1792000000_classic_order_requests.js' not in applied:raise RuntimeError('Unrecognized existing order journal')
 run('systemctl','is-active','pocketbase')
 print('PREFLIGHT_OK: client, gateway and schema match; manager preserved.')
 if not args.apply:return
 if os.geteuid()!=0:raise RuntimeError('Run --apply through sudo')
 backup=pathlib.Path('/opt')/('.karavay-classic-before-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir(mode=0o700)
 names=list(manifest['package']);state={'root':str(root),'files':names,'deployed_hashes':manifest['package']};(backup/'restore.json').write_text(json.dumps(state,indent=2))
 stopped=False;changed=False
 try:
  run('systemctl','stop','pocketbase');stopped=True
  shutil.copytree(root/'pb_data',backup/'pb_data')
  for name in names:
   target=root/name
   if target.exists():old=backup/name;old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,old)
  changed=True
  owner=(root/'pb_data').stat()
  for name in names:
   target=root/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(SOURCE/name,target);target.chmod(0o644);os.chown(target,owner.st_uid,owner.st_gid)
  run('systemctl','start','pocketbase');stopped=False;health()
  for path,method in [('/service/orders','GET'),('/service/orders/1','GET'),('/service/order-options','GET'),('/service/order-requests/'+'a'*32,'GET'),('/service/orders','POST')]:
   req=urllib.request.Request('http://127.0.0.1:8090'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Content-Type':'application/json'})
   try:urllib.request.urlopen(req,timeout=4);raise RuntimeError('Authentication gate failed: '+path)
   except urllib.error.HTTPError as e:
    if e.code!=401:raise RuntimeError('Unexpected route status: '+path+' '+str(e.code))
    json.loads(e.read())
  with urllib.request.urlopen('http://127.0.0.1:8090/',timeout=5) as r:
   if hashlib.sha256(r.read()).hexdigest()!=manifest['html_sha256']:raise RuntimeError('Served HTML does not match package')
  con=sqlite3.connect('file:'+str(root/'pb_data/data.db')+'?mode=ro',uri=True)
  journal=con.execute('SELECT listRule,viewRule,createRule,updateRule,deleteRule FROM _collections WHERE name=?',('lk_order_requests',)).fetchone();con.close()
  if journal!=(None,None,None,None,None):raise RuntimeError('Order journal API must remain private')
 except Exception:
  if not stopped:run('systemctl','stop','pocketbase')
  if changed:restore(root,backup)
  run('systemctl','start','pocketbase')
  raise
 print('CLASSIC_3.8.2_INSTALLED: http://192.168.25.98:8090/')
 print('BACKUP:',backup)
 print('Rollback: sudo python3 '+str(SOURCE/'scripts/install.py')+' --rollback '+str(backup))
 print('No KIS order was created by installation. Real POST still requires a user submission; OpenAPI/previous aId_Clt mismatch may remain on the KIS server.')
if __name__=='__main__':main()
