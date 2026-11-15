# Roadmap

## Per-site Trading branches from honest.money (Nov 14)
- [x] Wallet reads delegate_modes/delegate_branches; per-wallet branch book; 619 tests pass
- [x] honest.money reserves HME Chat branch 1108 (access only); spare branch suggested
- [x] Website already live with per-site branches; APK 0.1.202611142323 released to everyone as required update (Nov 15)
- [ ] Auditor review of per-site branch note (Bobby shipped ahead of it)
- [ ] Rebuild Chrome extension with per-site branches, then publish (bundled 0.5.1 predates it)

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
