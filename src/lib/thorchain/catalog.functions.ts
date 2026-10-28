/**
 * Server-function boundary for the THORChain route catalog. Thin wrappers
 * only — all logic lives in ./catalog.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { THOR_ASSET_IDS, type ThorAssetId, type ThorCatalogQuote } from "./catalog";
import { fetchCatalogQuote, fetchCatalogRoutes } from "./catalog.server";

const assetId = z.enum(THOR_ASSET_IDS as [ThorAssetId, ...ThorAssetId[]]);

const quoteInput = z.object({
  from: assetId,
  to: assetId,
  amount: z.string().min(1).max(40),
  destination: z.string().min(1).max(120),
  toleranceBps: z.number().int().min(50).max(2000).optional(),
});

export const getThorCatalogRoutes = createServerFn({ method: "POST" })
  .handler(async (): Promise<ThorAssetId[]> => fetchCatalogRoutes());

export const getThorCatalogQuote = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => quoteInput.parse(raw))
  .handler(async ({ data }): Promise<ThorCatalogQuote> => fetchCatalogQuote(data));
