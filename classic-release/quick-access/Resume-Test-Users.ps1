# Repair the already unpacked Manager-Fix setup without downloading another full package.
$ErrorActionPreference = 'Stop'
$vm = 'lindevadmin@192.168.25.98'
$source = Join-Path $env:USERPROFILE 'Downloads\Karavay-Quick-Access-KIS-2-3-Manager-Fix-20261016\Create-Quick-Users.py'
$target = '/home/lindevadmin/karavay-quick-access-20261016/quick-access/Create-Quick-Users.py'
if (-not (Test-Path -LiteralPath $source)) { throw 'The unpacked Manager-Fix Python file was not found in Downloads.' }
if (-not (Get-Content -LiteralPath $source -Raw -Encoding UTF8).Contains('--manager-karavay')) { throw 'The local Python file is outdated. Stop before uploading it.' }
$digest = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
& scp $source "${vm}:$target"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the updated Python file.' }
& ssh -t $vm "echo '$digest  $target' | sha256sum -c - && python3 $target --apply --payers 2 3 --client 2 --manager-karavay"
if ($LASTEXITCODE -ne 0) { throw 'Setup stopped. Read the server message above.' }
$html = Join-Path $env:USERPROFILE 'Downloads\Karavay-Test-Login.html'
& scp "${vm}:/home/lindevadmin/Karavay-Test-Login.html" $html
if ($LASTEXITCODE -ne 0) { throw 'Could not download the private login page.' }
Start-Process $html
