import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EXTRA_CHAINS, type ExtraChain } from "@/lib/xpub-link/delegate-keys";

const Input = z.object({
  items: z.array(z.object({ chain: z.enum(EXTRA_CHAINS), address: z.string().min(20).max(120) })).min(1).max(EXTRA_CHAINS.length),
});

/** Balances (smallest units, as strings) for Seeds' extra-coin pocket addresses; null = couldn't check. */
export const getExtraPocketBalances = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { extraBalance, EXTRA_ADDRESS_RE } = await import("./extra-balances.server");
    const out: Partial<Record<ExtraChain, string | null>> = {};
    await Promise.all(data.items.map(async ({ chain, address }) => {
      out[chain] = EXTRA_ADDRESS_RE[chain].test(address) ? await extraBalance(chain, address) : null;
    }));
    return out;
  });
