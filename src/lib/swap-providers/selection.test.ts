import { describe, expect, it } from "vitest";
import { assertSwapProvider, selectedSwapQuote } from "./selection";
import type { SwapQuote } from "./types";

const quote = (provider: SwapQuote["provider"]): SwapQuote => ({provider, amountOut: 100, destAsset: "ETH.USDC", totalBps: null, minInSats: null, maxInSats: null, etaSeconds: null, expiry: null});
describe("explicit swap provider selection", () => {
  it("keeps THORChain when FixedFloat ranks first", () => { expect(selectedSwapQuote([quote("fixedfloat"), quote("thorchain")], "thorchain")?.provider).toBe("thorchain"); });
  it("refuses fallback when the chosen THORChain quote disappears", () => { expect(selectedSwapQuote([quote("fixedfloat")], "thorchain")).toBeNull(); });
  it("uses best quote only before an explicit choice", () => { expect(selectedSwapQuote([quote("fixedfloat"), quote("thorchain")], null)?.provider).toBe("fixedfloat"); });
  it("rejects a returned order from a different provider", () => { expect(()=>assertSwapProvider("thorchain", "fixedfloat")).toThrow("Nothing was sent"); });
  it("accepts the requested provider", () => { expect(()=>assertSwapProvider("thorchain", "thorchain")).not.toThrow(); });
});