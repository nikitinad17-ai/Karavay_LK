# Read-only collection of installed gateway source files for manager integration.
# Does not copy pb_data, settings, credentials, or database records.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    throw 'OpenSSH scp was not found. Enable the Windows OpenSSH Client feature.'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$folder = Join-Path (Join-Path $env:USERPROFILE 'Downloads') ('Karavay-manager-source-' + $stamp)
New-Item -ItemType Directory -Path $folder -ErrorAction Stop | Out-Null
$sourceNames = @(
    'karavay-context.pb.js',
    'karavay-clients.pb.js',
    'karavay-catalog.pb.js',
    'karavay-orders.pb.js'
)
$sourcePaths = @($sourceNames | ForEach-Object { 'lindevadmin@192.168.25.98:/opt/pocketbase/pb_hooks/' + $_ })
Write-Host 'Copying the installed gateway source. Enter your SSH password only in the terminal if prompted.'
& scp @sourcePaths $folder
if ($LASTEXITCODE -ne 0) { throw 'Source copy failed. No server changes were made.' }
foreach ($name in $sourceNames) {
    $path = Join-Path $folder $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Missing source file: ' + $name) }
    if ((Get-Item -LiteralPath $path).Length -eq 0) { throw ('Empty source file: ' + $name) }
}
$archive = $folder + '.zip'
Compress-Archive -LiteralPath @($sourceNames | ForEach-Object { Join-Path $folder $_ }) -DestinationPath $archive -ErrorAction Stop
Write-Host ''
Write-Host 'Ready. Attach this ZIP in the manager cabinet chat:'
Write-Host $archive
