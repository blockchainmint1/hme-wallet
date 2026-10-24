# EVM reviewed-route preparation — 24 October 2026

## Release decision

Execution remains unconditionally paused. No transaction was signed, broadcast or funded; no website, APK or extension release was produced. The changes below affect shared web/APK/extension source, not installed packages. Desktop retains its paused presentation. This is a preparation pack, not permission to reopen.

## Owner constraints

Reviewed routes only; no generic fallback. Honest Money charges no integrator swap fee and has no fee wallet. Network gas, pool fees and provider charges are separate. LI.FI's fee-forwarding programs do not pass the candidate route policy.

## Changes ready for independent evaluation

- `lifi-reviewed-route.ts` decodes exactly one ERC20-to-ERC20 GenericSwapFacetV3 hop, targets the chain's candidate SwapRouter02, requires the same approval router and deposit flag, canonical exactInputSingle bytes, intent-bound tokens/input/minimum, literal Diamond recipient, zero price limit, and candidate pool fee tiers. Unknown/native/fee/multihop instructions fail closed. This is NOT a complete reviewed token/pool/deployment authorization policy.
- The executor invokes this additional check on displayed and both refreshed quotes, before creating allowances or signing. The unconditional release gate remains first.
- Quote requests omit the integrator environment configuration and send fee=0. This does not remove LI.FI's own charge or certify the provider accepts this parameter.
- A public read-only server checkpoint tests `LIFI_EXECUTION_DISABLED`. Any nonempty value stops both quotes and fresh execution checks. The executor requires it before allowance reads and on each prepared signing attempt. Network failure rejects execution. This is deployment-config-driven, not an instant database-admin switch; activation on production needs deployment. Existing installed clients do not gain these calls without package updates.
- `lifi-approval.ts` supplies tested receipt-block allowance readback with one bounded block-availability retry, and a separate explicit zero-allowance revoke helper binding user/network/token/spender/prepared bytes. These are DRAFT primitives: not wired into executor receipt tracking or user recovery controls. They do not complete approval recovery.

## Verified provider blocker

At Ethereum block 26,262,538, Base block 53,027,979 and BNB block 129,514,760 on 2026-10-24 around 12:35 UTC, the LI.FI Diamond's `isContractSelectorWhitelisted(address,bytes4)` returned false for each candidate Router02 paired with exactInputSingle selector `0x04e45aaf`. The proposed alternate whitelist getter reverted. Do not substitute a router or method merely to get execution through.

Official Router02 deployment addresses and live factory/WETH9 getters matched the candidate pins. Observed runtime hashes are included in the evidence, but reproducible source/runtime equivalence is incomplete. Pool identity/liquidity/fee acceptance is incomplete. Ethereum native USDC and USDT are issuer-documented candidates; Base's ordinary USDT counterpart was not established, and BNB pegged tokens need separate custody/backing acceptance.

Fresh public Ethereum 20 USDC→USDT and Base 20 USDC→WETH quotes returned Nordstern and feeCollection, not the candidate narrow route. They reported LI.FI Fixed Fee 50,000 USDC units (0.05 USDC, 0.25% of 20 USDC), with integratorFee=0. This corrects earlier uncertainty: the evidence attributes this charge to LI.FI, not Honest Money. The narrow policy rejects those instructions regardless of labels.

## Validation

- Full suite: 263 tests in 36 files passed.
- Dedicated candidate route tests: 15 cases, including altered recipients, assets, exact input/minimum, router/spender, tier, trailing bytes and multi-hop rejection.
- Executor tests cover remote refusal before allowance reads and again at prepared signing boundary. Sender-focused tests isolate nested checks via mocks; they are not proof of real nested execution.
- Five approval primitive tests cover mined-block pinning, bounded transient retry, mismatch refusal, exact zero approval and spender substitution.
- Unlocked disposable browser wallet: `/desktop/swap?coin=eth` remained paused; shared Ethereum swap page returned a live estimate for 0.01 ETH, disabled execution for insufficient funds, and had no page errors. This is NOT a funded end-to-end acceptance test.

## Required before opening

1. An available, semantically reviewed route with no unreviewed fallback; provider cooperation or a separately designed direct exchange path may be necessary.
2. Token, pool, fee, deployment/source and provider-whitelist acceptance; real stateful payout/minimum proofs and hostile fixtures.
3. Approval receipt/recovery controls wired into the actual shared form; clear approval-left-behind warnings and explicit revoke confirmation, with fee sufficiency and delayed receipt handling.
4. Complete reconfirmation/emergency-stop acceptance and desktop shared form without preference-based spending permission.
5. Independent security approval, website/APK/extension release verification and authorized tiny funded device swap.

The public permission checkpoint discloses only service availability, no wallet or private data; it grants no authority to sign and cannot override the local gate. Runtime hashes are change evidence, not blanket governance or source attestations. LI.FI shared-Diamond balances/allowances mean outer checks alone do not prove transaction-local payout safety.