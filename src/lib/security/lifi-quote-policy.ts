/** Honest Money never adds an integrator fee. Pool and gas costs still apply. */
export function lifiQuoteParameters(data: {
  chain: "eth" | "base" | "bsc"; fromToken: string; toToken: string; fromAmount: string; fromAddress: string; slippage?: number;
}) {
  const chain = { eth: 1, base: 8453, bsc: 56 }[data.chain];
  return new URLSearchParams({ fromChain: String(chain), toChain: String(chain), fromToken: data.fromToken,
    toToken: data.toToken, fromAmount: data.fromAmount, fromAddress: data.fromAddress,
    slippage: String(data.slippage ?? 0.005), order: "RECOMMENDED", fee: "0" });
}

export function assertLifiServerAvailable(disabled: string | undefined) {
  if (disabled) throw new Error("Swaps are temporarily unavailable");
}