import type { Erc20TokenMeta } from "@/lib/chains/erc20";
export type InitialEvmAsset = { kind: "native" } | { kind: "erc20"; token: Erc20TokenMeta };
/**
 * Picks the send's starting asset. When a contract is given, only an exact
 * (case-insensitive) match among enabled tokens counts; otherwise null — the
 * symbol is never consulted, so a spoofed name can't resolve to a real asset.
 */
export function pickInitialEvmAsset(
  tokens: readonly Erc20TokenMeta[],
  search: { asset?: string; contract?: string },
  nativeSymbol: string,
  bySymbol: (upperSymbol: string) => Erc20TokenMeta | null,
): InitialEvmAsset | null {
  if (search.contract) {
    const c = search.contract.toLowerCase();
    const t = tokens.find((x) => x.address.toLowerCase() === c);
    return t ? { kind: "erc20", token: t } : null;
  }
  const wanted = search.asset?.toUpperCase();
  if (wanted && wanted !== nativeSymbol.toUpperCase()) {
    const t = bySymbol(wanted);
    if (t) return { kind: "erc20", token: t };
  }
  return { kind: "native" };
}
