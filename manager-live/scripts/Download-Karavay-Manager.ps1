param(
    [switch]$CopyToVM,
    [switch]$Install,
    [switch]$ConfigureWorkspace,
    [switch]$EnableTestLogin,
    [ValidatePattern('^([0-9a-f]{40})?$')][string]$SourceRevision = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (($Install -or $ConfigureWorkspace -or $EnableTestLogin) -and -not $SourceRevision) { throw 'Installation/setup requires an exact Git commit in -SourceRevision.' }
$revision = if ($SourceRevision) { $SourceRevision } else { 'feature/manager-cabinet-v0.3' }
$base = 'https://raw.githubusercontent.com/nikitinad17-ai/Karavay_LK/' + $revision + '/manager-live'
$runId = 'manager-08-' + [Guid]::NewGuid().ToString('N')
$label = 'Karavay-Manager-0.9.1-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $runId.Substring($runId.Length - 8)
$folder = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $label
New-Item -ItemType Directory -Path $folder | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri ($base + '/MANIFEST.json') -OutFile (Join-Path $folder 'MANIFEST.json')
$manifest = Get-Content -LiteralPath (Join-Path $folder 'MANIFEST.json') -Raw | ConvertFrom-Json
$paths = @($manifest.package.PSObject.Properties.Name) + @($manifest.setup_files.PSObject.Properties.Name) + @('scripts/install.py')
foreach ($path in $paths) {
    if ($path -notmatch '^(pb_hooks|pb_public|pb_migrations|scripts|setup)/[A-Za-z0-9/_.-]+$' -or $path.Contains('..')) { throw 'Unexpected package path.' }
    $local = Join-Path $folder $path
    New-Item -ItemType Directory -Path (Split-Path $local) -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri ($base + '/' + $path) -OutFile $local
    $expected = if ($path -eq 'scripts/install.py') { $manifest.installer_sha256 } elseif ($manifest.package.PSObject.Properties.Name -contains $path) { $manifest.package.$path } else { $manifest.setup_files.$path }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $local).Hash.ToLower() -ne $expected) { throw ('Hash mismatch: ' + $path) }
}
$archive = $folder + '.zip'
if ($ConfigureWorkspace -and $runId -notmatch '^[A-Za-z0-9_-]{1,100}$') { throw 'Invalid setup run ID. No VM command was started.' }
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $archive
Write-Host ('PACKAGE VERIFIED: ' + $archive)
if ($CopyToVM -or $Install -or $ConfigureWorkspace -or $EnableTestLogin) {
    $vm = 'lindevadmin@192.168.25.98'
    & scp -r $folder "${vm}:/home/lindevadmin/"
    if ($LASTEXITCODE -ne 0) { throw 'SSH copy failed. The service was not changed.' }
    $remote = ''
    if ($Install -or -not ($ConfigureWorkspace -or $EnableTestLogin)) {
        $remote = 'sudo python3 /home/lindevadmin/' + $label + '/scripts/install.py'
        if ($Install) { $remote += ' --install' }
    }
    if ($EnableTestLogin -or $ConfigureWorkspace) {
        if ($remote) { $remote += ' && ' }
        $remote += 'python3 /home/lindevadmin/' + $label + '/scripts/Enable-Test-Login.py --enable'
    }
    if ($ConfigureWorkspace) {
        if ($remote) { $remote += ' && ' }
        $remote += 'sudo python3 /home/lindevadmin/' + $label + '/scripts/Setup-Recipient-Demos.py --apply --run-id ' + $runId
    }
    & ssh -t $vm $remote
    if ($LASTEXITCODE -ne 0) { throw ('VM step stopped with code ' + $LASTEXITCODE + '. Read the server message; repeat the same installer to resume. Existing passwords are not reset.') }
    if ($ConfigureWorkspace) { Write-Host 'RECIPIENT DEMOS READY: two buyers, four recipients, six independent accounts. Open Demo users in the manager.' }
    if ($EnableTestLogin -or $ConfigureWorkspace) {
        Write-Host 'TEST LOGIN READY: http://192.168.25.98:8090/manager/'
        Start-Process 'http://192.168.25.98:8090/manager/'
    }
    if ($Install -and -not ($ConfigureWorkspace -or $EnableTestLogin)) { Write-Host 'Manager installed. Refresh /manager/ with Ctrl+Shift+R.' }
    if (-not ($Install -or $ConfigureWorkspace -or $EnableTestLogin)) { Write-Host 'PREFLIGHT PASSED. No service change was made.' }
}
