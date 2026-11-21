# Roadmap

## Seeds re-link error (Nov 18 evening)
- [x] "hasn't approved Seeds" was a slow honest.money answer (timed out 20:32 BA), not the existing link; wallet now retries and says "couldn't reach honest.money" (5 tests, 726 total, browser-checked phone + desktop)
- [ ] Publish the fix (web + extension; next phone build for the message) — waits on Bobby / auditor

## Seeds coin list + Monero (Nov 18)
- [x] Wallet already reads Seeds' coin list right before linking; hands over every listed coin it can make keys for, skips the rest
- [x] Checked Bobby's 17-chain list: all covered except Maya (uses the same key as RUNE, no change needed)
- [x] Monero (XMR) keys added (Trezor method, independent reference values); 38 link tests pass
- [x] Bobby's rule: no automatic/generic chains; each chain is built and tested on purpose here before its keys go to Seeds (generic option dropped)
- [x] Seeds' reply: Monero fixed to Trezor's exact method (Trezor + Seeds test addresses), exact `format` check, relink updates one link (691 tests, browser-checked)
- [x] Seeds lists all 11 with formats and confirmed Cardano + Monero (built in their preview)
- [x] Seeds built "Add new coins", never-drop-a-coin and different-pocket refusal (in their preview); live Seeds sends `format` for all 11
- [x] Seeds reminder: revoking an older record can't retire the live pocket — covered by test (one record per site + pocket)
- [x] Bobby chose to publish the wallet ahead of Seeds withdraw-all (Nov 18): web published, extension 0.5.4 rebuilt with Monero handoff
- [x] Phone app 0.1.202611182136 released to everyone (required update) with the Monero handoff
- [ ] Joint test with Seeds once the wallet update is live: 5 → 16 coins on 1106, old-build re-link refused
- [ ] Auditor review of the Monero addition, then publish + extension + APK (waits on auditor)

## Full swap history on desktop Swap (Nov 15)
- [x] One "Swap history" list under the Swap page: THORChain, SideShift/FixedFloat, TSD buys, TSD cash-outs (670 tests pass, browser-checked with sample records)
- [x] TSD cash-outs now saved per wallet after sending (web, APK, extension share the Send screen)
- [x] Bobby's 40,000 test was USDC → TSD: already saved; live site only showed it inside the Buy TSD panel. New list shows it; amounts now comma-grouped
- [x] Auditor review (Nov 15 night): no cash-out ran (it was a buy); one-time fix live since Nov 12; disclosed list already live in the 21:46 build
- [x] Cash-outs saved as "sending" before broadcast, "sent" after; failed broadcast leaves "Not confirmed — check the explorer" row (4 new tests, 674 total)
- [x] Full source export + reply for auditor; draft note asking TSD Bridge for a key-scoped list-orders endpoint
- [x] Auditor sign-off (Nov 15 night); already live via owner publish 22:24 UTC (build 1794780623429 = 209cf7d); extension 0.5.3 published (build 1794782149589 = ad8fb99)
- [ ] Bobby sends TSD Bridge the list-orders request + the 40,000 purchase order id (waits on Bobby)
- [ ] Next APK build so the phone carries the merged history + "sending" records (Bobby runs GitHub Actions)

## Post-sign-off follow-ups (Nov 15 night)
- [x] Cash-out key conflict case: legacy key deleted + one-time notice, 3 tests (677 pass) — awaiting auditor review, not published
- [x] Branch-book design note (seed-keyed ledger + claim-time chain check) — awaiting auditor + Bobby's privacy choice
- [x] .env rename: skipped (platform-owned file); allowlist test added instead (src/lib/env-allowlist.test.ts)

## TSD Bridge routes on desktop Swap (Nov 15)
- [x] Buy TSD with USDC/USDT/PYUSD on Ethereum and USDC/USDT on Base (TSD Bridge mint orders), verified + re-polled + exact-transfer guard; 27 tests; 646 total pass
- [x] Sell TSD → USDC on Ethereum from the Swap page hands off to the audited Send cash-out
- [x] Auditor review received; applied: pinned contracts + refuse-on-mismatch, local record at Review, reuse/abandon, refuse reused deposit address, receipt wait, gas check, custody line, execution-policy entry (663 tests)
- [x] Bobby kept paste-any-T… recipient (warning + required tick) instead of auditor's own-only rule
- [x] Written request to TSD Bridge: confirm 5 contracts, publish depositTokenContracts, echo fields on orders, late-deposit policy
- [x] Auditor code review (Nov 15 pm): runtime gate on writtenConfirmation, server reads inbox itself, exact string amount, unconditional chain id, full-source export
- [x] TSD Bridge written contract confirmation (+ late-deposit sentence) filled in; mint margin 2h; mintFeeBps only (reply 2026-11-15)
- [x] Auditor sign-off on the confirmation diff (Nov 15 evening); live feed matches all five pins
- [x] Fresh security scan clean; 666 tests pass; extension rebuilt 0.5.2; publish requested
- [ ] New APK build (Bobby runs GitHub Actions → Android APK, then send the zip)
- [ ] 10 USDC on Base → wallet's own TSD address; send order id to TSD Bridge (Bobby, after publish)
- [ ] Leftovers: see "Post-sign-off follow-ups" below

## Per-site Trading branches from honest.money (Nov 14)
- [x] Wallet reads delegate_modes/delegate_branches; per-wallet branch book; 619 tests pass
- [x] honest.money reserves HME Chat branch 1108 (access only); spare branch suggested
- [x] Website already live with per-site branches; APK 0.1.202611142323 released to everyone as required update (Nov 15)
- [ ] Auditor review of per-site branch note (Bobby shipped ahead of it)
- [x] Rebuild Chrome extension with per-site branches (0.5.2, Nov 15)

## USDC THORChain send error (Oct 28)
- [x] Wait for successful approval confirmations and verify exact allowance before preparing the deposit; 72 targeted tests pass, build OK, auditor note delivered
- [x] Approve first, then refresh quote before deposit; deposit confirmation shown honestly (76 swap checks pass)
- [ ] Auditor review of export, publish, ~20 USDC test (exercises reset), then 10,000 USDC

## Vault THORChain signing preparation (Oct 28)
- [x] Compare HME Vault commit 5b3dde71: THORChain memos and EVM approvals/deposits explicitly unsupported
- [x] Wire paired-address desktop quotes, unsigned UTXO requests and proposed EVM review protocol; signed-result verification; no broadcast
- [x] 486 regression tests, build OK, browser live quote + mocked-RPC unsigned QR preparation, zero broadcasts; auditor handoff prepared
- [ ] Independent coordinated Vault review and tiny funded device tests before enabling broadcast

## Done: Full THORChain integration on desktop swap page (Oct 28)
- [x] Route catalog: 11 assets / 110 routes (BTC, DOGE, LTC, ETH, Base ETH, BNB, USDC/USDT on ETH/Base/BSC); TXC excluded (no THORChain pool), XRP excluded (no XRP support in wallet)
- [x] Desktop swap page rebuilt: source/destination pickers, auto-filled payout address, live quotes, min receive, fees, ETA, recent-swap tracking
- [x] Sending: UTXO via audited builders + OP_RETURN memo; EVM via quote-rebuilt calldata with beforeSign guard; exact-amount ERC-20 approvals; LI.FI gate untouched; Vault swaps stay blocked
- [x] 477 tests, typecheck, build, browser verification (live USDC→BTC and BTC→USDC quotes, zero broadcasts)
- [ ] Auditor review of Honest-Money-THORChain-Catalog-Audit.zip, then tiny funded device test per source kind, then publish

## Publish + build (Nov 12)
- [x] Full suite 588 tests pass (vitest), build clean
- [x] Fresh security scan: no critical findings, one info (app_releases readable — intentional key-free release feed)
- [x] Publish requested and confirmed live at https://mobile.honest.money (site 200; extension zip now 0.5.1 with cash-out code)
- [x] Chrome extension rebuilt 0.5.1 from current source, verified served from the live site
- [x] APK release 0.1.202611122035 built, verified (same signing key, no new permissions) and released to everyone as a required update (Nov 12)
- [ ] Auditor sign-off on cash-out v2 note (saved-address pre-send re-check), the 3 confirm points, and the two leftover decisions
- [ ] After publish: rotate the TSD Swap cash-out key and put it on the one wallet that should have it
- [ ] Tell TSD Bridge the wallet fix is live so they watch the first small cash-out to a non-saved address
- [ ] One small real cash-out to a non-saved address (Bobby, after the new APK/extension)
- [ ] Publish pending desktop changes (chart, holdings sort, Vault QR size, TSD receive/signing, swap provider fixes) after audit sign-off
- [ ] Physical device tests: Vault QR signing, TSD send, NFC card payment
- [ ] Android backup protection, old APK rotation, extension rebuild

- [ ] Desktop Send to many: tiny real TXC + TSD test, auditor review, publish

## Stale code incidents (Nov 8)
- [x] Publish proxy rescue for old clients' long GET broadcasts; live probes reach node at 16k/27.5k/40k hex
- [x] Stale-tab "new version available" bar (web only), 5 tests, browser checked
- [x] Rebuild extension zip 0.5.0 from current source
- [x] Auditor OK, then publish banner + extension zip (published Nov 12; extension rebuilt as 0.5.1)
- [ ] Retry 31,000 DOGE send from a fresh desktop tab (consider splitting into 2–3 sends)

## Per-wallet TSD cash-out key (Nov 11)
- [x] Confirm cause: cash-out key stored per install; all other ecosystem links per wallet
- [x] Auditor plan: /mnt/documents/Honest-Money-Per-Wallet-TSD-Cashout-Key-Plan-2026-11-11.md
- [x] Auditor answers received; implemented per-wallet key, fingerprints, one-time migration, unlink dialog, submission binding, first-wallet removal; 20 tests, preview checked
- [x] Inventory of first-wallet leftovers + implementation note for auditor
- [ ] Auditor sign-off on 3 confirm points, then publish; rebuild APK/extension; Bobby rotates key at TSD Swap
- [ ] Decide: clear other first-wallet leftovers, swap-history order tokens, keep pocket counters across wallet removal

## TSD one-time cash-out address (Nov 11, TSD Bridge handoff v1+v2)
- [x] Different payout address → one-time order (`/cashout/orders`), send to its own deposit address; never change saved address to redirect one cash-out
- [x] Separate "change my saved address" action; show "Check your email to confirm…" on pending_confirmation
- [x] Confirm screen shows bridge's payoutAddress + payoutAmount and says "this cash-out only" vs saved; source "HME Wallet"
- [x] Check bridge developer page (tsd.honest.money/api); tests; auditor note + note for the bridge team
- [x] Auditor + bridge answers (Nov 11): refund = address the TSD leaves from; 1-hour margin (bridge ≥1h, auditor ≥30m); re-poll order before signing; refuse wallet-owned deposit, exact decimal amounts, mismatched account inbox; skip deposit notice for one-time orders; saved-address re-check before signing
- [x] Bridge: one-time orders for every cash-out not needed — saved-address path stays
- [ ] Auditor reads v2 note + source export, runs tests (waits on auditor); a real small one-time cash-out to a non-saved address (waits on Bobby, after publish)
- [x] Publish + APK/extension rebuild after audit; tell bridge team when live (published Nov 12; APK rebuild runs in GitHub Actions)

## Seeds extra coin keys (Nov 17)
- [x] Trading-branch spend keys for DOGE, BCH, DASH, TRX, SOL, ZEC, XRP, ATOM, RUNE, ADA in access links (687 tests, browser-checked with mocked Seeds)
- [x] Auditor note: Honest-Money-Seeds-Extra-Coin-Keys-Audit-2026-11-17.md
- [ ] Auditor review, then publish + extension rebuild + next APK (waits on auditor/Bobby)
- [ ] Seeds lists + accepts DASH, ATOM, RUNE, ADA; confirms Cardano Icarus method (waits on Seeds)
- [x] Auditor opinion (Nov 18): Bobby declined wallet-side balances/key export/sweep/registry coin list; Seeds covers the exit. Reply: Honest-Money-Seeds-Extra-Coins-Reply-2026-11-18.md
- [ ] Seeds builds withdraw-all, balances and per-coin notes (waits on Seeds)
- [ ] Auditor accepts on that basis + reviews derivations from the export before publish (waits on auditor)
- [x] Seeds code review 18 Nov: wallet refuses updates that drop a coin; revoke uses an in-app dialog with a required tick when extra coins are shared
- [x] Auditor sign-off on the wallet side (18 Nov, relay-shapes sign-off): relay fix + every relay shape tested end-to-end; wallet approved on export hme-wallet-export-2026-11-18d
- [x] Checked Seeds' own code (their commit 65bbdc0a): refuses a different pocket while a link is active, refuses a link that drops a coin, submit accepts all 16 coins, Cardano = CIP-1852 Icarus and Monero = Trezor method written in their docs + tests, balances readable for 10 of 11 extra coins
- [x] Checked Seeds' live site build: all 16 coin definitions published, deposit screen carries the "HME Wallet can't hold this coin" notes, "Add new coins" button present
- [ ] Seeds still owes: a withdraw-all / send-out button per extra coin (live withdraw page only sends PulseChain out for the member), and Monero balances (needs a view-key scan server)
- [ ] Publish wallet after Seeds-side conditions are live and auditor checks Seeds (waits on Seeds + auditor); then rebuild extension and APK
- [x] Address-poisoning protection (member feedback): send-screen lookalike stop + recent-payment note on every send screen incl. Send to many and imported keys; red flagged rows phone+desktop; token lookalike rule (trusted = signed sends); explorer handoffs (TXC Tokens, TXC mempool)
- [ ] Auditor review, then publish + extension + APK (waits on auditor/Bobby); test against the member's watch-only payout wallet (waits on member's address)
- [ ] TXC Tokens + TXC mempool build their handoffs (open those projects)
- [ ] Seeds Pocket view for desktop Cold Storage (Vault) wallets — Bobby: not needed for now (19 Nov). Regular-wallet desktop Seeds Pocket page stays (commit 257cfdf), unpublished
- [x] Desktop finds a Seeds pocket linked on another device (activity on registry-reserved branch 1106) and shows Seeds Pocket view + Move back; Revoke needs relinking from desktop — unpublished
- [x] Seeds Pocket (desktop): show address #0, balance and explorer link for Seeds' extra coins (view only; no keys, no sending) — Bobby 19 Nov
- [x] Re-link a revoked Trading pocket on the same branch (same site only, Give access only) — Bobby 21 Nov; unpublished, needs new APK after publish
- [x] Desktop Seeds Pocket: "Move TSD back" button (TSD + the TXC paying its fee go to main #0) — Bobby 21 Nov; unpublished
- [x] Extra-passphrase safeguards: no autofill, confirm-or-clear on import/add-seed, backup page shows it — Bobby 21 Nov (Cory's different address); unpublished
