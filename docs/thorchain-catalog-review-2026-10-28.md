# THORChain full-route catalog — desktop swap review
2026-10-28

## Scope
Desktop `/desktop/swap` now offers native THORChain swaps between every
wallet-supported coin with a live pool: BTC, DOGE, LTC, ETH, ETH on Base,
BNB, and USDC/USDT on Ethereum, Base and BNB Chain (11 assets, 110 route
pairs, all verified Available against live THORChain pools at build time).
TXC is excluded (no TEXITcoin pool exists on THORChain). XRP is excluded
(no XRP support exists in this wallet).

This supersedes the quote-only `usdc-btc.*` modules and the `ThorUsdcBtc`
component, which are removed. The phone's LTC/DOGE multi-provider screen is
unchanged. LI.FI aggregator swaps remain paused under
`src/lib/security/execution-policy.ts` — this work does not touch that gate.

## Security model
- `catalog.ts` pins the three EVM routers (ETH 0xD37B…7146, BASE
  0x00dc…f1d4, BSC 0xb30e…f56b — all verified against live
  inbound_addresses on 2026-10-28) and validates destinations per chain.
- `catalog.server.ts` cross-checks every quote's deposit address against a
  separately fetched inbound_addresses record, requires pinned router match,
  honors global/chain halt flags and pool availability, refuses affiliate
  fees, enforces recommended minimums and UTXO dust thresholds, and binds
  the memo to the exact destination asset, payout address and after-fee
  minimum (`liquidity_tolerance_bps`, default 100 bps; never feeless
  `tolerance_bps`). Memos may use THORChain's full, short (BASE.USDC) or
  verified terse (b) asset forms; only explicit per-asset aliases are
  accepted.
- Amounts are bigint-only, capped at THORChain's 1e8 precision, so the
  displayed, quoted and signed amounts are identical.
- `execute.ts` EVM path rebuilds calldata from the frozen quote and enforces
  it with a `beforeSign` guard on every signing attempt (target, calldata
  and value must be byte-identical). ERC-20 sources approve the exact
  quoted amount only, resetting any stale allowance to zero first; no
  unlimited approvals. UTXO path reuses the audited chain builders with the
  memo in an 80-byte OP_RETURN; over-long memos refuse the route.
- Quotes must be fresh at send time (expiry > 60s out, age < 120s).
- Vault profiles remain blocked from swaps; watch-only wallets cannot sign.
- Swap history recording is profile-scoped; THORChain rows track by deposit
  txid only (no order is created at review time, unlike FixedFloat).

## Verification
- 61 THORChain tests (catalog, server cross-checks, executor guards, UTXO
  planning); full suite 473 passed; `tsgo --noEmit` clean; build OK.
- Browser (disposable imported test profile, 1280×1800): live USDC→BTC
  quote (1000 USDC → 0.012222 BTC expected / 0.0121 minimum / ~30s), live
  BTC→USDC-Base quote (0.001 BTC → 81.02 USDC), BTC payout address
  auto-filled from the wallet's own receive address, EVM payout auto-filled
  from the wallet's EVM address, invalid destination visibly rejected,
  zero broadcast requests observed throughout.

## Not yet done (required before real-money use)
- Independent auditor review of catalog.ts, catalog.server.ts, execute.ts,
  ThorSwap.tsx (this pack).
- A tiny funded device test per source kind (one UTXO, one EVM native, one
  ERC-20) before publishing is declared safe.
- Publishing itself — this change is not published.
