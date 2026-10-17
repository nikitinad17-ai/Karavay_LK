#!/usr/bin/env python3
"""Pinned download/install from a VM console, without SSH. No credentials in args."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision',required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--configure',action='store_true')
    args=parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}',args.revision):raise RuntimeError('Use an exact 40-character Git commit')
    if args.configure and not args.apply:raise RuntimeError('--configure requires --apply')
    if args.configure and os.geteuid()==0:
        raise RuntimeError('For the complete setup first run: sudo -iu lindevadmin ; then repeat this command. No service changes were made.')
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    folder=Path.home()/('Karavay-Manager-0.8.1-'+stamp)
    folder.mkdir(mode=0o700)
    base='https://raw.githubusercontent.com/nikitinad17-ai/Karavay_LK/'+args.revision+'/manager-live/'
    def download(name):
        if not re.fullmatch(r'[A-Za-z0-9/_\.-]+',name) or '..' in Path(name).parts:raise RuntimeError('Invalid package path')
        with urllib.request.urlopen(base+name,timeout=30) as response:return response.read(6*1024*1024)
    raw=download('MANIFEST.json');manifest=json.loads(raw);(folder/'MANIFEST.json').write_bytes(raw)
    files={**manifest['package'],**manifest['setup_files'],'scripts/install.py':manifest['installer_sha256']}
    for name,digest in files.items():
        content=download(name)
        if hashlib.sha256(content).hexdigest()!=digest:raise RuntimeError('Package checksum mismatch: '+name)
        target=folder/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
    cmd=['python3',str(folder/'scripts/install.py')]
    if args.apply:cmd=['sudo',*cmd,'--install']
    subprocess.run(cmd,check=True)
    if args.configure:
        # Run as the ordinary operator: generated access files stay in their home.
        subprocess.run(['python3',str(folder/'scripts/Configure-Workspace.py'),'--apply','--run-id','console-'+stamp],check=True)
    print('VERIFIED_PACKAGE:',folder)

if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.CalledProcessError) as error:print('STOPPED:',error,file=sys.stderr);sys.exit(1)
