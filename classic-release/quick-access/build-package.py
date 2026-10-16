"""Build a single downloadable Windows setup script. Contains no live credentials."""
import base64
import hashlib
import io
from pathlib import Path
import sys
import zipfile

HERE = Path(__file__).resolve().parent
pin_kis_23 = '--pin-kis-2-3' in sys.argv[2:]
package_name = 'Karavay-Quick-Access-KIS-2-3-20261016' if pin_kis_23 else 'Karavay-Quick-Access-20261016'
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
payload = io.BytesIO()
with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('Create-Quick-Users.py', 'launcher.js', 'launcher.css', 'Start-Karavay-Test-Users.ps1', 'README.md'):
        archive.write(HERE / name, name)
    archive.write(HERE.parent / 'scripts/Seed-Demo-Users.py', 'Seed-Demo-Users.py')
raw = payload.getvalue()
encoded = base64.b64encode(raw).decode()
digest = hashlib.sha256(raw).hexdigest()
script = r'''# KАRАVАY: one-time setup; generated test credentials stay on your VM/PC.
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Quick-Access-20261016'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$taskZip = Join-Path $taskDir 'setup-files.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA256__') { throw 'Setup payload checksum mismatch.' }
[IO.File]::WriteAllBytes($taskZip, $taskBytes)
Expand-Archive -LiteralPath $taskZip -DestinationPath $taskDir -Force
& (Join-Path $taskDir 'Start-Karavay-Test-Users.ps1')
'''.replace('__PAYLOAD__', encoded).replace('__SHA256__', digest)
# ASCII avoids Windows PowerShell 5.1 interpreting UTF-8 source as ANSI.
script = script.replace('KАRАVАY', 'KARAVAY')
if pin_kis_23:
    script = script.replace('Downloads\\Karavay-Quick-Access-20261016', 'Downloads\\' + package_name)
    script = script.replace("& (Join-Path $taskDir 'Start-Karavay-Test-Users.ps1')", "& (Join-Path $taskDir 'Start-Karavay-Test-Users.ps1') -PinKis23")
target = output / (package_name + '.ps1')
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
