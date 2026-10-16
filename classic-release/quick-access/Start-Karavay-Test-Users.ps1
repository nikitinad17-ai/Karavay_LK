param([switch]$PinKis23, [switch]$ManagerKaravay)
$ErrorActionPreference = 'Stop'
$taskDir = $PSScriptRoot
$remoteDir = '/home/lindevadmin/karavay-quick-access-20261016'
$remoteHome = 'lindevadmin@192.168.25.98'

Write-Host 'Setting up three test users using live KIS data...'
$uploadDir = Join-Path $taskDir '_vm-upload'
if (Test-Path -LiteralPath $uploadDir) { Remove-Item -LiteralPath $uploadDir -Recurse -Force }
$quickDir = Join-Path $uploadDir 'quick-access'
$scriptsDir = Join-Path $uploadDir 'scripts'
New-Item -ItemType Directory -Path $quickDir, $scriptsDir -Force | Out-Null
foreach ($name in @('Create-Quick-Users.py', 'launcher.js', 'launcher.css')) {
    Copy-Item -LiteralPath (Join-Path $taskDir $name) -Destination $quickDir
}
Copy-Item -LiteralPath (Join-Path $taskDir 'Seed-Demo-Users.py') -Destination $scriptsDir
$uploadZip = Join-Path $taskDir 'vm-code.zip'
Compress-Archive -Path (Join-Path $uploadDir '*') -DestinationPath $uploadZip -Force
$remoteZip = '/home/lindevadmin/karavay-quick-access-code-20261016.zip'
& scp $uploadZip "${remoteHome}:$remoteZip"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the setup archive.' }

$pinArguments = if ($PinKis23) { ' --payers 2 3 --client 2' } else { '' }
if ($ManagerKaravay) { $pinArguments += ' --manager-karavay' }
& ssh -t $remoteHome "mkdir -p $remoteDir && chmod 700 $remoteDir && python3 -m zipfile -e $remoteZip $remoteDir && python3 $remoteDir/quick-access/Create-Quick-Users.py --apply$pinArguments"
if ($LASTEXITCODE -ne 0) { throw 'Setup stopped. Read the message above. Repeating the same command resumes safely.' }

$localHtml = Join-Path $env:USERPROFILE 'Downloads\Karavay-Test-Login.html'
& scp "${remoteHome}:/home/lindevadmin/Karavay-Test-Login.html" $localHtml
if ($LASTEXITCODE -ne 0) { throw 'Could not download the private login page. It is still saved in your VM home directory.' }
Write-Host 'READY. Open Karavay-Test-Login.html and choose a test user. No test password entry is needed.'
Start-Process $localHtml
