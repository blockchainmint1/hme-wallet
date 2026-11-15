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
export function assertThorchainEvmExecution(evmSwapEnabled: boolean): void {
  if (!evmSwapEnabled) throw new Error("EVM swaps are turned off in this desktop wallet's settings.");
}

export function assertTsdMintEvmExecution(evmSwapEnabled: boolean): void {
  if (!evmSwapEnabled) throw new Error("EVM swaps are turned off in this desktop wallet's settings. Nothing was sent.");
}
