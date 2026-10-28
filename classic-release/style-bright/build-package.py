"""Package CSS-only injection; never replace the installed application bundle."""
import base64
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
SOURCE = ROOT / 'src/classic'
css = (SOURCE / 'bright.css').read_text()
for name in ('Ubuntu-R.ttf', 'Ubuntu-M.ttf', 'Ubuntu-B.ttf'):
    data = (SOURCE / 'fonts' / name).read_bytes()
    css = css.replace('./fonts/' + name, 'data:font/ttf;base64,' + base64.b64encode(data).decode())
if re.search(r'url\((?![\'\"]?data:)', css):
    raise RuntimeError('Style must not depend on external files or font servers')
css = css.encode()
manifest = json.loads((ROOT / 'classic-release/MANIFEST.json').read_text())
# The exact released 3.8.5 logic is an allowed base; a style patch preserves it.
known = ['82593d4b3ae76b058786cffadffdf0c5739e1ee0867908366492c82d1b409a6a',
         manifest['html_sha256'],
         *manifest['previous']['pb_public/index.html']]
release = {'style': 'bright-20261028', 'css_sha256': hashlib.sha256(css).hexdigest(),
           'known_base_html': list(dict.fromkeys(known))}
payload = io.BytesIO()
with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('bright.css', css)
    archive.writestr('style-release.json', json.dumps(release, indent=2) + '\n')
    archive.write(HERE / 'apply-style.py', 'apply-style.py')
raw = payload.getvalue()
digest = hashlib.sha256(raw).hexdigest()
script = r'''# KARAVAY: visual blue/yellow styling only; keep the installed application logic.
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-Style-Bright-20261028'
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
$taskZip = Join-Path $taskDir 'karavay-style-bright-20261028.zip'
$taskBytes = [Convert]::FromBase64String('__PAYLOAD__')
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
finally { $taskHasher.Dispose() }
if ($taskHash -ne '__SHA__') { throw 'Package checksum mismatch' }
[IO.File]::WriteAllBytes($taskZip,$taskBytes)
$taskUnpack = Join-Path $taskDir 'karavay-style-bright-20261028-unpack.py'
$taskPython = @'
import hashlib,pathlib,zipfile
p=pathlib.Path('/home/lindevadmin/karavay-style-bright-20261028.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='__SHA__', 'Package checksum mismatch'
zipfile.ZipFile(p).extractall('/home/lindevadmin/karavay-style-bright-20261028')
'@
[IO.File]::WriteAllText($taskUnpack,$taskPython,[Text.Encoding]::ASCII)
Write-Host 'Style only: brighter blue/yellow colors, Ubuntu font, welcome card, buttons and forms.'
Write-Host 'Original HTML and scripts are preserved outside one new style block. No demo/user/KIS changes.'
& scp $taskZip $taskUnpack 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; styling was not applied' }
$taskEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  & ssh -t 'lindevadmin@192.168.25.98' 'python3 /home/lindevadmin/karavay-style-bright-20261028-unpack.py && sudo python3 /home/lindevadmin/karavay-style-bright-20261028/apply-style.py --apply'
  if ($LASTEXITCODE -ne 0) { throw 'Read STYLE_STOP above. Previous client HTML was retained/restored.' }
} finally { [Console]::OutputEncoding = $taskEncoding }
Write-Host 'Ready. Reload the cabinet with Ctrl+F5. Success: BRIGHT_STYLE_READY.'
'''.replace('__PAYLOAD__', base64.b64encode(raw).decode()).replace('__SHA__', digest)
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
target = output / 'Karavay-Style-Bright-20261028.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
