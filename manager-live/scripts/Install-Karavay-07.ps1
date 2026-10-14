param([switch]$SkipDemo)
$ErrorActionPreference = 'Stop'
$zip = Join-Path $env:USERPROFILE 'Downloads\Karavay-Manager-0.7.1-Remember-Login-20261014.zip'
if (-not (Test-Path -LiteralPath $zip)) { throw ('Download the package first: ' + $zip) }
& scp $zip 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Copy failed; the VM was not changed.' }
$remote = 'python3 -m zipfile -e /home/lindevadmin/Karavay-Manager-0.7.1-Remember-Login-20261014.zip /home/lindevadmin/karavay-manager-071 && sudo python3 /home/lindevadmin/karavay-manager-071/scripts/install.py --install'
if (-not $SkipDemo) { $remote += ' && python3 /home/lindevadmin/karavay-manager-071/scripts/Create-Demo-Users.py' }
& ssh -t 'lindevadmin@192.168.25.98' $remote
if ($LASTEXITCODE -ne 0) { throw 'One step failed. Read the last output before retrying; installation or one demo user may already be complete.' }
Write-Host 'Done. Refresh /manager/ with Ctrl+Shift+R.'
