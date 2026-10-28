# Honest Money — direct THORChain USDC-to-BTC preparation

## Status and owner impact
Prepared a desktop **quote-only** route at `/desktop/swap?coin=usdc-eth` and `?coin=usdc-base`. Bobby cannot yet send USDC through this new route. No publishing, allowance, signature, order, broadcast, wallet migration or backend schema change occurred. Phone UI is unchanged; shared protocol code and safety checks travel with web/APK/extension source, but existing packages have not been rebuilt.

## TSD Bridge comparison
Read-only TSD Bridge snapshot: project 4a8d8fb2-f8a1-4461-aacb-1372a91b70c7, commit 79fced51. Its `thorchain.server.ts`, `native-provider.ts`, `native-deposits.server.ts` and `native-chain.server.ts` implement server-held native LTC/DOGE to Base USDC, not self-custody USDC-to-BTC. Borrowed protocol ideas, not custody, private keys, database records or source assets. No direct conversation with its maintainers was performed.

## Candidate contracts, not deployment attestations
Live THORNode inbound and quote responses on October 28 identified:
- Ethereum USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; router candidate `0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146`.
- Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; router candidate `0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4`.
Token addresses corroborated against TSD Bridge source. Router addresses were observed from live protocol responses, **not** independently source/bytecode/upgrade verified. A changed candidate fails closed. An inbound address is dynamic, never a pinned recipient.

## Changes
- Strict server input validation; fixed protocol node list, redirect refusal, timeout, streamed one-megabyte response cap and schema validation.
- Current source/BTC inbound pause flags and Available pools required; missing pause fields rejected. Quote vault/router must match inbound response.
- Bigint USDC six-decimal to THORNode eight-decimal conversion. BTC outputs retained as integer satoshi strings.
- Native USDC only on Ethereum/Base, Bitcoin mainnet address validation, exact destination, positive output, requested 1% after-fee threshold and exact `/1/0` automatic streaming memo. No affiliates, extra memo fields or provider fallback.
- Sixty-second quote freshness and sixty-second expiry margin. Edited fields, switched profile/network, and stale asynchronous responses clear or discard the old quote.
- Unsigned candidate builders for exact `approve(router, rawAmount)` / zero reset and `depositWithExpiry(vault, token, rawAmount, memo, expiry)` at zero native value. These are audit material only, not connected to signing.
- Disabled payment control and separate unconditional execution refusal. LI.FI, Earn and Vault pauses remain untouched.

## Verification
- 46 targeted tests passed: 31 new protocol tests, 6 new public quote tests, 2 existing THOR quote tests, 2 Vault policy tests, 5 provider-selection tests.
- Preview build log is clean.
- Actual desktop route unlocked with a disposable encrypted test wallet. Both networks returned live quotes for 1,000 USDC using a public fixture BTC address (not Bobby's address). Final fresh run: Ethereum estimated 0.01231618 BTC, requested minimum 0.01219301 BTC, protocol fee 0.00003562 BTC, estimated 30 seconds; Base estimated 0.01230080 BTC, minimum 0.01217779 BTC, protocol fee 0.00003614 BTC, estimated 102 seconds. These are time-specific estimates, not offers for Bobby's swap.
- Invalid EVM destination visibly refused; editing clears old quote; network switch remounts form; payment control disabled. Zero transaction submission requests, zero page errors. Screenshots inspected at 1280 × 1800.
- Independent read-only reviewer confirmed no spending side effects and raised input-echo limitation, broad streaming acceptance and overconfident minimum wording. Exact `/1/0` enforcement and precise quote-only wording applied and retested. This internal review is **not** required external audit sign-off.

## Important limitations / gates before sending
1. THORNode does not echo the requested source amount in this response. Request binding is transport/request context, not an independently attested output guarantee; UI discloses this. Memo minimum is verified against quote fields, not proof of final economic execution.
2. Independently verify router source, deployment bytecode, token/proxy behavior, upgrade model, memo enforcement, pause logic and current network chain ID. Merely fetching a router is not authorization.
3. Implement a dedicated locally signed executor: immutable amount/token/router/vault/BTC destination/minimum/expiry, fresh session and active profile guards, current inbound/pause/pool checks before every approval/signature/broadcast, prepared-byte verification on nonce retries, simulation and per-step gas budget.
4. Exact allowance normalization, confirmed reset/approval receipts and allowance read-back, plus recovery/revocation UX if approval succeeds and deposit fails. Never repeat a potentially broadcast deposit blindly.
5. Track approval vs inbound deposit separately and match protocol status/outbound BTC to the exact submitted intent; distinguish actual refunds on source network from BTC payouts.
6. Hostile execution/session/deployment/nonce/approval/refund tests, independent third-party audit, then a tiny funded desktop/device acceptance test using a real controlled destination. Only after those gates consider publication and package rebuilds. No production enable switch is implemented here.

## Audit source map
- `src/lib/thorchain/usdc-btc.ts`, `.test.ts`, `.server.ts`, `.server.test.ts`, `.functions.ts`, `AGENTS.md`
- `src/components/desktop/ThorUsdcBtc.tsx`, `src/routes/desktop.swap.tsx`
- Existing guard context: `src/lib/security/AGENTS.md`, `execution-policy.ts`, `vault-swap-policy.ts`, `src/lib/chains/evm-send.ts`, root `AGENTS.md`.

This delta is preparation for evaluation, not a full release-source export or a ready-to-send security claim.