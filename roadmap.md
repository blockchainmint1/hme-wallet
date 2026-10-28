# Roadmap

## Done: Full THORChain integration on desktop swap page (Oct 28)
- [x] Route catalog: 11 assets / 110 routes (BTC, DOGE, LTC, ETH, Base ETH, BNB, USDC/USDT on ETH/Base/BSC); TXC excluded (no THORChain pool), XRP excluded (no XRP support in wallet)
- [x] Desktop swap page rebuilt: source/destination pickers, auto-filled payout address, live quotes, min receive, fees, ETA, recent-swap tracking
- [x] Sending: UTXO via audited builders + OP_RETURN memo; EVM via quote-rebuilt calldata with beforeSign guard; exact-amount ERC-20 approvals; LI.FI gate untouched; Vault swaps stay blocked
- [x] 477 tests, typecheck, build, browser verification (live USDC→BTC and BTC→USDC quotes, zero broadcasts)
- [ ] Auditor review of Honest-Money-THORChain-Catalog-Audit.zip, then tiny funded device test per source kind, then publish

## Pending from earlier
- [ ] Publish pending desktop changes (chart, holdings sort, Vault QR size, TSD receive/signing, swap provider fixes) after audit sign-off
- [ ] Physical device tests: Vault QR signing, TSD send, NFC card payment
- [ ] Android backup protection, old APK rotation, extension rebuild
