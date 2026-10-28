"""One date-only helper patch + read-only catalog diagnostic for the VM."""
import base64, hashlib, io, pathlib, sys, zipfile
HERE = pathlib.Path(__file__).resolve().parent
raw = io.BytesIO()
with zipfile.ZipFile(raw, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(HERE / 'catalog-date-check.py', 'catalog-date-check.py')
    z.write(HERE.parent / 'pb_hooks/karavay-test-access.js', 'karavay-test-access.js')
payload = raw.getvalue()
digest = hashlib.sha256(payload).hexdigest()
script = r'''# TEST KIS: fix stale test-login date and read the selected recipient's catalog.
param([Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,40}$')][string]$ClientCode)
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Catalog-Date-20261027'
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
$taskZip = Join-Path $taskDir 'karavay-catalog-date-20261027.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA__') { throw 'Package checksum mismatch' }
[IO.File]::WriteAllBytes($taskZip, $taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-catalog-date-20261027-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-catalog-date-20261027.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-catalog-date-20261027')
'@
[IO.File]::WriteAllText($taskUnpack,$taskPython,[Text.Encoding]::ASCII)
Write-Host 'Date-only TEST login update, then direct KIS/gateway catalog reads for today/tomorrow, Groups 1/0.'
Write-Host 'No account recreation, schema migrations or order requests. SSH/sudo may request the VM password.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; date patch was not started' }
$taskEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $taskRemote = 'python3 /home/lindevadmin/karavay-catalog-date-20261027-unpack.py && sudo python3 /home/lindevadmin/karavay-catalog-date-20261027/catalog-date-check.py --apply-date --client-code ' + $ClientCode
  & ssh -t 'lindevadmin@192.168.25.98' $taskRemote
  if ($LASTEXITCODE -ne 0) { throw 'Read the TEST_DATE_FIXED / CATALOG_DATE_STOP result above. Catalog errors are reported separately.' }
} finally { [Console]::OutputEncoding = $taskEncoding }
Write-Host 'Reload the cabinet. Send the KIS_CATALOG_HTTP / KIS_MESSAGE / GATEWAY_CATALOG_HTTP lines.'
'''.replace('__PAYLOAD__',base64.b64encode(payload).decode()).replace('__SHA__',digest)
output = pathlib.Path(sys.argv[1]).resolve(); output.mkdir(parents=True,exist_ok=True)
target = output / 'Karavay-Catalog-Date-20261027.ps1'
target.write_text(script,encoding='ascii',newline='\r\n')
print(target)
