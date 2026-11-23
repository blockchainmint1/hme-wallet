/**
 * TEXITcoin fee-rate rule shared by every TXC payment (phone, desktop, APK,
 * extension, card service, Seeds pocket).
 *
 * The node relays and miners confirm transactions at 1 sat/vB (verified on
 * mempool.texitcoin.org, Nov 2026), so we follow the live estimate down to
 * that floor. Only when the estimate can't be fetched do we fall back to a
 * cautious 10 sat/vB, because guessing low then risks a rejected payment.
 */
export const TXC_MIN_RELAY_SAT_VB = 1;
export const TXC_FALLBACK_FEE_RATE = 10;
/**
 * Worst-case vbytes for a legacy (P2PKH, compressed key) input. Signatures are
 * 71–73 bytes, so 148 can undercount by one byte and, at 1 sat/vB, leave the
 * fee one sat short of the relay minimum.
 */
export const TXC_P2PKH_INPUT_VB = 149;

export type TxcFeeTier = "fastestFee" | "halfHourFee" | "hourFee";
type Estimates = Partial<Record<TxcFeeTier | "minimumFee", number>>;

const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Whole sat/vB to pay for a tier: live estimate, never below the node's minimum or 1. */
export function txcFeeRate(est: Estimates | null | undefined, tier: TxcFeeTier = "halfHourFee"): number {
  if (!est) return TXC_FALLBACK_FEE_RATE;
  const picks = [est[tier], est.minimumFee].filter(usable);
  if (picks.length === 0) return TXC_FALLBACK_FEE_RATE;
  return Math.max(TXC_MIN_RELAY_SAT_VB, ...picks.map((n) => Math.ceil(n)));
}
