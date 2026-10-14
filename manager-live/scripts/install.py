#!/usr/bin/env python3
"""Install additive manager files. Default is read-only preflight.
Run on the VM: sudo python3 install.py --install
Existing gateway files and collection definitions are never replaced.
"""
import argparse,hashlib,json,pathlib,shutil,subprocess,datetime,urllib.request,urllib.error,os
SOURCE=pathlib.Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--install',action='store_true');parser.add_argument('--root',default='/opt/pocketbase');args=parser.parse_args()
 root=pathlib.Path(args.root).resolve();manifest=json.load(open(SOURCE/'MANIFEST.json'))
 for name,digest in manifest['package'].items():
  if sha(SOURCE/name)!=digest:raise RuntimeError('Package hash mismatch: '+name)
 for name,digest in manifest['gateway'].items():
  if sha(root/'pb_hooks'/name) not in (digest if isinstance(digest,list) else [digest]):raise RuntimeError('Installed gateway differs: '+name+'. Re-export hooks before proceeding.')
 db=root/'pb_data/data.db'
 if not db.is_file():raise RuntimeError('Database not found')
 # Read definitions only. No data is read, exported or changed during preflight.
 import sqlite3
 con=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True)
 defs={row[0]:json.loads(row[1]) for row in con.execute('SELECT name, fields FROM _collections')};con.close()
 for col,required in manifest['required_fields'].items():
  fields={f['name']:f for f in defs.get(col,[])}
  for name,kind in required.items():
   if fields.get(name,{}).get('type')!=kind:raise RuntimeError('Schema mismatch: '+col+'.'+name)
 version=run(str(root/'pocketbase'),'--version').stdout
 if '0.40.3' not in version:raise RuntimeError('Expected PocketBase 0.40.3; found '+version.strip())
 for name in manifest['package']:
  dst=root/name
  if dst.exists() and sha(dst) not in [manifest['package'][name],*manifest.get('previous',{}).get(name,[])]:raise RuntimeError('Manager file already differs: '+name+'. Review before replacing.')
 run('systemctl','is-active','pocketbase')
 print('PREFLIGHT: PASSED. Existing gateway and schema match; no server changes made.')
 if not args.install:return
 if os.geteuid()!=0:raise RuntimeError('Installation requires sudo')
 if root!=pathlib.Path('/opt/pocketbase'):raise RuntimeError('Installation allowed only in /opt/pocketbase')
 stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
 backup=pathlib.Path('/opt')/('.karavay-manager-before-'+stamp);backup.mkdir(mode=0o700)
 copied=[];existing=[]
 try:
  run('systemctl','stop','pocketbase')
  shutil.copytree(root/'pb_data',backup/'pb_data')
  for name in manifest['package']:
   dst=root/name
   if dst.exists():
    old=backup/name;old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,old);existing.append(name)
   dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(SOURCE/name,dst);shutil.chown(dst,user='lindevadmin',group='lindevadmin');copied.append(name)
  run('systemctl','start','pocketbase')
  import time
  for i in range(50):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8090/api/health',timeout=2) as r:
     if r.status==200:break
   except Exception:time.sleep(.2)
  else:raise RuntimeError('Health check failed')
  for path in ['/service/context','/service/manager/state','/service/manager/buyers']:
   try:urllib.request.urlopen('http://127.0.0.1:8090'+path,timeout=5);raise RuntimeError('Unauthenticated endpoint is unexpectedly open')
   except urllib.error.HTTPError as e:
    if e.code!=401:raise RuntimeError('Smoke failed: '+path+' '+str(e.code))
    json.loads(e.read())
  with urllib.request.urlopen('http://127.0.0.1:8090/manager/',timeout=5) as r:
   if b'0.5' not in r.read():raise RuntimeError('Manager HTML check failed')
  with urllib.request.urlopen('http://127.0.0.1:8090/',timeout=5) as r:
   if b'3.7.3' not in r.read():raise RuntimeError('Client HTML check failed')
  for name,digest in manifest['gateway'].items():
   if sha(root/'pb_hooks'/name) not in (digest if isinstance(digest,list) else [digest]):raise RuntimeError('Gateway changed unexpectedly')
  print('AUTO_DIRECTORY_INSTALLED: http://192.168.25.98:8090/manager/')
  print('BACKUP:',backup)
  print('Client 3.7.3 and manager 0.5 installed; gateway preserved; no schema migrations.')
 except Exception:
  run('systemctl','stop','pocketbase')
  for name in copied:
   dst=root/name
   if name in existing:shutil.copy2(backup/name,dst)
   else:dst.unlink(missing_ok=True)
  run('systemctl','start','pocketbase')
  print('ROLLED_BACK: manager files restored. Database snapshot retained at',backup)
  raise
if __name__=='__main__':main()
