param([ValidateRange(4,200)][int]$MaxClients = 40)
# Read-only business requests; authentication uses only the configured test account.
$ErrorActionPreference = 'Stop'
$pb = 'http://192.168.25.98:8090'
$headers = @{}
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$checks = New-Object 'System.Collections.Generic.List[object]'
$found = $null
$clock = [Diagnostics.Stopwatch]::StartNew()

function Read-Service([string]$Path) {
    if ($Path -notmatch '^/service/(context|clients\?payer=[a-z0-9]{15}(&cursor=[1-9][0-9]*)?&perPage=(1|10)|orders\?payer=[a-z0-9]{15}&client=[1-9][0-9]*)$') {
        throw 'Unexpected read route.'
    }
    Invoke-RestMethod -Uri ($pb + $Path) -Headers $headers -TimeoutSec 70 -MaximumRedirection 0
}

function Error-Code($Record) {
    try {
        $parsed = $Record.ErrorDetails.Message | ConvertFrom-Json
        if ($parsed.code -match '^[A-Z0-9_]{1,80}$') { return $parsed.code }
    } catch {}
    if ($Record.Exception.Response) { return ('HTTP_' + [int]$Record.Exception.Response.StatusCode) }
    return 'NETWORK_OR_TIMEOUT'
}

function Check-Point($Payer, $Point) {
    $tag = $Payer.id + ':' + $Point.id
    if ($seen.Contains($tag)) { return $false }
    if ($seen.Count -ge $MaxClients -or $clock.Elapsed.TotalSeconds -ge 300) { return $false }
    [void]$seen.Add($tag)
    Write-Host ('CHECK ' + $seen.Count + '/' + $MaxClients + ': ' + $Payer.name + ' | ' + $Point.code + ' | client ' + $Point.id)
    try {
        $data = Read-Service ('/service/orders?payer=' + $Payer.id + '&client=' + $Point.id)
        if ($data.payer -ne $Payer.id -or $data.client -ne $Point.id -or $null -eq $data.count -or $data.count -ne @($data.orders).Count) {
            throw 'Invalid order response.'
        }
        $row = [ordered]@{payer_id=$Payer.id; payer_name=$Payer.name; client_id=$Point.id; client_code=$Point.code; client_name=$Point.name; state='ok'; count=$data.count; total=$data.total; hasMore=$data.hasMore}
        [void]$checks.Add($row)
        if ($data.count -gt 0) {
            $script:found = [ordered]@{payer_id=$Payer.id; payer_name=$Payer.name; client_id=$Point.id; client_code=$Point.code; client_name=$Point.name; count=$data.count; total=$data.total; orders=@($data.orders | Select-Object -First 3 id,order_number,order_date,state)}
            return $true
        }
    } catch {
        $code = Error-Code $_
        [void]$checks.Add([ordered]@{payer_id=$Payer.id; payer_name=$Payer.name; client_id=$Point.id; client_name=$Point.name; state='error'; code=$code})
        Write-Host ('  READ_ERROR: ' + $code)
    }
    return $false
}

try {
    Write-Host 'Finding existing KIS history. No installation, order creation, or password entry.'
    $auth = Invoke-RestMethod -Uri "$pb/service/test-access" -Method Post -ContentType 'application/json' -Body '{"id":"test381multi001"}' -TimeoutSec 30 -MaximumRedirection 0
    if (-not $auth.token -or $auth.record.id -ne 'test381multi001') { throw 'Test account is unavailable.' }
    $headers = @{Authorization=$auth.token}
    $ctx = Read-Service '/service/context'
    if (@($ctx.payers).Count -ne 2) { throw 'Expected the two configured test buyers.' }
    foreach ($payer in $ctx.payers) {
        if ($payer.id -notmatch '^[a-z0-9]{15}$') { throw 'Invalid buyer ID.' }
    }

    # Try the four recipients previously confirmed by the KIS directory first.
    :known foreach ($cid in @(234243,384786,385317,2)) {
        foreach ($payer in $ctx.payers) {
            if ($clock.Elapsed.TotalSeconds -ge 300) { break known }
            try {
                $page = Read-Service ('/service/clients?payer=' + $payer.id + '&cursor=' + ($cid - 1) + '&perPage=1')
                if ($page.payer -ne $payer.id) { throw 'Invalid recipient response.' }
                foreach ($point in $page.clients) {
                    if ($point.id -eq $cid -and (Check-Point $payer $point)) { break known }
                }
            } catch { Write-Host ('RECIPIENT_READ_ERROR: ' + (Error-Code $_)) }
        }
    }

    # Bounded, fair search across both buyers. A partial scan is never called empty KIS.
    $states = @($ctx.payers | ForEach-Object { @{payer=$_; cursor=0; done=$false} })
    while (-not $found -and $seen.Count -lt $MaxClients -and $clock.Elapsed.TotalSeconds -lt 300) {
        $remaining = @($states | Where-Object { -not $_.done })
        if ($remaining.Count -eq 0) { break }
        foreach ($state in $remaining) {
            if ($found -or $seen.Count -ge $MaxClients -or $clock.Elapsed.TotalSeconds -ge 300) { break }
            $payer = $state.payer
            $path = '/service/clients?payer=' + $payer.id
            if ($state.cursor -gt 0) { $path += '&cursor=' + $state.cursor }
            try {
                $page = Read-Service ($path + '&perPage=10')
                if ($page.payer -ne $payer.id) { throw 'Invalid recipient response.' }
                foreach ($point in $page.clients) {
                    if ($point.id -lt 1) { throw 'Invalid recipient ID.' }
                    if (Check-Point $payer $point) { break }
                }
                if (-not $page.hasMore) { $state.done = $true }
                elseif ($page.nextCursor -gt $state.cursor) { $state.cursor = $page.nextCursor }
                else { throw 'Invalid recipient cursor.' }
            } catch {
                $state.done = $true
                Write-Host ('RECIPIENT_READ_ERROR: ' + (Error-Code $_))
                [void]$checks.Add([ordered]@{payer_id=$payer.id; payer_name=$payer.name; state='recipient_error'; code=(Error-Code $_)})
            }
        }
    }
    $report = [ordered]@{checked_at=(Get-Date).ToUniversalTime().ToString('o'); business_mode='read-only'; points_checked=$seen.Count; max_points=$MaxClients; found=$found; checks=@($checks.ToArray())}
    $reportPath = Join-Path $env:USERPROFILE 'Downloads\Karavay-History-Check-20261017.json'
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    if ($found) {
        Write-Host 'HISTORY_FOUND'
        Write-Host ('BUYER: ' + $found.payer_name)
        Write-Host ('RECIPIENT: ' + $found.client_code + ' | ' + $found.client_name + ' | KIS ID ' + $found.client_id)
        Write-Host ('ORDERS_ON_FIRST_PAGE: ' + $found.count)
    } else {
        Write-Host 'NO_HISTORY_FOUND_IN_CHECKED_POINTS. This is a partial search; read errors are listed separately.'
    }
    Write-Host ('REPORT: ' + $reportPath)
} finally {
    $headers.Clear()
    $auth = $null
}
