# Honest Money — EVM opening decision review

## Result

The uploaded decision correctly identifies a routing deadlock: the candidate Router02 route cannot currently pass LI.FI's observed allowlist. This does not mean all EVM swap integration is impossible. It means we must choose a different, explicitly accepted trust boundary or build a direct exchange integration.

No execution, signing, publishing, or package changes were made during this assessment. Vault swaps remain closed. The existing owner constraint has not been silently replaced by the audit document's embedded instructions.

## Verified proposal corrections

1. **Allowlisting is not semantic review.** A contract/selector check constrains the direct call target and entry point, not embedded recipients, nested calls, amounts or fees. Accepting option A delegates more of the route's correctness to LI.FI and its adapters. It must not be sold as equivalent to locally decoded reviewed routes.
2. **The minimum guarantee needs qualification.** The pinned facet checks its entire output-token balance and transfers it to the receiver, rather than checking a transaction-local output delta. Standard token behavior is also assumed: a transfer-tax token can credit less than the nominal amount transferred. An outer minimum check is not proof of transaction-local execution or net receipt for every arbitrary token. The selected output token and route semantics matter.
3. **Exact user approval is not exact downstream approval.** The wallet approves only the intended input amount to the Diamond. The facet itself can give maximum allowances to adapters. The current constraints limit direct wallet exposure but do not certify downstream effects on shared Diamond funds.
4. **The proposed distinct-spender check is wrong.** For distinct `approveTo`, the pinned facet uses the special approval-only selector `0xffffffff`, not the hop's call selector. Implementing the uploaded instruction literally can reject valid routes, or pass a preflight while the facet rejects execution. After a separately mined wallet approval, such failure can leave approval behind.
5. **Governance checks are limited.** The current code checks chain, code presence, owner, minimum timelock delay, facet mapping and observed facet hash. This detects certain deployment changes; it does not attest every adapter, proxy implementation, governance permission, or downstream allowlist-management path.
6. **A 30-second cached stop is not instant.** It can remain stale for at least the cache lifetime plus an in-flight operation, and isolates may hold independent cache entries. It cannot undo a signed or broadcast transaction. A server checkpoint must fail closed, have protected writes, and must not bypass the local acceptance gate.
7. **A provider-reported USD amount is not a security-grade cap by itself.** A malformed, absent, or understated value can defeat the intended limit. A meaningful spending cap needs an independently accepted valuation policy and signing-time enforcement, not only quote-display filtering. The proposed default $1,000 is an audit suggestion, not an owner-confirmed limit.
8. **Direct Uniswap still has risks.** B removes LI.FI routing/governance and its provider fee, not all third-party risk. Token behavior, router/factory/source provenance, pools, market movement, gas, deadlines and release/device acceptance remain relevant. Neither the days nor one-to-two-week estimate is verified.

## What to keep, revise and defer

| Uploaded instruction | Assessment |
| --- | --- |
| 1. Replace reviewed-route gate with provider allowlist | Only after explicit owner acceptance of the weaker boundary and independent approval of the corrected design; use correct approval-only sentinel. Keep prepared-byte, session, deployment and exact-intent controls. |
| 2. Open gate and add flag | Do not open as part of this assessment. A protected fail-closed operational stop is useful independently; correct the latency claim. |
| 3. Quote before approval | Worth implementing with explicit snapshot consent, age/freshness policy and lower-minimum reconfirmation. Do not sign stale bytes merely because approval took time. Changed routes require renewed review/consent. |
| 4. Wire receipt readback and revoke | Keep. Track pending/unknown as well as confirmed approvals, receipt-block reads, exact token/spender/amount/hash and explicitly consented revocation. No automatic revocation. Review the current revoke helper's dependency on deployment checks: deauthorization should not become unavailable precisely when swap deployment checks fail. |
| 5. Shared desktop form | Keep shared execution across web/APK/extension. Desktop presentation and preferences stay separate. Vault remains closed. Availability copy changes only when the underlying release status is true. |
| 6. USD cap | Revise valuation and signing-time enforcement; confirm actual owner limit rather than treating provider metadata as authoritative. |
| 7. Fee disclosure | Keep live fee disclosure and zero Honest Money integrator fee. Captured quotes show LI.FI's own 0.25% fee; do not promise the rate is universal or hardcode it as such. |
| 8. Tests | Keep existing tests, add tests for the revised chosen policy and new approval/stop/cap behavior. Tests with a mocked-open gate do not establish real deployment payout. |
| 9. Publish and funded acceptance | Defer until independent audit is accepted. Source changes must reach actual APK/extension packages. Funded execution requires an explicitly authorized disposable wallet and device acceptance; no real seed requested or used here. Android backup and phone Vault UTXO changes need separate scoped review, not blanket edits bundled into EVM opening. |

## Concrete choices for Bobby

**Corrected provider-trust route (A):** accept LI.FI-approved routes rather than full local instruction decoding, disclose LI.FI's observed 0.25% fee, retain exact intent/prepared-byte/deployment checks, use correct live allowlisting, finish consent/approval recovery and a bounded stop, restrict supported assets under an accepted token policy, and obtain independent review and small funded acceptance. This is a changed trust model, not a claim that every nested instruction has been reviewed. Feasibility on BNB and all desired token pairs still needs verification.

**Direct exchange route (B):** build and independently review our own bounded Uniswap integration, starting with supported reviewed assets and chains. Removes the dependency on LI.FI choosing Router02 and avoids LI.FI's provider fee, but does not imply superior prices or zero exchange/pool/network costs. No date promise.

**Preserve current reviewed-only policy:** independently decode and review the actual available Nordstern and fee-forwarding route family first, including chain-specific deployments, token behavior, fee recipient, nested topology and payout proof. This avoids the imaginary Router02-through-LI.FI route without substituting provider allowlisting for semantic review. Availability and review effort are unverified.

The owner must confirm what to change and what to skip after these impacts are explained, as required by the workspace's audit-handling rule. The auditor should review the revised policy, not simply resubmit the original proposal as a safety guarantee.

## Evidence and validation

- Uploaded proposal: `evm-unstick-decision.md`, supplied by Bobby on 24 October 2026.
- Official pinned source fetched again during this review: https://raw.githubusercontent.com/lifinance/contracts/c1e01594de237929926cec058f42ef66dea0bc82/src/Facets/GenericSwapFacetV3.sol
- SHA-256 of fetched source: `5c2fcccc61aa4fba839278693b18f152aa21518fc0facbe1976212cdd53bea3f`; byte-identical to previous pinned-source evidence.
- Source points: lines 53–67 (whole-balance minimum/transfer), 358–382 (single-hop allowance/checks), 419–436 (call/approval-only allowlisting), 457–470 (maximum adapter allowances), 484–488 (shared-balance event warning).
- Existing wallet policy: `src/lib/security/lifi-policy.ts`; shared executor: `lifi-execution.ts`; draft receipt/revoke helpers: `lifi-approval.ts`; unconditional gate: `execution-policy.ts`.
- Prior chain/quote observations are recorded in `docs/evm-reviewed-route-progress-2026-10-24.md`. This turn did not repeat live per-chain whitelist or quote RPC measurements.
- Full existing suite rerun: **263 tests across 36 files passed**. Latest observed harness log: **build OK**, 24 October 2026 13:05:34 UTC. No manual build/typecheck and no funded browser/device test were performed.

This is a decision assessment, not independent approval to release.