/**
 * "Found on the blockchain" Seeds pockets for the desktop Seeds Pocket page.
 *
 * Link records live only on the device that made the link, so a wallet linked
 * from the phone has no record on the desktop. Instead of inventing a record,
 * the desktop checks the branch(es) honest.money's fresh signed list reserves
 * for Seeds and remembers (per wallet) any that show chain activity. A found
 * pocket is view + Move back only: Revoke needs the real link record.
 */
import { scopedKey } from "@/lib/profiles";
import { evmClient, type EvmChainId } from "@/lib/chains/evm";
import { evmPocketAccount, pocketAddresses, UTXO_META, type UtxoChain } from "./pocket";
import { isDelegableAccount } from "./branch-rules";

const KEY = "hme:seeds-pocket-found";
export const SEEDS_FOUND_EVENT = "hme:seeds-pocket-found-changed";

export function foundSeedsPockets(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(scopedKey(KEY)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && isDelegableAccount(n)) : [];
  } catch {
    return [];
  }
}

export function rememberFoundSeedsPockets(accounts: number[]): void {
  const next = [...new Set([...foundSeedsPockets(), ...accounts.filter(isDelegableAccount)])].sort((a, b) => a - b);
  window.localStorage.setItem(scopedKey(KEY), JSON.stringify(next));
  window.dispatchEvent(new Event(SEEDS_FOUND_EVENT));
}

/** One lookup's answer: true = activity, false = checked and empty, null = couldn't check. */
export type Probe = () => Promise<boolean | null>;

/** Any probe seeing activity wins; otherwise false only if at least one check succeeded. */
export async function anyActivity(probes: Probe[]): Promise<boolean | null> {
  const results = await Promise.all(probes.map((p) => p().catch(() => null)));
  if (results.some((r) => r === true)) return true;
  return results.some((r) => r === false) ? false : null;
}

const EVM_PROBE_CHAINS: EvmChainId[] = ["eth", "base", "bsc", "zcu"];

/** Chain probes for one pocket branch: every UTXO pocket address, plus the EVM address's nonce and balance. */
export function pocketProbes(seed: Uint8Array, account: number): Probe[] {
  const probes: Probe[] = [];
  for (const chain of Object.keys(UTXO_META) as UtxoChain[]) {
    const api = UTXO_META[chain].api;
    for (const a of pocketAddresses(seed, chain, account)) {
      probes.push(async () => {
        const s = await api.getAddressStats(a.address);
        return s.chain_stats.tx_count + s.mempool_stats.tx_count > 0;
      });
    }
  }
  const address = evmPocketAccount(seed, account).address;
  for (const id of EVM_PROBE_CHAINS) {
    probes.push(async () => {
      const c = evmClient(id);
      const [nonce, bal] = await Promise.all([c.getTransactionCount({ address }), c.getBalance({ address })]);
      return nonce > 0 || bal > 0n;
    });
  }
  return probes;
}

/**
 * Which of the registry-reserved Seeds branches show activity. Only branches
 * from the fresh verified list are checked; an unverified list checks nothing.
 */
export async function detectSeedsPockets(args: {
  registryBranches: number[] | null;
  probesFor: (account: number) => Probe[];
}): Promise<number[]> {
  if (!args.registryBranches) return [];
  const found: number[] = [];
  for (const account of args.registryBranches.filter(isDelegableAccount)) {
    if ((await anyActivity(args.probesFor(account))) === true) found.push(account);
  }
  return found;
}
