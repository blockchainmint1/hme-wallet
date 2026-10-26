# Approved Vault auditor fixes — 26 October 2026

## Approval and scope
Bobby approved all three recommendations from vault-signing-scanner-review-2026-10-26.md after impact assessment. This work implements full UTXO transaction equivalence, historical change-index selection, and recoverable signed-QR collection errors, in addition to the independently reproduced 240-character QR checksum compatibility correction.

Shared source covers web, Android and extension; no published release, package build, spending gate change, wallet migration or CSP change. Independent review of these new changes and physical/funded acceptance remain required. Previous scanner approval does not clear this new spending-verifier change.

## Changes
1. Extracted verifySignedAgainstPsbt into psbt-build.ts. Ordinary send calls it against the exact frozen PSBT displayed to Vault before the readable recipient check and before broadcast. Every input hash/index/sequence, ordered output script/value, count, version and locktime must match; each input must contain script or witness material. Swap retains its existing wrapper, return value and mismatch wording. Malformed parsing fails closed with no weaker fallback.
2. Added nextVaultChangeIndex shared by ordinary sends and swap preparation: max historical used change index plus one, zero for none. Receive-branch activity does not influence it. It fixes the held-UTXO-count mistake; it does not persist reservations or prove scans complete during an outage.
3. Collector errors reset partial state and progress, show an in-camera error, and leave capture open. A fresh accepted frame clears the error. This reset avoids carrying corrupted or mixed chunks into recovery. Complete integrity-validated payloads still close capture before verification; invalid transactions remain rejected. Implemented for both ordinary Vault send and EVM signing callers; EVM signing/verification rules unchanged.
4. HMQR2 computes content tags directly, matching fresh Vault source's 240-character signing/pairing frames. Default outgoing size remains 600. Cumulative unique chunk storage is bounded to 3 MiB; duplicates consume no additional budget; altered content/mixed transfers/conflicts stay rejected.

## Tests and verification
- 62 tests pass across psbt-build.test.ts (24), swap.test.ts (3), vault-link.test.ts (19), evm-send.test.ts (14) and headers.test.ts (2).
- Redirected-change rejection tested on TXC, ISK, BTC, LTC and DOGE legacy transaction fixtures, alongside unchanged acceptance and readable payment checks.
- Separate mutations reject changed input hash/index/sequence, extra inputs, absent signature material, recipient/change values, extra/missing/reordered outputs, version and locktime. Existing swap tests retain memo/script and equivalence behavior.
- Historical change test: used change indexes 7 and 2 with receive index 99 produce next change index 8, even with no held-change count. Empty activity produces zero.
- Direct framing interoperability against HME Vault snapshot 8c16ee16 passes seven payload sizes (241, 400, 480, 500, 600, 601, 1201).
- Browser: actual mounted VaultSendDialog, actual jsQR decoding through a synthetic canvas MediaStream, fresh 1280×1800 Chromium. Malformed QR leaves camera live with visible error; subsequent valid parts clear error, show 50%, close on completion and stop tracks. Invalid transaction rejected. Retry resets progress.
- Browser: decode the actual unsigned PSBT displayed by the dialog, build signed-shaped equivalent and redirected-change fixtures, return them as real QR pixels. Redirected change displays refusal with zero broadcast calls. Exact equivalence reaches one intercepted mock broadcast and confirmation screen. All /api requests blocked except the intercepted fake broadcast; no real network payment. No page errors.
- Latest preview build OK. All content routes inspected for existing leaf head metadata.

## Evidence limitations and outstanding acceptance
Browser runs are isolated mounted-component tests with public deterministic fixture metadata, not an unlocked real user profile or a genuine offline signature. Signature-shaped fixtures establish equivalence, not cryptographic validity; the chain node still verifies signatures. EVM scan recovery was source-reviewed and its verifier tests pass, but its camera flow was not separately browser-driven. Physical camera optics, native detector, APK/extension packages, actual Vault signing and funded transfer remain unverified.

This does not prove a Vault authentic or firmware safe. Network scans may still fail or be incomplete; current highest-used indexing is not an on-device reservation system. Broader scan completeness, Android backup, spending-session freshness, wallet-management release acceptance, paused swap semantics and other previously recorded audit items are not cleared by this pack. No real-money spending or publication is authorized here.

## Auditor reproduction
The validation scripts require the running development app at localhost:8080, project dependencies and Python Playwright. check_recovery.py uses validation/frames.json; check_payment.py generates QR images from the unsigned request. All fixtures are deliberately public/synthetic. Read result logs and screenshots alongside the source. Do not use the deterministic test seed for funds.