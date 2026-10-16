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
