/**
 * Which of this wallet's addresses an Omni token send leaves from.
 *
 * Omni takes the sending address from the transaction's FIRST input, and a
 * Simple Send moves the whole amount from that one address. The send screen
 * picks the address holding the most of the token among those that cover the
 * amount. The TSD cash-out uses the same rule for its refund address, so the
 * refund goes back to exactly the address the TSD left from.
 */
export type PerAddressTokenBalances = Record<string, Record<number, string> | undefined>;

export function pickOmniSender(
  ownAddresses: readonly string[],
  perAddr: PerAddressTokenBalances | null | undefined,
  propertyId: number,
  amountUnits: bigint,
): string | null {
  if (!perAddr || amountUnits <= 0n) return null;
  let best: { addr: string; bal: bigint } | null = null;
  for (const addr of ownAddresses) {
    let bal: bigint;
    try {
      bal = BigInt(perAddr[addr]?.[propertyId] ?? "0");
    } catch {
      continue;
    }
    if (bal < amountUnits) continue;
    // Strictly greater keeps the first-listed address on ties, matching the
    // stable sort the send screen used before.
    if (!best || bal > best.bal) best = { addr, bal };
  }
  return best?.addr ?? null;
}
