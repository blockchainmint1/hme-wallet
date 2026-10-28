# Vault THORChain preparation — independent review handoff

Date: 2026-10-28. Status: **PREPARATION ONLY — NOT RELEASE APPROVAL**.

## Owner summary

Desktop Cold Storage profiles can obtain THORChain quotes using their paired public addresses, prepare unsigned requests, display animated QR codes, and check returned signatures. This flow cannot send transactions. The current HME Vault signer explicitly refuses THORChain memos, ERC-20 approvals and router deposits. HME Vault must implement and independently review coordinated support before real swaps are possible.

## Source reviewed

- Honest Money current working source included in this archive.
- HME Vault read-only snapshot, commit `5b3dde71`, project `954a8d62-2653-447a-8d15-1cbcf445b17d`.
- Vault `src/lib/signer/psbt.ts:validateDataOutputs` refuses unknown data/THORChain memos.
- Vault `src/lib/signer/evm.ts` strictly accepts only native-transfer and erc20-transfer under hm-evm-tx v1.
- No changes were pushed into HME Vault. Snapshot excerpts are included for context, not a replacement Vault source audit.

## Changes and boundaries

- `src/components/desktop/VaultThorSwap.tsx`: dedicated profile-scoped quote/preparation/check flow. Paired EVM address and paired UTXO receive address #0 are used, never the online profile's random wrapping anchor. Quotes may target a pasted custom destination. Catalog selectors show assets with paired addresses; route liveness still comes from server catalog.
- `src/components/desktop/ThorSwap.tsx`: Vault branch uses the review flow. Local-root source/destination scans, balance reads, quoting and send handler are disabled for Vault/watch-only modes. Hot-wallet behavior otherwise unchanged.
- `src/lib/vault-link/thor-swap.ts`: new isolated preparation and signed-result verifier. No broadcast call, executable acceptance toggle, WalletClient adaptation, private key access or wallet storage write.
- Transfer-only hm-evm-tx unchanged. Proposed hm-thor-swap v1 is intentionally incompatible with current Vault; it is not an agreed protocol.
- Phone LTC/DOGE Vault swap gate, LI.FI execution gate and Earn gate unchanged. Shared logic ships through the web/APK/extension source; no APK/extension artifacts rebuilt and nothing published.

## UTXO request layout

Sources: BTC, LTC, DOGE. Frozen quote is locally checked for exact raw/THOR-unit amount, destination, minimum, no affiliate fields, freshness and 80-byte memo limit. Quote's inbound is address-validated; its live authenticity still depends on the existing server-side catalog validator.

Inputs are largest-first paired UTXOs. Derivation path, pubkey, address, unique txid/vout and safe values are checked. Fetch only selected previous transactions, including SegWit inputs, and verify each txid, exact output script and value. Every input explicitly uses SIGHASH_ALL.

Output order:

1. Exact quote amount to THORChain inbound.
2. Change (if non-dust) to the **first selected input address**, with its derivation metadata.
3. One zero-value OP_RETURN carrying the exact memo.

Refund address displayed separately from payout. Refund ownership follows first-input holder. Fee rate must be below fixed Vault caps (BTC/LTC 5,000; DOGE 1,000,000 raw units/vB); absorbed dust is checked against an intentionally conservative unsigned-size bound. DOGE preparation treats change under 1 DOGE as dust. These are implementation assumptions for independent review, not owner-supplied amounts. Request Base64 cap: 250,000 characters. Bounded Base64 encoding reused.

Returned raw transactions must match frozen PSBT version, locktime, every input/sequence and every output. Additionally verifies genuine ECDSA SIGHASH_ALL for P2PKH, wrapped P2WPKH and native P2WPKH; pubkeys must match paired inputs. Tests cover genuine BTC SegWit and DOGE legacy signatures plus fake signatures and changed outputs. LTC/wrapped-SegWit physical acceptance is still outstanding.

## Proposed EVM protocol — for discussion with Vault

Request is JSON:

```text
format: hm-thor-swap
v: 1
fp, path
action: approval-reset | approval | evm-deposit
quote: full frozen ThorCatalogQuote
transaction: from, chainId, nonce, to, value, data, gas,
             type, gasPrice OR maxFeePerGas + maxPriorityFeePerGas
```

Sources: ETH/Base ETH/BNB, catalog USDC/USDT contracts. Router pinned to existing catalog values. DepositWithExpiry calldata rebuilt from quote. If token allowance differs from exact input, prepare zero-reset when nonzero, otherwise exact approval. Exact allowance prepares deposit. Token/native balance, pending nonce, estimated gas and fees read from paired sender. Signed result recovers sender and matches chain/nonce/target/value/calldata/gas/type/fees; nonempty access lists refused.

**This is not a complete multi-transaction sending workflow.** There is no approval broadcast, confirmation wait, automatic next step or deposit submission. Re-preparation reads allowance again but does not establish safe execution. Final coordinated implementation must resolve approval partial completion and quote expiry without silently changing intent, protect fee bounds, and reject unsupported envelope extensions.

## Checks performed

- Full project: **486 tests in 53 files pass**.
- Preview build/type checks: latest recorded build OK.
- Browser: fresh isolated context, synthetic encrypted Vault profile, inline unlock on /desktop/swap, real THORChain 1,000 USDC→BTC quote, paired BTC address autofill.
- Browser preparation used intercepted EVM RPC reads with synthetic allowance/balance/nonce/fee data, rendered approval-reset QR, verified no Confirm-and-send control, returned to quote; **zero broadcasts, zero runtime errors**. This is not a funded acceptance test.
- Existing QR player pause/back/forward/part selection retained; scanner reuses actual collected-piece indexes and recoverable progress. New scanner return verification tested in unit tests, not physically exercised.

## Required before enabling real swaps

1. Agree a strict versioned EVM semantic protocol with HME Vault; reconstruct deposits/approvals offline from bounded fields rather than authorize arbitrary calldata. Pin and display chains/contracts/routers; bind the review to signing bytes and seed.
2. Vault UTXO review must decode supported swap memos and show source amount, payout asset/address/minimum, refund holder, fees, expiry limitation and deposit/change/memo ordering. Unknown instructions must remain refused. Offline Vault cannot independently prove live inbound authenticity; decide an explicit trust/attestation model.
3. Add fresh online revalidation before **each actual broadcast**: profile/pairing/session, quote expiry, current pools/halt flags/inbound/router, every UTXO unspent exact script/value or EVM nonce/balance/allowance, and immutable reviewed intent. No freshness check is presently a broadcast authorization because no broadcast exists.
4. Complete coordinated approval reset → mined confirmation → exact approval → mined confirmation → deposit with safe retry/partial-completion handling and no automatic re-quote signing.
5. Extend hostile-input review to signature hash changes, all UTXO purposes/chains, EVM legacy and envelope extensions, mixed account inputs/refund policy, incomplete scans, fees and altered provider responses.
6. Independent audit acceptance for both apps, release hashes/artifacts and tiny funded physical-device tests for UTXO, EVM native and ERC-20 source types.

Do not open the shared Vault swap execution gate as a shortcut. Do not label this preparation complete signing or approved real-money functionality.