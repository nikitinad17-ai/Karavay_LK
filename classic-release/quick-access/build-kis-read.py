"""Package the VM read-only script as a single Windows PowerShell file."""
import base64
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
source = (here / 'Read-KIS-VM.py').read_bytes()
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
template = r'''$ErrorActionPreference = 'Stop'
$taskDir = Join-Path $env:USERPROFILE 'Downloads\Karavay-KIS-VM-20261016'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
$pythonFile = Join-Path $taskDir 'Karavay-Read-KIS-VM-20261016.py'
[IO.File]::WriteAllBytes($pythonFile, [Convert]::FromBase64String('__PAYLOAD__'))
$vm = 'lindevadmin@192.168.25.98'
$vmScript = '/home/lindevadmin/Karavay-Read-KIS-VM-20261016.py'
$vmReport = '/home/lindevadmin/Karavay-KIS-VM-20261016'
Write-Host 'Reading KIS from the VM. No admin access to PocketBase is required.'
& scp $pythonFile "${vm}:$vmScript"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the script. Check SSH access to the VM.' }
& ssh $vm "python3 $vmScript --output $vmReport"
$vmStatus = $LASTEXITCODE
# Download the diagnostic report even if KIS was unavailable.
& scp "${vm}:${vmReport}.json" "${vm}:${vmReport}.txt" $taskDir
if ($LASTEXITCODE -ne 0) { throw 'Could not download the report. Read the SSH output above.' }
$textReport = Join-Path $taskDir 'Karavay-KIS-VM-20261016.txt'
Write-Host "Report saved: $taskDir"
Start-Process $textReport
if ($vmStatus -ne 0) {
    Write-Warning 'KIS read did not complete. Send the JSON report to this chat for diagnosis.'
} else {
    Write-Host 'KIS_VM_READ_OK. Send Karavay-KIS-VM-20261016.json to this chat.'
}
'''
target = output / 'Karavay-KIS-VM-Read-20261016.ps1'
target.write_text(template.replace('__PAYLOAD__', base64.b64encode(source).decode()), encoding='ascii', newline='\r\n')
print(target)
