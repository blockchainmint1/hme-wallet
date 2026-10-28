import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCatalogQuote, fetchCatalogRoutes } from "./catalog.server";
import { THOR_EVM_ROUTERS } from "./catalog";

const BTC_DEST = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const ETH_INBOUND = "0x718f6c9df785bc4e32a0db0f4e4b6a9b0e8a0e8a12";
const BTC_INBOUND = "bc1qup236qj2mr87ml93exampleaddress000000000000";

function inboundRow(chain: string, over: Record<string, unknown> = {}) {
  const evm = chain === "ETH" || chain === "BASE" || chain === "BSC";
  return {
    chain,
    address: evm ? ETH_INBOUND : BTC_INBOUND,
    router: evm ? THOR_EVM_ROUTERS[chain.toLowerCase() as "eth" | "base" | "bsc"] : undefined,
    halted: false,
    global_trading_paused: false,
    chain_trading_paused: false,
    ...over,
  };
}

function quoteBody(over: Record<string, unknown> = {}) {
  return {
    inbound_address: ETH_INBOUND,
    router: THOR_EVM_ROUTERS.eth,
    memo: `=:BTC.BTC:${BTC_DEST}:1219301/1/0`,
    expected_amount_out: "1231618",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    recommended_min_amount_in: "1000",
    dust_threshold: "10000",
    max_streaming_quantity: 10,
    total_swap_seconds: 30,
    fees: { asset: "BTC.BTC", affiliate: "0", outbound: "10000", liquidity: "2317", total: "12317", slippage_bps: 10, total_bps: 100 },
    ...over,
  };
}

function mockNode(over: { quote?: Record<string, unknown>; inbounds?: unknown[]; pools?: unknown[]; mimir?: Record<string, number> } = {}) {
  const inbounds = over.inbounds ?? [inboundRow("ETH"), inboundRow("BTC"), inboundRow("BASE"), inboundRow("BSC"), inboundRow("DOGE"), inboundRow("LTC")];
  const pools = over.pools ?? [
    { asset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", status: "Available" },
    { asset: "BTC.BTC", status: "Available" },
    { asset: "ETH.ETH", status: "Available" },
    { asset: "BASE.ETH", status: "Available" },
    { asset: "BSC.BNB", status: "Available" },
    { asset: "DOGE.DOGE", status: "Available" },
    { asset: "LTC.LTC", status: "Available" },
  ];
  const mimir = over.mimir ?? {};
  const quote = over.quote ?? quoteBody();
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/inbound_addresses") ? inbounds
      : url.includes("/pools") ? pools
      : url.includes("/mimir") ? mimir
      : url.includes("/quote/swap") ? quote
      : null;
    if (!body) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

describe("fetchCatalogRoutes", () => {
  beforeEach(() => mockNode());
  afterEach(() => vi.restoreAllMocks());

  it("lists assets with live pools and unhalted chains", async () => {
    const routes = await fetchCatalogRoutes();
    expect(routes).toContain("usdc-eth");
    expect(routes).toContain("btc");
    expect(routes).toContain("doge");
    expect(routes).not.toContain("usdc-base"); // pool not in mock
  });

  it("excludes halted chains", async () => {
    vi.restoreAllMocks();
    mockNode({ mimir: { HALTBTCTRADING: 1 } });
    const routes = await fetchCatalogRoutes();
    expect(routes).not.toContain("btc");
  });

  it("returns nothing during a global halt", async () => {
    vi.restoreAllMocks();
    mockNode({ mimir: { HALTTRADING: 1 } });
    expect(await fetchCatalogRoutes()).toEqual([]);
  });
});

describe("fetchCatalogQuote", () => {
  afterEach(() => vi.restoreAllMocks());

  const input = { from: "usdc-eth" as const, to: "btc" as const, amount: "1000", destination: BTC_DEST };

  it("returns a frozen, cross-checked quote", async () => {
    mockNode();
    const q = await fetchCatalogQuote(input);
    expect(q.provider).toBe("thorchain");
    expect(q.rawIn).toBe("1000000000");
    expect(q.amountIn).toBe("100000000000");
    expect(q.inbound).toBe(ETH_INBOUND);
    expect(q.router).toBe(THOR_EVM_ROUTERS.eth);
    expect(q.minimumOut).toBe("1219301");
    expect(Object.isFrozen(q)).toBe(true);
  });

  it("requests after-fee price protection and streaming", async () => {
    const spy = mockNode();
    await fetchCatalogQuote(input);
    const quoteCall = spy.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/quote/swap"))!;
    expect(quoteCall).toContain("liquidity_tolerance_bps=100");
    expect(quoteCall).toContain("streaming_interval=1");
    expect(quoteCall).toContain("streaming_quantity=0");
    expect(quoteCall).not.toContain("affiliate");
    expect(quoteCall).not.toContain("tolerance_bps=");
  });

  it("refuses when the quote's deposit address differs from the inbound record", async () => {
    mockNode({ quote: quoteBody({ inbound_address: "0x000000000000000000000000000000000000dead" }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/deposit address changed/);
  });

  it("refuses when the router changed", async () => {
    mockNode({ quote: quoteBody({ router: "0x000000000000000000000000000000000000dead" }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/router changed/);
  });

  it("refuses when the inbound record's router changed", async () => {
    mockNode({ inbounds: [inboundRow("ETH", { router: "0x000000000000000000000000000000000000dead" }), inboundRow("BTC")] });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/router changed/);
  });

  it("refuses a halted source chain", async () => {
    mockNode({ inbounds: [inboundRow("ETH", { halted: true }), inboundRow("BTC")] });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/paused/);
  });

  it("refuses an affiliate fee", async () => {
    mockNode({ quote: quoteBody({ fees: { ...quoteBody().fees, affiliate: "500" } }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/affiliate/);
  });

  it("refuses amounts below the recommended minimum", async () => {
    mockNode({ quote: quoteBody({ recommended_min_amount_in: "999999999999" }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/minimum/);
  });

  it("refuses UTXO amounts at the dust threshold", async () => {
    mockNode({
      quote: quoteBody({ inbound_address: BTC_INBOUND, router: undefined, dust_threshold: "100000000000" }),
    });
    await expect(
      fetchCatalogQuote({ from: "btc", to: "usdc-eth", amount: "1", destination: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }),
    ).rejects.toThrow(/dust/);
  });

  it("refuses a memo that changed the payout address", async () => {
    mockNode({ quote: quoteBody({ memo: "=:BTC.BTC:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq:1219301/1/0" }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/memo/);
  });

  it("refuses an expiring quote", async () => {
    mockNode({ quote: quoteBody({ expiry: Math.floor(Date.now() / 1000) + 30 }) });
    await expect(fetchCatalogQuote(input)).rejects.toThrow(/expiring/);
  });

  it("refuses the same asset on both sides", async () => {
    mockNode();
    await expect(fetchCatalogQuote({ ...input, to: "usdc-eth" })).rejects.toThrow(/different/);
  });
});
