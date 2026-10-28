import { z } from "zod";
import { THOR_USDC, thorBtcMemoMinimum, validateThorBtcIntent, validateThorBtcQuote, usdcRaw, type ThorBtcIntent, type ThorBtcQuote } from "./usdc-btc";

const nodes = ["https://gateway.liquify.com/chain/thorchain_api", "https://thornode.thorchain.network", "https://thornode.thorchain.liquify.com"];
const integer = z.string().regex(/^\d{1,78}$/);
const inboundSchema = z.array(z.object({ chain: z.string(), address: z.string(), router: z.string().optional(), halted: z.boolean(), global_trading_paused: z.boolean(), chain_trading_paused: z.boolean() })).max(100);
const poolSchema = z.array(z.object({ asset: z.string(), status: z.string() })).max(2000);
const quoteSchema = z.object({ inbound_address: z.string(), router: z.string(), memo: z.string().max(256), expiry: z.number().int(), expected_amount_out: integer,
  recommended_min_amount_in: integer, max_streaming_quantity: z.number().int().min(1).max(1_000_000_000), total_swap_seconds: z.number().nonnegative().optional(),
  fees: z.object({ asset: z.literal("BTC.BTC"), affiliate: z.literal("0"), total: integer }) });
async function readNode(path: string): Promise<unknown> {
  for (const node of nodes) {
    try {
      const response = await fetch(`${node}${path}`, { redirect: "error", headers: { accept: "application/json", "x-client-id": "hme-wallet" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) continue;
      const reader = response.body?.getReader();
      if (!reader) continue;
      const decoder = new TextDecoder(); let text = ""; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.length;
          if (size > 1_000_000) { await reader.cancel(); throw new Error("Oversized THORChain response"); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      const json: unknown = JSON.parse(text);
      if (json && typeof json === "object" && ("error" in json || "code" in json)) continue;
      return json;
    } catch { /* Same protocol, fixed public nodes only; no exchange fallback. */ }
  }
  throw new Error("THORChain could not provide a quote. Trading may be paused, the amount may be too small, or its nodes may be unavailable.");
}
export async function fetchThorUsdcBtcQuote(intent: ThorBtcIntent): Promise<ThorBtcQuote> {
  validateThorBtcIntent(intent);
  const config = THOR_USDC[intent.network];
  const [inbounds, pools] = await Promise.all([readNode("/thorchain/inbound_addresses").then(raw => inboundSchema.parse(raw)), readNode("/thorchain/pools").then(raw => poolSchema.parse(raw))]);
  const source = inbounds.find(row => row.chain === config.chain);
  const btc = inbounds.find(row => row.chain === "BTC");
  if (!source || !btc || [source, btc].some(row => row.halted || row.global_trading_paused || row.chain_trading_paused)) throw new Error("THORChain has paused this USDC-to-BTC route.");
  if (source.router?.toLowerCase() !== config.router.toLowerCase()) throw new Error("THORChain router changed; a new review is required.");
  const asset = `${config.chain}.USDC-${config.token.toUpperCase()}`;
  const available = new Set(pools.filter(row => row.status === "Available").map(row => row.asset.toUpperCase()));
  if (!available.has(asset) || !available.has("BTC.BTC")) throw new Error("THORChain's USDC or BTC pool is unavailable.");
  // USDC has 6 decimals; THORNode always expects 8 decimals. Never use Number for amounts.
  const amount = usdcRaw(intent.amount) * 100n;
  const params = new URLSearchParams({ from_asset: asset, to_asset: "BTC.BTC", amount: amount.toString(), destination: intent.destination, liquidity_tolerance_bps: "100", streaming_interval: "1", streaming_quantity: "0" });
  const raw = quoteSchema.parse(await readNode(`/thorchain/quote/swap?${params}`));
  if (raw.inbound_address.toLowerCase() !== source.address.toLowerCase() || raw.router.toLowerCase() !== source.router?.toLowerCase()) throw new Error("THORChain deposit address changed during quoting. Get a new quote.");
  if (amount < BigInt(raw.recommended_min_amount_in)) throw new Error("Amount is below THORChain's recommended minimum; raise the USDC amount.");
  const minimumSats = thorBtcMemoMinimum(raw.memo, intent.destination, raw.expected_amount_out, raw.max_streaming_quantity);
  const quote: ThorBtcQuote = Object.freeze({ intent: Object.freeze({ ...intent }), provider: "thorchain", inbound: raw.inbound_address as `0x${string}`, router: raw.router as `0x${string}`, memo: raw.memo, expiry: raw.expiry, expectedSats: raw.expected_amount_out, minimumSats, feeSats: raw.fees.total, seconds: raw.total_swap_seconds ?? null, quotedAt: Date.now() });
  validateThorBtcQuote(quote);
  return quote;
}