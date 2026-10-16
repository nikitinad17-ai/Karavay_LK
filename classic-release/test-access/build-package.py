"""Build one ASCII PowerShell installer for Windows 5.1/7. No credentials."""
import base64, hashlib, io, json, pathlib, sys, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / 'MANIFEST.json').read_text())
payload = io.BytesIO()
with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in [*manifest['package'], 'MANIFEST.json', 'scripts/install.py', 'scripts/Seed-Demo-Users.py', 'test-access/install-test.py', 'test-access/1792180000_test_access_users.js', 'test-access/README.md']:
        archive.write(ROOT / name, name)
raw = payload.getvalue()
script = r'''# KARAVAY 3.8.1: install test buttons into the main cabinet once.
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Test-3.8.1'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$taskZip = Join-Path $taskDir 'karavay-test-3.8.1.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA256__') { throw 'Package checksum mismatch.' }
[IO.File]::WriteAllBytes($taskZip, $taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-test-3.8.1-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-test-3.8.1.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA256__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-test-3.8.1')
'@
[IO.File]::WriteAllText($taskUnpack, $taskPython, [Text.Encoding]::ASCII)
Write-Host 'One-time VM update. SSH/sudo may request the VM password. Test login will need no password.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'SSH upload failed; no installation was started.' }
$taskRemote = 'python3 /home/lindevadmin/karavay-test-3.8.1-unpack.py && sudo python3 /home/lindevadmin/karavay-test-3.8.1/test-access/install-test.py --apply'
& ssh -t 'lindevadmin@192.168.25.98' $taskRemote
if ($LASTEXITCODE -ne 0) { throw 'VM update stopped. Read the error above. Repeating this installer preserves completed users and rights.' }
Write-Host 'READY: open the cabinet and choose one of three test users.'
Start-Process 'http://192.168.25.98:8090/'
'''.replace('__PAYLOAD__', base64.b64encode(raw).decode()).replace('__SHA256__', hashlib.sha256(raw).hexdigest())
target = output / 'Karavay-Test-3.8.1.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
