# EVM swaps — nested route acceptance handoff

## Decision: NOT READY TO REOPEN
Source investigation is not third-party security approval. The unconditional gate is unchanged. Deadline pressure does not authorize unverified routes or remove device/release acceptance. No funds signed or broadcast.

## New evidence and hardening
- Executor verifies the actual prepared sender as well as chain, target, calldata and value on every signature attempt.
- Deployment checks repeat after sender preparation on every nonce attempt; session checks repeat after these awaits and approval receipts.
- 140 targeted tests pass. 18 new synthetic tests use real local viem signatures for the six outer ABI families across Ethereum, Base and BNB. These prove preservation of encoded bytes/recipient/minimum/network, NOT nested instructions or successful on-chain payout.
- Unlocked disposable-wallet browser retrieved a live 0.01 ETH→USDC quote (~23.581077 USDC at observation). Zero balance prevented submission; desktop pause remained. No page errors. Quotes change; this value is not a promise.

## Existing fixtures are not accepted executable routes
Ethereum fixture: 100 USDC→ETH. First hop calls FeeForwarder at `0xCE40449B773a3E6E5e769ADb4e567179d4828cbd`, selector `0x332d746b`, forwarding 0.25 USDC to `0xc06ebbefd94032b85424d51906e2a335efae264b`; second hop spends 99.75 USDC at `0xa929c559E5e6537359680F39CB4E3708E1a14dd1`, selector `0x3f0bde25`.

Base fixture: 0.01 ETH→USDC. Same forwarder, selector `0x0e8ae67f`, fee 0.000025 ETH; second hop spends 0.009975 ETH at `0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d`, same opaque selector `0x3f0bde25`.

Fee accounting matches 25 bps, but neither that fee policy nor recipient is authorized merely by appearing in a quote. Nordstern's embedded program, destinations, spender authority and upgrade model are not independently decoded. Current `verifyLifiQuote` validates OUTER facts only. Tests referring to “genuine routes” establish capture shape, not safe nested execution.

## Proposed narrow adapter — specification, NOT IMPLEMENTED OR APPROVED
First family: only LI.FI `swapTokensSingleV3ERC20ToERC20`, exactly one hop, no native input/output, fees, splits or intermediate steps. Supported tokens must be separately reviewed. Reject all other shapes.

SwapRouter02 `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))`, selector `0x04e45aaf`. This is NOT legacy selector `0x414bf389` with deadline. SwapRouter02 direct call has NO on-chain expiry; if expiry is required, review a bounded deadline wrapper separately.

Candidate official pins (runtime hashes/immutables/allowlist still need fresh attestation):

| Chain | Router02 | Factory |
|---|---|---|
| Ethereum | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Base | `0x2626664c2603336E57B271c5C0b26F421741e481` | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| BNB | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` |

Require callTo=approveTo=pinned router. Canonically decode/re-encode exact bytes; reject trailing bytes. Bind tokenIn/out to intent and hop assets; amountIn to exact input; recipient to LI.FI Diamond; inner minimum to outer validated quote minimum; sqrtPriceLimitX96=0 and canonical requiresDeposit=true. Review allowed tiers (candidate standard set 100/500/3000/10000), factory getPool/code/identity and runtime router/factory/wrapped-native immutables. Check LI.FI router+selector allowlisting. Unknown route must fail before allowance changes.

This proposal DOES NOT accept existing native/Nordstern fixtures. Do not invisibly substitute WETH for ETH or broaden acceptance because no compliant quote is offered. Need real provenance-recorded compliant quote captures and stateful/fork payout acceptance per enabled chain. FeeForwarder needs its own reviewed fee schedule/recipient authorization and exact conservation rules before inclusion.

## External and device blockers
1. Auditor approval of nested adapter, fee/native coverage, governance/upgrade and check-to-sign trust model.
2. Approval-only failure UI and separately consented revocation; approvals cannot automatically roll back. Not implemented.
3. Actual hostile nested/signing acceptance and fork/payout read-back, not just synthetic ABI tests.
4. Reviewed website/APK/extension artifacts and install-over preservation; separately authorized tiny funded trade with device and confirmed output.

## Demo available today
Existing shared `/wallet/evm/eth/swap` provides live quote selection without enabling execution. Desktop EVM remains paused. Use an empty disposable account, not a production seed. Earn shows live rates/read-only previews, not executable deposits. No fabricated completion, fake balance, or signing bypass has been added.

## Sources
- LI.FI pinned revision `c1e01594de237929926cec058f42ef66dea0bc82`: `src/Facets/GenericSwapFacetV3.sol`, `src/Periphery/FeeForwarder.sol`, and deployments/mainnet.json, base.json, bsc.json at https://github.com/lifinance/contracts
- Router interface: https://github.com/Uniswap/swap-router-contracts/blob/v1.1.0/contracts/interfaces/IV3SwapRouter.sol
- Official deployment documentation: https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments ; https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments ; https://docs.uniswap.org/contracts/v3/reference/deployments/bnb-deployments
- Nordstern route documentation: https://docs.nordstern.finance/swap-route — does not substitute for a deployment-matched semantic decoder.

Review `docs/evm-swap-safety-review-2026-10-24.md` and `docs/earn-review-2026-10-24.md` for unchanged boundaries. Do not open gates on the strength of this handoff alone.