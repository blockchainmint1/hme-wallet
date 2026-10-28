/**
 * Server-side THORChain catalog quoting. Every quote is cross-checked
 * against a separately fetched inbound_addresses record: the deposit address
 * and (for EVM chains) the router must match, halt flags are honored, and the
 * memo is bound to the exact destination and after-fee minimum before the
 * quote ever reaches the browser.
 */
import {
  THOR_CATALOG,
  THOR_EVM_ROUTERS,
  parseAssetAmount,
  toThorUnits,
  validateSwapMemo,
  validateThorDestination,
  type ThorAssetId,
  type ThorAssetMeta,
  type ThorCatalogQuote,
} from "./catalog";
import { nodeGet } from "./thornode.server";

export interface ThorCatalogQuoteInput {
  from: ThorAssetId;
  to: ThorAssetId;
  /** User-entered decimal amount in the source asset. */
  amount: string;
  destination: string;
  /** After-fee price protection; default 100 bps (1%). */
  toleranceBps?: number;
}

interface InboundRecord {
  chain?: string;
  address?: string;
  router?: string;
  halted?: boolean;
  global_trading_paused?: boolean;
  chain_trading_paused?: boolean;
}

interface PoolRecord {
  asset?: string;
  status?: string;
}

interface RawQuote {
  inbound_address?: string;
  router?: string;
  memo?: string;
  expected_amount_out?: string;
  expiry?: string | number;
  recommended_min_amount_in?: string;
  dust_threshold?: string;
  max_streaming_quantity?: number;
  total_swap_seconds?: number;
  outbound_delay_seconds?: number;
  fees?: { total?: string; affiliate?: string };
  error?: string;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function fetchChainState() {
  const [inbounds, pools, mimir] = await Promise.all([
    nodeGet<InboundRecord[]>("/thorchain/inbound_addresses"),
    nodeGet<PoolRecord[]>("/thorchain/pools"),
    nodeGet<Record<string, number>>("/thorchain/mimir").catch(() => ({}) as Record<string, number>),
  ]);
  const live = new Set(
    pools.filter((p) => p.status === "Available").map((p) => (p.asset ?? "").toUpperCase()),
  );
  const halted = (chain: string) =>
    mimir[`HALT${chain}TRADING`] === 1 || mimir[`SOLVENCYHALT${chain}CHAIN`] === 1;
  return { inbounds, live, halted, globalHalt: mimir["HALTTRADING"] === 1 };
}

/** Catalog assets whose pools are live and whose chains are not halted. */
export async function fetchCatalogRoutes(): Promise<ThorAssetId[]> {
  const state = await fetchChainState();
  if (state.globalHalt) return [];
  return (Object.keys(THOR_CATALOG) as ThorAssetId[]).filter((id) => {
    const meta = THOR_CATALOG[id];
    return state.live.has(meta.thorAsset.toUpperCase()) && !state.halted(meta.thorChain);
  });
}

function checkChain(state: Awaited<ReturnType<typeof fetchChainState>>, meta: ThorAssetMeta): InboundRecord {
  if (state.globalHalt) throw new Error("THORChain has paused trading network-wide. Try again later.");
  if (state.halted(meta.thorChain)) throw new Error(`${meta.label} swaps are paused on THORChain right now.`);
  if (!state.live.has(meta.thorAsset.toUpperCase())) {
    throw new Error(`The ${meta.label} pool is not available on THORChain right now.`);
  }
  const inbound = state.inbounds.find((r) => r.chain === meta.thorChain);
  if (!inbound?.address || inbound.halted || inbound.global_trading_paused || inbound.chain_trading_paused) {
    throw new Error(`${meta.label} deposits are paused on THORChain right now.`);
  }
  if (meta.kind !== "utxo") {
    const pinned = THOR_EVM_ROUTERS[meta.chain as keyof typeof THOR_EVM_ROUTERS];
    if (!inbound.router || !same(inbound.router, pinned)) {
      throw new Error("THORChain's router changed. This route is refused until the new router is reviewed.");
    }
  }
  return inbound;
}

export async function fetchCatalogQuote(input: ThorCatalogQuoteInput): Promise<ThorCatalogQuote> {
  const from = THOR_CATALOG[input.from];
  const to = THOR_CATALOG[input.to];
  if (!from || !to) throw new Error("Choose a supported swap route.");
  if (from.id === to.id) throw new Error("Choose two different assets.");
  const toleranceBps = input.toleranceBps ?? 100;
  if (!Number.isInteger(toleranceBps) || toleranceBps < 50 || toleranceBps > 2000) {
    throw new Error("Invalid price protection.");
  }
  const rawIn = parseAssetAmount(input.amount, from.decimals);
  const amountIn = toThorUnits(rawIn, from.decimals);
  validateThorDestination(to, input.destination);

  const state = await fetchChainState();
  const inbound = checkChain(state, from);
  checkChain(state, to);

  const params = new URLSearchParams({
    from_asset: from.thorAsset,
    to_asset: to.thorAsset,
    amount: amountIn,
    destination: input.destination,
    // Protect the actual after-fee quote, never the feeless spot price.
    liquidity_tolerance_bps: String(toleranceBps),
    streaming_interval: "1",
    streaming_quantity: "0",
  });
  const q = await nodeGet<RawQuote>(`/thorchain/quote/swap?${params.toString()}`);
  if (q.error) throw new Error(q.error);
  if (!q.inbound_address || !q.memo || !q.expected_amount_out || q.expiry == null) {
    throw new Error("THORChain returned an incomplete quote. Try again.");
  }
  // The deposit address must be the one from the independently fetched
  // inbound record — a quote pointing anywhere else is refused.
  if (!same(q.inbound_address, inbound.address!)) {
    throw new Error("THORChain's deposit address changed. Get a new quote.");
  }
  if (from.kind !== "utxo") {
    const pinned = THOR_EVM_ROUTERS[from.chain as keyof typeof THOR_EVM_ROUTERS];
    if (!q.router || !same(q.router, pinned)) {
      throw new Error("THORChain's router changed. This route is refused until it is reviewed.");
    }
  }
  if (q.fees?.affiliate && q.fees.affiliate !== "0") {
    throw new Error("THORChain quote includes an affiliate fee, which this wallet never pays.");
  }
  if (q.recommended_min_amount_in && BigInt(amountIn) < BigInt(q.recommended_min_amount_in)) {
    throw new Error("Amount is below THORChain's minimum for this route.");
  }
  if (from.kind === "utxo" && q.dust_threshold && BigInt(amountIn) <= BigInt(q.dust_threshold)) {
    throw new Error("Amount is too close to this chain's dust threshold to swap safely.");
  }
  const expiry = Number(q.expiry);
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= Date.now() + 60_000) {
    throw new Error("THORChain gave an expiring quote. Try again.");
  }
  const minimumOut = validateSwapMemo(q.memo, to, input.destination, q.expected_amount_out, toleranceBps);
  // Sign our own memo, rebuilt from validated parts, never THORNode's string.
  const shortForm = to.thorAsset.split("-")[0]!.toUpperCase();
  const shortIsUnique =
    [...state.live].filter((a) => a.split("-")[0] === shortForm).length === 1;
  const memo = buildSwapMemo(from, to, input.destination, minimumOut, shortIsUnique);
  const seconds =
    typeof q.total_swap_seconds === "number" ? q.total_swap_seconds
    : typeof q.outbound_delay_seconds === "number" ? q.outbound_delay_seconds
    : null;

  return Object.freeze<ThorCatalogQuote>({
    provider: "thorchain",
    from: from.id,
    to: to.id,
    rawIn: rawIn.toString(),
    amountIn,
    destination: input.destination,
    inbound: inbound.address!,
    router: from.kind === "utxo" ? null : THOR_EVM_ROUTERS[from.chain as keyof typeof THOR_EVM_ROUTERS],
    memo,
    expiry,
    expectedOut: q.expected_amount_out,
    minimumOut,
    feeOut: q.fees?.total ?? "0",
    seconds,
    toleranceBps,
    quotedAt: Date.now(),
  });
}
