param(
    [string]$SshHost = "192.168.25.98",
    [string]$SshUser = "Lindevadmin",
    [int]$SshPort = 22,
    [string]$KisBaseUrl = "http://serv15db:55580",
    [ValidateRange(1, 100)]
    [int]$MaxPayers = 15,
    [ValidateRange(1, 30)]
    [int]$MaxClients = 6,
    [ValidateRange(1, 31)]
    [int]$DaysToTry = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
    throw "ssh.exe not found. Install the Windows OpenSSH Client first."
}

if ($SshHost -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Invalid SshHost value."
}

if ($SshUser -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Invalid SshUser value."
}

if ($KisBaseUrl -notmatch '^https?://[A-Za-z0-9._:-]+/?$') {
    throw "Invalid KisBaseUrl value."
}

$reportPath = Join-Path $PSScriptRoot ("Karavay-KIS-API-Check-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

# The remote program is intentionally read-only: it only performs HTTP GET requests.
$pythonProgram = @'
from __future__ import annotations

import json
import re
import sys
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, time as datetime_time, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None


BASE_URL = sys.argv[1].rstrip("/")
MAX_PAYERS = int(sys.argv[2])
MAX_CLIENTS = int(sys.argv[3])
DAYS_TO_TRY = int(sys.argv[4])
TIMEOUT_SECONDS = 30

if not re.fullmatch(r"https?://[A-Za-z0-9._:-]+", BASE_URL):
    print("[FAIL] CONFIG invalid_base_url")
    raise SystemExit(2)


@dataclass
class ApiResult:
    status: int | None
    payload: Any
    body_length: int
    content_type: str
    repaired_numbers: int
    parse_error: str | None
    transport_error: str | None


request_count = 0
total_repaired_numbers = 0
failures: list[str] = []
warnings: list[str] = []


def emit(level: str, code: str, detail: str = "") -> None:
    suffix = f" {detail}" if detail else ""
    print(f"[{level}] {code}{suffix}")
    if level == "FAIL":
        failures.append(code)
    elif level == "WARN":
        warnings.append(code)


def normalize_json(text: str) -> tuple[str, int]:
    # KIS currently emits invalid JSON decimals such as .00 and -.50.
    return re.subn(
        r"([:\[,]\s*)(-?)\.(\d+)",
        r"\g<1>\g<2>0.\g<3>",
        text,
    )


def fetch(path: str, *, expect_json: bool = True) -> ApiResult:
    global request_count, total_repaired_numbers
    request_count += 1
    url = BASE_URL + path
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Karavay-KIS-ReadOnly-Diagnostic/1.0",
            "X-Request-ID": "karavay-check-" + uuid.uuid4().hex,
        },
        method="GET",
    )

    status: int | None = None
    body = b""
    content_type = ""
    transport_error: str | None = None

    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as exc:
        status = int(exc.code)
        body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
    except URLError as exc:
        reason = getattr(exc, "reason", exc)
        transport_error = type(reason).__name__
    except TimeoutError:
        transport_error = "TimeoutError"
    except Exception as exc:
        transport_error = type(exc).__name__

    if transport_error:
        return ApiResult(status, None, 0, content_type, 0, None, transport_error)

    if not body or not expect_json:
        return ApiResult(status, None, len(body), content_type, 0, None, None)

    text = body.decode("utf-8", "replace")
    normalized, repaired = normalize_json(text)
    total_repaired_numbers += repaired
    try:
        payload = json.loads(normalized)
        parse_error = None
    except json.JSONDecodeError as exc:
        payload = None
        char_code = ord(normalized[exc.pos]) if exc.pos < len(normalized) else -1
        parse_error = f"JSON_AT_{exc.pos}_CHAR_{char_code}"

    return ApiResult(
        status,
        payload,
        len(body),
        content_type.split(";", 1)[0].strip(),
        repaired,
        parse_error,
        None,
    )


def normalized_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def get_case_insensitive(mapping: dict[str, Any], names: tuple[str, ...]) -> Any:
    wanted = {normalized_key(name) for name in names}
    for key, value in mapping.items():
        if normalized_key(key) in wanted:
            return value
    return None


def extract_items(payload: Any, hints: tuple[str, ...]) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []

    direct = get_case_insensitive(payload, hints)
    if isinstance(direct, list):
        return direct

    data = get_case_insensitive(payload, ("data", "result"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        nested = get_case_insensitive(data, hints)
        if isinstance(nested, list):
            return nested

    return []


def extract_record(payload: Any, hints: tuple[str, ...]) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        data = get_case_insensitive(payload, ("data", "result"))
        if isinstance(data, dict):
            nested = get_case_insensitive(data, hints)
            if isinstance(nested, dict):
                return nested
            return data
        direct = get_case_insensitive(payload, hints)
        if isinstance(direct, dict):
            return direct
        return payload
    return None


def record_id(record: Any, entity: str) -> int | str | None:
    if not isinstance(record, dict):
        return None
    candidates = {
        "payer": ("id", "id_pay", "idPay", "Id_pay"),
        "client": ("id", "id_clt", "idClt", "Id_clt"),
        "order": ("id", "id_ord", "idOrd", "Id_ord"),
    }[entity]
    value = get_case_insensitive(record, candidates)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, str)) and str(value).strip():
        return value
    return None


def type_name(value: Any) -> str:
    if value is None:
        return "null"
    return type(value).__name__


def print_shape(label: str, items: list[Any]) -> None:
    print(f"{label}_COUNT={len(items)}")
    first = next((item for item in items if isinstance(item, dict)), None)
    if first is None:
        print(f"{label}_FIELDS=NO_ITEMS")
        print(f"{label}_TYPES=-")
        return
    fields = sorted(str(key) for key in first.keys())
    types = ";".join(f"{key}={type_name(first[key])}" for key in fields)
    print(f"{label}_FIELDS={','.join(fields)}")
    print(f"{label}_TYPES={types}")


def print_record_shape(label: str, record: dict[str, Any] | None) -> None:
    if not record:
        print(f"{label}_FIELDS=NO_RECORD")
        print(f"{label}_TYPES=-")
        return
    fields = sorted(str(key) for key in record.keys())
    types = ";".join(f"{key}={type_name(record[key])}" for key in fields)
    print(f"{label}_FIELDS={','.join(fields)}")
    print(f"{label}_TYPES={types}")


def classify_problem(result: ApiResult) -> str:
    if result.transport_error:
        return "TRANSPORT_" + result.transport_error.upper()
    if result.parse_error:
        return result.parse_error
    if result.status == 204:
        return "NO_CONTENT"

    try:
        source = json.dumps(result.payload, ensure_ascii=False).lower()
    except Exception:
        source = ""

    if "не найден маршрут" in source or "route not found" in source:
        return "ROUTE_NOT_FOUND"
    if "dateord" in source:
        return "DATEORD_REJECTED"
    if "group" in source:
        return "GROUP_REJECTED"
    if "день недели" in source or "принимает поставку" in source:
        return "DELIVERY_DAY_REJECTED"
    if "forbidden" in source or "нет доступа" in source:
        return "FORBIDDEN"
    if "unauthorized" in source or "авторизац" in source:
        return "UNAUTHORIZED"
    if "не найден" in source or "not found" in source:
        return "NOT_FOUND"
    return "HTTP_" + str(result.status if result.status is not None else "NONE")


def result_ok(result: ApiResult, statuses: tuple[int, ...] = (200,)) -> bool:
    return (
        result.status in statuses
        and result.transport_error is None
        and result.parse_error is None
    )


def report_http(label: str, result: ApiResult, statuses: tuple[int, ...] = (200,)) -> bool:
    details = (
        f"status={result.status} bytes={result.body_length} "
        f"type={result.content_type or '-'} repaired={result.repaired_numbers}"
    )
    if result_ok(result, statuses):
        emit("OK", label, details)
        if result.repaired_numbers:
            emit("WARN", label + "_INVALID_DECIMALS_FIXED", f"count={result.repaired_numbers}")
        return True
    emit("FAIL", label, details + " problem=" + classify_problem(result))
    return False


def status_summary(counter: Counter[int | None]) -> str:
    return ",".join(
        f"{('NONE' if key is None else key)}={counter[key]}"
        for key in sorted(counter, key=lambda value: -1 if value is None else value)
    ) or "none"


def moscow_timezone():
    if ZoneInfo is not None:
        try:
            return ZoneInfo("Europe/Moscow")
        except Exception:
            pass
    return timezone(timedelta(hours=3))


print("KARAVAY_KIS_API_READ_ONLY_CHECK=1")
print("SCRIPT_VERSION=1.0.0")
print("MODE=GET_ONLY")
print("OUTPUT_VALUES=REDACTED")
print("BASE_URL=" + BASE_URL)
print("PYTHON=" + sys.version.split()[0])
print()


info_result = fetch("/Info", expect_json=False)
report_http("INFO", info_result)


payers_result = fetch("/api/v1/payers")
if not report_http("PAYERS", payers_result):
    print()
    print(f"SUMMARY requests={request_count} warnings={len(warnings)} failures={len(failures)} repaired={total_repaired_numbers}")
    raise SystemExit(2)

payers = extract_items(payers_result.payload, ("payers", "items"))
print_shape("PAYERS", payers)
if not payers:
    emit("FAIL", "PAYERS_EMPTY")
    print()
    print(f"SUMMARY requests={request_count} warnings={len(warnings)} failures={len(failures)} repaired={total_repaired_numbers}")
    raise SystemExit(2)


client_candidates: list[tuple[int | str, dict[str, Any]]] = []
client_scan_statuses: Counter[int | None] = Counter()
scanned_payers = 0
selected_payer_id: int | str | None = None
selected_payer_clients: list[Any] = []

for payer in payers[:MAX_PAYERS]:
    payer_id = record_id(payer, "payer")
    if payer_id is None:
        continue
    scanned_payers += 1
    clients_result = fetch(f"/api/v1/payers/{quote(str(payer_id), safe='')}/clients")
    client_scan_statuses[clients_result.status] += 1
    if not result_ok(clients_result):
        continue
    clients = extract_items(clients_result.payload, ("clients", "items"))
    if clients and selected_payer_id is None:
        selected_payer_id = payer_id
        selected_payer_clients = clients
    for client in clients:
        if isinstance(client, dict) and record_id(client, "client") is not None:
            client_candidates.append((payer_id, client))
            if len(client_candidates) >= MAX_CLIENTS:
                break
    if len(client_candidates) >= MAX_CLIENTS:
        break

print(f"PAYER_CLIENT_SCAN_SCANNED_PAYERS={scanned_payers}")
print(f"PAYER_CLIENT_SCAN_STATUSES={status_summary(client_scan_statuses)}")
print(f"CLIENT_CANDIDATES={len(client_candidates)}")

if not client_candidates or selected_payer_id is None:
    emit("FAIL", "PAYER_CLIENT_LINK_NOT_FOUND")
    print()
    print(f"SUMMARY requests={request_count} warnings={len(warnings)} failures={len(failures)} repaired={total_repaired_numbers}")
    raise SystemExit(2)

emit("OK", "PAYER_CLIENT_LINK", f"selected_payer_clients={len(selected_payer_clients)}")
print_shape("CLIENTS", selected_payer_clients)


payer_detail_result = fetch(f"/api/v1/payers/{quote(str(selected_payer_id), safe='')}")
if report_http("PAYER_DETAIL", payer_detail_result, (200, 204)) and payer_detail_result.status == 200:
    print_record_shape("PAYER_DETAIL", extract_record(payer_detail_result.payload, ("payer",)))

first_client_id = record_id(client_candidates[0][1], "client")
client_detail_result = fetch(f"/api/v1/clients/{quote(str(first_client_id), safe='')}")
if report_http("CLIENT_DETAIL", client_detail_result, (200, 204)) and client_detail_result.status == 200:
    print_record_shape("CLIENT_DETAIL", extract_record(client_detail_result.payload, ("client",)))


tz = moscow_timezone()
today = datetime.now(tz).date()
matrix_statuses: Counter[int | None] = Counter()
matrix_problems: Counter[str] = Counter()
matrix_attempts = 0
matrix_success: tuple[int | str, int | str, str, dict[int, tuple[ApiResult, list[Any]]]] | None = None
matrix_fallback: tuple[int | str, int | str, str, dict[int, tuple[ApiResult, list[Any]]]] | None = None

for payer_id, client in client_candidates:
    client_id = record_id(client, "client")
    if client_id is None:
        continue
    for day_offset in range(1, DAYS_TO_TRY + 1):
        order_date = today + timedelta(days=day_offset)
        order_datetime = datetime.combine(order_date, datetime_time.min, tzinfo=tz)
        timestamp = int(order_datetime.timestamp())
        group_results: dict[int, tuple[ApiResult, list[Any]]] = {}
        any_http_success = False
        any_products = False

        for group in (1, 0):
            query = urlencode({"DateOrd": timestamp, "Group": group})
            result = fetch(
                f"/api/v1/clients/{quote(str(client_id), safe='')}/matrix?{query}"
            )
            matrix_attempts += 1
            matrix_statuses[result.status] += 1
            if result_ok(result):
                products = extract_items(result.payload, ("product", "products", "items"))
                group_results[group] = (result, products)
                any_http_success = True
                any_products = any_products or bool(products)
            else:
                matrix_problems[classify_problem(result)] += 1
                group_results[group] = (result, [])

        if any_http_success and matrix_fallback is None:
            matrix_fallback = (payer_id, client_id, order_date.isoformat(), group_results)
        if any_http_success and any_products:
            matrix_success = (payer_id, client_id, order_date.isoformat(), group_results)
            break
    if matrix_success is not None:
        break

if matrix_success is None:
    matrix_success = matrix_fallback

print(f"MATRIX_ATTEMPTS={matrix_attempts}")
print(f"MATRIX_STATUSES={status_summary(matrix_statuses)}")
print(
    "MATRIX_PROBLEMS="
    + (",".join(f"{key}={matrix_problems[key]}" for key in sorted(matrix_problems)) or "none")
)

selected_client_id: int | str = first_client_id
selected_orders_payer_id: int | str = selected_payer_id

if matrix_success is None:
    emit("FAIL", "MATRIX_NO_WORKING_CLIENT_DATE")
else:
    selected_orders_payer_id, selected_client_id, selected_date, group_results = matrix_success
    emit("OK", "MATRIX", f"date={selected_date}")
    matrix_has_products = False
    for group in (1, 0):
        result, products = group_results[group]
        label = f"MATRIX_GROUP_{group}"
        if result_ok(result):
            report_http(label, result)
            print_shape(label, products)
            matrix_has_products = matrix_has_products or bool(products)
        else:
            emit(
                "WARN",
                label,
                f"status={result.status} problem={classify_problem(result)}",
            )
    if not matrix_has_products:
        emit("WARN", "MATRIX_WORKS_BUT_EMPTY")


def check_orders(label: str, path: str) -> tuple[ApiResult, list[Any]]:
    result = fetch(path)
    if result.status == 204 and result.transport_error is None:
        emit("OK", label, "status=204 orders=0")
        print_shape(label, [])
        return result, []
    if not report_http(label, result):
        return result, []
    orders = extract_items(result.payload, ("orders", "items"))
    print_shape(label, orders)
    return result, orders


payer_orders_result, payer_orders = check_orders(
    "PAYER_ORDERS",
    f"/api/v1/payers/{quote(str(selected_orders_payer_id), safe='')}/orders?offset=0&limit=5",
)
client_orders_result, client_orders = check_orders(
    "CLIENT_ORDERS",
    f"/api/v1/clients/{quote(str(selected_client_id), safe='')}/orders",
)
last_order_result, last_orders = check_orders(
    "CLIENT_LAST_ORDER",
    f"/api/v1/clients/{quote(str(selected_client_id), safe='')}/orders?last=1",
)

order_for_detail = next(
    (order for order in payer_orders + client_orders + last_orders if record_id(order, "order") is not None),
    None,
)
if order_for_detail is None:
    emit("WARN", "ORDER_DETAIL_SKIPPED", "reason=no_order_id")
else:
    order_id = record_id(order_for_detail, "order")
    order_detail_result = fetch(f"/api/v1/orders/{quote(str(order_id), safe='')}")
    if report_http("ORDER_DETAIL", order_detail_result, (200, 204)) and order_detail_result.status == 200:
        print_record_shape(
            "ORDER_DETAIL",
            extract_record(order_detail_result.payload, ("order",)),
        )


print()
print("READ_ONLY_CONFIRMED=GET_REQUESTS_ONLY")
print(f"SUMMARY requests={request_count} warnings={len(warnings)} failures={len(failures)} repaired={total_repaired_numbers}")
print("WARNING_CODES=" + (",".join(sorted(set(warnings))) or "none"))
print("FAILURE_CODES=" + (",".join(sorted(set(failures))) or "none"))

if failures:
    raise SystemExit(2)
raise SystemExit(0)
'@

$remoteCommand = "python3 - '$KisBaseUrl' $MaxPayers $MaxClients $DaysToTry"
$oldOutputEncoding = $OutputEncoding
$sshExitCode = 1

try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Write-Host "KARAVAY KIS API: full read-only check" -ForegroundColor Cyan
    Write-Host "VM: $SshUser@$SshHost`:$SshPort" -ForegroundColor Cyan
    Write-Host "You may be prompted for the VM password once." -ForegroundColor Yellow
    Write-Host "No POST, PUT or DELETE requests will be sent." -ForegroundColor Green
    Write-Host ""

    $pythonProgram |
        & ssh.exe -T -o ConnectTimeout=15 -p $SshPort "$SshUser@$SshHost" $remoteCommand 2>&1 |
        Tee-Object -FilePath $reportPath

    $sshExitCode = $LASTEXITCODE
}
finally {
    $OutputEncoding = $oldOutputEncoding
}

Write-Host ""
Write-Host "Report saved:" -ForegroundColor Cyan
Write-Host $reportPath -ForegroundColor Cyan

if ($sshExitCode -eq 0) {
    Write-Host "CHECK_FINISHED_OK" -ForegroundColor Green
}
else {
    Write-Host "CHECK_FINISHED_WITH_ERRORS (exit $sshExitCode)" -ForegroundColor Red
}

exit $sshExitCode

