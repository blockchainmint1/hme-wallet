import type { EvmChainId } from "@/lib/chains/evm";
import { BUILTIN_TOKENS_BY_CHAIN, type Erc20TokenMeta } from "@/lib/chains/erc20";

/** Contract identity, never a user-supplied symbol, determines peg treatment. */
export function desktopTokenIdentity(chain: EvmChainId, token: Erc20TokenMeta) {
  const builtin = BUILTIN_TOKENS_BY_CHAIN[chain].find(t => t.address.toLowerCase() === token.address.toLowerCase());
  return {
    key: builtin ? `${chain}-${builtin.symbol}` : `${chain}-${token.address.toLowerCase()}`,
    stable: Boolean(builtin),
    price: builtin ? 1 : null,
    custom: !builtin,
  };
}