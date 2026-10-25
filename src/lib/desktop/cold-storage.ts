import { listWatchWallets } from "@/lib/watch-only";
import { watchApi } from "@/lib/watch/chain-io";
import { loadPairing, type VaultPairing, type VaultUtxoChain } from "@/lib/vault-link/pairing";
import { deriveVaultAddress } from "@/lib/vault-link/derive";
import { pairedPurposes } from "@/lib/vault-link/snapshot";
import type { WalletProfileSummary } from "@/lib/txc/storage";

export function coldStorageEntries(profiles: WalletProfileSummary[]) {
  return {
    watches: profiles.flatMap(profile => listWatchWallets(profile.id).map(wallet => ({ wallet, profile }))),
    vaults: profiles.filter(profile => profile.mode === "vault").map(profile => ({ profile, pairing: loadPairing(profile.id) })),
  };
}

type Stats = { chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number } };
export function addressBalance(stats: Stats): number {
  const balance = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum + stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
  if (!Number.isFinite(balance)) throw new Error("Balance unavailable");
  return balance;
}

/** Read-only preview. Any failed address read rejects the whole chain, never a false zero. */
export async function previewVaultBalance(pairing: VaultPairing, chain: VaultUtxoChain, read = watchApi(chain).getAddressStats): Promise<number> {
  const purposes = pairedPurposes(pairing, chain);
  if (!purposes.length) throw new Error("Chain not paired");
  const totals = await Promise.all(purposes.flatMap(purpose => ([0, 1] as const).map(async change => {
    let total = 0;
    let lastUsed = -1;
    for (let start = 0; start < 2000; start += 20) {
      const stats = await Promise.all(Array.from({ length: 20 }, (_, offset) => read(deriveVaultAddress(pairing, chain, purpose, change, start + offset).address)));
      stats.forEach((s, offset) => {
        total += addressBalance(s);
        if (s.chain_stats.tx_count + s.mempool_stats.tx_count > 0) lastUsed = start + offset;
      });
      if (start + 19 - lastUsed >= 20) return total;
    }
    throw new Error("Preview scan limit reached");
  })));
  return totals.reduce((sum, total) => sum + total, 0);
}