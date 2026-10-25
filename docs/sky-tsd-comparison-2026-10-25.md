# TSD / Sky Earn comparison — review handoff

## Result
TSD's public treasury frontend contains forward savings parking and reverse-USDC controls. Its actual treasury signing functions are server-side and cannot be read from the public frontend. TSD was not present among the eight accessible workspace projects. No private endpoints were invoked; no authentication, signing or payment occurred.

This wallet currently previews USDS ↔ sUSDS only. USDC conversion is missing. Reusing a working TSD backend blindly would also risk copying its reserve/hot-wallet custody model into a self-custodial wallet. Keep the user's selected wallet as the owner and recipient; never send user keys to a treasury service.

## Public TSD evidence
Observed 2026-10-25:
- https://tsd.honest.money/
- https://tsd.honest.money/assets/admin.treasury-BFndhcDn.js
- https://tsd.honest.money/assets/index-Dms8BFtZ.js

The shipped treasury UI includes “Park in TSD Vault”, “Convert hot-wallet sUSDS back to USDC”, USDC/DAI parking amounts and Ledger/hot-wallet destinations. These prove frontend intent, not the chosen ABI, exact allowance policy, bound enforcement, or successful historical transactions.

## Official Ethereum evidence
- https://developers.sky.money/guides/psm/litepsm/
- https://developers.sky.money/quick-start/protocol-token-routes/
- https://chainlog.sky.money/api/mainnet/active.json
- https://github.com/sky-ecosystem/usds-wrappers/blob/dev/src/UsdsPsmWrapper.sol
- https://github.com/sky-ecosystem/dss-lite-psm/blob/main/src/DssLitePsm.sol
- https://github.com/sparkdotfi/spark-user-actions/blob/master/README.md
- https://github.com/sparkdotfi/spark-user-actions/blob/master/src/PSMVariant1Actions.sol

Deployment registry/source evidence, NOT fresh runtime-bytecode attestation:
- USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- USDS: `0xdC035D45d973E3EC169d2276DDab16f1e407384F`
- sUSDS: `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD`
- USDS PSM wrapper: `0xA188EEC8F81263234dA3622A406892F3D630f98c`
- Core DAI LitePSM: `0xf6e72Db5454dd049d0788e411b06CfAF16853042`
- Spark USDS PSMVariant1Actions candidate: `0xd0A61F2963622e992e6534bde4D52fd0a89F39E0`

The Ethereum conversion is a same-chain swap, not a cross-chain bridge. The wrapper internally uses DAI liquidity.

## Critical contract semantics
`sellGem(receiver, gemAmt)` takes exact USDC input (six decimals), returning USDS assets (eighteen decimals). `buyGem(receiver, gemAmt)` requests exact USDC OUTPUT; its return is USDS INPUT cost, not USDC received. Neither enforces user minimum/maximum arguments. Sky explicitly documents changeable fees and no slippage protection.

With `gross = usdcUnits * 10^12` and fees in WAD:
- entry assets = `gross - floor(gross * tin / 10^18)`;
- exit cost = `gross + floor(gross * tout / 10^18)`.

The Spark action router combines the conversions but its bounds have different units:
- `swapAndDeposit(receiver, amountIn, minAmountOut)`: exact USDC input; minimum checks intermediate **USDS assets**, not final sUSDS shares.
- `redeemAndSwap(receiver, shares, minAmountOut)`: exact sUSDS shares; minimum checks final **USDC output**.
- `withdrawAndSwap(receiver, amountOut, maxAmountIn)`: exact USDC output; maximum checks USDS assets, not maximum shares.

No deadline is present. Router dependency approvals and reverse USDS dust also require review. Do not relabel its deposit bound as a final-share minimum. Existing Earn intent has a share-denominated deposit minimum, so substituting the router would weaken the confirmed promise.

## Preparation delivered
Added `src/lib/earn/sky-conversion.ts` with read-only official wrapper identities/ABI and checked bigint arithmetic for both conversion directions. No mutation ABI, signer, approval, network fetch or executor is introduced. The module is not yet connected to the page: showing an estimate must not imply availability of an accepted execution route.

Seven new tests cover zero-fee unit conversion, entry and exit fees, largest affordable exact-output redemption, rounding, halt sentinel, nonpositive outputs and overflow. Together with existing Earn tests: **27 tests pass**. The unconditional execution gate and explicit Sky refusal remain unchanged.

## Needed to finish
1. Obtain TSD's project source (project mention or a clean source export; no credentials or private keys) and inspect its server-side treasury conversion implementation. Verify actual addresses, ABIs, allowances, fee bounds and receipts rather than its visible labels.
2. Find and independently attest an existing fixed-route contract enforcing final-share minimum, or separately approve a reviewed fixed-route bounded adapter. Do not deploy a new adapter or lower user guarantees implicitly. Reverse `redeemAndSwap` is a candidate, not an accepted route.
3. Preserve self-custody with selected-wallet ownership, exact per-step approvals, session checks and prepared-byte binding. Clearly bind tokens and units to each direction.
4. Complete original Earn review blockers: deployment/upgrade proof, gas and ETH sufficiency, protocol-specific receipts, approval recovery, malicious signing fixtures, independent audit, tiny funded deposit AND redemption, website/APK/extension release/device checks.

## Scope
No screen, wallet storage, key derivation, backend, live release, APK or extension changed. No funded success flow verified. Existing shared execution remains closed across all builds. This is investigation and tested arithmetic preparation, not clearance to spend.