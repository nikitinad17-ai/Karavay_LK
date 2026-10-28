"""One Windows release: history UI first, then the requested diverse demos."""
import base64
import hashlib
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
classic = json.loads((ROOT / 'MANIFEST.json').read_text())
html = (ROOT / 'pb_public/index.html').read_bytes()
release = {'version': '3.8.5', 'html_sha256': hashlib.sha256(html).hexdigest(),
           'known_html': list(dict.fromkeys(classic['previous']['pb_public/index.html']))}
files = ['pb_public/index.html', 'pb_hooks/karavay-test-access.js',
         'test-access/install-scenarios.py', 'test-access/install-diverse-history.py',
         'test-access/select-buyers.py', 'test-access/select-diverse-history.py',
         'test-access/1793093600_test_scenario_users.js', 'test-access/SCENARIOS-3.8.5.md']
required = classic['required_fields']
required['users'].update(name='text', login='text')
required['payers'].update(kod_pay='text', name_pay='text')
required['clients'].update(kod_clt='text', name_clt='text')
demo = {'version': '3.8.5', 'files': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
        'known_html': list(dict.fromkeys([classic['html_sha256'], *classic['previous']['pb_public/index.html']])),
        'required_fields': required, 'route_sha256': hashlib.sha256((ROOT / 'pb_hooks/karavay-test-access.pb.js').read_bytes()).hexdigest()}
(ROOT / 'test-access/SCENARIOS-MANIFEST.json').write_text(json.dumps(demo, indent=2) + '\n')
stream = io.BytesIO()
with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('client/index.html', html)
    archive.writestr('client/release.json', json.dumps(release, indent=2) + '\n')
    archive.write(ROOT / 'order-repeat/update-client.py', 'client/update-client.py')
    for name in [*demo['files'], 'test-access/SCENARIOS-MANIFEST.json']:
        archive.write(ROOT / name, 'demo/' + name)
raw = stream.getvalue()
digest = hashlib.sha256(raw).hexdigest()
script = r'''# KARAVAY 3.8.5: clickable history rows and repeat-order draft actions.
param([switch]$ClientOnly,[ValidateRange(1,60)][int]$SearchMinutes=15)
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Orders-3.8.5'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$taskZip = Join-Path $taskDir 'karavay-orders-385.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA__') { throw 'Package checksum mismatch' }
[IO.File]::WriteAllBytes($taskZip,$taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-orders-385-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-orders-385.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-orders-385')
'@
[IO.File]::WriteAllText($taskUnpack,$taskPython,[Text.Encoding]::ASCII)
Write-Host 'Stage 1: update client HTML; remove raw KIS state; clickable rows; Repeat order in list and detail.'
if ($ClientOnly) { Write-Host 'ClientOnly: retain existing demo logins. No service restart or migrations.' }
else { Write-Host 'Stage 2: install one-recipient / MULTIPLE-RECIPIENT / multiple-buyer demo logins. The second login MUST see at least TWO real active recipients.' }
Write-Host 'Account creation does NOT wait for history or catalog success. Real history is reported separately.'
Write-Host 'No KIS writes or order creation. Existing users/passwords/rights and manager files are retained.'
Write-Host 'SSH/sudo may ask for the VM password. No PocketBase password is needed.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; update was not started' }
$taskEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $taskRemote = 'python3 /home/lindevadmin/karavay-orders-385-unpack.py && sudo python3 /home/lindevadmin/karavay-orders-385/client/update-client.py --apply'
  if (-not $ClientOnly) {
    $taskRemote += ' && sudo python3 -u /home/lindevadmin/karavay-orders-385/demo/test-access/install-scenarios.py --apply --seconds ' + ($SearchMinutes * 60)
  }
  & ssh -t 'lindevadmin@192.168.25.98' $taskRemote
  if ($LASTEXITCODE -ne 0) { throw 'Read the CLIENT_3_8_5_* / SCENARIOS_STOP results above. UI success and demo installation are reported separately.' }
} finally { [Console]::OutputEncoding = $taskEncoding }
Write-Host 'Ready. Reload http://192.168.25.98:8090/ with Ctrl+F5. Expected version: 3.8.5.'
if (-not $ClientOnly) { Write-Host 'Demo success: MULTI_RECIPIENT_DEMO_READY with recipients >= 2, then SCENARIOS_READY.' }
'''.replace('__PAYLOAD__', base64.b64encode(raw).decode()).replace('__SHA__', digest)
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
target = output / 'Karavay-Orders-3.8.5.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
