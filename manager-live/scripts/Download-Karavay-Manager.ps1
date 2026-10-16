param(
    [switch]$CopyToVM,
    [switch]$Install,
    [ValidatePattern('^([0-9a-f]{40})?$')][string]$SourceRevision = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Install -and -not $SourceRevision) { throw 'Installation requires an exact Git commit in -SourceRevision.' }
$revision = if ($SourceRevision) { $SourceRevision } else { 'feature/manager-cabinet-v0.3' }
$base = 'https://raw.githubusercontent.com/nikitinad17-ai/Karavay_LK/' + $revision + '/manager-live'
$label = 'Karavay-Manager-Users-20261016-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$folder = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $label
New-Item -ItemType Directory -Path $folder | Out-Null
Invoke-WebRequest -Uri ($base + '/MANIFEST.json') -OutFile (Join-Path $folder 'MANIFEST.json')
$manifest = Get-Content -LiteralPath (Join-Path $folder 'MANIFEST.json') -Raw | ConvertFrom-Json
$paths = @($manifest.package.PSObject.Properties.Name) + @('scripts/install.py')
foreach ($path in $paths) {
    if ($path -notmatch '^(pb_hooks|pb_public|pb_migrations|scripts)/[A-Za-z0-9/_.-]+$' -or $path.Contains('..')) { throw 'Unexpected package path.' }
    $local = Join-Path $folder $path
    New-Item -ItemType Directory -Path (Split-Path $local) -Force | Out-Null
    Invoke-WebRequest -Uri ($base + '/' + $path) -OutFile $local
    $expected = if ($path -eq 'scripts/install.py') { $manifest.installer_sha256 } else { $manifest.package.$path }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $local).Hash.ToLower() -ne $expected) { throw ('Hash mismatch: ' + $path) }
}
$archive = $folder + '.zip'
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $archive
Write-Host ('PACKAGE VERIFIED: ' + $archive)
if ($CopyToVM -or $Install) {
    & scp -r $folder 'lindevadmin@192.168.25.98:/home/lindevadmin/'
    if ($LASTEXITCODE -ne 0) { throw 'Copy to VM failed. PocketBase was not changed.' }
    $remote = 'sudo python3 /home/lindevadmin/' + $label + '/scripts/install.py'
    if ($Install) { $remote += ' --install' }
    & ssh -t 'lindevadmin@192.168.25.98' $remote
    if ($LASTEXITCODE -ne 0) { throw 'VM step failed. Read the error and any ROLLED_BACK message before retrying.' }
    if ($Install) {
        Write-Host 'Open http://192.168.25.98:8090/manager/ and refresh with Ctrl+Shift+R.'
    } else {
        Write-Host 'PREFLIGHT PASSED. The manager cabinet is not installed yet.'
        Write-Host 'Installation command:'
        Write-Host ('ssh -t lindevadmin@192.168.25.98 "' + $remote + ' --install"')
    }
}
