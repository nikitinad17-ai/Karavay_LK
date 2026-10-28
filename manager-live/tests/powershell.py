"""Execute the real PS1 workflows with native SSH/SCP fixtures, never the VM.

Requires PWSH=/path/to/pwsh. Runs legacy native argument passing as in Windows
PowerShell, with spaces in USERPROFILE. Only transport/PB results are fixtures.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ['PWSH']
spec = importlib.util.spec_from_file_location('release_builder', ROOT/'scripts/build-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

TRANSPORT = r'''#!/usr/bin/env python3
import json,os,pathlib,re,shlex,shutil,sys
root=pathlib.Path(os.environ['TEST_CASE']);args=sys.argv[1:]
name=pathlib.Path(sys.argv[0]).name
with (root/'calls.jsonl').open('a') as out:out.write(json.dumps({'command':name,'args':args})+'\n')
scenario=os.environ['TEST_SCENARIO']
remote=root/'remote';remote.mkdir(exist_ok=True)
if name=='ssh':
 assert len(args)==3 and args[:2]==['-t','lindevadmin@192.168.25.98'],args
 if scenario=='ssh-fail':sys.exit(255)
 command=shlex.split(args[2])
 if '--run-id' not in command:sys.exit(0)
 run_id=command[command.index('--run-id')+1]
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',run_id):
  print('STOPPED: Invalid run ID');sys.exit(2)
 if scenario=='early-fail':
  print('STOPPED: Fixture setup failed before authentication');sys.exit(2)
 sys.exit(2 if scenario=='partial' else 0)
if args[0]=='-r':
 assert len(args)==3,args
 sys.exit(1 if scenario=='copy-fail' else 0)
assert len(args)==2 and args[0].startswith('lindevadmin@192.168.25.98:/home/lindevadmin/'),args
source=remote/args[0].rsplit('/',1)[1]
if not source.is_file():
 print('fixture scp: report does not exist',file=sys.stderr);sys.exit(1)
shutil.copyfile(source,args[1])
'''

WRAPPER = r'''
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Legacy'
function Start-Process { param($FilePath) Add-Content -LiteralPath (Join-Path $env:TEST_CASE 'opened.txt') -Value $FilePath }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,[string]$Uri,[string]$OutFile)
    $relative = $Uri.Substring($Uri.IndexOf('/manager-live/') + 14)
    Copy-Item -LiteralPath (Join-Path $env:TEST_SOURCE $relative) -Destination $OutFile
}
$arguments = @(ConvertFrom-Json $env:TEST_ARGUMENTS)
$parameters = @{}
for ($i = 0; $i -lt $arguments.Count; $i++) {
    $key = $arguments[$i].TrimStart('-')
    if ($key -eq 'SourceRevision') { $i++; $parameters[$key] = $arguments[$i] }
    else { $parameters[$key] = $true }
}
try { & $env:TEST_PS1 @parameters; exit 0 }
catch { Write-Host $_.Exception.Message; exit 1 }
'''

with tempfile.TemporaryDirectory(prefix='manager-powershell-') as temp:
    base=Path(temp)
    native=base/'bin';native.mkdir()
    for command in ('ssh','scp'):
        path=native/command;path.write_text(TRANSPORT);path.chmod(0o755)
    wrapper=base/'run.ps1';wrapper.write_text(WRAPPER)
    complete,_=builder.build(base/'release')
    count=0

    def run(source,args,scenario='success',expected=0):
        global count
        count+=1
        case=base/('case-'+str(count));case.mkdir()
        profile=case/'Operator With Spaces';(profile/'Downloads').mkdir(parents=True)
        env=dict(os.environ,PATH=str(native)+':'+os.environ['PATH'],USERPROFILE=str(profile),TEST_CASE=str(case),TEST_SCENARIO=scenario,TEST_SOURCE=str(ROOT),TEST_PS1=str(source),TEST_ARGUMENTS=json.dumps(args))
        result=subprocess.run([PWSH,'-NoLogo','-NoProfile','-File',str(wrapper)],env=env,text=True,capture_output=True,timeout=30)
        assert result.returncode==expected,(count,scenario,result.stdout,result.stderr)
        calls=[json.loads(line) for line in (case/'calls.jsonl').read_text().splitlines()] if (case/'calls.jsonl').exists() else []
        opens=(case/'opened.txt').read_text().splitlines() if (case/'opened.txt').exists() else []
        for archive in profile.rglob('*.zip'):
            with zipfile.ZipFile(archive) as package:
                assert not any('Private/' in name or name.endswith('Access.html') or name.endswith('Test-Login.html') for name in package.namelist())
        return calls,opens,result.stdout

    def check(calls,*,install,configure):
        commands=[row['args'][2] for row in calls if row['command']=='ssh']
        assert len(commands)==1,commands
        command=commands[0]
        assert ('install.py' in command)==install,command
        assert ('Setup-Recipient-Demos.py' in command)==configure,command
        if configure:
            run_id=command.rsplit('--run-id ',1)[1]
            assert re.fullmatch(r'manager-08-[0-9a-f]{32}',run_id),command
            assert 'Enable-Test-Login.py --enable' in command
            assert 'sudo python3' in command
        downloads=[row['args'] for row in calls if row['command']=='scp' and row['args'][0]!='-r']
        assert not downloads,downloads
        return command

    calls,opens,_=run(complete,[])
    command=check(calls,install=True,configure=False)
    assert 'Setup-Recipient-Demos.py' not in command
    assert opens==['http://192.168.25.98:8090/manager/']
    calls,opens,_=run(complete,['-ResumeSetup'])
    check(calls,install=False,configure=True)
    assert len(opens)==1
    calls,opens,_=run(complete,['-PreflightOnly'])
    command=check(calls,install=True,configure=False)
    assert '--install' not in command and not opens
    for scenario in ['partial','early-fail','ssh-fail']:
        calls,opens,_=run(complete,['-ResumeSetup'],scenario,1)
        check(calls,install=False,configure=True)
        assert not opens
    calls,opens,_=run(complete,['-ResumeSetup'],'copy-fail',1)
    assert all(row['command']!='ssh' for row in calls) and not opens
    for args in [['-ResumeSetup','-PreflightOnly'],['-ResumeSetup','-TestLoginOnly']]:
        calls,opens,_=run(complete,args,expected=1)
        assert not calls and not opens
    downloader=ROOT/'scripts/Download-Karavay-Manager.ps1'
    for args,install in [(['-Install','-ConfigureWorkspace'],True),(['-ConfigureWorkspace'],False)]:
        calls,opens,_=run(downloader,['-SourceRevision','a'*40,*args])
        check(calls,install=install,configure=True)
        assert len(opens)==1
    calls,opens,_=run(complete,['-TestLoginOnly'])
    command=check(calls,install=True,configure=False)
    assert opens==['http://192.168.25.98:8090/manager/'] and 'Enable-Test-Login.py --enable' in command
    calls,opens,output=run(downloader,['-SourceRevision','a'*40,'-EnableTestLogin'])
    check(calls,install=False,configure=False)
    assert len(opens)==1 and 'TEST LOGIN READY' in output
    calls,opens,_=run(complete,['-TestLoginOnly','-PreflightOnly'])
    command=check(calls,install=True,configure=False)
    assert not opens and 'Enable-Test-Login.py' not in command
    print('PASS:',count,'real PowerShell workflow cases; native argv, spaces, full/resume/preflight/test-only, failed copy/SSH/setup, no password/access-file downloads')
