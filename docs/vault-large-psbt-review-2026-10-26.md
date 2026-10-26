# Vault large PSBT preparation review — 2026-10-26

## Report and diagnosis
Bobby reported “Maximum call stack size exceeded” during Vault DOGE preparation for 390000 DOGE with displayed balance 390096.08619381 DOGE. The exact user input transactions were not accessed; diagnosis is based on a reproducible matching failure class.

bitcoinjs-lib Psbt.toBase64 delegates to bip174's uint8array-tools. The browser export calls btoa(String.fromCharCode(...bytes)), placing every PSBT byte on the argument stack. Node exports instead use Buffer, so ordinary unit tests did not expose this browser failure. A synthetic 204087-byte legacy previous transaction reproduces the exact error through the real browser Psbt.toBase64 call.

## Change
src/lib/vault-link/psbt-build.ts now serializes psbt.toBuffer with vaultBytesToBase64: iterative byte conversion into 8192-byte string chunks, join, btoa. No unbounded argument spreading. Native browser btoa is available in the shared browser clients; the builder remains unsigned and browser-side.

No transaction fields, input selection, fees, derivation, payload contents, signing validation or broadcast policy change. Full legacy nonWitnessUtxo is preserved, not trimmed. Shared builder covers web, APK and extension source and Vault swap construction. Other non-Vault encoders are outside this correction's scope.

## Validation
- 56 tests pass across psbt-build.test.ts, swap.test.ts and vault-link.test.ts.
- Exact Base64 equality against reference encoding at byte lengths 0, 1, 2, 3, 8191, 8192, 8193, 200000 and 2000000.
- Synthetic 390000 DOGE payment from 390096.08619381 DOGE: payment 39000000000000 sats, fixture fee 306000 sats, change 9608313381 sats; full previous transaction retained.
- Browser reproduces old encoder overflow, then actual VaultSendDialog completes Prepare using controlled public fixtures and intercepted fee/previous-transaction reads. QR renders; no page errors. Broadcast replaced with a throwing guard; no signatures or payments attempted.
- Screenshot shows 455 QR frames for this deliberately large synthetic transaction. Correction removes stack overflow, not the long physical transfer time or existing QR payload limits. Real device scanning remains required.
- Preview reports build OK.

## Release status
Not published; APK/extension not rebuilt. User's exact previous transactions and real Vault scanning/signing remain unverified. Independent review and existing release/device acceptance still required.