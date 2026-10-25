# Vault camera pairing and TXC spending comparison

## Scope and release status
Requested by Bobby on 2026-10-25: fix camera pairing and display progress; investigate TXC Wallet spending and desktop-only Omni send-to-many for seed and Vault wallets. No spending implementation was copied, no transaction was signed or broadcast, no publishing or packaged release was performed. Source inspection is not a conversation with another project's operator.

## Sources inspected
- TXC Wallet read-only snapshot commit d3ef8679, project 01170711-dab6-4e29-b721-a097914784ac.
- HME Vault read-only snapshot commit 8c16ee16, project 954a8d62-2653-447a-8d15-1cbcf445b17d.
- Current wallet source, notably QrScanButton, VaultPairingForm, security/headers, vault-link/qr-parts and psbt-build.

## Camera findings and changes
TXC's Scanner.tsx awaits its pinned, same-origin ZXing WASM decoder before rendering the camera, restricts decoding to QR and reports failures. Its server.ts permits local/blob media and WASM compilation. Do not copy its external script permission or generalize its CSP to this wallet.

Our scanner uses native BarcodeDetector or bundled JavaScript jsQR, not WASM; no WASM or eval permission is needed. We added media-src 'self' blob: to the shared header/meta policy. This addresses the missing local video allowance but does not prove it was the sole cause on Bobby's physical device. Camera permission remains camera=(self); an embedding preview can separately deny camera access, and an own-tab check may be required.

Changes: await the bundled fallback before requesting camera even when BarcodeDetector exists; use that fallback if native decoding throws or finds no QR; request ideal 1920x1080 capture without making it mandatory; contain rather than crop video; expose exact unique-parts progress inside the scanner; close after valid pairing; clear collection on reopening/start-over; stop tracks on close/play failure; explain permission errors. No external decoder downloads or broader connection destinations.

## Verification
- 16 targeted tests pass: two CSP tests and fourteen pairing/framing/intent tests, including duplicate-frame progress.
- Fresh browser context, disposable wallet created and unlocked through the UI. A canvas-captured MediaStream supplied actual generated HMQR2 image frames; native BarcodeDetector was disabled to exercise the real bundled jsQR decoder, not a mocked decoded result.
- First frame: 1 of 2 parts, 50%, visible progress bar. Second frame: fingerprint/address confirmation, automatic dialog closure, all camera tracks stopped. Add Vault wallet persisted one pairing record and navigated to /desktop/vault without replacing the original wallet.
- No page errors; preview build OK. This is synthetic camera-input acceptance, NOT physical webcam/phone/Vault-device acceptance. APK and extension packages were not built or installed. Shared code changes reach all source variants; actual release delivery still needs audit and packaging.

## How TXC spends
Seed wallet: local signing using its derived account key, then broadcast. Vault: derive addresses/public keys from the pairing, build an unsigned PSBT carrying derivation metadata, show animated QR, scan Vault-signed hex, verify and broadcast. No private Vault keys are transferred online.

Important: TXC's vault-signer.ts checkSignedTx checks input outpoints and output amounts/counts, but does NOT compare output scripts/destinations, version, locktime or sequences. A changed destination with identical value can pass. Do not port this check. Current generic VaultSendDialog's verifySignedTx also deserves separate hardening: expected recipient matching is not full unsigned-transaction equivalence. Keep this task from implicitly claiming existing spending is fully accepted.

## Omni send-to-many findings
TXC token-bulk.ts pins activation height 364100 and batches up to seven receivers to fit the node's single-OP_RETURN policy. These are snapshot implementation constants; current network activation/relay behavior was not independently probed here. Before activation, seed bulk falls back to individual Simple Sends. Larger lists chain transaction change, so the batch is not atomic and later sends depend on earlier broadcasts. It reports per-recipient outcomes and network fee shares.

Vault buildVaultTokenBatch supports one Simple Send or two-to-seven Send To Many recipients, requires a legacy holder, spends holder TXC for dust/fees, returns TXC change to that holder and carries its derivation metadata. Verify activation for this path rather than assuming the seed fallback applies. Snapshot dust is 10000 satoshis per receiver; do not treat it as an independently confirmed current network minimum.

HME Vault signer/omni.ts recognizes canonical type-7 packets specifically for property 39 (TSD), explicit output indices, up to seven unique recipients and bounded positive integer amounts. This is NOT proof of Vault multisend support for all TXC Omni properties. Signer psbt.ts/policy tests require independent review for broader token support.

## Safe follow-up, not delivered here
Build bulk controls ONLY under /desktop, sharing a transaction engine without phone controls. Review the token, every normalized recipient, exact integer units, holder balance, fees/dust and total before signing. Compare returned signed transactions with the frozen unsigned transaction: every ordered input/outpoint/sequence, every output script/value (including Omni payload and change), version and locktime; verify signatures and spending policy. Bind each batch to active profile, fingerprint and intended holder, stop on lock/profile changes, bound chain length, persist/read actual transaction status, show partial success without automatic duplicate sends. Confirm activation and TSD-only signer coverage before widening scope. Independent source review and funded seed/Vault device tests are required before release.