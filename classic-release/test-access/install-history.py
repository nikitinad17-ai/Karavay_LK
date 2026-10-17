#!/usr/bin/env python3
"""Install three NEW test accounts only after real KIS history/catalog verification."""
import argparse, json, os, pathlib, subprocess
import importlib.util
HERE = pathlib.Path(__file__).resolve().parent
def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path); value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
setup=module('test_setup',HERE/'install-test.py')
selection=module('history_selection',HERE/'select-history.py')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    root=pathlib.Path('/opt/pocketbase')
    if args.apply and os.geteuid()!=0: raise RuntimeError('Use sudo once for installation')
    subprocess.run(['python3',str(setup.SOURCE/'scripts/install.py')],check=True)
    saved_path=root/'pb_data/karavay-test-access.json'
    saved=json.loads(saved_path.read_text()) if saved_path.is_file() else None
    api=setup.seed.Api()
    chosen=selection.select(api,saved)
    config=setup.plan(root,api,chosen)
    for item in chosen:
        print('HISTORY_READY:',item['payer']['name'],'|',item['point']['kod'],'|',item['point']['name'],'| orders:',item['history_count'])
    if not args.apply: print('HISTORY_PREFLIGHT_OK: read-only; no changes');return
    setup.MIGRATION='1792260000_test_history_users.js'
    backup=setup.deploy(root,config,json.loads((setup.SOURCE/'MANIFEST.json').read_text()))
    print('TEST_3.8.2_HISTORY_READY: http://192.168.25.98:8090/')
    print('BACKUP:',backup)
    print('Verified: 3 logins, existing history, readable lines, dated catalog. No KIS order created by installation.')
if __name__=='__main__':main()
