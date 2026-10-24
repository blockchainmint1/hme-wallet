import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import { LIFI_DIAMOND, LIFI_NATIVE, verifyLifiQuote, type LifiChain } from "./lifi-policy";
import { inspectNordsternHeader } from "./nordstern-inspection";

function captured(chain: "eth" | "base") {
  const quote = JSON.parse(readFileSync(new URL(`./fixtures/lifi-quote-${chain}.json`, import.meta.url), "utf8")) as SwapQuote;
  const native = chain === "base";
  const verified = verifyLifiQuote(quote, { chain, user: "0x000000000000000000000000000000000000dEaD",
    fromToken: native ? LIFI_NATIVE : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    toToken: native ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : LIFI_NATIVE,
    fromAmount: BigInt(quote.estimate.fromAmount), minAmountOutFloor: BigInt(quote.estimate.toAmountMin) });
  const hop = verified.hops.at(-1); if (!hop) throw new Error("missing captured hop");
  return hop.callData;
}
describe("Nordstern captured packed-header inspection (not an accepted route)", () => {
  it.each([
    ["eth", 99750000n, "0xe6eeda550918638529c6cf2ea14f9ea0572d6f88"],
    ["base", 9975000000000000n, "0x939e398d2c31b0757d009222de99c6e461d3de15"],
  ] as const)("reads actual %s executor, post-fee input and Diamond recipient", (chain, amount, executor) => {
    const inspected = inspectNordsternHeader(captured(chain));
    expect(inspected.amountIn).toBe(amount); expect(inspected.executor.toLowerCase()).toBe(executor);
    expect(inspected.firstTokenReceiver).toBe(inspected.executor);
    expect(inspected.recipient).toBe(LIFI_DIAMOND[chain as LifiChain]);
    expect(inspected.executorHeaderByte).toBe(7);
    expect(inspected.unreviewedProgram.length).toBeGreaterThan(2);
  });
  it("retains the complete unknown tail without pretending it is reviewed", () => {
    const data = captured("eth"); const inspected = inspectNordsternHeader(data);
    expect(inspected.unreviewedProgram).toBe(`0x${data.slice(2 + 139 * 2)}`);
  });
  it.each(["0x3f0bde25", "0x3f0bde250", "0x04e45aaf", "0xzz"])("rejects malformed/truncated header %s", data => {
    expect(() => inspectNordsternHeader(data as Hex)).toThrow("Invalid or truncated");
  });
});