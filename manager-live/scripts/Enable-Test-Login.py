#!/usr/bin/env python3
"""Enable/disable the manager test-server button. No password or rights changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.request

SOURCE=Path(__file__).resolve().parents[1]
CONFIG='manager-test-login.json'

def toggle(root,enabled=None,origin='http://192.168.25.98:8090',pb_url='http://127.0.0.1:8090'):
    root=Path(root)
    if not re.fullmatch(r'https?://[A-Za-z0-9.:-]+',origin):raise RuntimeError('Invalid manager origin')
    manifest=json.loads((SOURCE/'MANIFEST.json').read_text())
    for name in ['pb_hooks/karavay-manager-test.js','pb_hooks/karavay-manager.pb.js','pb_hooks/karavay-manager.js','pb_public/manager/index.html','pb_public/manager/app.js']:
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=manifest['package'][name]:raise RuntimeError('Install manager 0.9.0 first: '+name)
    path=root/'pb_data'/CONFIG
    if path.is_symlink():raise RuntimeError('Test-login config must not be a symlink')
    if enabled is False:
        path.unlink(missing_ok=True)
        print('MANAGER_TEST_LOGIN_DISABLED')
        return
    with sqlite3.connect('file:'+str(root/'pb_data/data.db')+'?mode=ro',uri=True) as db:
        users=db.execute('SELECT u.id,u.name,u.active,u.must_change_password,u.role_code,r.code_role,r.active FROM users u LEFT JOIN roles r ON r.id=u.role WHERE trim(u.name)=?',('Менеджер Каравай',)).fetchall()
    if len(users)!=1:raise RuntimeError('Existing manager name is not unique; no accounts changed')
    user=users[0]
    if not re.fullmatch('[a-z0-9]{15}',user[0]) or not user[2] or user[3] or user[4:7]!=('manager','manager',1):raise RuntimeError('Existing manager is disabled, requires password change or has a different role; no accounts changed')
    print('Manager:',user[1])
    if enabled is None:
        print('READ_ONLY: test entry can be enabled; no files or accounts changed')
        return
    settings={'version':1,'enabled':True,'manager_id':user[0],'origin':origin}
    before=path.read_bytes() if path.exists() else None
    fd,name=tempfile.mkstemp(prefix='.manager-test-login-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as output:json.dump(settings,output);output.write('\n')
        os.replace(name,path)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(pb_url+'/service/manager/test-login',timeout=20) as response:result=json.load(response)
        if result.get('version')!='0.9.0' or result.get('enabled') is not True:raise RuntimeError('Server did not confirm test entry')
    except Exception:
        if before is None:path.unlink(missing_ok=True)
        else:
            fd,restore=tempfile.mkstemp(prefix='.manager-test-login-restore-',dir=path.parent)
            with os.fdopen(fd,'wb') as output:output.write(before)
            os.replace(restore,path)
        raise
    finally:
        Path(name).unlink(missing_ok=True)
    print('MANAGER_TEST_LOGIN_READY:',origin+'/manager/')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group();group.add_argument('--enable',action='store_true');group.add_argument('--disable',action='store_true')
    args=parser.parse_args()
    toggle(Path('/opt/pocketbase'),True if args.enable else False if args.disable else None)

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,sqlite3.Error) as error:raise SystemExit('STOPPED: '+str(error)) from None
