/**
 * Pure rules for the desktop Seeds Pocket page (src/routes/desktop.seeds.tsx).
 * Kept separate so they can be tested without keys or network.
 */
import { MEMPOOL_BASE } from "@/lib/txc/network";
import { ISK_MEMPOOL_BASE } from "@/lib/isk/network";
import { BTC_MEMPOOL_BASE } from "@/lib/btc/network";
import { LTC_MEMPOOL_BASE } from "@/lib/ltc/network";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import type { PocketChain, UtxoChain } from "./pocket";

export const SEEDS_HOST = "seeds.honest.money";

export function seedsLinks<T extends { host: string }>(links: readonly T[]): T[] {
  return links.filter((l) => l.host.toLowerCase() === SEEDS_HOST);
}

const UTXO_EXPLORER: Record<UtxoChain, string> = {
  TXC: MEMPOOL_BASE,
  ISK: ISK_MEMPOOL_BASE,
  BTC: BTC_MEMPOOL_BASE,
  LTC: LTC_MEMPOOL_BASE,
};

export function utxoExplorerUrl(chain: UtxoChain, address: string): string {
  return `${UTXO_EXPLORER[chain]}/address/${encodeURIComponent(address)}`;
}

export function evmExplorerUrl(id: EvmChainId, address: string): string {
  return EVM_CHAINS[id].explorerAddress(address);
}

/**
 * Moving TXC out of the pocket while TSD still sits on it would leave the TSD
 * with no TXC to pay its own transfer fee. Refuse until the TSD is out.
 */
export function moveBackBlockReason(chain: PocketChain, tsdUnits: bigint | null): string | null {
  if (chain !== "TXC") return null;
  if (tsdUnits === null) return "Couldn't check TSD in the pocket, so TXC stays put for now. Try again in a moment.";
  if (tsdUnits > 0n) return "TSD is still in the pocket and needs this TXC to pay its fee. Withdraw the TSD on Seeds first.";
  return null;
}
