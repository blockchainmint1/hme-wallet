/**
 * Shared Blockbook raw-transaction broadcast for BTC, LTC and DOGE.
 *
 * Small transactions keep the long-proven `GET /sendtx/{hex}` form. Large
 * ones (many inputs, e.g. a big DOGE send gathering dozens of coins) are
 * POSTed as a plain-text body to `/sendtx/`: the NowNodes and public
 * Blockbook gateways answer a URL longer than roughly 12–16 KB with a bare
 * Cloudflare "520" and never reach the node, so the GET form cannot carry them.
 * Both forms send identical signed bytes; only the transport differs.
 *
 * A failed broadcast never proves the payment did not go out (a 520 or a
 * timeout can follow an accepted transaction, and the proxy fails over to a
 * second backend that then answers "already known"). So the txid is computed
 * locally before sending, "already known" answers are treated as success, and
 * any other failure is followed by a txid lookup on the read path before the
 * user is told anything about whether their coins moved.
 */
import { Transaction } from "bitcoinjs-lib";
import { cleanUpstreamBody } from "@/lib/broadcast-error";

/** Hex length above which the URL form is unsafe (12,000 chars verified OK upstream). */
export const BLOCKBOOK_GET_MAX_HEX = 6000;

const ALREADY_KNOWN = /txn-already-in-mempool|txn-already-known|already in block ?chain|transaction already exists/i;

export function isAlreadyKnownBroadcastError(message: string): boolean {
  return ALREADY_KNOWN.test(message);
}

/** txid of a signed transaction (non-witness hash), computed before sending. */
export function signedTxid(hex: string): string {
  return Transaction.fromHex(hex).getId();
}

export function blockbookSendTxRequest(apiBase: string, hex: string): { url: string; init: RequestInit } {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Signed transaction is not valid hex");
  }
  if (hex.length <= BLOCKBOOK_GET_MAX_HEX) {
    return { url: `${apiBase}/sendtx/${hex}`, init: { headers: { accept: "application/json" } } };
  }
  return {
    url: `${apiBase}/sendtx/`,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "text/plain" },
      body: hex,
    },
  };
}

/**
 * Server-side rescue for older app builds (phone app, extension, or a browser
 * tab still running a pre-fix version) that still put a large signed
 * transaction in the URL. Our worker receives the full URL fine; it is the
 * upstream gateways that answer a long one with a bare 520. So the proxy
 * re-sends exactly the same bytes as a POST body instead. Returns null for
 * anything that is not a long, well-formed `GET sendtx/<hex>`.
 */
export function longGetSendTxAsPost(method: string, path: string): { path: string; body: string } | null {
  if (method !== "GET" || !path.startsWith("sendtx/")) return null;
  const hex = path.slice("sendtx/".length);
  if (hex.length <= BLOCKBOOK_GET_MAX_HEX) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return { path: "sendtx/", body: hex };
}

/** Wait before re-checking after a transport failure (overridable in tests). */
export let LOOKUP_RETRY_MS = 4000;
export function setLookupRetryMsForTests(ms: number): void {
  LOOKUP_RETRY_MS = ms;
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type TxLookup = "present" | "absent" | "unknown";

/** Read-path lookup: is this txid in the backend's mempool or chain? */
export async function lookupTxid(apiBase: string, txid: string): Promise<TxLookup> {
  try {
    const res = await fetch(`${apiBase}/tx/${txid}`, { headers: { accept: "application/json" } });
    const text = await res.text();
    let parsed: { txid?: unknown; error?: unknown } | null = null;
    try {
      parsed = JSON.parse(text) as { txid?: unknown; error?: unknown };
    } catch {
      parsed = null;
    }
    if (res.ok && parsed && typeof parsed.txid === "string" && parsed.txid.toLowerCase() === txid) return "present";
    if (
      res.status === 400 &&
      parsed &&
      typeof parsed.error === "string" &&
      /not found/i.test(parsed.error) &&
      parsed.error.toLowerCase().includes(txid)
    ) {
      return "absent";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function sendOnce(apiBase: string, hex: string, coin: string): Promise<{ ok: true; result?: string } | { ok: false; message: string; rejected: boolean }> {
  const { url, init } = blockbookSendTxRequest(apiBase, hex);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, rejected: false, message: `${coin} broadcast failed: ${e instanceof Error ? e.message : "network error"}` };
  }
  const body = await res.text();
  type SendTxBody = { result?: string; error?: string | { message?: string } };
  let parsed: SendTxBody | null = null;
  try {
    parsed = JSON.parse(body) as SendTxBody;
  } catch {
    parsed = null;
  }
  const errMsg = parsed ? (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) : undefined;
  if (errMsg) return { ok: false, rejected: true, message: `${coin} broadcast rejected: ${errMsg}` };
  if (!res.ok) return { ok: false, rejected: false, message: `${coin} broadcast failed: ${res.status} ${cleanUpstreamBody(body)}` };
  return { ok: true, result: parsed?.result };
}

export async function blockbookBroadcast(apiBase: string, hex: string, coin: string): Promise<string> {
  const txid = signedTxid(hex);
  const sent = await sendOnce(apiBase, hex, coin);
  if (sent.ok) {
    if (sent.result && sent.result.toLowerCase() !== txid) {
      throw new Error(`${coin} broadcast returned an unexpected transaction id — check Activity before retrying (expected ${txid})`);
    }
    return txid;
  }
  // The node (or a failover backend) already has exactly these bytes.
  if (isAlreadyKnownBroadcastError(sent.message)) return txid;

  // A transport failure (520, timeout) can follow an accepted transaction that
  // is still propagating to the backend we read from, so give it a moment and
  // look twice before calling it absent.
  let seen = await lookupTxid(apiBase, txid);
  if (seen !== "present" && !sent.rejected) {
    await delay(LOOKUP_RETRY_MS);
    seen = await lookupTxid(apiBase, txid);
  }
  if (seen === "present") return txid;
  if (seen === "absent") {
    throw new Error(
      sent.rejected
        ? `${sent.message} — transaction ${txid} is not on the network, your coins did not move`
        : `${sent.message} — transaction ${txid} was not found on the network. Check Activity before trying again.`,
    );
  }
  throw new Error(
    `${sent.message} — could not confirm whether transaction ${txid} reached the network. Check Activity or the explorer before trying again.`,
  );
}
