# Vault TSD failed-fetch fix — auditor handoff

## Diagnosis
The error appears after the signed QR is received. Before submitting, Vault TSD checks that each TXC input remains unspent. The client used `/api/tx/{txid}/outspend/{vout}` on the configured TXC explorer.

Browser reproduction on 2026-10-27 showed that singular path returns HTTP 200 HTML (the explorer website) without Access-Control-Allow-Origin; the browser reports Failed to fetch. The transaction-wide `/api/tx/{txid}/outspends` returns accessible JSON. Transaction hex and fees also work. No change to CSP, upstream host, proxies or signing permissions is needed.

## Change
`src/lib/txc/mempool.ts:getOutspend` now requests `/outspends`, bypasses browser caching, selects the exact requested output index and requires a boolean `spent`. Invalid transaction IDs/indexes, missing outputs, malformed data, HTML, HTTP errors and connection failures throw; none is treated as unspent. No automatic retries or broadcasting are added.

The common client serves desktop, phone, APK and browser extension callers; installed packages require their normal rebuild/release. No wallet envelopes, profile storage, signing bytes, token recipient/change rules, session checks or TSD balance checks were changed.

## Verification
- 108 targeted tests passed: 14 endpoint tests, 40 TSD builder/signature tests, 34 PSBT tests, 20 Vault protocol tests.
- Live browser call through the changed client correctly read a known previously spent TXC output.
- Actual desktop send dialog: disposable encrypted Vault profile, controlled chain reads, real fixture SIGHASH_ALL signature transferred through a three-frame scanner-detector fixture, exact-input check, balance/session checks, and one intercepted simulated submission; success state visible and no page errors. No real transaction submitted. Camera detector was simulated, not physical QR pixels in this test.
- Preview reports build OK.

## Remaining acceptance
Independent auditor review, physical Vault signing and tiny funded transaction, website publication, APK and extension rebuild/release. The precise input from Bobby's screenshot was not available, so his exact transaction has not been replayed or submitted. New fix is in preview/source only.

## Review files
`src/lib/txc/mempool.ts`, `src/lib/txc/mempool.test.ts`, `src/lib/vault-link/AGENTS.md`, this note and `roadmap.md`.