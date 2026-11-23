import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter } from "@/lib/security/nectar-pay-policy";
import { z } from "zod";
import { EXTRA_CHAINS, type ExtraChain } from "@/lib/xpub-link/delegate-keys";

const Input = z.object({
  items: z.array(z.object({ chain: z.enum(EXTRA_CHAINS), address: z.string().min(20).max(120) })).min(1).max(EXTRA_CHAINS.length),
});

/**
 * About 20 lookups a minute per visitor: each call fans out to up to ten
 * outside services and needs no key. Best effort per server instance.
 */
export const EXTRA_BALANCE_LIMIT_PER_MIN = 20;
const allow = createRateLimiter(EXTRA_BALANCE_LIMIT_PER_MIN, 60_000);

function visitorKey(h: Headers): string {
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Balances (smallest units, as strings) for Seeds' extra-coin pocket addresses; null = couldn't check. */
export const getExtraPocketBalances = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    if (!allow(visitorKey(getRequest().headers))) throw new Error("Too many balance checks — please wait a minute and refresh.");
    const { extraBalance, EXTRA_ADDRESS_RE } = await import("./extra-balances.server");
    const out: Partial<Record<ExtraChain, string | null>> = {};
    await Promise.all(data.items.map(async ({ chain, address }) => {
      out[chain] = EXTRA_ADDRESS_RE[chain].test(address) ? await extraBalance(chain, address) : null;
    }));
    return out;
  });
