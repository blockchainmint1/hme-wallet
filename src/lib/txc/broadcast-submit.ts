import { Transaction } from "bitcoinjs-lib";
import { cleanUpstreamBody } from "@/lib/broadcast-error";
import { MEMPOOL_API } from "./network";

export class TxcBroadcastUncertainError extends Error {
  constructor(public readonly txid: string) {
    super(
      `Sending was not confirmed. Check transaction ${txid} before trying again; it may already have been sent.`,
    );
    this.name = "TxcBroadcastUncertainError";
  }
}

/** The node definitely refused the bytes and the exact txid is absent: nothing was sent. */
export class TxcBroadcastRejectedError extends Error {
  constructor(
    public readonly txid: string,
    public readonly reason: string,
  ) {
    super(`TXC refused this payment, so it was not sent: ${reason}`);
    this.name = "TxcBroadcastRejectedError";
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

/**
 * Only 400/422 with text is the node's own verdict (Esplora relays RPC errors
 * that way). 404/401/403/408/429 come from routing or limits, not the node.
 */
export function isNodeRejection(status: number, body: string): boolean {
  return (status === 400 || status === 422) && body.trim() !== "" && !/<html/i.test(body);
}

/**
 * Exactly one submission. A matching OK reply = sent. A node rejection plus an
 * exact 404 lookup = refused (nothing sent). Everything else stays uncertain.
 */
export async function submitTxcHex(hex: string): Promise<string> {
  const bytes = hex.trim();
  const txid = Transaction.fromHex(bytes).getId();
  let rejection: string | null = null;
  try {
    const res = await fetch(`${MEMPOOL_API}/tx`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: bytes,
    });
    const body = await res.text();
    if (res.ok && body.trim().toLowerCase() === txid) return txid;
    if (isNodeRejection(res.status, body)) rejection = cleanUpstreamBody(body, 200) || "rejected";
  } catch {
    /* a missing response does not prove a missing payment */
  }
  let found: boolean | null = null;
  try {
    found = await findBroadcastTx(txid);
  } catch {
    /* keep uncertain */
  }
  if (found) return txid;
  if (found === false && rejection) throw new TxcBroadcastRejectedError(txid, rejection);
  throw new TxcBroadcastUncertainError(txid);
}
