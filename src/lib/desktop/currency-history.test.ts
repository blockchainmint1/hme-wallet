import { describe, expect, it } from "vitest";
import { appendCurrencyPoint, currencyHistoryKey, matchesCurrency } from "./currency-history";
describe("desktop currency observations", () => {
  const first = { at: 1, usd: 200, price: 100, amount: 2 };
  it("keeps Bitcoin separate from TXC and another wallet", () => {
    expect(currencyHistoryKey("default", "aa", "btc")).not.toBe(currencyHistoryKey("default", "aa", "txc"));
    expect(currencyHistoryKey("default", "aa", "btc")).not.toBe(currencyHistoryKey("second", "aa", "btc"));
    expect(currencyHistoryKey("default", "aa", "btc")).not.toBe(currencyHistoryKey("default", "bb", "btc"));
  });
  it("does not convert unavailable funded balances or prices into losses", () => {
    expect(appendCurrencyPoint([first], { at: 300001, usd: 0, price: null, amount: 2 }, true)).toEqual([first]);
    expect(appendCurrencyPoint([first], { at: 300001, usd: 0, price: 100, amount: 0 }, false)).toEqual([first]);
  });
  it("records a complete coin independently of other networks every five minutes", () => {
    expect(appendCurrencyPoint([first], { ...first, at: 300001, usd: 210, price: 105 }, true)).toHaveLength(2);
    expect(appendCurrencyPoint([first], { ...first, at: 300000 }, true)).toEqual([first]);
  });
  it("filters Bitcoin history without including TXC or unidentified tokens", () => {
    expect(matchesCurrency({ chain: "btc", currencyKey: "btc" }, "btc")).toBe(true);
    expect(matchesCurrency({ chain: "txc", currencyKey: "txc" }, "btc")).toBe(false);
    expect(matchesCurrency({ chain: "eth", currencyKey: null }, "eth-USDC")).toBe(false);
    expect(matchesCurrency({ chain: "eth", currencyKey: "eth-USDC" }, "eth-USDC")).toBe(true);
    expect(matchesCurrency({ chain: "base", currencyKey: "base-USDC" }, "eth-USDC")).toBe(false);
  });
});