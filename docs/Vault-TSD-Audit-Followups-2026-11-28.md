# Vault TSD audit follow-ups — 28 November 2026

## Review target

Public repository: https://github.com/blockchainmint1/hme-wallet

Review the commit identified in Bobby's accompanying handoff, against parent `402c7ee`. No source pack is needed. These changes are **unpublished**; phone and extension packages have not been rebuilt.

## Rule and approved scope

A missing or unsuccessful sending reply must never be presented as proof that a payment did not happen, or allow an unresolved Send to many run to be repeated after reload. TXC fees must follow the shared network-minimum rule. Consolidate all must queue ready holders and explicitly list those it skips. The Vault bulk page must name its minimum compatible signer version.

Bobby approved all four recommendations. He also requested inspection of sibling paths, with settled records, permissions, settings and example data left untouched.

## Implementation

- `broadcast-submit.ts`: browser/server-safe transport, exactly one POST, locally computed transaction ID, fresh uncached `/tx/<id>/hex` reconciliation after any refusal, wrong response ID or exception. A positive lookup requires genuine transaction bytes with the exact local ID. A 404, HTML, unavailable lookup or different ID leaves a typed uncertain result containing the local ID. No POST retry or alternate broadcast provider.
- `broadcast-journal.ts` / TXC `mempool.ts`: public transaction ID and consumed outpoints persist before browser submission, with `safeSetItem`. A storage error prevents submission. Identical or overlapping unresolved attempts are reconciled before any new POST; unresolved attempts remain reserved across reloads without an automatic expiry. An exact same transaction already found returns its ID without another POST; a different transaction spending an already-found attempt's inputs is refused. No private keys or signed hex stored by the journal.
- Shared bulk progress: records local ID/outpoints synchronously before submission; reload converts interrupted attempts to `uncertain`, not `failed`. Existing ambiguous legacy failure messages are treated conservatively. `bulkRunSettled` refuses pending/uncertain runs. A read-only recovery query resolves only exact positive lookups; Omni validity is still required for "Tokens delivered". Unknown-ID legacy interrupted runs remain blocked, rather than inventing a safe retry. Already sent/delivered/rejected steps are not rewritten by recovery.
- Regular and Vault bulk UIs both use these rules. Vault scans still verify frozen PSBT equivalence, genuine signatures, recipients, active profile/pairing/session and fresh outspends. An uncertain batch stops further preparation and keeps new runs, consolidation and result clearing disabled. Recovery never automatically continues a partially completed list.
- TXC fee helper is used for Vault bulk display and preparation, Vault gather, native/TSD single Vault sends, WIF TXC sends and Seeds TXC sweeps. Existing helper semantics remain: integer ceiling, network minimum at least 1 sat/vB, fallback 10 only without a usable estimate. Vault builders still refuse rates at or above 5,000 sat/vB. TXC legacy single-Vault input estimate now uses shared 149 vB.
- Consolidate all partitions holders by `confirmedSats > 0`, queues ready indexes only, and lists skipped address indexes as unmoved. Fresh preparation still checks holder coins, #0 fee availability, balance, previous outputs and session; losing readiness mid-queue stops safely. One signature per holder, no pending-change chaining.
- Bulk page states "Requires HME Vault 1.0.5 or newer." Pairing has no signer-version field, so this is a compatibility note, not an invented attestation.

## Sibling paths inspected

Only call the following code-checked, not live-device tested, unless separately stated below.

| Member-facing place | Code inspected | Result |
|---|---|---|
| Desktop regular TXC/Omni Send to many | `components/desktop/BulkSend.tsx`, `lib/txc/bulk-send.ts` | Same unsafe failed/reload handling; fixed with pre-submit records, uncertainty, reservations and positive-only recovery. |
| Desktop Vault TSD Send to many | `components/desktop/VaultBulkSend.tsx`, Vault builders/tests | Fixed; actual unlocked synthetic signing/recovery flow exercised. |
| Vault individual gather / Consolidate all | `components/desktop/VaultTsdGather.tsx`, gather queue/builder/tests | Retained existing conservative uncertainty and reservations; corrected readiness queue, fee helper and hidden rescan bypass. Browser exercised skipped #1 / ready #2, stop and return. |
| Ordinary TXC/token sends, desktop shared send, Nectar/invoice and cash-out entry | `components/wallet/shared/txc-send.tsx` | Shared fee helper already used; funding and final payment now inherit persistent TXC broadcast journal/exact lookup. Existing cash-out record written before broadcast retained. |
| Token-holder automatic fee funding | `lib/txc/topup.ts` | Shared fee helper already used; attempted-holder throttling retained; now inherits broadcast journal protecting unresolved inputs. |
| Ordinary TXC token consolidation | `routes/wallet.txc.consolidate.tsx` | Shared fees already correct; uncertain error now retains txid, stops the loop and blocks repeat while screen remains open. Journal protects overlapping attempts after reload. |
| Old TXC branch migration | `routes/wallet.txc.migrate.tsx` | Shared fee helper already used; primary path changes only after accepted broadcast. Inherits journal/exact transport; no migration settings changed by this task. |
| Imported-key TXC/token sends | `routes/wallet.wif.$id.send.tsx`, `lib/wif/chain-io.ts` | Uses same TXC broadcaster; corrected fee helper including node minimum. Leaf metadata completed while editing; no key storage/signing changes. |
| Seeds TXC Move back / Move TSD back | `lib/seeds/pocket.ts`, `lib/seeds/pocket-tsd.ts`, `routes/desktop.seeds.tsx` | Shared broadcaster covers both; TXC native fee helper corrected; removed an outer blanket "Nothing was sent" claim. TSD builder/own-destination rule unchanged. |
| Tap-card direct payments / partner polling | `lib/card/card.server.ts`, `routes/api/public/card.pay.ts` | Separate unsafe server broadcaster/status release found and fixed. Persist/claim local txid on existing pending row before broadcast, retain pending invoice/daily-limit reservation when uncertain, only exact readback marks paid. Polling attempted payments performs read-only reconciliation. |
| Telegram-approved card payments | `routes/api/public/telegram.webhook.ts` | Same card execution; Telegram now reports uncertainty rather than claiming failure. Authorization, approver membership and limits unchanged. |
| Owner card closure sweep | `lib/card/card.functions.ts` | Uses shared server exact-ID transport through sendFromPocket; existing closure/key deletion behavior unchanged. No settled card state or keys edited. |
| Card database guard and invoice idempotency | `drizzle/migrations/0001_atomic_card_payment_security.sql`, initial card schema/index | Existing guard serializes pending payments and counts pending+paid in daily limits; invoice uniqueness covers pending/approval/paid. No migration, grant, RLS, PIN or cap changes. |
| UTXO swaps / THORChain | `components/wallet/UtxoSwap.tsx`, `lib/thorchain/execute.ts`, BTC/LTC/DOGE mempool broadcasters and shared `blockbook-broadcast.ts` | These swaps do not use TXC. Existing independent local-ID/readback handling inspected; no swap gates, providers, permissions or other-chain broadcast behavior changed. |

## Tests and verification

- Full existing regression suite: **89 files, 840 tests passed**.
- ESLint on all changed TS/TSX files: clean. Harness preview build: OK.
- TXC transport/journal tests cover pre-submit persistence, HTTP failure with exact readback, timeout/404, reload, identical and changed attempts, wrong ID/bytes/HTML, and storage failure preventing a POST.
- Bulk tests cover pending reload, uncertain-ID/outpoint restore, storage failure, positive-only recovery, continued Omni checking and unchanged settled steps.
- Gather queue test concretely selects ready indexes `[2, 4]`, lists skipped `[1, 3]` and keeps skipped rows unchanged.
- Card tests use a synthetic encrypted key and fake existing-row database. They assert local ID is recorded before POST, uncertainty remains pending, repeat execution sends no second POST, exact readback settles read-only, failed claim sends nothing and retains pending, and paid records remain byte-for-byte unchanged.
- Browser: disposable unlocked paired Vault, synthetic funded holders #1/#2 with only #2 having confirmed TXC. Consolidate all prepared #2 and explicitly listed #1 as skipped. Stop/return preserved the recipient CSV.
- Browser bulk: genuine test-root signature over the prepared PSBT, real HMQR2 signed frames delivered through the scanner callback, simulated HTTP 503 and 404. Both preparation and consolidation stayed disabled; reload/unlock restored the same uncertain txid with no second POST. Subsequent exact transaction readback and positive Omni verdict displayed "Tokens delivered", still with exactly **one** intercepted POST. No page errors. Real camera optics/physical Vault hardware were not tested.
- Browser test viewport: 1258 × 930. No real funds or production writes used.

## Managed environment finding

`09ef1a5` changed the two URL entries in tracked `.env`. This task did not alter `.env` or generated clients. Without printing any URL/key values, the configured endpoint and the expected project backend were queried for the latest three public release IDs/versions: both returned 200 and identical nonempty rows. Browser/server URL settings also match. This verifies current routing for the tested read; it does **not** prove the historical edit was intentional, nor every backend operation. No preview-environment rollback is justified by the evidence collected.

## Review caveats and release requirements

- Safety is deliberately conservative: a genuine relay rejection with no positive readback also stays uncertain. There is no timed release, negative-lookup retry, manual "assume failed" button or automatic resend. A safe, independently reviewed rejection/retry workflow is separate work.
- Browser journals protect stored attempts on this device/origin; they are not cross-device coordination or an atomic cross-tab lock. Independent physical devices spending the same wallet still require normal member care and fresh unspent checks.
- No production database rows, settled payment records, profile envelopes, permission grants, chain settings or example data were changed. Card code uses existing columns and constraints, with no migration.
- Formatting normalizes the edited files and makes the textual diff larger than the functional change; no dependency updates.
- Auditor approval and a tiny real Vault send/consolidation test are still needed. Shared source changes apply to web, APK and extension; existing installed APK/extension binaries are unchanged until audited rebuilds/releases.