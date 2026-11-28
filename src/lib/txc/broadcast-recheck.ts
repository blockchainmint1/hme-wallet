import { pendingTxcBroadcasts } from "./broadcast-journal";
import { findBroadcastTx } from "./broadcast-submit";
import { getOutspend } from "./mempool";

export type TxcRecheck = "sent" | "not-sent" | "unknown";
export const TXC_RECHECK_MIN_AGE_MS = 2 * 60 * 1000;

/**
 * "not-sent" only when the exact txid is absent AND every input it used is
 * still unspent (mempool-aware). Any failed read stays "unknown".
 */
export async function recheckTxcAttempt(
  txid: string,
  inputs: readonly string[],
  attemptedAt?: number,
  now = Date.now(),
): Promise<TxcRecheck> {
  // Vault gathers keep their attempt time in the shared browser journal.
  if (attemptedAt === undefined && typeof window !== "undefined") {
    try {
      attemptedAt = pendingTxcBroadcasts().find((item) => item.txid === txid)?.attemptedAt;
    } catch {
      return "unknown";
    }
  }
  // A lagging explorer can briefly say 404/unspent while the node has the tx.
  if (
    attemptedAt === undefined ||
    !Number.isFinite(attemptedAt) ||
    attemptedAt <= 0 ||
    now < attemptedAt ||
    now - attemptedAt < TXC_RECHECK_MIN_AGE_MS
  )
    return "unknown";
  try {
    if (await findBroadcastTx(txid)) return "sent";
    if (inputs.length === 0) return "unknown";
    for (const key of inputs) {
      const m = /^([a-f0-9]{64}):(\d+)$/i.exec(key);
      if (!m) return "unknown";
      const out = await getOutspend(m[1]!, Number(m[2]));
      if (out.spent) return "unknown";
    }
    // Re-check the txid last so a send landing mid-check is not missed.
    return (await findBroadcastTx(txid)) ? "sent" : "not-sent";
  } catch {
    return "unknown";
  }
}
