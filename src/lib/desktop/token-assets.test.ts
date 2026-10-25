import { expect, it } from "vitest";
import { desktopTokenIdentity } from "./token-assets";
import { USDC_BY_CHAIN } from "@/lib/chains/erc20";

it("custom sUSDS is listed by contract without assuming a one-dollar share price", () => {
  const row = desktopTokenIdentity("eth", { symbol: "sUSDS", address: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD", decimals: 18 });
  expect(row.key).toBe("eth-0xa3931d71877c0e7a3148cb7eb4463524fec27fbd");
  expect(row.custom).toBe(true); expect(row.price).toBeNull(); expect(row.stable).toBe(false);
});
it("a custom USDC symbol cannot inherit the real USDC peg or identity", () => {
  const fake = desktopTokenIdentity("base", { symbol: "USDC", address: "0x1234567890123456789012345678901234567890", decimals: 6 });
  expect(fake.price).toBeNull(); expect(fake.key).not.toBe("base-USDC");
  expect(desktopTokenIdentity("base", USDC_BY_CHAIN.base)).toEqual({ key: "base-USDC", stable: true, price: 1, custom: false });
});