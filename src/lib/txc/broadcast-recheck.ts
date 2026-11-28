import { findBroadcastTx } from "./broadcast-submit";
import { getOutspend } from "./mempool";

export type TxcRecheck = "sent" | "not-sent" | "unknown";

/**
 * "not-sent" only when the exact txid is absent AND every input it used is
 * still unspent (mempool-aware). Any failed read stays "unknown".
 */
export async function recheckTxcAttempt(
  txid: string,
  inputs: readonly string[],
): Promise<TxcRecheck> {
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
