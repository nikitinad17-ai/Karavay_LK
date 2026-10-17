# Проверка 3.8.1 — 2026-10-16

- `npm run check`: TypeScript strict, 31 unit/integration tests, production build — PASS.
- Classic Vite + single HTML build: CSP SHA hashes verified — PASS.
- Real isolated PocketBase 0.40.3: one transactional test-user migration, three
  passwordless auth responses, normal auth-refresh, exact point/all/multi scopes,
  no foreign-ID login, no foreign-Origin POST, disabled user/right/role/payer
  rejection, repeated install and restart without changing data — PASS.
- Real Chromium 155, hosted client: login without password, KIS catalog fixture,
  cart, explicit review, exactly one KIS POST fixture, verified order, history,
  order lines, F5, complete browser process restart, all three account scopes,
  logout, mobile login without horizontal overflow — PASS.
- Actual installer deployment and verification with real PB (systemctl/address
  substituted): PASS. Simulated post-install failure restores preceding HTML,
  users, rights and accepted order are retained — PASS.
- Existing classic checkout server suite: PASS (KIS fixture): idempotency,
  journal across restarts, concurrency, prices/minimums, timeout/rejection,
  role/rights isolation and details/history.
- Windows PowerShell wrapper: ASCII, ZIP payload/hash, unpack script and all
  manifest files checked locally; native Windows execution unavailable.
- Existing main 3.5 E2E suite was previously run in this session: 1 passed,
  6 failed, 1 skipped due old selector/mobile assertions; main 3.5 UI untouched.
  Relevant classic end-to-end test above is green.

Actual VM 192.168.25.98:8090 is not reachable from this environment. Installation
3.8.1 on VM and successful POST into the real TEST KIS remain unverified.
Earlier KIS response `Не задан aId_Clt` remains a known upstream contract failure;
no guessed write fields or automatic repeated submissions were introduced.
No claim that fixture success proves the live integration.

Main and the manager application/rights are unchanged. Branch:
`feature/client-classic-orders-3.8`.

## VM evidence — 2026-10-17

User screenshot confirms successful passwordless login and `/service/context`,
then `/service/orders?payer=<mapped payer>&client=2` returning HTTP success with
`count=0,total=0,orders=[],hasMore=false`. This confirms the empty KIS history
for that recipient at the time of the check; it does not prove other recipients
have no orders. Test recipient selection did not include a history check.
No successful real KIS POST has been confirmed.

`Find-History-20261017.ps1` searches existing history using the configured multi
test account and service routes, with point/time limits. It checks the four
previously confirmed recipients first, then paginates both buyers. Business
operations are GET only; its sole POST is test authentication. No tokens are
printed/saved, and errors are reported separately from empty results. It stops
at the first usable order history; the user can select that point under the
all-recipients or multi-buyer test login without changing rights or reinstalling.

Finder validation: executed in native PowerShell 7.4.6 against an isolated HTTP
fixture. Verified automatic test authentication, buyer order independence, known
recipient lookup, upstream errors distinct from empty results, existing history
detection, report creation, token exclusion, and GET-only business traffic. PASS.
Windows PowerShell 5.1 was not available; script uses its supported syntax.
No real VM history beyond the confirmed empty recipient 2 is inferred from this.

## 3.8.2 — 2026-10-17

- Selection fixture: omitted state in directory, real payer-card state check,
  banned/empty/foreign buyers excluded; history headers/lines/matrix required;
  saved scenarios revalidated; all-empty response blocks installation. PASS.
- `npm run check`: strict TypeScript, 31 tests including preferred recipient
  (non-first in list), persisted preference and session, production build: PASS.
- Real PB 0.40.3 + Chromium, upgrade from 3.8.1 in SAME DB to v382 accounts:
  pre-existing users/rights/payers/clients byte-for-byte JSON unchanged; existing
  history visible BEFORE creating an order; default point with history, catalog,
  cart/review/one POST, details/history, F5 and browser restart, all three scopes,
  logout/mobile, disabled guard, rerun, actual deployment checks and rollback. PASS.
- Legacy 3.8.1 config/session/browser scenario with new helper/client: PASS.
- KIS in these tests is a fixture. Real VM selection/install 3.8.2 and real KIS
  POST remain unverified. VM screenshot shows 40 checked recipients, no history;
  it does not prove no orders exist for other buyers/recipients.

## History-Fix — saved OpenAPI contract alignment

- Primary source: Karavay-Order-Contract-20261014.zip, captured on the user's VM.
  PayerOrdersResponse = {Id_pay,Orders}; client schema = {id_clt,Orders}; actual
  archived client response was a flat array. Explicit query Id_pay is documented.
- Selector now supports wrappers with owner validation and documented query.
  Tests reject foreign owner; three repeated HTTP failures stop scanning. PASS.
- Gateway supports flat and wrapper client orders, rejects foreign id_clt (403)
  and malformed Orders (502). Real PB/browser fixture tests cover both paths.
- Existing checkout suite + strict TypeScript/31 tests/production build: PASS.
- First 3.8.2 VM attempt: 100 read/contract errors, zero empty buyer histories;
  no deployed files/users changed. Exact first error not visible in screenshot.
- Corrected build still needs VM verification. No actual KIS POST verified.

## KIS-Read — 2026-10-17, actual VM validator evidence

- User screenshot (4): payer history with Id_pay/offset/limit query attributes
  fails HTTP 400 / -20001: attributes do not belong to order. Screenshot (6):
  bare `/payers/428125/orders` succeeds HTTP 200 with success=true, data=[].
  This confirms one empty buyer history, not an empty entire KIS.
- Removed all query attributes from payer history selection. Fixtures reject
  them and cover flat empty/nonempty and owner-checked wrapped lists. PASS.
- Actual Api reader processes captured empty response and preserves upstream
  error.message on HTTP failure without Oracle stack/details or PB token. PASS.
- `npm run check`: strict TS, 31 tests, production build. PASS.
- PB 0.40.3 + Chromium upgrade/browser/deployment/rollback suite: passwordless
  entry, existing history, catalog/cart/review/fixture POST/history/details,
  refresh/restart, three scopes, logout/mobile, old users/rights retained. PASS.
- KIS transport in automated tests remains an isolated fixture. New VM buyer
  selection/installation and actual KIS POST have not yet been confirmed.

## Full-directory search — 2026-10-17

- VM screenshot (7): 100 empty payer histories, zero read errors. The former
  100-buyer cap was reached; this was not the entire directory.
- Screenshot (8): archived control payer/client histories are empty today and
  order 48393204 now returns HTTP 400, KIS message «Не найден order». No database
  reset or absence of all orders is inferred from this.
- Selection now covers the returned directory (up to 10,000 rows, 900 seconds).
  Regression fixture places two usable older buyers after 120 empty buyers.
  Existing fail-closed checks, exclusions, saved-scope checks stay in place. PASS.
- `npm run check`: strict TS, 31 tests, production build. PASS. Rebuilt PS1 ZIP
  has verified checksums/Python compilation and the full-directory limit.

## Whole-tray regression — 2026-10-17

- Confirmed original rule in utils/orderRules: null KolshtOrdmin means lotOnly;
  KolUkl is pieces per tray. Classic migration omitted this rule in UI/backend.
- Restored absent piece input, whole-tray validation, and refusal to guess
  missing packing. Nonempty minimum retains mixed trays/pieces. No rounding of
  historical quantities. `npm run check`: strict TS, 34 tests/build. PASS.
- Real PB checkout: 15 pieces with packing 8 rejected before KIS POST/journal;
  invalid/missing packing rejected; 24 pieces accepted as exact KolSht=24. PASS.
- Real Chromium desktop/mobile checks lot-only and piece-allowed inputs, then
  existing full checkout/session/scope/browser-restart flow. PASS with fixture KIS.
- Actual core installer main/apply also exercised on isolated PB: auth gates,
  served HTML, journal privacy, current test config and existing records retained.
  `-ClientOnly` dispatches to this installer, bypassing new-user/history selection.
- Browser/deployment suite passes with BOTH existing 3.8.1 and new history-based
  3.8.2 configurations. Native PowerShell executes/decompresses/checks the actual
  wrapper in both modes with SSH/SCP/browser mocked; correct dispatch verified.
- No VM deployment or actual KIS POST is claimed by these fixture tests.
