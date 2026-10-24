# Honest Money — Actual LI.FI route investigation

## Decision and scope

Bobby chose actual-route review on 24 October 2026: preserve semantic route review, no opaque fallback, and no Honest Money integrator fee. Execution and Vault swaps remain closed. No publication, APK/extension build, funded transaction or signature occurred. Changes affect the shared source used by web, APK and extension; installed packages have not changed.

## Implemented preparation

- Added `lifi-route-allowlist.ts` and tests. This supplements mandatory nested review; it does not replace it. Call/selector permissions are read from the pinned Diamond at a single observed block. Distinct spenders require `0xffffffff`, matching the pinned facet. Single-native input does not create an approval-only check. RPC/network failure refuses permission.
- Wired these compatibility checks into the shared executor for the displayed quote and both refreshed snapshots, before allowance reads for the initial/pre-approval route. Existing gate, exact intent, prepared bytes, session/deployment and server checks remain intact.
- Added `nordstern-inspection.ts` with captured-header tests. This is a read-only parser, not an accepted route adapter; the complete executor program remains explicitly unreviewed. It is not called to grant execution permission.
- Updated architecture guidance and roadmap; preserved all existing spending restrictions.

## Verified actual-route findings

### Ethereum and Base Nordstern

The captured selector `0x3f0bde25` invokes `IceCreamSwap()`. Although its ABI has no arguments, its source parses appended packed bytes. Ordinary ABI round-tripping cannot authorize this program.

Deployment-specific guard source was recovered from Ethereum Blockscout and BaseScan. Sources show a calldata-selected external executor, not a guard-fixed executor. The Ethereum source interface differs from Base; matching function selectors do not prove equivalent deployment semantics.

| Absolute byte range | Meaning |
| --- | --- |
| 4–5 | 16-bit route ID |
| 6–25 | Executor address |
| 26–41 | 128-bit input amount |
| 42–57 | 128-bit minimum output |
| 58 | Executor header byte, ignored by guard |
| 59–78 | First input-token receiver |
| 79–98 | Output recipient |
| 99–118 | Input token |
| 119–138 | Output token |
| 139 onward | Executor-specific program |

The guard calls `executor.executeSwap(msg.data[26:])`, forwarding native value. For ERC20, it pulls from its caller to the calldata-selected first receiver. It measures the selected recipient's output balance delta and enforces the packed minimum. Neither that delta check nor the guard's LI.FI allowlist membership authenticates arbitrary executor semantics.

| Captured fact | Ethereum | Base |
| --- | --- | --- |
| Guard | `0xa929c559E5e6537359680F39CB4E3708E1a14dd1` | `0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d` |
| Executor / first receiver | `0xe6eeda550918638529c6cf2ea14f9ea0572d6f88` | `0x939e398d2c31b0757d009222de99c6e461d3de15` |
| Post-fee input | 99,750,000 USDC base units | 9,975,000,000,000,000 wei |
| Packed minimum | 40,352,724,097,967,460 wei | 24,420,841 USDC base units |
| Packed recipient | LI.FI Diamond | LI.FI Diamond |
| Program length including header | 215 bytes | 513 bytes |

**Decisive missing evidence:** no usable deployment-matched verified source and complete instruction grammar were recovered for those two executors. This is not proof such source does not exist; verification lookup failures are recorded. Their proxy/admin/configuration/callback/approval models remain unresolved. No address-shaped sequence in the tail has been guessed into an approved pool or recipient.

### Provider fees

Official pinned FeeForwarder source canonically decodes the captured fee calls:

- `0x332d746b`: `forwardERC20Fees(address,(address,uint256)[])`.
- `0x0e8ae67f`: `forwardNativeFees((address,uint256)[])`.
- Captured Ethereum: 100 USDC gross = 0.25 USDC provider fee + 99.75 USDC exchange input.
- Captured Base: 0.01 ETH gross = 0.000025 ETH fee + 0.009975 ETH exchange input.
- Public BNB quote: 0.01 BNB gross = 0.000025 BNB fee + 0.009975 BNB exchange input; API reports zero integrator fee and LI.FI fixed fee.

All observed distributions pay `0xc06ebbefd94032b85424d51906e2a335efae264b`. Repeated calldata and API labels are not independent recipient authorization. Need official chain-specific recipient/schedule/rounding provenance before admitting the fee hop. Do not assume the observed 25 bps is permanent or universal.

Native FeeForwarder receives gross value and refunds the net remainder to its caller (the Diamond). ERC20 forwarding pulls only distributions directly from its caller; it does not custody/refund the remaining gross input. The source intentionally does not authorize recipients; local policy must. Downstream maximum approvals and unsupported token semantics remain important.

Live FeeForwarder runtime observations on all three chains matched `0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74`, 3037 bytes. These latest/batched RPC observations are consistency evidence, not pinned-block reproducible source equivalence. BNB source verification could not establish a match. Do not pin this hash as approval without independent attestation.

### BNB is a separate adapter review

A newly obtained public 0.01 BNB → `0x55d398326f99059fF775485246999027B3197955` quote uses FeeForwarder followed by **SushiSwap Aggregator**, not Nordstern:

- `callTo = approveTo = 0xAC4c6e212A361c968F1725b4d055b47E63F80b75`.
- Selector `0x5f3bd1c8`, input 9,975,000,000,000,000 wei.

This capture does not establish the pegged token's backing, runtime equivalence, nested program semantics or safety. Ethereum/Base review cannot enable BNB by analogy. Other quotes may choose other adapters.

## Source request to LI.FI / Nordstern

Please provide deployment-matched verified Solidity/source packages, compiler settings, runtime and creation evidence, complete packed-program decoder and instruction specifications for:

1. Ethereum executor `0xe6eeda550918638529c6cf2ea14f9ea0572d6f88` behind guard `0xa929c559E5e6537359680F39CB4E3708E1a14dd1`.
2. Base executor `0x939e398d2c31b0757d009222de99c6e461d3de15` behind guard `0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d`.
3. Any proxies, upgrade/admin paths, mutable target/configuration controls, callback validation, allowance/Permit2 behavior and surplus/refund instructions used by these captured programs.
4. Official chain-specific authorization for LI.FI fee recipient `0xc06ebbefd94032b85424d51906e2a335efae264b`, applicable input-fee schedule and integer rounding; confirm zero integrator fees with no integrator parameter.
5. A way to request only the independently reviewed program subset and fail without silently selecting another adapter.

For BNB, separately provide the deployment-matched Sushi adapter `0xAC4c6e212A361c968F1725b4d055b47E63F80b75` selector `0x5f3bd1c8` program specification and dependencies.

No request has been sent externally by this investigation. These are public addresses, not signing keys.

## Remaining acceptance tasks

1. Recover and independently review executor source/program grammar and chain-specific runtime/configuration dependencies.
2. Implement a narrow full-program decoder, intent-bound tokens/amounts/minimum/recipient/fees/refunds/pools and canonical encoding; reject all unknown instructions. Header parsing is insufficient.
3. Independently authorize provider recipient/schedule, then bind the exact decoded fee to immutable user consent and review-screen disclosure. Preserve zero HME fee.
4. Wire receipt-block approval readback, pending/unknown/confirmed tracking and separately consented recovery/revocation; finish freshness/reconfirmation and bounded emergency-stop acceptance.
5. Run hostile program mutations and stateful/fork payout/conservation/allowance tests per accepted chain, including ambient Diamond balances.
6. Independent audit acceptance, reviewed desktop/shared form availability, website and actual APK/extension release artifacts and explicitly authorized tiny funded device payout verification.

These are real blockers; more header checks cannot manufacture the missing executor evidence. No executable Nordstern/Sushi subset is approved today.

## Validation

- Full suite: **280 tests in 38 files passed**, including 17 added checks. Existing 263 tests remain green.
- Unlocked isolated disposable-wallet browser: desktop EVM pause retained; shared Ethereum form returned a live 0.01 ETH → 23.597808 USDC estimate at observation, insufficient funds prevented execution, zero page errors. Quote value is not a promise.
- Browser checks cover presentation/quote availability only, not funded payout or native-device signing. Gate tests verify no approval or sender calls while paused.
- Harness build status was clean after compatibility/parser changes; no manual builds/typechecks or APK/extension packaging were run.

## Provenance

- https://docs.nordstern.finance/contracts
- https://docs.nordstern.finance/swap-route
- https://eth.blockscout.com/api/v2/smart-contracts/0xa929c559E5e6537359680F39CB4E3708E1a14dd1
- https://basescan.org/address/0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d
- https://github.com/lifinance/contracts/blob/c1e01594de237929926cec058f42ef66dea0bc82/src/Periphery/FeeForwarder.sol
- Prior review: `docs/evm-unstick-decision-review-2026-10-24.md` and `docs/evm-reviewed-route-progress-2026-10-24.md`.

This is an investigation and auditor handoff, not third-party release approval.