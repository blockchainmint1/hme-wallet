/**
 * Ordered Solana JSON-RPC upstreams for the same-origin proxy.
 *
 * Solana's own public endpoint blocks requests from our hosting provider
 * ("Your IP or provider is blocked from this endpoint"), so the live site
 * must try other providers first and fall through when one refuses.
 *
 * Failing over a `sendTransaction` is safe: the body carries identical
 * signed bytes, and the cluster de-duplicates by signature, so a second
 * submission can never create a second payment.
 */

export interface SolanaUpstream {
  name: string;
  url: string;
}

export const SOLANA_PUBLIC_UPSTREAMS: readonly SolanaUpstream[] = [
  { name: "publicnode", url: "https://solana-rpc.publicnode.com" },
  { name: "solana", url: "https://api.mainnet-beta.solana.com" },
];

export function solanaUpstreams(alchemyKey: string | undefined): SolanaUpstream[] {
  const list: SolanaUpstream[] = [];
  const key = alchemyKey?.trim();
  if (key) list.push({ name: "alchemy", url: `https://solana-mainnet.g.alchemy.com/v2/${key}` });
  list.push(...SOLANA_PUBLIC_UPSTREAMS);
  return list;
}

/** JSON-RPC error codes providers use for "blocked", "no access" or "slow down". */
const REFUSAL_CODES = new Set([401, 403, 429, -32052, -32029, -32005, 35]);

/**
 * True when this upstream refused or failed to serve the request, so the
 * next upstream should be tried. Ordinary RPC answers (including normal
 * errors such as an invalid transaction) are returned to the wallet as-is.
 */
export function shouldTryNextUpstream(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // HTML/plain-text pages are never valid RPC answers.
    return true;
  }
  const replies = Array.isArray(parsed) ? parsed : [parsed];
  if (replies.length === 0) return true;
  return replies.some((reply) => {
    if (!reply || typeof reply !== "object") return true;
    const error = (reply as { error?: { code?: unknown } }).error;
    return typeof error?.code === "number" && REFUSAL_CODES.has(error.code);
  });
}
