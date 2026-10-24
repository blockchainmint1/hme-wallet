# Honest Money direct Earn preparation — NOT CLEARED FOR SPENDING

## Scope and status
Desktop Ethereum-only Sky USDS/sUSDS and Aave USDC/aEthUSDC positions and previews are implemented. Phone preferences and screens are unchanged. The executor is a preparation draft, NOT production-ready. No funds moved, no approval signed, no publish or package build performed. No cross-chain bridge, Vault signing or USDC→USDS conversion was added.

`src/lib/earn/protocols.ts:assertEarnExecution` unconditionally throws before any RPC/signing side effect. `DESKTOP_EARN_EXECUTION_ENABLED` remains false. Sky has a second explicit executor refusal: its basic ERC-4626 ABI lacks atomic minimum-output enforcement. Do not remove these gates based on passing preview tests.

## Implemented
- Fixed Ethereum identities from official Sky and Aave address book; runtime chain/code/decimals/underlying checks; Aave pool provider and receipt identities checked.
- Public-only address derivation for desktop display, checked against canonical Ethereum test address.
- Live balances, sUSDS share value/SSR annualized rate, Aave liquidity-rate APY. Rates are variable and do not promise returns.
- Sky limits/preview reads; Aave active/frozen/paused bits, liquidity and existing-debt exclusion.
- Exact supply/deposit/redeem/withdraw ABI construction. Draft normalizes allowance to exact amount (reset first when nonzero), checks receipt status and allowance read-back.
- Draft guards immutable intent, sender/chain/target/data/value and current wallet session at pre-sign attempts and after receipt. Post-send balance checks are diagnostic, NOT definitive receipt proof.
- Snapshot-based review-only dialog with locked action/amount/symbols; bigint display avoids balance conversion to floating point. Unquoted fees explicitly marked.

## Evidence
Official references: https://developers.sky.money/protocol/tokens/susds/ ; https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol ; https://aave.com/docs/developers/smart-contracts/pool ; https://developers.sky.money/guides/psm/litepsm/ . Runtime identity checks are change detectors, not full proxy/upgrade security attestations.

Live read-only Ethereum checks on 2026-10-24: both runtime identity checks pass; Sky APY about 3.80%, Aave USDC about 3.93% at observation (not fixed rates). Unlocked disposable-wallet browser at /desktop/earn renders both, rejects 100 USDS with zero available balance and switches to withdrawal. No page errors. Funded success path and device signing remain UNVERIFIED.

Targeted test output is included. Tests cover production gate before any side effect; exact call amounts/recipients; invalid amounts/protocols; network/code/underlying/decimal/provider changes; limits, output preview floor, debt and paused reserves; withdrawal liquidity; deterministic public-address derivation. These do NOT certify dormant execution approval/signing/receipt paths. Shared security and desktop preference/history tests also run.

## Blocking acceptance work — reviewer decisions required
1. Sky deposit/redeem has no min-output argument. Design and independently review an atomic bounded route before signing can be exposed. LitePSM USDC conversion has changeable fees and documents no slippage protection; not implemented.
2. Aave supply may auto-enable collateral. Agree explicit collateral policy and confirmation. Existing debt is excluded from previews. Do not blindly auto-disable collateral or change borrowing positions.
3. Replace generic wallet-wide output deltas with transaction-specific, protocol-correct receipt evidence. Aave interest accrual/concurrent transfers can falsify deltas; “receipt success” alone proves transaction inclusion, not promised receipt. Do not retry uncertain outcomes.
4. Add per-step reset/approval/deposit fee estimates and ETH sufficiency; show residual-approval risk and failed-transaction gas cost. Current UI truthfully says fees not quoted.
5. Add hostile executable signing tests for every sender attempt, exact approvals/read-back/reset failures, session changes, wrong recipient/network, reverted receipt and misleading balance changes. Current production-gate test must remain.
6. Review live upgrade model/proxy implementations and dependencies. Address checks alone are not full attestation.
7. Independent review followed by tiny funded deposit AND withdrawal; verify actual balances and allowances, then website/APK/extension release acceptance. This preparation shares logic across builds but no artifacts were built.

## How to review
Read root and scoped AGENTS; inspect src/lib/earn, src/components/desktop/EarnAsset.tsx, src/routes/desktop.earn.tsx, src/lib/chains/evm-send.ts and desktop policy. Run `bunx vitest run src/lib/earn src/lib/security src/lib/desktop`. Do not enable gates or sign funds as part of source review. Evaluate proposed fixes against existing behavior before implementation.