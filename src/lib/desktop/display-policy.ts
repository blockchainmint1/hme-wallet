/** Only portfolio balances and prices may be refreshed from the overview. */
const PORTFOLIO_QUERY_HEADS = new Set([
  "account", "isk-account", "btc-account", "ltc-account", "doge-account",
  "evm-balance", "erc20-balance", "tsd-balance-usd", "tron-balance",
  "tron-trc20", "solana-balance", "txc-price", "isk-price", "btc-price",
  "ltc-price", "doge-price", "all-prices", "tron-price",
]);

export function isPortfolioRefreshKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && PORTFOLIO_QUERY_HEADS.has(key[0]);
}

export function visibleAllocation<T>(rankedAssets: readonly T[], hidden: boolean): readonly T[] {
  return hidden ? [] : rankedAssets;
}