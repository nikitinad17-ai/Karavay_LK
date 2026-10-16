param([switch]$PinKis23, [switch]$ManagerKaravay)
$ErrorActionPreference = 'Stop'
$taskDir = $PSScriptRoot
$remoteDir = '/home/lindevadmin/karavay-quick-access-20261016'
$remoteHome = 'lindevadmin@192.168.25.98'

Write-Host 'Setting up three test users using live KIS data...'
$sourceFile = Join-Path $taskDir 'Create-Quick-Users.py'
$sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
& ssh $remoteHome "mkdir -p $remoteDir/quick-access $remoteDir/scripts && chmod 700 $remoteDir"
if ($LASTEXITCODE -ne 0) { throw 'SSH connection failed.' }
& scp $sourceFile (Join-Path $taskDir 'launcher.js') (Join-Path $taskDir 'launcher.css') "${remoteHome}:$remoteDir/quick-access/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the setup files.' }
& scp (Join-Path $taskDir 'Seed-Demo-Users.py') "${remoteHome}:$remoteDir/scripts/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the KIS helper.' }

$pinArguments = if ($PinKis23) { ' --payers 2 3 --client 2' } else { '' }
if ($ManagerKaravay) { $pinArguments += ' --manager-karavay' }
& ssh -t $remoteHome "echo '$sourceHash  $remoteDir/quick-access/Create-Quick-Users.py' | sha256sum -c - && python3 $remoteDir/quick-access/Create-Quick-Users.py --apply$pinArguments"
if ($LASTEXITCODE -ne 0) { throw 'Setup stopped. Read the message above. Repeating the same command resumes safely.' }

$localHtml = Join-Path $env:USERPROFILE 'Downloads\Karavay-Test-Login.html'
& scp "${remoteHome}:/home/lindevadmin/Karavay-Test-Login.html" $localHtml
if ($LASTEXITCODE -ne 0) { throw 'Could not download the private login page. It is still saved in your VM home directory.' }
Write-Host 'READY. Open Karavay-Test-Login.html and choose a test user. No test password entry is needed.'
Start-Process $localHtml
