import type { SwapProviderId, SwapQuote } from "./types";

/** A user's explicit provider choice never falls back to a different service. */
export function selectedSwapQuote(quotes: SwapQuote[], provider: SwapProviderId | null): SwapQuote | null {
  return provider === null ? quotes[0] ?? null : quotes.find(quote => quote.provider === provider) ?? null;
}

export function assertSwapProvider(requested: SwapProviderId, returned: SwapProviderId): void {
  if (requested !== returned) throw new Error("The swap service changed. Nothing was sent. Select your route again.");
}