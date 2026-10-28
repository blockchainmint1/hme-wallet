import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchThorUsdcBtcQuote } from "./usdc-btc.server";
import { THOR_USDC } from "./usdc-btc";
const destination = "bc1qup236qj2mr87ml9388ydm33tuhtdckk33j68qx";
afterEach(() => vi.unstubAllGlobals());
function fixture(change: Record<string, unknown> = {}, halted = false) {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url); requests.push(u);
    const body = u.pathname.endsWith("inbound_addresses") ? [{ chain: "ETH", address: "0x718f6c9df785bc4e323086de024ca822efbe8ab9", router: THOR_USDC.eth.router, halted, global_trading_paused: false, chain_trading_paused: false }, { chain: "BTC", address: destination, halted: false, global_trading_paused: false, chain_trading_paused: false }]
      : u.pathname.endsWith("pools") ? [{ asset: `ETH.USDC-${THOR_USDC.eth.token.toUpperCase()}`, status: "Available" }, { asset: "BTC.BTC", status: "Available" }]
      : { inbound_address: "0x718f6c9df785bc4e323086de024ca822efbe8ab9", router: THOR_USDC.eth.router, memo: `=:b:${destination}:990000/1/0`, expiry: Math.floor(Date.now()/1000) + 600, expected_amount_out: "1000000", recommended_min_amount_in: "100000000", max_streaming_quantity: 1, fees: { asset: "BTC.BTC", affiliate: "0", total: "2000" }, ...change };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  })); return requests;
}
describe("THORChain USDC-BTC public quote", () => {
  it("requests USDC to BTC with exact 6-to-8 decimal conversion and no affiliate", async () => {
    const requests = fixture(); const q = await fetchThorUsdcBtcQuote({ network: "eth", amount: "1000.123456", destination });
    const request = requests.find(u => u.pathname.endsWith("quote/swap"));
    expect(request?.searchParams.get("amount")).toBe("100012345600"); expect(request?.searchParams.get("to_asset")).toBe("BTC.BTC"); expect(request?.searchParams.get("destination")).toBe(destination);
    expect(request?.searchParams.get("liquidity_tolerance_bps")).toBe("100"); expect(request?.searchParams.has("tolerance_bps")).toBe(false); expect(request?.searchParams.has("affiliate")).toBe(false);
    expect(q.minimumSats).toBe("990000"); expect(q.provider).toBe("thorchain");
  });
  it("refuses halted trading before requesting a quote", async () => { const requests = fixture({}, true); await expect(fetchThorUsdcBtcQuote({ network: "eth", amount: "1000", destination })).rejects.toThrow("paused"); expect(requests.some(u => u.pathname.endsWith("quote/swap"))).toBe(false); });
  it("refuses changed inbound address", async () => { fixture({ inbound_address: "0x1111111111111111111111111111111111111111" }); await expect(fetchThorUsdcBtcQuote({ network: "eth", amount: "1000", destination })).rejects.toThrow("changed"); });
  it("refuses affiliate fees", async () => { fixture({ fees: { asset: "BTC.BTC", affiliate: "25", total: "2000" } }); await expect(fetchThorUsdcBtcQuote({ network: "eth", amount: "1000", destination })).rejects.toThrow(); });
  it("refuses below recommended minimum", async () => { fixture({ recommended_min_amount_in: "100000000001" }); await expect(fetchThorUsdcBtcQuote({ network: "eth", amount: "1000", destination })).rejects.toThrow("minimum"); });
  it("refuses a missing halt flag rather than assuming trading is active", async () => {
    fixture(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ chain: "ETH", address: "0x1111111111111111111111111111111111111111", halted: false }]), { headers: { "content-type": "application/json" } })));
    await expect(fetchThorUsdcBtcQuote({ network: "eth", amount: "1000", destination })).rejects.toThrow();
  });
});