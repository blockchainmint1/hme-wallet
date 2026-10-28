/** Quote APIs are not signing authorities. Re-enable only after calldata/contract verification. */
export function assertReviewedExecution(_provider: "lifi"): void {
  throw new Error("EVM swaps are temporarily paused while spending-contract verification is completed. Sending and receiving still work.");
}

/**
 * The single EVM swap path allowed to sign: THORChain's pinned router
 * (`THOR_EVM_ROUTERS` in src/lib/thorchain/catalog.ts) calling only
 * `depositWithExpiry`, rebuilt from a frozen server-validated quote and
 * enforced by the `beforeSign` guard. Gated on the EVM swap toggle.
 */
export const REVIEWED_EVM_SWAP_SURFACES = Object.freeze(["thorchain-router-depositWithExpiry"] as const);
export function assertThorchainEvmExecution(evmSwapEnabled: boolean): void {
  if (!evmSwapEnabled) throw new Error("EVM swaps are turned off in this desktop wallet's settings.");
}
