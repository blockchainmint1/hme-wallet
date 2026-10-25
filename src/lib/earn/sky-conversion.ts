import { parseAbi, type Address } from "viem";

/** Read-only conversion arithmetic, NOT signing authorization.
 * Official route: https://developers.sky.money/guides/psm/litepsm/
 * Formulas: sky-ecosystem/dss-lite-psm DssLitePsm.sol and
 * sky-ecosystem/usds-wrappers UsdsPsmWrapper.sol.
 */
export const SKY_CONVERSION = {
  wrapper: "0xA188EEC8F81263234dA3622A406892F3D630f98c" as Address,
  psm: "0xf6e72Db5454dd049d0788e411b06CfAF16853042" as Address,
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
} as const;
export const skyConversionAbi = parseAbi([
  "function psm() view returns (address)",
  "function gem() view returns (address)",
  "function usds() view returns (address)",
  "function tin() view returns (uint256)",
  "function tout() view returns (uint256)",
  "function live() view returns (uint256)",
]);
const WAD = 10n ** 18n;
const SCALE = 10n ** 12n;
const MAX_UINT256 = 2n ** 256n - 1n;

function checked(amount: bigint, fee: bigint, entering: boolean) {
  if (amount <= 0n || amount > MAX_UINT256 / SCALE) throw new Error("Invalid conversion amount");
  if (fee < 0n || fee === MAX_UINT256 || (entering && fee > WAD)) throw new Error("Sky conversion halted or invalid fee");
  const gross = amount * SCALE;
  if (fee > 0n && gross > MAX_UINT256 / fee) throw new Error("Conversion overflow");
  return gross;
}

/** USDC units (6 decimals) -> estimated USDS units (18 decimals).
 * No promise of execution: governance may change tin before inclusion.
 */
export function usdcToUsdsEstimate(usdc: bigint, tin: bigint): bigint {
  const gross = checked(usdc, tin, true);
  const out = gross - gross * tin / WAD;
  if (out <= 0n) throw new Error("Conversion returns no USDS");
  return out;
}

/** Exact desired USDC units -> required USDS units, including tout fee. */
export function usdsCostForUsdc(usdc: bigint, tout: bigint): bigint {
  const gross = checked(usdc, tout, false);
  const cost = gross + gross * tout / WAD;
  if (cost > MAX_UINT256) throw new Error("Conversion overflow");
  return cost;
}

/** Largest exact-output USDC amount affordable by the supplied USDS budget.
 * Binary search preserves Solidity integer rounding without float errors.
 */
export function usdsToUsdcEstimate(usds: bigint, tout: bigint): bigint {
  if (usds <= 0n || usds > MAX_UINT256) throw new Error("Invalid USDS budget");
  checked(1n, tout, false);
  let low = 0n;
  let high = usds / SCALE;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    let affordable = false;
    try { affordable = usdsCostForUsdc(mid, tout) <= usds; } catch { /* Overflow is unaffordable. */ }
    if (affordable) low = mid; else high = mid - 1n;
  }
  if (low <= 0n) throw new Error("Conversion returns no USDC");
  return low;
}