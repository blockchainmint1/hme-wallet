# Vault TSD signing preparation — 2026-10-27

## Status
Prepared in shared wallet source, not published or packaged. No real payment, provider order or blockchain broadcast was made. Third-party audit and a tiny funded physical Vault transfer remain required before release. This is single-recipient TSD, not bulk send, consolidation, cash-out or swapping.

## What changed
- Desktop Send → TSD now opens the token-aware Vault QR flow rather than the unavailable warning.
- `/wallet/send?token=39` has a Vault-specific TXC/TSD selector, avoiding signing from the random wrapping anchor. Payment-link amount/recipient are passed through; token changes reset the signing entry.
- A dedicated builder pins TXC Omni property 39, divisible eight-decimal bigint amounts and legacy receive address #0 (`m/44'/696969'/0'/0/0`). Other holder addresses and cross-address fee funding are deliberately unsupported.
- Every selected fee input must belong to that address. Previous transaction hash, output value, script, path and public key are checked. Only confirmed address-zero coins are fetched for preparation.
- Ordered outputs: canonical zero-value Simple Send OP_RETURN, recipient legacy P2PKH with 10,000 TXC base units, optional change to the same sender address with its exact derivation metadata. Native HD change policy remains unchanged.
- Eight-decimal token amount, sender, recipient, actual TXC fee, 0.0001 TXC accompanying payment and holder change are shown with the signing QR. Sub-dust change is disclosed as part of the fee. Fee estimates are bounded below the current Vault TXC cap.
- Before broadcast: all frozen PSBT fields must match, each legacy signature must verify cryptographically with SIGHASH_ALL, current Vault session/profile/pairing must match, selected outpoints must remain unspent and the holder must still have the requested TSD. Duplicate scan processing is suppressed.
- Preparation fails if property-39 metadata is absent or divisibility disagrees, token/node reads fail, no holder fee funds exist, recipient is wrong-network/non-P2PKH/self, or request exceeds the inspected Vault's 250,000-character PSBT limit.

## Current Vault compatibility evidence
Read-only HME Vault snapshot commit `5b3dde71` checked out on this date. `src/lib/signer/psbt.ts` explicitly recognizes canonical version-0/type-0 Simple Send, property 39 as TSD with eight-decimal formatting; it excludes derivation-verified change from the displayed token recipient. It verifies ownership and previous outputs, binds review to exact PSBT, permits only SIGHASH_ALL and has a TXC fee cap of 5,000 base units/vB. This source inspection is not proof that Bobby's installed Vault matches that version, nor a genuine offline device acceptance test.

## Verification completed
92 targeted checks passed: 35 new TSD builder/signature/tamper tests, 34 existing frozen-PSBT tests, 20 Vault framing/intent checks, wallet-preservation and Vault-swap-pause checks. Genuine deterministic local test signatures verify; fake signature-shaped material and altered token payload, recipient, change, order, sequence and locktime reject.

Actual desktop screen verified with a disposable encrypted Vault profile and controlled service balances. Preparing 1 TSD produced a QR and showed the expected recipient, sender address #0, 0.00000258 TXC fee, 0.0001 TXC accompanying output and 0.99989742 TXC holder change from one 1-TXC fixture input. No page errors and zero broadcast calls. Nine-decimal input rejected visibly. The same open signing dialog was checked at 390×844: 260px QR, one close, no horizontal overflow. These balances are test fixtures, not Bobby's funds.

Preview's latest checked result: build OK. No manual project build/typecheck run.

## Not verified / acceptance still required
- Fully authenticated phone-route entry end-to-end: shared dialog is verified at phone dimensions, but synthetic phone navigation encountered unrelated controlled-data route errors; do not claim full phone acceptance.
- Genuine signed-QR → successful broadcast through UI, real node Omni acceptance and final TSD recipient balance. Tests verify local signatures, not physical Vault signing.
- Lock/profile/pairing-switch negative browser scenarios, duplicate signed-QR broadcast, node races and unavailable metadata scenarios deserve dedicated integration acceptance; code checks are present but not all separately browser exercised.
- Installed APK/extension/Vault versions, actual cameras and new release packages. Shared source applies to web/APK/extension when rebuilt and delivered.
- The existing metadata service treats omitted divisibility as true; new code requires its returned property entry, but does not change this pre-existing service behavior. Auditor should assess that pinned TSD policy.
- 10,000-base-unit dust convention follows existing TXC code; current public relay policy was not independently established here.
- A read-only helper reviewed the new path and found no transaction-integrity blocker; it found discarded payment-link fields and stale token selection, corrected in this change. This is not the required external audit.

## Audit source map
Primary new logic/tests: `src/lib/vault-link/tsd-send.ts`, `tsd-send.test.ts`.
Entry and execution: `src/components/desktop/AssetFlow.tsx`, `src/components/wallet/VaultBottomActions.tsx`, `VaultSendDialog.tsx`, `src/routes/wallet.send.tsx`.
Preserved dependencies: `vault-link/psbt-build.ts`, `derive.ts`, `pairing.ts`, `qr-parts.ts`, `txc/tokens.ts`, `tokens.functions.ts`, `mempool.ts`, `session-cache.ts`, `storage.ts`.

## Physical acceptance procedure
After independent review, confirm current Vault version. Use a small disposable Vault holding TSD and confirmed TXC on legacy TXC address #0. Prepare a tiny TSD payment to another known TXC legacy address; verify Vault itself shows property 39/TSD, exact amount/recipient and TXC fee/change. Sign and scan back. Confirm only one broadcast, exact TXC transaction outputs and final Omni-valid receipt at the intended recipient. Repeat on web, rebuilt APK and extension; verify lock/profile change stops pending transfer. Never test first with the full balance in the screenshot.