# Vault QR integrity fix and auditor assessment — 26 October 2026

## Scope and release status
The shared wallet QR framing code was corrected in response to Bobby's “QR transfer was damaged” screenshot. No spending verifier, signing logic, CSP, wallet storage or execution gate changed. Applies to source used by web, Android and extension; no release published or installed packages built. This is a review handoff, not live-money acceptance.

## Reproduced root cause
HME Vault snapshot 8c16ee16 uses SIGNING_PART_SIZE = 240 in src/routes/sign.tsx. Our collector previously recomputed a tag by calling toParts(text) with the default 600-character frame size and extracting the first frame's tag. A reconstructed result of 241–600 characters becomes an unframed single string under that default, so tag extraction fails even when the received checksum is correct. A two-part transfer can therefore decode correctly and be falsely reported as damaged.

TXC Wallet snapshot d3ef8679's collector does not validate the reconstructed checksum. That behavior was not copied. The investigation agent's stale-collector hypothesis was not adopted: callers reset collection after completion; conflicting duplicate content is already rejected; the 240/600 size discrepancy was reproduced directly and confirmed against fresh Vault source.

## Correction and safeguards
- Compute FNV content tags directly over reconstructed text, independent of frame size.
- Match Vault's minimum 240-character framing and corresponding bounded part count; keep outgoing default at 600, avoiding an unrelated UI change.
- Bound cumulative unique chunk storage at 3 MiB before completion, including legacy frames; duplicates consume no additional budget.
- Preserve mixed-transfer, conflicting-duplicate and damaged-content rejection. No bypass of integrity or transaction validation.

## Verification
- 21 targeted tests pass: 19 Vault framing/pairing/intent tests and 2 header tests.
- Direct interoperability with fresh Vault source passes for 241, 400, 480, 500, 600, 601 and 1201 characters at 240-character framing.
- Real bundled jsQR pixel decoding inside the actual VaultSendDialog: 480-character synthetic result in two Vault-generated frames, 50% progress, one scanner Close, completion reaches transaction parsing instead of false corruption. Intentionally invalid transaction rejected with “Transaction has unexpected data”; no broadcast, no page errors, capture tracks stopped, retry progress resets.
- Isolated mounted component uses public test xpub/UTXO metadata, not Bobby's wallet. This is not an unlocked real-wallet, genuine signed-transaction or physical-device end-to-end acceptance. Native detector, installed Android/extension and a real funded signature remain unverified.

## Newly supplied auditor feedback: assessed, not implemented
The auditor's approval of the previous scanner-only changes does not approve this new framing correction or live-money spending.

### Finding 1 — transaction equivalence: agree, pending Bobby's approval
Current ordinary UTXO send calls verifySignedTx, which checks requested payments appear among outputs but does not bind the complete transaction to step.payload. The existing verifySignedVaultSwap checks all inputs/outpoints/sequences, ordered outputs/scripts/values, version and locktime and requires signature material. Reusing a neutral shared equivalent before broadcast makes sense. Retain readable recipient checks as a second assertion and preserve a swap wrapper's existing error semantics/callers.

Impact: valid transactions matching the frozen PSBT should continue to work. A signer that changes output ordering, change destinations, extra outputs, input selection, sequences, version or locktime will be rejected instead of broadcast. This is intentional, not a reason to weaken verification. The node still enforces cryptographic signature validity; equivalence checks are not a counterfeit-device attestation.

### Finding 2 — change index: agree, pending Bobby's approval
Ordinary send derives changeIndex from the count of currently held change UTXOs. Swap uses max used change index + 1. Reusing the latter avoids reuse caused by spending old change coins. Does not migrate wallets or change existing funds/addresses; affects future change only. Completeness of the public scan must still be respected.

### Finding 3 — malformed-frame recovery: reasonable, pending Bobby's approval
Keep camera open and show an in-scanner error on collector failures, without treating malformed/mixed/corrupt content as complete. Define whether valid partial progress is retained or explicitly reset and test recovery. Only a complete integrity-validated result may enter transaction verification. This affects interaction and recovery, not signing policy.

### Outstanding claims requiring reconciliation
Audit refers to yesterday's export. Current roadmap records Oct 25 fixes for add-wallet preservation and the shared phone Vault-swap block; do not blindly treat stale “still reachable”/fallback claims as current without source and flow rechecks. EVM swaps remain paused despite the note saying written acceptance is enough; project requirements additionally need reviewed executable route semantics and release/device acceptance. Android backup and installed package rebuilds remain outside this change and must not be declared cleared.

## Next decision
Recommend approving all three focused auditor recommendations together, followed by redirected-change/input/output/version/locktime regressions and browser recovery verification. Await Bobby's confirmation before applying them. No publishing before independent review and release/device acceptance.