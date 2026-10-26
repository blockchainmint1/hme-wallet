# Vault signing scanner review — 2026-10-26

## Request and release status
Remove the duplicate close control and investigate the reported signing-QR camera/CSP failure using TXC Wallet's implementation, including multipart progress. No transaction signed or broadcast, no production data changed, no publication, APK or extension build. Independent review and physical-device acceptance remain required.

## Source comparison and diagnosis
Read-only TXC Wallet snapshot d3ef8679, inspected `src/components/wallet/Scanner.tsx`, `VaultSignerDialog.tsx`, `src/lib/txc/vault-signer.ts` and `src/server.ts`. This was source inspection, not contact with its operator.

TXC prepares a same-origin ZXing WASM reader before rendering its scanner, restricts formats to QR, surfaces loading/errors and shows unique captured parts, total, percentage, progress bar and part indicators. Its CSP permits WASM compilation; that permission is not necessary for this wallet's bundled JavaScript jsQR decoder and was not copied. No external decoder hosts, eval permission or CSP widening added.

Current Honest Money scanner already loads jsQR before camera permission and falls back when native BarcodeDetector fails or finds nothing. Published root response returned HTTP 200 with `media-src 'self' blob:` and `camera=(self)` on Oct 26. This confirms the public root policy, not Bobby's cached installed shell or every spending route. The screenshot shows a working camera preview but cannot establish the physical device's decoding failure. No evidence proves CSP is its remaining blocker.

The confirmed gaps were duplicate Close controls (scanner header plus shared DialogContent) and active signed-transaction callers not supplying the existing scanner progress/completion interface. Pairing already did. Paused Vault swap UI remains untouched and inaccessible.

## Changes
- `QrScanButton.tsx`: removed the extra close button; retained shared dialog Close and updated screen-reader description.
- `VaultSendDialog.tsx`: shows unique part counts inside scanner and parent, resets collection on reopening/back, closes scan on complete/error, hides scanner and disables Back during verification/broadcast, and uses an immediate ref to prevent concurrent decoded-result processing.
- `VaultEvmSigning.tsx`: provides the same progress/completion/reset behavior; existing immediate processing guard retained.
- Root `AGENTS.md`: documented shared single-close/progress/capture behavior. Roadmap updated.

No key storage, profiles, signing verification rules, destinations, fee selection, server policy or swap gates changed. Shared source is used by web, APK and extension; installed packages need a reviewed rebuild to receive UI changes.

## Verification and its limits
- 16 existing tests pass: `src/lib/vault-link/vault-link.test.ts` (14), `src/lib/security/headers.test.ts` (2).
- Latest preview build OK; content routes inspected for leaf head presence, none missing.
- Fresh Chromium 1280 × 1800, real VaultSendDialog mounted into running localhost app with isolated public-xpub/UTXO fixture, no wallet store modification. This is component integration, NOT ordinary user navigation/unlock or funded end-to-end spending acceptance.
- Prepared unsigned Bitcoin payment through its form; fee API response synthetic. Actual QR images fed through a continuously refreshed canvas MediaStream; BarcodeDetector disabled so bundled jsQR decoded the pixels. No decoded-result mock.
- First frame showed 1 of 2 parts and 50% with a progress bar; scanner contained exactly one Close button. Complete invalid transaction was rejected with “Transaction has unexpected data,” scanner closed, every capture track stopped; reopening reset to 1/2 and manual Close stopped all tracks. No page errors.
- EVM UI changes were not separately browser-driven; EVM verifier itself unchanged. Single-frame success, native BarcodeDetector, physical cameras, valid Vault signature/broadcast, installed APK/extension and full user flow remain unverified.

## Remaining review
The existing generic UTXO `verifySignedTx` still matches requested recipient outputs rather than complete frozen transaction equivalence; this known separate security issue is NOT fixed or cleared by camera work. Vault swaps and EVM swaps remain paused as before. Do not treat this package as approval for live-money spending.

For Bobby's physical scan failure, collect a real device test on a reviewed release: camera renders, unique frame count advances, valid signed result is verified, then only after independent spend-policy acceptance perform a tiny funded transfer. Do not relax CSP on speculation.