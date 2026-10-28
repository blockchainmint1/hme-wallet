# THORChain swaps

## Direct catalog routes (desktop swap page)
- Every route is a native THORChain swap from the catalog in `catalog.ts`; never route through LI.FI, FixedFloat or TSD Bridge custody, and never add affiliate parameters. Why: displayed amounts and destinations must match protocol instructions on every build.
- Quotes are server-validated in `catalog.server.ts`: live pool + halt checks, deposit address cross-checked against a separately fetched inbound_addresses record, pinned routers (ETH/Base/BSC) must match, memo bound to the exact destination asset, payout address and after-fee minimum (`liquidity_tolerance_bps`, never feeless `tolerance_bps`). Why: a changed router, vault or memo must refuse the route, not silently redirect funds.
- Amounts are bigint-only and capped at THORChain's 1e8 precision, so displayed = quoted = signed. Why: no float rounding can skim value.
- EVM execution (`execute.ts`) rebuilds calldata from the frozen quote and enforces it with a `beforeSign` guard on every signing attempt; ERC-20 sources approve the exact quoted amount (resetting stale allowances first), never unlimited. Why: a tampered request can never be signed.
- UTXO execution reuses the chain builders with the memo in an OP_RETURN (80-byte standardness limit; over-long memos refuse the route). Why: the memo is the swap instruction.
- Vault profiles stay blocked from swaps; phone keeps the existing LTC/DOGE multi-provider screen. Why: offline swap signing needs the coordinated Vault corrections first.

## Legacy LTC/DOGE phone flow
- `thornode.server.ts` / `swap.functions.ts` / `assets.ts` serve the phone's multi-provider screen; quotes use `liquidity_tolerance_bps` against expected after-fee output. Why: liquidity fees must not consume price protection or reject valid streaming quotes.
