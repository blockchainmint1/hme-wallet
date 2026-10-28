import { describe, expect, it } from "vitest";
import { createRateLimiter, nectarPayBody, nectarPayTarget } from "./nectar-pay-policy";

const q = (s: string) => new URLSearchParams(s);

describe("NectarPay relay policy", () => {
  it("forwards a well-formed invoice with its tap nonce only", () => {
    expect(nectarPayTarget("inv_ABC123", q("t=nonce12345"))).toBe("https://nectar-pay.com/api/public/v1/pay/inv_ABC123?t=nonce12345");
  });
  it("refuses missing nonce, extra params, and odd invoice IDs", () => {
    expect(nectarPayTarget("inv_ABC123", q(""))).toBeNull();
    expect(nectarPayTarget("inv_ABC123", q("t=nonce12345&x=1"))).toBeNull();
    expect(nectarPayTarget("../admin", q("t=nonce12345"))).toBeNull();
    expect(nectarPayTarget("a".repeat(65), q("t=nonce12345"))).toBeNull();
  });
  it("accepts only an { option } body", () => {
    expect(nectarPayBody({ option: "base:USDC" })).toBe('{"option":"base:USDC"}');
    expect(nectarPayBody({ option: "x", address: "0xevil" })).toBeNull();
    expect(nectarPayBody({ option: 5 })).toBeNull();
    expect(nectarPayBody([])).toBeNull();
  });
  it("allows 20 requests per minute per client, then refuses", () => {
    const allow = createRateLimiter(20, 60_000);
    for (let i = 0; i < 20; i++) expect(allow("1.2.3.4", 0)).toBe(true);
    expect(allow("1.2.3.4", 1)).toBe(false);
    expect(allow("5.6.7.8", 1)).toBe(true);
    expect(allow("1.2.3.4", 60_000)).toBe(true);
  });
});
