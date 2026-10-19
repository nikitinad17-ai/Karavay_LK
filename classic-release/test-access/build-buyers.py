"""Package only the test access helper/configuration update. Preserve the client."""
import base64
import hashlib
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
files = ['pb_hooks/karavay-test-access.js', 'test-access/install-test.py',
         'test-access/install-buyers.py', 'test-access/select-buyers.py',
         'test-access/1792400000_test_buyer_users.js', 'test-access/BUYERS-3.8.3.md',
         'scripts/install.py', 'scripts/Seed-Demo-Users.py']
manifest = {'version': '3.8.3', 'files': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
            'route_sha256': hashlib.sha256((ROOT / 'pb_hooks/karavay-test-access.pb.js').read_bytes()).hexdigest(),
            'required_fields': json.loads((ROOT / 'MANIFEST.json').read_text())['required_fields']}
(ROOT / 'test-access/BUYERS-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
payload = io.BytesIO()
with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in [*files, 'test-access/BUYERS-MANIFEST.json']:
        archive.write(ROOT / name, name)
raw = payload.getvalue()
digest = hashlib.sha256(raw).hexdigest()
script = r'''# KARAVAY: replace manufacturer demo scenarios with KIS customer scenarios.
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Buyers-20261019'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$taskZip = Join-Path $taskDir 'karavay-buyers-20261019.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA256__') { throw 'Package checksum mismatch.' }
[IO.File]::WriteAllBytes($taskZip, $taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-buyers-20261019-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-buyers-20261019.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA256__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-buyers-20261019')
'@
[IO.File]::WriteAllText($taskUnpack, $taskPython, [Text.Encoding]::ASCII)
Write-Host 'Three new passwordless demo scenarios. KIS reads only; no history scan or order creation.'
Write-Host 'Known manufacturers KARAVAY/PALYANITSA and rejected NEVA/PROMTEHSBYT are excluded.'
Write-Host 'SSH/sudo request the VM password. No PocketBase or demo passwords are required.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Installation was not started.' }
$taskPreviousEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  & ssh -t 'lindevadmin@192.168.25.98' 'python3 /home/lindevadmin/karavay-buyers-20261019-unpack.py && sudo python3 /home/lindevadmin/karavay-buyers-20261019/test-access/install-buyers.py --apply'
  if ($LASTEXITCODE -ne 0) { throw 'Update stopped. Send the BUYER_READ_ERROR / final error above. No automatic replacement with manufacturers.' }
} finally { [Console]::OutputEncoding = $taskPreviousEncoding }
Write-Host 'READY. Reload the cabinet and select one of the three new demo logins.'
Start-Process 'http://192.168.25.98:8090/'
'''.replace('__PAYLOAD__', base64.b64encode(raw).decode()).replace('__SHA256__', digest)
target = output / 'Karavay-Real-Buyers-20261019.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
