"""Read-only installer preflight: isolated SQLite schema and simulated systemd.
Run: python3 manager-live/tests/installer.py. No VM or real service is used.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import types
import unittest
import urllib.error
from unittest import mock

SOURCE=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('manager_installer',SOURCE/'scripts/install.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class Preflight(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='karavay-install-preflight-')
  self.addCleanup(self.temp.cleanup)
  self.root=pathlib.Path(self.temp.name)
  self.manifest=json.loads((SOURCE/'MANIFEST.json').read_text())
  for name in self.manifest['package']:
   target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(SOURCE/name,target)
  for name,digests in self.manifest['gateway'].items():
   (self.root/'pb_hooks'/name).write_text(digests[0] if isinstance(digests,list) else digests)
  (self.root/'pb_public/index.html').write_text('Existing client 3.8.0')
  (self.root/'pb_data').mkdir()
  with sqlite3.connect(self.root/'pb_data/data.db') as con:
   con.execute('CREATE TABLE _collections (id TEXT, name TEXT, fields TEXT)')
   con.execute('CREATE TABLE _migrations (file TEXT)')
   for col in json.loads((SOURCE/'tests/schema.json').read_text()):
    con.execute('INSERT INTO _collections VALUES (?, ?, ?)',(col['id'],col['name'],json.dumps(col['fields'])))

 def snapshot(self):
  return {str(p.relative_to(self.root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()}

 def preflight(self,*extra):
  original_sha=installer.sha
  def fixture_sha(p):
   if p.parent==self.root/'pb_hooks' and p.name in self.manifest['gateway']:
    return p.read_text() # A controlled hash fixture; source/package files use real SHA-256.
   return original_sha(p)
  def run(*args):
   return types.SimpleNamespace(stdout='pocketbase version 0.40.3' if args[-1]=='--version' else 'active')
  with mock.patch.object(installer,'sha',side_effect=fixture_sha),mock.patch.object(installer,'run',side_effect=run),mock.patch.object(sys,'argv',['install.py','--root',str(self.root),*extra]),contextlib.redirect_stdout(io.StringIO()) as output:
   installer.main()
   return output.getvalue()

 def test_accepts_old_and_classic38_orders_without_writes(self):
  for digest in self.manifest['gateway']['karavay-orders.pb.js']:
   with self.subTest(digest=digest):
    (self.root/'pb_hooks/karavay-orders.pb.js').write_text(digest)
    before=self.snapshot()
    self.assertIn('PREFLIGHT: PASSED',self.preflight())
    self.assertEqual(before,self.snapshot())

 def test_preserves_other_client_orders_version(self):
  (self.root/'pb_hooks/karavay-orders.pb.js').write_text('0'*64)
  before=self.snapshot()
  self.preflight()
  self.assertEqual(before,self.snapshot())

 def test_rejects_unknown_gateway_without_writes(self):
  (self.root/'pb_hooks/karavay-context.pb.js').write_text('0'*64)
  before=self.snapshot()
  with self.assertRaisesRegex(RuntimeError,'Installed gateway differs'):
   self.preflight()
  self.assertEqual(before,self.snapshot())

 def test_rejects_other_pending_migration_without_writes(self):
  (self.root/'pb_migrations/unknown.js').write_text('unexpected pending migration')
  before=self.snapshot()
  with self.assertRaisesRegex(RuntimeError,'Other pending migrations'):
   self.preflight()
  self.assertEqual(before,self.snapshot())

 def test_accepts_previously_applied_client_migration(self):
  (self.root/'pb_migrations/client.js').write_text('already applied')
  with sqlite3.connect(self.root/'pb_data/data.db') as con:
   con.execute('INSERT INTO _migrations VALUES (?)',('client.js',))
  self.assertIn('PREFLIGHT: PASSED',self.preflight())

 def test_rejects_unknown_manager_file_without_writes(self):
  (self.root/'pb_public/manager/app.js').write_text('unexpected manager version')
  before=self.snapshot()
  with self.assertRaisesRegex(RuntimeError,'Manager file already differs'):
   self.preflight()
  self.assertEqual(before,self.snapshot())

 def test_install_refuses_nonproduction_root_without_writes(self):
  before=self.snapshot()
  with self.assertRaisesRegex(RuntimeError,'Installation allowed only|Installation requires sudo'):
   self.preflight('--install')
  self.assertEqual(before,self.snapshot())

 def simulated_install(self,fail_copy=False):
  original_path=pathlib.Path;original_sha=installer.sha;original_copy=shutil.copy2
  old=b'Known previous manager application'
  target=self.root/'pb_public/manager/app.js';target.write_bytes(old)
  (self.root/'pb_public/manager/theme.css').unlink()
  backup_root=self.root/'backups';backup_root.mkdir()
  def mapped_path(value='.',*parts):
   if str(value)=='/opt/pocketbase':return self.root
   if str(value)=='/opt':return backup_root
   return original_path(value,*parts)
  def fixture_sha(p):
   if p.parent==self.root/'pb_hooks' and p.name in self.manifest['gateway']:return p.read_text()
   if p==target and p.read_bytes()==old:return self.manifest['previous']['pb_public/manager/app.js'][-1]
   return original_sha(p)
  def run(*args):
   if args==('systemctl','start','pocketbase'):
    with sqlite3.connect(self.root/'pb_data/data.db') as con:
     row=con.execute('SELECT id,fields FROM _collections WHERE name=?',('users',)).fetchone();fields=json.loads(row[1])
     if not any(f['name']=='manager_owner' for f in fields):
      fields.append({'name':'manager_owner','type':'relation','collectionId':row[0],'maxSelect':1,'required':False})
      con.execute('UPDATE _collections SET fields=? WHERE name=?',(json.dumps(fields),'users'))
   return types.SimpleNamespace(stdout='pocketbase version 0.40.3' if args[-1]=='--version' else 'active')
  class Response:
   status=200
   def __init__(self,body=b''):self.body=body
   def read(self):return self.body
   def __enter__(self):return self
   def __exit__(self,*_):pass
  def urlopen(url,**_):
   if url.endswith('/api/health'):return Response()
   if url.endswith('/manager/'):return Response((SOURCE/'pb_public/manager/index.html').read_bytes())
   raise urllib.error.HTTPError(url,401,'Unauthorized',{},io.BytesIO(b'{}'))
  def copy(src,dst,*a,**kw):
   if fail_copy and src==SOURCE/'pb_public/manager/app.js' and dst==target:
    dst.write_bytes(b'PARTIAL WRITE');raise OSError('Simulated partial write')
   return original_copy(src,dst,*a,**kw)
  with mock.patch.object(installer.pathlib,'Path',side_effect=mapped_path),mock.patch.object(installer,'sha',side_effect=fixture_sha),mock.patch.object(installer,'run',side_effect=run),mock.patch.object(installer.os,'geteuid',return_value=0),mock.patch.object(installer.shutil,'chown'),mock.patch.object(installer.shutil,'copy2',side_effect=copy),mock.patch.object(installer.urllib.request,'urlopen',side_effect=urlopen),mock.patch.object(sys,'argv',['install.py','--install']),contextlib.redirect_stdout(io.StringIO()) as output:
   if fail_copy:
    with self.assertRaisesRegex(OSError,'Simulated partial write'):installer.main()
   else:installer.main()
  return old,target,backup_root,output.getvalue()

 def test_install_preserves_client_and_creates_backup(self):
  old,target,backups,output=self.simulated_install()
  self.assertEqual(target.read_bytes(),(SOURCE/'pb_public/manager/app.js').read_bytes())
  self.assertEqual((self.root/'pb_public/index.html').read_text(),'Existing client 3.8.0')
  self.assertTrue((self.root/'pb_public/manager/theme.css').exists())
  backup=next(backups.iterdir());self.assertEqual((backup/'pb_public/manager/app.js').read_bytes(),old)
  self.assertIn('MANAGER_RELEASE_INSTALLED: 0.9.1',output)

 def test_partial_copy_failure_restores_the_affected_file(self):
  old,target,backups,output=self.simulated_install(fail_copy=True)
  self.assertEqual(target.read_bytes(),old)
  self.assertEqual((self.root/'pb_public/index.html').read_text(),'Existing client 3.8.0')
  self.assertIn('ROLLED_BACK',output)

if __name__=='__main__':unittest.main()
