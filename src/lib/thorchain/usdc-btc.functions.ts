import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchThorUsdcBtcQuote } from "./usdc-btc.server";

export const getThorUsdcBtcQuote = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ network: z.enum(["eth", "base"]), amount: z.string().max(40), destination: z.string().max(90) }).strict().parse(raw))
  .handler(async ({ data }) => fetchThorUsdcBtcQuote(data));