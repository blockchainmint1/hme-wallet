import { describe, expect, it } from "vitest";
import { usdcToUsdsEstimate, usdsCostForUsdc, usdsToUsdcEstimate } from "./sky-conversion";

describe("official Sky conversion estimates (not execution permission)", () => {
  it("converts 100 USDC to 100 USDS with zero fee", () => {
    expect(usdcToUsdsEstimate(100_000_000n, 0n)).toBe(100n * 10n ** 18n);
  });
  it("subtracts the current entry fee rather than assuming a permanent 1:1 route", () => {
    expect(usdcToUsdsEstimate(100_000_000n, 10n ** 16n)).toBe(99n * 10n ** 18n);
  });
  it("accounts for exit fees in the USDS cost of exactly 100 USDC", () => {
    expect(usdsCostForUsdc(100_000_000n, 10n ** 16n)).toBe(101n * 10n ** 18n);
  });
  it("returns exactly 100 USDC for a 100 USDS zero-fee redemption budget", () => {
    expect(usdsToUsdcEstimate(100n * 10n ** 18n, 0n)).toBe(100_000_000n);
  });
  it("rounds exit proceeds down and never exceeds the budget", () => {
    const budget = 100n * 10n ** 18n;
    const output = usdsToUsdcEstimate(budget, 10n ** 16n);
    expect(output).toBe(99_009_900n);
    expect(usdsCostForUsdc(output, 10n ** 16n)).toBeLessThanOrEqual(budget);
    expect(usdsCostForUsdc(output + 1n, 10n ** 16n)).toBeGreaterThan(budget);
  });
  it("rejects halted conversion in both directions", () => {
    const halted = 2n ** 256n - 1n;
    expect(() => usdcToUsdsEstimate(100_000_000n, halted)).toThrow("halted");
    expect(() => usdsToUsdcEstimate(100n * 10n ** 18n, halted)).toThrow("halted");
  });
  it("rejects zero-output, negative amounts and arithmetic overflow", () => {
    expect(() => usdcToUsdsEstimate(1n, 10n ** 18n)).toThrow("no USDS");
    expect(() => usdcToUsdsEstimate(-1n, 0n)).toThrow("amount");
    expect(() => usdsToUsdcEstimate(1n, 0n)).toThrow("no USDC");
    expect(() => usdcToUsdsEstimate(2n ** 256n - 1n, 0n)).toThrow("amount");
  });
});