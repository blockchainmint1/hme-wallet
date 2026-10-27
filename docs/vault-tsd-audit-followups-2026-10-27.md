# Approved TSD audit follow-ups — 2026-10-27

## Assessment and approval
Bobby supplied an independent review reporting 399 tests and a clean export build, and approved both code changes. The receive fallback finding was valid: desktop TSD Receive could issue a purpose-49/84 address even though the restricted TSD sender requires legacy purpose 44 address #0. Removing that fallback affects only Vault TSD receiving with a missing legacy pairing; it does not migrate, replace or delete wallet data. Fetching only selected previous transactions is a performance improvement, not permission to skip input verification.

## Changes
- Shared `vaultTsdReceiveAddress` returns legacy TXC address #0 only, or null when unpaired. Desktop Receive shows “Pair the Vault's legacy TXC account to receive TSD.” No unsupported receiving QR is rendered.
- Shared `selectVaultTsdInputs` uses the existing largest-first policy and unchanged fee estimate. The signing dialog selects confirmed holder coins before previous-transaction downloads. The builder calls the same selector and still checks full previous transaction hashes, scripts, amounts and holder derivations.
- Added five concrete tests for legacy receiving, purpose-49-only and purpose-84-only refusal, skipping unnecessary coins while preserving the exact request, and multiple-coin selection.
- Same-holder change remains unchanged and retains derivation metadata. This is correct for Omni; physical Vault display classification remains an acceptance item, not a new change.

## Verification
95 targeted tests passed (40 TSD, 34 frozen PSBT, 20 Vault protocol, one wallet-preservation).
Actual desktop flow with a disposable encrypted Vault and controlled network data:
- Two confirmed fixture coins offered; preparation downloaded exactly one previous transaction, belonging to the selected 1-TXC coin. The unused 100-base-unit coin was not downloaded.
- 1 TSD request retained the recipient, address-zero sender/change and previous fee: 258 TXC base units. No page errors, zero broadcast calls.
- Legacy pairing rendered its address-zero receive QR. After changing only the disposable test pairing to purpose 84, reloading and unlocking through the UI, Receive showed the legacy-pairing warning with no QR.
- Same signing dialog at 390×844 had no horizontal overflow. This does not prove the full phone entry path or device camera.
- Latest preview result checked: build OK.

## Remaining gates
Independent review of this small delta; then a disposable 1-TSD physical Vault test confirming one token recipient, correct property/amount, derivation-verified change, one broadcast and final recipient token balance. Repeat on rebuilt APK and extension. No publish, package build, provider order or real transaction was performed. Existing ordinary Vault broadcast/session and Android packaging items are outside the approved two-fix scope and were not changed.

## Source delta
`src/lib/vault-link/tsd-send.ts`, `tsd-send.test.ts`, `src/components/wallet/VaultSendDialog.tsx`, `src/components/desktop/AssetFlow.tsx`, `src/lib/vault-link/AGENTS.md`, `roadmap.md`. Apply these as a delta to the prior full audit source export; do not replace unrelated files.