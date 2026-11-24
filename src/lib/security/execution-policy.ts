/** Quote APIs are not signing authorities. Re-enable only after calldata/contract verification. */
export function assertReviewedExecution(_provider: "lifi"): void {
  throw new Error("EVM swaps are temporarily paused while spending-contract verification is completed. Sending and receiving still work.");
}

/**
 * The only EVM swap paths allowed to sign, both gated on the EVM swap toggle:
 *  - THORChain's pinned router (`THOR_EVM_ROUTERS` in
 *    src/lib/thorchain/catalog.ts) calling only `depositWithExpiry`, rebuilt
 *    from a frozen server-validated quote and enforced by the `beforeSign` guard.
 *  - Buying TSD through TSD Bridge: one plain ERC-20 `transfer(deposit, amount)`
 *    on a pinned stablecoin contract (`MINT_SOURCES` in
 *    src/lib/cashout/mint.ts) to a verified, re-polled per-order deposit
 *    address, enforced byte-exact by `assertMintTransferRequest`.
 */
export const REVIEWED_EVM_SWAP_SURFACES = Object.freeze([
  "thorchain-router-depositWithExpiry",
  "tsd-bridge-mint-erc20-transfer",
] as const);
/**
 * The only multi-payment requests a Vault wallet may be asked to sign
 * (desktop round-up, src/lib/vault-link/evm-roundup.ts). Not swaps:
 *  - HME Vault `sweep-batch`: up to 25 plain transfers, every one to the
 *    Vault's own address #0, each signed transaction checked field by field.
 *  - HME Vault `native-disperse` on the pinned Disperse contract
 *    (`disperseEther` only, runtime code hash checked when prepared and again
 *    before broadcast), paying fee money only to the Vault's own addresses.
 */
export const REVIEWED_VAULT_BATCH_SURFACES = Object.freeze([
  "vault-sweep-batch-to-own-address-0",
  "vault-native-disperse-fee-topup",
] as const);
export type ReviewedVaultBatchSurface = (typeof REVIEWED_VAULT_BATCH_SURFACES)[number];
export function assertReviewedVaultBatchSurface(surface: string): asserts surface is ReviewedVaultBatchSurface {
  if (!(REVIEWED_VAULT_BATCH_SURFACES as readonly string[]).includes(surface)) throw new Error("That kind of Vault batch hasn't been reviewed. Nothing was prepared.");
}

export function assertThorchainEvmExecution(evmSwapEnabled: boolean): void {
  if (!evmSwapEnabled) throw new Error("EVM swaps are turned off in this desktop wallet's settings.");
}

export function assertTsdMintEvmExecution(evmSwapEnabled: boolean): void {
  if (!evmSwapEnabled) throw new Error("EVM swaps are turned off in this desktop wallet's settings. Nothing was sent.");
}
