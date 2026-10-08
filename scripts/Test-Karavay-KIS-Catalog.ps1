param(
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$KisClientId,
    [Parameter(Mandatory=$true)][ValidateRange(1,4102444800)][long]$DateOrd,
    [ValidateSet(0,1)][int]$Group = 0,
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$SshHost = '192.168.25.98',
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$SshUser = 'Lindevadmin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# GET for one explicitly selected test client; no enumeration, credentials or raw body output.
$program = @'
import sys, socket, json
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.error import HTTPError, URLError
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
client, date, group = map(int, sys.argv[1:])
assert client > 0 and 0 < date <= 4102444800 and group in (0, 1)
try:
    socket.getaddrinfo('serv15db', 55580)
    print('DNS=OK')
    with socket.create_connection(('serv15db', 55580), timeout=3):
        print('TCP_55580=OK')
except OSError as e:
    print('NETWORK=FAIL TYPE=' + type(e).__name__)
    sys.exit(2)
url = f'http://serv15db:55580/api/v1/clients/{client}/matrix?DateOrd={date}&Group={group}'
opener = build_opener(NoRedirect(), ProxyHandler({}))
try:
    with opener.open(Request(url, headers={'Accept':'application/json'}, method='GET'), timeout=10) as res:
        body = res.read(2097153)
        print('HTTP=' + str(res.status))
        if len(body) > 2097152:
            print('BODY=TOO_LARGE'); sys.exit(2)
        payload = json.loads(body)
        print('JSON=VALID')
        # Values and raw errors stay on the VM; output only structural metadata and equality checks.
        if not isinstance(payload, dict):
            print('ENVELOPE=INVALID'); sys.exit(2)
        print('FIELDS=' + ','.join(sorted(payload)))
        print('CONTEXT_MATCH=' + str(payload.get('id_clt') == client and payload.get('DateOrd') == date and payload.get('Group') == group))
        products = payload.get('Product')
        print('PRODUCT_COUNT=' + str(len(products) if isinstance(products, list) else -1))
        if isinstance(products, list) and products and isinstance(products[0], dict):
            print('PRODUCT_FIELDS=' + ','.join(sorted(products[0])))
            print('PRODUCT_TYPES=' + ','.join(k+':'+type(v).__name__ for k,v in sorted(products[0].items())))
        if not isinstance(products, list) or payload.get('id_clt') != client or payload.get('DateOrd') != date or payload.get('Group') != group:
            sys.exit(2)
except HTTPError as e:
    print('HTTP=' + str(e.code) + ' NO_REDIRECT_NO_AUTH'); sys.exit(2)
except (URLError, OSError, ValueError) as e:
    print('REQUEST=FAIL TYPE=' + type(e).__name__); sys.exit(2)
'@
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $program | & ssh.exe -T -o ConnectTimeout=10 "$SshUser@$SshHost" "python3 - $KisClientId $DateOrd $Group"
    $result = $LASTEXITCODE
} finally { $OutputEncoding = $previousEncoding }
exit $result
