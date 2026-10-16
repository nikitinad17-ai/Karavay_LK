#!/usr/bin/env python3
"""Build a self-contained PS1 and source ZIP. No generated access files included."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
NAME='Karavay-Manager-0.8.0-Complete-20261016'

def build(output):
    output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'MANIFEST.json').read_text())
    expected={**manifest['package'],**manifest['setup_files'],'scripts/install.py':manifest['installer_sha256']}
    for name,digest in expected.items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Manifest checksum mismatch: '+name)
    names=[*expected,'MANIFEST.json','README.md','RELEASE_0.8.0.md']
    payload=io.BytesIO()
    with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED) as archive:
        for name in names:archive.write(ROOT/name,name)
    data=payload.getvalue()
    zip_path=output/(NAME+'.zip');zip_path.write_bytes(data)
    source=(ROOT/'scripts/Download-Karavay-Manager.ps1').read_text()
    # Reuse the tested operator workflow, replacing only online download with
    # this immutable embedded package. Interactive SSH output is not piped.
    workflow=source[source.index('$archive = $folder'):]
    try:
        revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        if subprocess.run(['git','diff','--quiet','HEAD','--','.'],cwd=ROOT).returncode:
            revision+=' (uncommitted changes)'
    except subprocess.CalledProcessError:revision='uncommitted'
    bootstrap=r'''param([switch]$PreflightOnly)
$ErrorActionPreference = 'Stop'
$Install = -not $PreflightOnly
$ConfigureWorkspace = -not $PreflightOnly
$CopyToVM = $true
$label = 'Karavay-Manager-0.8.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$folder = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $label
New-Item -ItemType Directory -Path $folder | Out-Null
$bytes = [Convert]::FromBase64String('__PAYLOAD__')
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $digest = [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
finally { $hasher.Dispose() }
if ($digest -ne '__DIGEST__') { throw 'Embedded package checksum mismatch.' }
$embedded = Join-Path $folder 'embedded.zip'
[IO.File]::WriteAllBytes($embedded, $bytes)
Expand-Archive -LiteralPath $embedded -DestinationPath $folder -Force
Remove-Item -LiteralPath $embedded
$manifest = Get-Content -LiteralPath (Join-Path $folder 'MANIFEST.json') -Raw | ConvertFrom-Json
$paths = @($manifest.package.PSObject.Properties.Name) + @($manifest.setup_files.PSObject.Properties.Name) + @('scripts/install.py')
foreach ($path in $paths) {
    $expected = if ($path -eq 'scripts/install.py') { $manifest.installer_sha256 } elseif ($manifest.package.PSObject.Properties.Name -contains $path) { $manifest.package.$path } else { $manifest.setup_files.$path }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $folder $path)).Hash.ToLower() -ne $expected) { throw ('Hash mismatch: ' + $path) }
}
'''.replace('__PAYLOAD__',base64.b64encode(data).decode()).replace('__DIGEST__',hashlib.sha256(data).hexdigest())
    ps1=output/(NAME+'.ps1')
    ps1.write_text('# Source commit: '+revision+'\n'+bootstrap+workflow,encoding='ascii',newline='\r\n')
    # Verify actual output rather than trusting the builder's own input.
    text=ps1.read_text();encoded=text.split("FromBase64String('",1)[1].split("')",1)[0]
    assert base64.b64decode(encoded)==data
    with zipfile.ZipFile(io.BytesIO(data)) as check:
        assert check.testzip() is None
        assert set(check.namelist())==set(names)
        assert not any('private' in name.casefold() or 'pb_data' in name.casefold() for name in check.namelist())
        for name,digest in expected.items():assert hashlib.sha256(check.read(name)).hexdigest()==digest
    print(json.dumps({'ps1':str(ps1),'zip':str(zip_path),'zip_sha256':hashlib.sha256(data).hexdigest(),'source':revision}))
    return ps1,zip_path

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output');args=parser.parse_args();build(args.output)
