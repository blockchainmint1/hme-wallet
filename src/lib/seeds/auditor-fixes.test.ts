import { describe, expect, it } from "vitest";
import { pocketSweepFeeProblem } from "./pocket";
import { createRateLimiter } from "@/lib/security/nectar-pay-policy";
import { EXTRA_BALANCE_LIMIT_PER_MIN } from "./extra-balances.functions";

describe("pocket Move back fee cap", () => {
  it("allows a normal 1 sat/vB fee", () => {
    expect(pocketSweepFeeProblem(200, 200)).toBeNull();
  });
  it("refuses at 5,000 sat/vB or more", () => {
    expect(pocketSweepFeeProblem(5_000 * 200, 200)).toMatch(/unusually high/);
    expect(pocketSweepFeeProblem(4_999 * 200, 200)).toBeNull();
  });
  it("refuses below 1 sat/vB of the signed size", () => {
    expect(pocketSweepFeeProblem(199, 200)).toMatch(/below the network minimum/);
  });
});

describe("extra-coin balance lookup limit", () => {
  it("allows 20 lookups a minute per visitor, then refuses until the minute passes", () => {
    expect(EXTRA_BALANCE_LIMIT_PER_MIN).toBe(20);
    const allow = createRateLimiter(EXTRA_BALANCE_LIMIT_PER_MIN, 60_000);
    for (let i = 0; i < 20; i++) expect(allow("1.2.3.4", 1_000 + i)).toBe(true);
    expect(allow("1.2.3.4", 2_000)).toBe(false);
    expect(allow("5.6.7.8", 2_000)).toBe(true);
    expect(allow("1.2.3.4", 61_000)).toBe(true);
  });
});
