param(
    [switch]$CopyToVM,
    [switch]$Install,
    [switch]$ConfigureWorkspace,
    [ValidatePattern('^([0-9a-f]{40})?$')][string]$SourceRevision = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (($Install -or $ConfigureWorkspace) -and -not $SourceRevision) { throw 'Installation/setup requires an exact Git commit in -SourceRevision.' }
$revision = if ($SourceRevision) { $SourceRevision } else { 'feature/manager-cabinet-v0.3' }
$base = 'https://raw.githubusercontent.com/nikitinad17-ai/Karavay_LK/' + $revision + '/manager-live'
$runId = 'manager-08-' + [Guid]::NewGuid().ToString('N')
$label = 'Karavay-Manager-0.8.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $runId.Substring($runId.Length - 8)
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
if ($CopyToVM -or $Install -or $ConfigureWorkspace) {
    $vm = 'lindevadmin@192.168.25.98'
    & scp -r $folder "${vm}:/home/lindevadmin/"
    if ($LASTEXITCODE -ne 0) { throw 'SSH copy failed. The service was not changed. Use the VM console route in README; no passwords need changing.' }
    $remote = ''
    if ($Install -or -not $ConfigureWorkspace) {
        $remote = 'sudo python3 /home/lindevadmin/' + $label + '/scripts/install.py'
        if ($Install) { $remote += ' --install' }
    }
    if ($ConfigureWorkspace) {
        if ($remote) { $remote += ' && ' }
        $remote += 'python3 /home/lindevadmin/' + $label + '/scripts/Configure-Workspace.py --apply --run-id ' + $runId
    }
    & ssh -t $vm $remote
    $vmExit = $LASTEXITCODE
    if ($vmExit -eq 255) { throw 'SSH authentication/connection failed. The VM console route avoids SSH; see README.' }
    if ($ConfigureWorkspace -and ($vmExit -eq 0 -or $vmExit -eq 2)) {
        $privateDir = Join-Path $folder 'Private'
        New-Item -ItemType Directory -Path $privateDir | Out-Null
        # Fetch one remote source per scp call. Read the report before any access
        # file: code 2 can also mean setup stopped before creating a report.
        $reportPath = Join-Path $privateDir 'Karavay-Manager-Setup-Report.json'
        & scp "${vm}:/home/lindevadmin/Karavay-Manager-Setup-Report.json" $reportPath
        if ($LASTEXITCODE -ne 0) { throw ('Setup stopped without a downloadable report (VM code ' + $vmExit + '). Read the server message above. Do not reinstall or recreate accounts blindly.') }
        $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($report.run_id -ne $runId -or $report.version -ne '0.8.0') { throw 'Results belong to an older run; no access file was downloaded or opened.' }
        if ($report.manager_access -ne 'ready') { throw 'The current report does not confirm manager access; no access file was downloaded or opened.' }
        if ($vmExit -eq 0 -and $report.demo -ne 'ready') { throw 'VM success and setup report disagree; no access file was downloaded or opened.' }
        $accessNames = @('Karavay-Manager-Access.html')
        if ($vmExit -eq 0) { $accessNames += 'Karavay-Test-Login.html' }
        foreach ($accessName in $accessNames) {
            & scp "${vm}:/home/lindevadmin/$accessName" (Join-Path $privateDir $accessName)
            if ($LASTEXITCODE -ne 0) { throw ('Could not download ' + $accessName + '. Setup already ran; do not recreate accounts blindly.') }
        }
        Write-Host ('PRIVATE MANAGER ENTRY: ' + (Join-Path $privateDir 'Karavay-Manager-Access.html'))
        if ($vmExit -eq 0 -and $report.demo -eq 'ready') {
            Write-Host ('DEMO CLIENT ENTRY: ' + (Join-Path $privateDir 'Karavay-Test-Login.html'))
            Write-Host 'WORKSPACE READY: manager and three KIS demo accounts verified.'
        } else { Write-Host 'Manager entry is ready, but demo setup did not finish. Read the VM error above.' }
        Start-Process (Join-Path $privateDir 'Karavay-Manager-Access.html')
    }
    if ($vmExit -ne 0) { throw ('VM step stopped with code ' + $vmExit + '. Review the last message before retrying.') }
    if ($Install -and -not $ConfigureWorkspace) { Write-Host 'Manager installed. Setup/demo was not requested. Refresh /manager/ with Ctrl+Shift+R.' }
    if (-not $Install -and -not $ConfigureWorkspace) { Write-Host 'PREFLIGHT PASSED. No service change was made.' }
}
