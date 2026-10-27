# Vault QR controls and exact received-piece progress

## Scope
Presentation-only improvement to shared wallet QR transfer controls. No changes to transaction construction, signature verification, broadcast rules, keys, pairing saves, frame format, frame size or CSP. No HME Vault project changes, publication, APK builds or extension builds.

## Behavior
- Outgoing multipart signing QRs retain 700 ms automatic playback. Pause/resume, previous/next and a numbered part selector are available. Previous/next and selection pause playback; previous from part 1 wraps to the last part, next from the last wraps to part 1.
- A new payload resets playback and selection. Single-frame requests have no playback controls.
- The wallet scanner shows one dot per numbered received/missing piece and a missing-number list (first 24 plus remaining count). Dots are bounded in a scrollable area for unusually large transfers.
- Ordinary UTXO/native EVM send scanning, dedicated EVM signing and pairing pass copied collector indexes to the shared scanner. Paused Vault swap execution remains paused; its unreachable scanner is not newly enabled or modified.
- Receiver progress comes from validated numbered frames and unique indexes, not order of arrival. Existing checksum, size, duplicate/conflict and transfer-mixing checks are unchanged.
- The outgoing wallet cannot know which pieces the offline HME Vault camera captured: no acknowledgement channel exists. Receiver dots for unsigned requests must be implemented by HME Vault. This wallet's dots apply when scanning signed results/pairing back. Labels do not claim a received piece is a verified signature; full payment checks still run on completion.

## Validation
- 70 tests passed across vault-link.test.ts, psbt-build.test.ts, evm-send.test.ts and vault-swap-policy.test.ts.
- New regression: 96 frames collected out of order, part 43 withheld, duplicates ignored, exact received indexes correct, returned array cannot mutate collector state; final piece completes the original payload.
- Real shared components mounted in an isolated browser harness: pause holds beyond two playback intervals, previous/next wrap, select part 43, resume, payload reset and single-frame controls hidden.
- Real jsQR decoded manually selected outgoing part 43 to the exact existing toParts frame string.
- Synthetic camera stream/native detector input: 95 of 96 frames shows missing 43 and exactly 96 received/missing dots; final frame closes scanner.
- Desktop 1280×1800 and phone 390×844 screenshots inspected. No horizontal overflow or page errors. This is controlled transfer verification, not a funded payment or physical device acceptance.
- Preview build log reports build OK.

## HME Vault handoff
Frames use `HMQR2:<content-tag>:<one-based-piece>/<total>:<chunk>` (legacy `HMQR:<piece>/<total>:<chunk>` is also accepted). The collector already stores pieces by their exact one-based number. Return a copied, sorted list of keys for receiver dots; never infer receipt from sender playback. Show explicit missing numbers so the sender can pause and choose that number. Do not relax integrity or signed-transaction review to complete a scan.

## Release limitations
Independent audit and physical Vault/phone testing remain required. Shared source applies to web/APK/extension when delivered; installed packages and published site are unchanged. The HME Vault team's receiving-screen dots are outside this project's changes.