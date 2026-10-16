#!/usr/bin/env python3
"""Read-only VM report. Never selects passwords, tokenKey, tokens or personal plans."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import urllib.error
import urllib.request

def inspect(root,source):
    manifest=json.loads((source/'MANIFEST.json').read_text())
    report={'read_only':True,'expected_release':manifest['version'],'routes':{},'files':{},'managers':[]}
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for path in ['/api/health','/manager/','/service/manager/state','/service/manager/directory']:
        try:
            with opener.open('http://127.0.0.1:8090'+path,timeout=8) as response:
                raw=response.read(4*1024*1024);entry={'status':response.status}
                if path=='/manager/':entry['current_html']=hashlib.sha256(raw).hexdigest()==manifest['package']['pb_public/manager/index.html']
        except urllib.error.HTTPError as error:entry={'status':error.code}
        except (urllib.error.URLError,TimeoutError):entry={'status':'unavailable'}
        report['routes'][path]=entry
    for name,digest in manifest['package'].items():
        p=root/name
        report['files'][name]='current' if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==digest else 'different' if p.exists() else 'missing'
    database=root/'pb_data/data.db'
    try:
        with sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True) as con:
            roles={row[0]:{'code':row[1],'active':bool(row[2])} for row in con.execute('SELECT id,code_role,active FROM roles')}
            for uid,name,email,active,change,code,role in con.execute('SELECT id,name,email,active,must_change_password,role_code,role FROM users WHERE role_code = ? ORDER BY id',('manager',)):
                linked=roles.get(role,{})
                reason='disabled_user' if not active else 'password_change_required' if change else 'inactive_or_wrong_role' if linked.get('code')!='manager' or linked.get('active') is not True else 'configuration_ok_password_not_tested'
                assigned=con.execute('SELECT COUNT(*) FROM rights WHERE user = ? AND active = 1',(uid,)).fetchone()[0]
                report['managers'].append({'id':uid,'name':name,'email':email,'status':reason,'active_assignments':assigned})
            report['demo_user_count']=con.execute('SELECT COUNT(*) FROM users WHERE email LIKE ? OR name LIKE ?',('demo.%','%(демо)%')).fetchone()[0]
    except sqlite3.Error:
        report['database']='unavailable_or_incompatible_schema'
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',default='/opt/pocketbase');args=parser.parse_args()
    print(json.dumps(inspect(Path(args.root),Path(__file__).resolve().parents[1]),ensure_ascii=False,indent=2))
