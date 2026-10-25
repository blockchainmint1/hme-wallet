# Oct 25 audit feedback — approved fixes and acceptance handoff

## Decision and scope
Bobby approved wallet-preservation fixes across web/APK/extension, removal wording, environment-file protection and a shared Vault swap hold. Chart retention, Android backup policy and generic Vault send equivalence remain separate. No publication, APK/extension rebuild, funded signing or broadcast performed.

## Implemented
- Create/import add intent is `desktop || add`, independent of unlock/password availability. Password is freshly obtained at submission and again at the actual save boundary. Missing/expired session refuses with unlock guidance; it never falls back to replacement or an empty password.
- Shared `managed-seed-save.ts` makes add-only persistence explicit. Initial setup additionally refuses to overwrite an existing active envelope. Lower-level `saveWallet` remains unchanged because existing unlock/KDF upgrade and intentional upgrade flows need it.
- Import's network/manual-choice completion routes all enter the same guarded save boundary; save errors now appear on the manual-choice screen too.
- Desktop removal footnote uses the wallet name, not the removal trigger label.
- Shared UTXO swap entry rejects Vault mode before mounting quotes/order/signing flows. Applies to DOGE/LTC and all providers, web/APK/extension, not only desktop. Seed-wallet swaps are unchanged. Existing provider/signed-swap implementation was not altered or newly accepted.

## Blocked environment-file request
The tool refused editing `.gitignore` because it is managed read-only. Read-only tracked-file inspection confirms `.env` is already tracked, so an ignore rule alone would not remove it from repository history or tracked files. No bypass, stateful Git operation, `.env` edit or environment-value inspection was performed. Auditor archive excludes `.env` and every credential file. Platform-managed configuration treatment must be resolved before claiming this finding closed; no secret exposure was established by this task.

## Verification
- Full suite: **305 tests, 43 files passed**; targeted new safety tests + wallet removal: **10 tests passed**.
- Preview latest build: **build OK**. No manual production build/typecheck performed.
- Fresh disposable browser: initial creation through UI; desktop second-wallet creation; original encrypted envelope byte-identical and both wallets read back in library.
- Fresh locked phone create/import add pages: attempted submissions show explicit locked-session message; all saved wallet envelopes unchanged.
- Disposable Vault envelope created through app storage helpers, then unlocked using actual desktop UI; same-session phone DOGE swap navigation shows pause and no order/sign controls. No funded wallet involved.
- Browser page errors: none. Screenshots included (library, locked import, Vault pause); all use disposable accounts only.
- Content-route metadata inspected for home and affected create/import/desktop and phone swap routes; existing distinct titles/descriptions/OG and Twitter card preserved. No routes added.

## Review focus and remaining limitations
Verify immutable add dispatch, fresh check at each import completion, no lower-level storage migration, and shared early swap gate. Fresh session password is returned for saveSession after persistence. No new dependencies, backend/server/auth changes or camera/CSP changes.

Generic Vault UTXO send verifier remains subset-recipient matching rather than complete unsigned-transaction equivalence; this is not cleared by the swap hold. Android merged-manifest backup policy and physical camera acceptance remain unverified. Chart series already cap at 2,000 points; aggregate storage budget unchanged. EVM and Earn gates remain closed. Full release/device acceptance and independent review are still required before publication/package delivery.