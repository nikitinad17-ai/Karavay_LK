"""One ASCII Windows launcher; only one SSH session, no upload/install/sudo."""
import base64
import pathlib
import sys

source = pathlib.Path(__file__).with_name('control-order.py').read_bytes()
output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
script = r'''# One controlled order in TEST KIS, then history verification through PocketBase.
param([switch]$NewAfterRejection)
$ErrorActionPreference = 'Stop'
$taskCode = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CODE__'))
$taskRemote = if ($NewAfterRejection) { 'python3 - --new-after-rejection' } else { 'python3 -' }
$taskEncoding = [Console]::OutputEncoding
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    Write-Host 'TEST KIS: one control order. Repeated runs verify the saved result; no automatic duplicate POST.'
    $taskCode | & ssh 'lindevadmin@192.168.25.98' $taskRemote
    if ($LASTEXITCODE -ne 0) { throw 'Control stopped. Send the KIS_MESSAGE and CONTROL_STOP lines above.' }
}
finally { [Console]::OutputEncoding = $taskEncoding }
'''.replace('__CODE__', base64.b64encode(source).decode())
target = output / 'Karavay-Control-Order-20261017.ps1'
target.write_text(script, encoding='ascii', newline='\r\n')
print(target)
