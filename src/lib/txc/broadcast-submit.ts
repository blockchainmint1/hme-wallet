import { Transaction } from "bitcoinjs-lib";
import { MEMPOOL_API } from "./network";

export class TxcBroadcastUncertainError extends Error {
  constructor(public readonly txid: string) {
    super(
      `Sending was not confirmed. Check transaction ${txid} before trying again; it may already have been sent.`,
    );
    this.name = "TxcBroadcastUncertainError";
  }
}

/** Only fresh bytes with the exact local ID prove acceptance, never a 404. */
export async function findBroadcastTx(txid: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(txid)) throw new Error("Invalid TXC transaction ID.");
  const res = await fetch(`${MEMPOOL_API}/tx/${txid}/hex`, { cache: "no-store" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error("Could not check the TXC transaction.");
  const hex = (await res.text()).trim();
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex) || Transaction.fromHex(hex).getId() !== txid.toLowerCase())
    throw new Error("TXC returned a different transaction.");
  return true;
}

/** Exactly one submission, then an exact-ID lookup if its reply is uncertain. */
export async function submitTxcHex(hex: string): Promise<string> {
  const bytes = hex.trim();
  const txid = Transaction.fromHex(bytes).getId();
  try {
    const res = await fetch(`${MEMPOOL_API}/tx`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: bytes,
    });
    if (res.ok && (await res.text()).trim().toLowerCase() === txid) return txid;
  } catch {
    /* a missing response does not prove a missing payment */
  }
  try {
    if (await findBroadcastTx(txid)) return txid;
  } catch {
    /* keep uncertain */
  }
  throw new TxcBroadcastUncertainError(txid);
}
