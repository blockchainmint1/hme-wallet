/**
 * Server-side balance reads for Seeds' extra coins (desktop Seeds Pocket).
 * Public address reads only — no keys ever reach this code. Each coin has a
 * fixed, ordered upstream list; first good answer wins. Monero is absent on
 * purpose: its balance can't be read without a private view key.
 */
import type { ExtraChain } from "@/lib/xpub-link/delegate-keys";

type Json = Record<string, unknown>;

async function getJson(url: string, init?: RequestInit): Promise<Json | Json[] | null> {
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!res.ok && res.status !== 404) return null;
    const text = await res.text();
    if (text.length > 256 * 1024) return null;
    return JSON.parse(text) as Json | Json[];
  } catch {
    return null;
  }
}

async function first<T>(bases: string[], read: (base: string) => Promise<T | null>): Promise<T | null> {
  for (const b of bases) {
    const v = await read(b).catch(() => null);
    if (v !== null) return v;
  }
  return null;
}

const intStr = (v: unknown): string | null => {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" ? v : null;
  return s !== null && /^\d{1,30}$/.test(s) ? s : null;
};

const BLOCKBOOK: Partial<Record<ExtraChain, string[]>> = {
  DOGE: ["https://dogebook.nownodes.io/api/v2", "https://blockbook.doge.zelcore.io/api/v2"],
  BCH: ["https://bchbook.nownodes.io/api/v2"],
  DASH: ["https://dashbook.nownodes.io/api/v2"],
  ZEC: ["https://zecbook.nownodes.io/api/v2"],
};

function blockbook(chain: ExtraChain, address: string): Promise<string | null> {
  const key = process.env["NOWNODES_API_KEY"];
  const bases = (BLOCKBOOK[chain] ?? []).filter((b) => key || !b.includes("nownodes.io"));
  return first(bases, async (b) => {
    const j = (await getJson(`${b}/address/${encodeURIComponent(address)}?details=basic`, {
      headers: { accept: "application/json", ...(b.includes("nownodes.io") && key ? { "api-key": key } : {}) },
    })) as Json | null;
    return j ? intStr(j["balance"]) : null;
  });
}

const XRP_RPC = ["https://xrplcluster.com", "https://xrpl.ws", "https://s1.ripple.com:51234"];
const TRON = ["https://api.trongrid.io", "https://tron-rpc.publicnode.com"];
const SOLANA = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const COSMOS = ["https://cosmos-rest.publicnode.com", "https://rest.cosmos.directory/cosmoshub"];
const THOR = ["https://gateway.liquify.com/chain/thorchain_api", "https://thorchain.ibs.team/api"];
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });

export async function extraBalance(chain: ExtraChain, address: string): Promise<string | null> {
  switch (chain) {
    case "DOGE": case "BCH": case "DASH": case "ZEC":
      return blockbook(chain, address);
    case "XRP":
      return first(XRP_RPC, async (b) => {
        const j = (await getJson(b, post({ method: "account_info", params: [{ account: address, ledger_index: "validated" }] }))) as Json | null;
        const r = j?.["result"] as Json | undefined;
        if (!r) return null;
        if (r["error"] === "actNotFound") return "0";
        return intStr((r["account_data"] as Json | undefined)?.["Balance"]);
      });
    case "TRX":
      return first(TRON, async (b) => {
        const j = (await getJson(`${b}/wallet/getaccount`, post({ address, visible: true }))) as Json | null;
        if (!j || j["Error"]) return null;
        return j["balance"] === undefined ? "0" : intStr(j["balance"]);
      });
    case "SOL":
      return first(SOLANA, async (b) => {
        const j = (await getJson(b, post({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "finalized" }] }))) as Json | null;
        return intStr(((j?.["result"] as Json | undefined)?.["value"]));
      });
    case "ATOM": case "RUNE": {
      const [bases, denom] = chain === "ATOM" ? [COSMOS, "uatom"] : [THOR, "rune"];
      return first(bases, async (b) => {
        const j = (await getJson(`${b}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}/by_denom?denom=${denom}`, { headers: { accept: "application/json" } })) as Json | null;
        const bal = j?.["balance"] as Json | undefined;
        return bal ? intStr(bal["amount"]) ?? "0" : null;
      });
    }
    case "ADA": {
      const j = await getJson("https://api.koios.rest/api/v1/address_info", post({ _addresses: [address] }));
      if (!Array.isArray(j)) return null;
      return j.length === 0 ? "0" : intStr(j[0]?.["balance"]);
    }
    case "XMR":
      return null;
  }
}

/** Strict per-coin address shapes, so this can't be used to fetch arbitrary URLs. */
export const EXTRA_ADDRESS_RE: Record<ExtraChain, RegExp> = {
  DOGE: /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/,
  BCH: /^bitcoincash:[qp][02-9ac-hj-np-z]{41}$/,
  DASH: /^X[1-9A-HJ-NP-Za-km-z]{25,34}$/,
  ZEC: /^t1[1-9A-HJ-NP-Za-km-z]{33}$/,
  XRP: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  TRX: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  ATOM: /^cosmos1[02-9ac-hj-np-z]{38}$/,
  RUNE: /^thor1[02-9ac-hj-np-z]{38}$/,
  ADA: /^addr1[02-9ac-hj-np-z]{98}$/,
  XMR: /^4[1-9A-HJ-NP-Za-km-z]{94}$/,
};
