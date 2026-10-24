import { expect, it } from "vitest";
import { assertLifiServerAvailable, lifiQuoteParameters } from "./lifi-quote-policy";
it("Honest Money charges zero integrator fees and selects no fee wallet", () => {
  const params = lifiQuoteParameters({ chain: "eth", fromToken: "a", toToken: "b", fromAmount: "20000000", fromAddress: "c" });
  expect(params.get("fee")).toBe("0"); expect(params.has("integrator")).toBe(false);
});
it("any configured emergency stop refuses new execution authorization", () => {
  expect(() => assertLifiServerAvailable("true")).toThrow("temporarily unavailable");
  expect(() => assertLifiServerAvailable("false")).toThrow("temporarily unavailable");
  expect(() => assertLifiServerAvailable(undefined)).not.toThrow();
});