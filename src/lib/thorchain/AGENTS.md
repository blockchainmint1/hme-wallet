# THORChain swaps

## Direct catalog routes (desktop swap page)
- Every route is a native THORChain swap from the catalog in `catalog.ts`; never route through LI.FI, FixedFloat or TSD Bridge custody, and never add affiliate parameters. Why: displayed amounts and destinations must match protocol instructions on every build.
- Quotes are server-validated in `catalog.server.ts`: live pool + halt checks, deposit address cross-checked against a separately fetched inbound_addresses record, pinned routers (ETH/Base/BSC) must match, THORNode's memo is only validated (accepting live terse gas codes b/d/l/e/f/s) for its after-fee minimum (`liquidity_tolerance_bps`, never feeless `tolerance_bps`); the signed memo is rebuilt by `buildSwapMemo` — full contract asset on EVM sources, shortest 80-byte form on UTXO sources, short token form only when it matches exactly one live pool. Why: a changed router, vault or memo must refuse the route, not silently redirect funds.
- Amounts are bigint-only and capped at THORChain's 1e8 precision, so displayed = quoted = signed. Why: no float rounding can skim value.
- EVM execution (`execute.ts`) rebuilds calldata from the frozen quote and enforces it with a `beforeSign` guard on every signing attempt; ERC-20 sources approve the exact quoted amount (resetting stale allowances first), never unlimited. Why: a tampered request can never be signed.
- UTXO execution reuses the chain builders with the memo in an OP_RETURN (80-byte standardness limit; over-long memos refuse the route). Why: the memo is the swap instruction.
- Vault profiles may quote and prepare review-only requests through VaultThorSwap; no Vault broadcast path exists and phone swaps remain blocked. Why: current offline signer rejects swap memos and approvals, requiring coordinated protocol review and release acceptance.

## Legacy LTC/DOGE phone flow
- `thornode.server.ts` / `swap.functions.ts` / `assets.ts` serve the phone's multi-provider screen; quotes use `liquidity_tolerance_bps` against expected after-fee output. Why: liquidity fees must not consume price protection or reject valid streaming quotes.
- Desktop sources are gated per toggle: BTC/LTC/DOGE on `utxoSwap`, ETH/Base/BNB on `evmSwap`; the THORChain router is the only reviewed EVM swap surface in `security/execution-policy.ts`. Why: settings must truthfully describe what can sign.
