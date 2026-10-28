"""Package the distinct-customer TEST KIS history installer for Windows."""
import base64
import hashlib
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
files = ['pb_public/index.html', 'pb_hooks/karavay-test-access.js',
         'test-access/select-diverse-history.py', 'test-access/install-diverse-history.py',
         'test-access/1793090000_test_diverse_history_users.js', 'test-access/DIVERSE-HISTORY-3.8.4.md']
classic = json.loads((ROOT / 'MANIFEST.json').read_text())
required = classic['required_fields']
required['users'].update(name='text', login='text')
required['payers'].update(kod_pay='text', name_pay='text')
required['clients'].update(kod_clt='text', name_clt='text')
manifest = {'version': '3.8.4', 'files': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
            'known_html': list(dict.fromkeys([classic['html_sha256'], *classic['previous']['pb_public/index.html']])),
            'route_sha256': hashlib.sha256((ROOT / 'pb_hooks/karavay-test-access.pb.js').read_bytes()).hexdigest(),
            'required_fields': required}
(ROOT / 'test-access/DIVERSE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
payload = io.BytesIO()
with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in [*files, 'test-access/DIVERSE-MANIFEST.json']:
        archive.write(ROOT / name, name)
raw = payload.getvalue()
digest = hashlib.sha256(raw).hexdigest()
script = r'''# TEST KIS: three OTHER customer defaults and verified real recipient histories.
param([switch]$Rescan,[ValidateRange(1,60)][int]$SearchMinutes=20)
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Different-Buyers-History-20261027'
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
$taskZip = Join-Path $taskDir 'karavay-different-buyers-history-20261027.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA__') { throw 'Package checksum mismatch' }
[IO.File]::WriteAllBytes($taskZip,$taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-different-buyers-history-20261027-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-different-buyers-history-20261027.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-different-buyers-history-20261027')
'@
[IO.File]::WriteAllText($taskUnpack,$taskPython,[Text.Encoding]::ASCII)
Write-Host 'Three OTHER buyers, fake login emails, real existing KIS histories. Current demo buyers are excluded.'
Write-Host 'Search checks RECIPIENT histories and order lines. Price errors do not discard histories.'
Write-Host 'Search progress is saved on the VM. The same command resumes an unfinished scan.'
Write-Host 'No KIS writes or order creation. SSH/sudo may request the VM password; no PB password is needed.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; installation was not started' }
$taskEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $taskRemote = 'python3 /home/lindevadmin/karavay-different-buyers-history-20261027-unpack.py && sudo python3 -u /home/lindevadmin/karavay-different-buyers-history-20261027/test-access/install-diverse-history.py --apply --seconds ' + ($SearchMinutes * 60)
  if ($Rescan) { $taskRemote += ' --rescan' }
  & ssh -t 'lindevadmin@192.168.25.98' $taskRemote
  if ($LASTEXITCODE -ne 0) { throw 'Read DIVERSE_HISTORY_STOP / DIVERSE_HISTORY_PAUSED above. Existing application files are retained/restored. Send that result.' }
} finally { [Console]::OutputEncoding = $taskEncoding }
Write-Host 'Reload the cabinet. Success is DIVERSE_HISTORY_READY plus three DEMO_HISTORY_OK lines.'
'''.replace('__PAYLOAD__', base64.b64encode(raw).decode()).replace('__SHA__', digest)
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
target = output / 'Karavay-Different-Buyers-History-20261027.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
