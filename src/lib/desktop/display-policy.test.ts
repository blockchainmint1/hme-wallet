import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { isPortfolioRefreshKey, visibleAllocation } from "./display-policy";

describe("desktop display audit rules", () => {
  it("refreshes portfolio balances and prices only, leaving history and swaps valid", async () => {
    const client = new QueryClient();
    const included = ["account", "isk-account", "btc-account", "ltc-account", "doge-account", "evm-balance", "erc20-balance", "tsd-balance-usd", "tron-balance", "tron-trc20", "solana-balance", "txc-price", "isk-price", "btc-price", "ltc-price", "doge-price", "all-prices", "tron-price"];
    const excluded = ["evm-history", "desktop-txs", "tron-history", "solana-history", "swap-quotes", "thorchain-quote", "swap-order", "ecosystem-sites", "unknown"];
    for (const head of [...included, ...excluded]) client.setQueryData([head, "test-wallet"], 1);
    await client.invalidateQueries({ predicate: q => isPortfolioRefreshKey(q.queryKey), refetchType: "none" });
    for (const head of included) expect(client.getQueryState([head, "test-wallet"])?.isInvalidated).toBe(true);
    for (const head of excluded) expect(client.getQueryState([head, "test-wallet"])?.isInvalidated).toBe(false);
    expect(isPortfolioRefreshKey([])).toBe(false);
    client.clear();
  });
  it("does not expose funded asset names or rankings when balances are hidden", () => {
    const ranked = [{ symbol: "BTC", share: 62 }, { symbol: "ETH", share: 38 }];
    expect(visibleAllocation(ranked, true)).toEqual([]);
    expect(visibleAllocation(ranked, false)).toEqual(ranked);
  });
});