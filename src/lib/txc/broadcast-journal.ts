import { safeSetItem } from "@/lib/storage/safe-set";

const PREFIX = "hme.txc.broadcast-pending.";
export interface TxcPendingBroadcast {
  txid: string;
  inputs: string[];
  /** Saved before submission; Check again cannot free a fresh attempt. */
  attemptedAt: number;
}

/** Public transaction metadata only; no expiry can turn uncertainty into safety. */
export function pendingTxcBroadcasts(
  storage: Storage = window.localStorage,
  onMalformed?: (key: string) => void,
): TxcPendingBroadcast[] {
  const out: TxcPendingBroadcast[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    let item: TxcPendingBroadcast | null = null;
    try {
      item = JSON.parse(storage.getItem(key) ?? "null") as TxcPendingBroadcast | null;
    } catch {
      item = null;
    }
    if (
      !item ||
      !/^[a-f0-9]{64}$/i.test(item.txid) ||
      key !== PREFIX + item.txid ||
      !Array.isArray(item.inputs) ||
      item.inputs.some((input) => typeof input !== "string" || !/^[a-f0-9]{64}:\d+$/i.test(input))
    ) {
      // Skip and report; one unreadable entry must never block every valid send.
      onMalformed?.(key);
      continue;
    }
    // Legacy entries have no trustworthy age. Stamp them once and make them wait
    // too; if storage is unavailable, every reload starts that wait again.
    const attemptedAt =
      typeof item.attemptedAt === "number" &&
      Number.isFinite(item.attemptedAt) &&
      item.attemptedAt > 0
        ? item.attemptedAt
        : Date.now();
    const normalized = { ...item, attemptedAt };
    if (normalized.attemptedAt !== item.attemptedAt) {
      try {
        storage.setItem(key, JSON.stringify(normalized));
      } catch {
        /* keep the in-memory wait; never drop the conflict record */
      }
    }
    out.push(normalized);
  }
  return out;
}

export function reserveTxcBroadcast(
  attempt: TxcPendingBroadcast,
  storage: Storage = window.localStorage,
): void {
  safeSetItem(PREFIX + attempt.txid, JSON.stringify(attempt), storage);
}

export function finishTxcBroadcast(txid: string, storage: Storage = window.localStorage): void {
  storage.removeItem(PREFIX + txid);
}

export function conflictingTxcBroadcasts(
  txid: string,
  inputs: readonly string[],
  storage: Storage = window.localStorage,
): TxcPendingBroadcast[] {
  const keys = new Set(inputs);
  return pendingTxcBroadcasts(storage).filter(
    (item) => item.txid === txid || item.inputs.some((key) => keys.has(key)),
  );
}

/** Keys of unreadable entries, so the UI can report them without blocking sends. */
export function malformedTxcBroadcastKeys(storage: Storage = window.localStorage): string[] {
  const bad: string[] = [];
  pendingTxcBroadcasts(storage, (k) => bad.push(k));
  return bad;
}
