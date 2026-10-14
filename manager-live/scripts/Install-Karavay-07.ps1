param([switch]$SkipDemo)
$ErrorActionPreference = 'Stop'
$zip = Join-Path $env:USERPROFILE 'Downloads\Karavay-Manager-0.7.0-User-First-20261014.zip'
if (-not (Test-Path -LiteralPath $zip)) { throw ('Download the package first: ' + $zip) }
$key = Join-Path $env:USERPROFILE '.ssh\karavay_ed25519'
$keyArgs = @()
if (Test-Path -LiteralPath $key) { $keyArgs = @('-i', $key, '-o', 'IdentitiesOnly=yes') }
& scp @keyArgs $zip 'lindevadmin@192.168.25.98:/home/lindevadmin/'
if ($LASTEXITCODE -ne 0) { throw 'Copy failed; the VM was not changed.' }
$remote = 'python3 -m zipfile -e /home/lindevadmin/Karavay-Manager-0.7.0-User-First-20261014.zip /home/lindevadmin/karavay-manager-070 && sudo python3 /home/lindevadmin/karavay-manager-070/scripts/install.py --install'
if (-not $SkipDemo) { $remote += ' && python3 /home/lindevadmin/karavay-manager-070/scripts/Create-Demo-Users.py' }
& ssh @keyArgs -t 'lindevadmin@192.168.25.98' $remote
if ($LASTEXITCODE -ne 0) { throw 'One step failed. Read the last output before retrying; installation or one demo user may already be complete.' }
Write-Host 'Done. Refresh /manager/ with Ctrl+Shift+R.'
