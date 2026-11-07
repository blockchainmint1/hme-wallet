/**
 * Shared Blockbook raw-transaction broadcast for BTC, LTC and DOGE.
 *
 * Small transactions keep the long-proven `GET /sendtx/{hex}` form. Large
 * ones (many inputs, e.g. a big DOGE send gathering dozens of coins) are
 * POSTed as a plain-text body to `/sendtx/`: the NowNodes and public
 * Blockbook gateways answer a URL longer than roughly 10–12 KB with a bare
 * Cloudflare "520" and never reach the node, so the GET form cannot carry them.
 * Both forms send identical signed bytes; only the transport differs.
 */
import { cleanUpstreamBody } from "@/lib/broadcast-error";

/** Hex length above which the URL form is unsafe (8,008 chars verified OK upstream). */
export const BLOCKBOOK_GET_MAX_HEX = 6000;

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

export async function blockbookBroadcast(apiBase: string, hex: string, coin: string): Promise<string> {
  const { url, init } = blockbookSendTxRequest(apiBase, hex);
  const res = await fetch(url, init);
  const body = await res.text();

  type SendTxBody = { result?: string; error?: string | { message?: string } };
  let parsed: SendTxBody | null = null;
  try {
    parsed = JSON.parse(body) as SendTxBody;
  } catch {
    parsed = null;
  }
  const errMsg = parsed ? (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) : undefined;
  if (!res.ok) {
    if (errMsg) throw new Error(`${coin} broadcast rejected: ${errMsg}`);
    throw new Error(`${coin} broadcast failed: ${res.status} ${cleanUpstreamBody(body)}`);
  }
  if (errMsg) throw new Error(`${coin} broadcast rejected: ${errMsg}`);
  if (parsed?.result) return parsed.result;
  return cleanUpstreamBody(body, 120);
}
