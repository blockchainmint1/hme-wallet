# Honest Money EVM swap safety preparation — 24 October 2026

## Release decision

**NOT CLEARED TO ENABLE OR PUBLISH.** LI.FI execution remains unconditionally paused. This is a preparation/hardening pack, not a completed swap acceptance certificate. The old review's statement that calldata/spender are completely unverified is superseded by the current source; the important remaining gap is **nested executable route semantics**.

## Implemented

- One shared executor called by the existing web/APK/extension EVM swap screen; desktop remains explicitly paused.
- Snapshot quotes and consent before asynchronous work. Preserve the exact displayed minimum; remove the extra 0.5% silent weakening.
- Validate a refreshed quote before allowance changes, and again after approval before the swap.
- New approvals encode the precise input amount and pinned Diamond. Existing excess allowances are reset and normalized to that amount. Reset and approval receipts must succeed; resulting allowance must read back exactly.
- Simulate approvals and swaps; no fallback to provider gas on failure.
- Optional shared-sender pre-sign hook runs on **every nonce attempt**, checking prepared chain/target/calldata/value and active wallet session. Ordinary sends have no hook and retain their behavior.
- Runtime deployment checks: RPC chain, Diamond code, owner, timelock code and minimum 10,800-second delay, all six selector-to-facet mappings, observed facet runtime hash.
- Provider responses: 15-second timeout, redirect refusal, JSON-only, 512 KiB streaming cap, bounded validated numeric/address/calldata fields before display.
- Single ERC20 swap accounting follows the actual contract's unconditional pull, even when requiresDeposit=false.

Wallet envelopes, profile storage, signing certificates, Android IDs and site grants are unchanged. Vault swaps, Earn, Relay and external EIP-712 signing are not enabled.

## Verified evidence

`bunx vitest run src/lib/security src/lib/desktop/preferences.test.ts`: **84 tests, 12 files pass**. This includes 17 executor tests, 21 quote-policy tests, 7 deployment rejection tests, 5 response tests, 3 actual-sender tests and wallet-preservation/other security regressions.

Executor tests mock the release gate open **inside test modules only**; production code has no bypass. Executor sender spies establish ordering and exact approval payloads. Separately, a public disposable key signs a real local viem approval, decoded to check chain 1, USDC token, pinned Diamond, 100 USDC and zero value; recovery matches the test account. Guard rejection produces zero local signatures/broadcasts, and nonce retry repeats the guard. No real RPC broadcast or funded transaction occurs in these tests. This is not full all-family signed swap/device acceptance.

Unlocked isolated browser: desktop Ethereum option remains paused at `/desktop/swap?coin=eth`; shared Ethereum swap form renders after client navigation without losing unlock; no page errors. Empty wallet only, no funded trade. Latest harness build reports build OK.

`bun scripts/verify-lifi-deployments.ts` is a reproducible read-only check. Evidence JSON records 2026-10-24 11:35 UTC snapshots: Ethereum block 26262243, Base 53026203, BNB 129506869. All three match the official pins and observed runtime hash. Provider-family limitations apply; no build-to-bytecode attestation.

Official revision: `lifinance/contracts@c1e01594de237929926cec058f42ef66dea0bc82`:
- https://github.com/lifinance/contracts/blob/c1e01594de237929926cec058f42ef66dea0bc82/deployments/mainnet.json
- https://github.com/lifinance/contracts/blob/c1e01594de237929926cec058f42ef66dea0bc82/deployments/base.json
- https://github.com/lifinance/contracts/blob/c1e01594de237929926cec058f42ef66dea0bc82/deployments/bsc.json
- https://github.com/lifinance/contracts/blob/c1e01594de237929926cec058f42ef66dea0bc82/src/Facets/GenericSwapFacetV3.sol

## Blocking acceptance work — reviewer must address explicitly

1. **Nested calls:** outer SwapData declares assets/amounts but callTo, approveTo and inner callData are not semantically authorized. The new code exposes these fields and checks callable shape only. Do not mistake that for route validation. Current nordstern/fee fixtures demonstrate why generic routing cannot be declared safe just from an outer ABI. Specify a narrow route-adapter set, independently pin relevant targets/approval targets, decode inner recipients/amounts/deadlines/fees and enforce topology. Unknown routes must stay blocked. Never remove pause while this remains open.
2. **Upgrade model:** runtime facet hash/routing detects known changes but does not pin full Diamond/timelock bytecode, authority-role membership, allowlist configuration or eliminate changes between checks/signing. Review additional attestations and residual trust explicitly.
3. **Approval-only failure:** an approval mined before a final route rejection stays on-chain. No automatic rollback/revocation is claimed. Before reopening, provide an understandable approval-only outcome and a separately consented revoke path; gas and allowance normalization UX need review.
4. **Full acceptance:** add BNB realistic capture provenance, all accepted families, downstream malicious targets/calldata/fees, actual signed swap-byte tests and stateful/fork simulation with payout read-back. Existing fixtures are realistic shapes, not certified successful swaps.
5. **Delivery:** independent approval, website release and freshly reviewed APK/extension packages, install-over wallet preservation and separately authorized tiny funded real-device swap. None done this turn. No APK/extension artifacts built and no production release requested.

## Auditor request

Review current source, especially lifi-policy/execution/response and the shared sender's optional hook. Challenge the assertions above; do not merely run the tests or use past successful swaps as proof. Return severity, concrete attack, affected paths and proposed corrections. Do not request secrets/production seeds. Preserve the release gate and mobile/desktop preference separation. Bobby must confirm any audit-directed behavior changes before they are applied.