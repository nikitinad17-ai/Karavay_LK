# Run once in Windows PowerShell as administrator to enable ssh-agent.
# Private key stays on this PC. Only the public key is sent to the VM.
$ErrorActionPreference = 'Stop'
$server = 'lindevadmin@192.168.25.98'
$keyDir = Join-Path $env:USERPROFILE '.ssh'
$key = Join-Path $keyDir 'karavay_ed25519'
New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $key)) {
    Write-Host 'Create a passphrase for the new key. ssh-agent will remember the unlocked key.'
    & ssh-keygen -t ed25519 -f $key -C 'karavay-lk-windows'
    if ($LASTEXITCODE -ne 0) { throw 'Key creation failed.' }
}
if (-not (Test-Path -LiteralPath ($key + '.pub'))) { throw 'Public key is missing. Existing private key was not changed.' }
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
& ssh-add $key
if ($LASTEXITCODE -ne 0) { throw 'ssh-add failed.' }
$pub = (Get-Content -LiteralPath ($key + '.pub') -Raw).Trim()
if ($pub -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') { throw 'Unexpected public key format.' }
# Existing authorized_keys are preserved. The public key is read from stdin.
$pub | & ssh $server 'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; IFS= read -r key; key=$(printf "%s" "$key" | tr -d "\r"); grep -qxF "$key" ~/.ssh/authorized_keys || printf "%s\n" "$key" >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'
if ($LASTEXITCODE -ne 0) { throw 'Public key installation failed.' }
& ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $key $server 'printf "SSH_KEY_OK\n"'
if ($LASTEXITCODE -ne 0) { throw 'Key verification failed. Password login was not disabled.' }
Write-Host 'SSH_KEY_OK. Use the deployment script: it passes the key automatically. sudo may still request the VM password once.'
