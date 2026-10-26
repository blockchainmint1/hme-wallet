# Honest Money — full release audit handoff (26 October 2026)

## Scope and approval
Bobby approved recommendations 1, 2 and 4 from the swap incident review: explicit instant-exchange Review wording, opened/unpaid local order records, and older portfolio observation thinning. Recommendation 3 (move order creation to Confirm) is deliberately not implemented. No execution gates reopened, no publication, no APK/extension builds or release-row changes.

## Changes for independent review
- Shared UtxoSwap names the selected provider on Review and announces that FixedFloat/SideShift Review opens an order. Review explains that Edit leaves an unpaid order until expiry.
- A successful, provider-matched instant-exchange order is saved immediately with profile ownership, order ID/token, amount, payout destination and expiry; txid remains empty, lifecycle opened, done/failed false. THORChain reviews do not create opened rows. No deposit address is saved, and the opened detail cannot resume payment: fresh review is required.
- Broadcast upgrades the same profile/provider/order row to sent with its real txid, without a duplicate. Existing history key and legacy payout-address isolation are preserved. Unpaid rows do not poll payment status or show sent/completed steps. Provider expiry labels them expired/not-sent; it does not claim the provider cancelled or refunded anything. Expiry checks update every minute on list rows.
- Existing opened orders from before this update cannot be reconstructed. Local storage is best-effort, not an authoritative ledger; an external payment or a broadcast followed by a crash/storage failure may not be recorded. “Not sent” describes this wallet's local broadcast record, not independent chain proof.
- Older portfolio observations (older than 24h relative to the newly appended observation) retain the last actual observation in each five-minute bucket, independently per coverage. Recent points remain unchanged. Existing 2000-point cap remains. Currency histories retain their existing five-minute policy.
- Retention is still bounded: minute updates leave approximately two days of older five-minute samples plus the recent day within 2000 points; faster-than-minute changes can still exhaust the cap inside a day. Thinning is not unlimited year history, and extrema within older buckets can disappear. No averages, invented observations, storage migration, new network calls or historical reconstruction.

## Verification
- Full suite: 47 files, 353 tests passed. Includes opened/expiry/no-poll rules, same-order upgrade/profile isolation, no THORChain opened records, real older samples, coverage isolation and 2000-point cap.
- Preview build log: build OK at 2026-10-26T13:08:29Z.
- Browser mounted actual shared UtxoSwap with controlled unlocked-wallet data and mocked quote/order providers. Explicit FixedFloat Review made exactly one mocked order; Edit retained opened/not-sent history; detail read back the order/expiry; 390×844 layout showed button text and last row without overflow. Screenshots inspected. No signatures, broadcasts, real orders or provider payments; no page errors. This is not live-wallet authenticated E2E or device acceptance.
- Quick backend scan: one informational public app_releases read policy, consistent with the key-free public update feed. No migration performed. Deeper platform scan was started and is pending; it may reflect the last saved revision rather than these just-written changes. Results must be reconciled against this export.
- Internal read-only release reviewer: 115 targeted tests passed; preservation, frozen transaction equivalence, provider intent and execution pauses intact. This is not independent signoff.

## Existing concerns requiring separate decisions, not silently changed
1. Android fresh platform template still enables allowBackup; the patch script does not disable it or set data extraction exclusions. No final APK inspected. Recommend a separately approved Android backup-exclusion fix before the next APK.
2. Ordinary Vault broadcast handlers enforce frozen transaction equivalence but lack a handler-local fresh session/profile check. Component unmount may mitigate it, but lock/switch races have not been reproduced or device-tested. Recommend separate audit of lifecycle and fresh authorization; not a newly proven recipient/amount vulnerability.
3. Android workflow defaults to bundled origin but does not assert final bundled-origin config or signing certificate. No incorrectly signed or remote-origin shipped APK demonstrated.

## Release acceptance blockers
Independent review of these three follow-ups and completed deeper scan remain before publishing. APK/extension need new reviewed packages, upgrade/preservation and artifact checks. Physical camera/QR/Vault signing and tiny funded acceptance need Bobby's devices. EVM swaps, Earn and Vault swaps remain paused with their existing blockers. Actual 10,000 DOGE deposit verification still needs transaction ID. Platform-managed tracked publishable environment configuration remains excluded from export; do not add secrets there.

## Package contents
Complete clean source/config/test/docs/assets tree, dependencies and lock/config metadata, plus this review, full-suite output and controlled-browser evidence. Excludes Git metadata, dependencies, generated builds, Android generated platform, environment files, release binaries, platform private metadata and uploaded user data. Source-only export is for independent audit, not an installable release. Public embedded publishable client values are not private keys. Independent reviewer should install from the lockfile and reproduce tests/build in their own environment.