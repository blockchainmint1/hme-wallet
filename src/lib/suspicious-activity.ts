import type { EvmChainId, EvmTransfer } from "@/lib/chains/history.functions";
import { getKnownTokens } from "@/lib/token-prefs";
import { evmTrustedDestinations, isLookalike } from "@/lib/address-lookalike";
import { zeroValueTokenReason } from "./chains/history-cache";

/** Verified contracts (built-in + the member's own custom tokens) per chain. */
function verifiedContracts(chain?: EvmChainId): Set<string> {
  if (!chain) return new Set();
  try {
    return new Set(getKnownTokens(chain).map((t) => t.address.toLowerCase()));
  } catch {
    return new Set();
  }
}

const trustedCache = new WeakMap<EvmTransfer[], Map<string, Set<string>>>();
function trustedFor(history: EvmTransfer[], chain?: EvmChainId): Set<string> {
  let byChain = trustedCache.get(history);
  if (!byChain) trustedCache.set(history, (byChain = new Map()));
  const key = chain ?? "";
  let set = byChain.get(key);
  if (!set) byChain.set(key, (set = evmTrustedDestinations(history, verifiedContracts(chain))));
  return set;
}

/**
 * Advisory only: never changes balances, stored history, or spending permissions.
 * `chain` lets sends of verified tokens count as real payments; without it only
 * native sends do.
 */
export function suspiciousActivityReason(t: EvmTransfer, history: EvmTransfer[], chain?: EvmChainId): string | null {
  // A Transfer log's `from` is not a signature: counterfeit contracts can
  // claim any wallet sent their token. Contract-based token classification
  // therefore takes precedence over the outgoing display flag.
  if (t.category === "erc20" && t.spam) {
    const impersonated = t.spamReason?.match(/^imposter (.+)$/i)?.[1];
    return impersonated
      ? `Counterfeit ${impersonated} token — unverified contract`
      : t.spamReason ?? "Suspicious token transfer";
  }
  const poisoning = zeroValueTokenReason(t);
  if (poisoning) return poisoning;
  // Native sends were signed by this key: always real, never hidden.
  if (t.outgoing && t.category === "external") return null;
  // Any other row whose counterparty mimics an address this wallet really
  // paid — native or token, either direction, any amount, spam-listed or not.
  const trusted = trustedFor(history, chain);
  const counterparty = (t.outgoing ? t.to : t.from)?.toLowerCase();
  if (counterparty && /^0x[0-9a-f]{40}$/.test(counterparty) && !trusted.has(counterparty)) {
    for (const paid of trusted) {
      if (isLookalike(paid, counterparty, "evm")) return "Lookalike of an address you've paid — possible address poisoning";
    }
  }
  // Other outgoing and nonzero genuine ERC-20 movements stay visible.
  if (t.outgoing) return null;
  if (t.spam) return t.spamReason ?? "Suspicious token transfer";
  const amount = Number(t.value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return "Zero-value incoming transfer";
  return null;
}

export function filterSuspiciousActivity(history: EvmTransfer[], hide: boolean, chain?: EvmChainId): EvmTransfer[] {
  return hide ? history.filter((t) => !suspiciousActivityReason(t, history, chain)) : history;
}

/** Don't turn a nonzero payment into an apparent zero through rounding. */
export function formatActivityAmount(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (amount !== 0 && Math.abs(amount) < 0.000001) {
    return amount.toLocaleString(undefined, { maximumSignificantDigits: 6 });
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
}