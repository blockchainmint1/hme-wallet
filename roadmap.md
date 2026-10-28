# Roadmap

## Current: Full THORChain integration on desktop swap page (Bobby, Oct 28)
- [ ] Verify what TSD Bridge's EVM audit actually covered vs our wallet's EVM signer
- [ ] Route catalog: all THORChain routes among wallet-supported coins (BTC, DOGE, LTC, ETH, BSC, Base, XRP, USDC/USDT on ETH/Base); TXC excluded (not on THORChain)
- [ ] Desktop swap page: source + destination pickers, amount, auto-filled destination from wallet, live quote, min receive, fees, expiry
- [ ] Sending: UTXO sources via existing audited THOR flow; EVM sources via new restricted THOR-only executor (fixed router, memo-bound calldata, exact approvals); XRP via existing XRP send with memo
- [ ] Keep LI.FI aggregator gate intact; Vault mode swaps stay blocked
- [ ] Tests + browser verification + auditor pack before publishing

## Pending from earlier
- [ ] Publish pending desktop changes (chart, holdings sort, Vault QR size, TSD receive/signing, swap provider fixes) after audit sign-off
- [ ] Physical device tests: Vault QR signing, TSD send, NFC card payment
- [ ] Android backup protection, old APK rotation, extension rebuild
