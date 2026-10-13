param([switch]$CopyToVM)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = 'https://raw.githubusercontent.com/nikitinad17-ai/Karavay_LK/feature/manager-cabinet-v0.3/manager-live'
$label = 'Karavay-Manager-0.4-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$folder = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $label
New-Item -ItemType Directory -Path $folder | Out-Null
Invoke-WebRequest -Uri ($base + '/MANIFEST.json') -OutFile (Join-Path $folder 'MANIFEST.json')
$manifest = Get-Content -LiteralPath (Join-Path $folder 'MANIFEST.json') -Raw | ConvertFrom-Json
$paths = @($manifest.package.PSObject.Properties.Name) + @('scripts/install.py')
foreach ($path in $paths) {
    if ($path -notmatch '^(pb_hooks|pb_public/manager|scripts)/[A-Za-z0-9/_.-]+$' -or $path.Contains('..')) { throw 'Unexpected package path.' }
    $local = Join-Path $folder $path
    New-Item -ItemType Directory -Path (Split-Path $local) -Force | Out-Null
    Invoke-WebRequest -Uri ($base + '/' + $path) -OutFile $local
    $expected = if ($path -eq 'scripts/install.py') { $manifest.installer_sha256 } else { $manifest.package.$path }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $local).Hash.ToLower() -ne $expected) { throw ('Hash mismatch: ' + $path) }
}
$archive = $folder + '.zip'
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $archive
Write-Host ('PACKAGE VERIFIED: ' + $archive)
if ($CopyToVM) {
    & scp -r $folder 'lindevadmin@192.168.25.98:/home/lindevadmin/'
    if ($LASTEXITCODE -ne 0) { throw 'Copy to VM failed. PocketBase was not changed.' }
    & ssh -t 'lindevadmin@192.168.25.98' ('sudo python3 /home/lindevadmin/' + $label + '/scripts/install.py')
    if ($LASTEXITCODE -ne 0) { throw 'Preflight failed. Do not install; send the error text.' }
    Write-Host 'PREFLIGHT PASSED. The manager cabinet is not installed yet.'
    Write-Host 'Installation command, to run separately after reviewing preflight:'
    Write-Host ('ssh -t lindevadmin@192.168.25.98 "sudo python3 /home/lindevadmin/' + $label + '/scripts/install.py --install"')
}
