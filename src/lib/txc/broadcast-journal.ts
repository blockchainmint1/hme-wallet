import { safeSetItem } from "@/lib/storage/safe-set";

const PREFIX = "hme.txc.broadcast-pending.";
export interface TxcPendingBroadcast {
  txid: string;
  inputs: string[];
}

/** Public transaction metadata only; no expiry can turn uncertainty into safety. */
export function pendingTxcBroadcasts(
  storage: Storage = window.localStorage,
): TxcPendingBroadcast[] {
  const out: TxcPendingBroadcast[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const item = JSON.parse(storage.getItem(key) ?? "null") as TxcPendingBroadcast | null;
    if (
      !item ||
      !/^[a-f0-9]{64}$/i.test(item.txid) ||
      key !== PREFIX + item.txid ||
      !Array.isArray(item.inputs) ||
      item.inputs.some((input) => typeof input !== "string" || !/^[a-f0-9]{64}:\d+$/i.test(input))
    ) {
      throw new Error(
        "Could not read an unfinished TXC payment. Check your activity before sending again.",
      );
    }
    out.push(item);
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
