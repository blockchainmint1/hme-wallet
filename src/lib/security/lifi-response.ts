/** Untrusted quote JSON is validated before display or numeric conversions. */
import { z } from "zod";
const amount = z.string().regex(/^\d{1,78}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export const lifiQuoteSchema = z.object({
  estimate: z.object({
    fromAmount: amount, toAmount: amount, toAmountMin: amount,
    approvalAddress: address, executionDuration: z.number().finite().nonnegative(),
    feeCosts: z.array(z.object({ name: z.string().max(200), amountUSD: z.string().max(100).optional() })).max(20).optional(),
    gasCosts: z.array(z.object({ amountUSD: z.string().max(100).optional(), estimate: amount.optional() })).max(20).optional(),
  }),
  transactionRequest: z.object({
    to: address, data: hex.max(262144), value: hex,
    chainId: z.union([z.literal(1), z.literal(8453), z.literal(56)]),
    gasLimit: hex.optional(), gasPrice: hex.optional(),
  }),
  tool: z.string().max(100),
  toolDetails: z.object({ name: z.string().max(200), logoURI: z.string().max(2048).optional() }).optional(),
});

export async function readLifiQuote(response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Swap quote unavailable. Please try again later.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Swap quote unavailable.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) throw new Error("Swap quote exceeds the supported size.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    return lifiQuoteSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error("Swap provider returned an unsupported quote.");
  }
}