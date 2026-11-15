/**
 * Server functions for the TSD → USDC cash-out. Thin wrappers only.
 *
 * Every call carries the user's own TSD Swap API key from wallet Settings;
 * without it the feature is not available at all.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CashoutAccount, CashoutOrder, CashoutSettings } from "./tsd";
import { isLegacyTxcP2pkh, verifyOneTimeOrder } from "./one-time";
import { TSD_PROPERTY_ID } from "./tsd";
import {
  MINT_SOURCE_IDS,
  availableMintSources,
  decimalUnits,
  mintAmountInLimits,
  mintSource,
  parseMintAmount,
  verifyMintOrder,
  type MintOrderResponse,
  type TsdBridgeTerms,
  type VerifiedMintOrder,
} from "./mint";
import {
  createCashout,
  createMintOrder,
  fetchStablesAssets,
  fetchCashoutOrder,
  fetchCashoutSettings,
  fetchDepositAddress,
  saveDepositPayoutAddress,
} from "./tsd.server";

const apiKey = z.string().trim().min(16).max(200);

/**
 * TSD Swap has returned numeric fields as strings in some responses.
 * Coercing here keeps the UI from showing a phantom fee or hanging on
 * "Checking…" because `typeof redeemFeeBps === "number"` was false.
 */
const settingsSchema = z.object({
  live: z.coerce.boolean(),
  minAmount: z.coerce.number(),
  maxAmount: z.coerce.number(),
  redeemFeeBps: z.coerce.number(),
});

/** Only the fields the wallet relies on; everything else is dropped. */
const oneTimeResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  depositAddress: z.string(),
  sendTo: z.string().nullable().optional(),
  amountExpected: z.coerce.number().nullable(),
  payoutAddress: z.string().nullable(),
  refundAddress: z.string().nullable().optional(),
  payoutAmount: z.coerce.number().nullable().optional(),
  feeBps: z.coerce.number(),
  chain: z.string().nullable().optional(),
  expiresAt: z.string().nullable(),
  accountTxcDepositAddress: z.string().nullable().optional(),
});

export type OneTimeCashoutResponse = z.infer<typeof oneTimeResponseSchema>;

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  depositAddress: z.string(),
  amountExpected: z.coerce.number().nullable(),
  feeBps: z.coerce.number(),
  payoutAmount: z.coerce.number().nullable(),
  payoutAddress: z.string().nullable(),
  refundAddress: z.string().nullable(),
  expiresAt: z.string().nullable(),
  releaseTxHash: z.string().nullable(),
  refundTxid: z.string().nullable(),
  error: z.string().nullable(),
});

export const getCashoutSettings = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<CashoutSettings> => {
    const raw = await fetchCashoutSettings(data.apiKey);
    return settingsSchema.parse(raw);
  });

/**
 * Create a ONE-TIME cash-out order (TSD Bridge handoff 2026-11-11). Use this
 * whenever the payout address is not exactly the account's saved one; send
 * the TSD to the returned `depositAddress`, never the permanent inbox.
 * The order is checked here and again on the device before signing.
 */
export const createOneTimeCashout = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        amount: z.number().positive().max(1_000_000),
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid 0x… address"),
        refundAddress: z.string().refine(isLegacyTxcP2pkh, "Refund address must be a legacy T… address"),
        permanentInbox: z.string().max(64).nullable(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<OneTimeCashoutResponse> => {
    const raw = (await createCashout({
      apiKey: data.apiKey,
      amount: data.amount,
      payoutAddress: data.payoutAddress,
      refundAddress: data.refundAddress,
    })) as Record<string, unknown>;
    const res = oneTimeResponseSchema.parse(raw);
    verifyOneTimeOrder(
      { amount: data.amount, payoutAddress: data.payoutAddress, refundAddress: data.refundAddress },
      res,
      { permanentInbox: data.permanentInbox },
    );
    return res;
  });

export const getCashoutOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ apiKey, id: z.string().min(4).max(80) }).parse(raw),
  )
  .handler(async ({ data }): Promise<CashoutOrder> => {
    const raw = await fetchCashoutOrder(data.id, data.apiKey);
    return orderSchema.parse(raw);
  });

/**
 * The account's permanent TSD deposit address + fee. TSD Swap has been
 * inconsistent about field names/types, so accept both `redeemFeeBps` and
 * `feePercent` and coerce numbers.
 */
const accountSchema = z
  .object({
    address: z.string().min(20).optional(),
    depositAddress: z.string().min(20).optional(),
    redeemFeeBps: z.coerce.number().optional(),
    feePercent: z.coerce.number().optional(),
    payoutAddress: z.string().nullable().optional(),
    live: z.coerce.boolean().optional(),
    minAmount: z.coerce.number().optional(),
    maxAmount: z.coerce.number().optional(),
  })
  .transform((r) => ({
    depositAddress: (r.depositAddress ?? r.address ?? "").trim(),
    feeBps: r.redeemFeeBps ?? (typeof r.feePercent === "number" ? r.feePercent * 100 : 0),
    payoutAddress: r.payoutAddress ?? null,
    live: r.live ?? true,
    minAmount: r.minAmount ?? null,
    maxAmount: r.maxAmount ?? null,
  }));

export const getCashoutAccount = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ apiKey }).parse(raw))
  .handler(async ({ data }): Promise<CashoutAccount> => {
    return accountSchema.parse(await fetchDepositAddress(data.apiKey));
  });

/**
 * Change the account's SAVED cash-out address. This is a separate action from
 * cashing out: replacing an existing address needs the member's emailed
 * confirmation, and the permanent inbox keeps paying the old address until
 * then. Never chain a deposit onto this call.
 */
export const setCashoutPayoutAddress = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid 0x… address"),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ status: "saved" | "pending_confirmation" }> => {
    const raw = (await saveDepositPayoutAddress(data.apiKey, data.payoutAddress)) as {
      status?: unknown;
      payoutStatus?: unknown;
    } | null;
    const pending =
      raw?.status === "pending_confirmation" || raw?.payoutStatus === "pending_confirmation";
    return { status: pending ? "pending_confirmation" : "saved" };
  });

/** Fire-and-forget heads-up to TSD Swap after the deposit is broadcast. */
export const notifyCashoutDeposit = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
        amount: z.number().positive().max(1_000_000),
        depositAddress: z.string().min(20).max(64),
        payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const { notifyDeposit } = await import("./tsd.server");
      await notifyDeposit(data);
      return { ok: true };
    } catch (e) {
      console.warn("TSD deposit notice failed", e);
      return { ok: false };
    }
  });

/* ------------------------------------------------------------------ */
/* Buy TSD with stablecoins (TSD Bridge mint orders)                    */
/* ------------------------------------------------------------------ */

const bridgeAssetSchema = z
  .object({
    symbol: z.string(),
    propertyId: z.coerce.number(),
    decimals: z.coerce.number(),
    depositTokens: z.array(z.string()),
    minAmount: z.coerce.number(),
    maxAmount: z.coerce.number(),
    mintFeeBps: z.coerce.number(),
    redeemFeeBps: z.coerce.number(),
    live: z.boolean(),
  })
  .passthrough();
const bridgeTermsSchema = z.object({ assets: z.array(bridgeAssetSchema), chains: z.array(z.string()) });

async function loadTsdBridgeTerms(): Promise<TsdBridgeTerms> {
    const parsed = bridgeTermsSchema.parse(await fetchStablesAssets());
    const tsd = parsed.assets.find((a) => a.symbol === "TSD" && a.propertyId === TSD_PROPERTY_ID);
    if (!tsd || tsd.decimals !== 8) throw new Error("TSD Bridge isn't offering TSD right now.");
    const bps = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 10_000);
    return {
      live: tsd.live,
      minAmount: tsd.minAmount,
      maxAmount: tsd.maxAmount,
      mintFeeBps: bps(tsd.mintFeeBps),
      redeemFeeBps: bps(tsd.redeemFeeBps),
      depositTokens: tsd.depositTokens.map((t) => t.toUpperCase()),
      chains: parsed.chains.map((c) => c.toLowerCase()),
    };
}

/** TSD's live mint terms from TSD Bridge's public registry. */
export const getTsdBridgeTerms = createServerFn({ method: "GET" }).handler(loadTsdBridgeTerms);

/**
 * Open a buy-TSD order and verify the reply here before the device sees it;
 * the device verifies again and re-polls right before signing.
 */
export const createTsdMintOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey,
        sourceId: z.enum(MINT_SOURCE_IDS),
        amount: z.string().trim().regex(/^\d{1,7}(\.\d{1,6})?$/, "Enter a plain amount"),
        recipient: z.string().trim().refine(isLegacyTxcP2pkh, "TSD must go to a legacy T… address"),
        ownEvmAddresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(8),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<VerifiedMintOrder> => {
    const source = mintSource(data.sourceId)!;
    const terms = await loadTsdBridgeTerms();
    if (!availableMintSources(terms).some((s) => s.id === source.id)) {
      throw new Error(`TSD Bridge isn't accepting ${source.label} right now.`);
    }
    const units = parseMintAmount(data.amount, source);
    if (units === null || !mintAmountInLimits(units, source, terms)) {
      throw new Error(`Amount must be between ${terms.minAmount} and ${terms.maxAmount} ${source.symbol}.`);
    }
    // TSD Bridge takes a JSON number; refuse anything that doesn't round-trip exactly.
    const amount = Number(data.amount);
    if (decimalUnits(amount, source.decimals) !== units) throw new Error("Enter a plain amount.");
    const raw = await createMintOrder({
      apiKey: data.apiKey,
      chain: source.bridgeChain,
      token: source.symbol,
      recipient: data.recipient,
      amount,
    });
    return verifyMintOrder(
      { source, amount: data.amount, recipient: data.recipient },
      raw as MintOrderResponse,
      { ownEvmAddresses: data.ownEvmAddresses },
    );
  });

const mintOrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  depositAddress: z.string(),
  amountExpected: z.coerce.number().nullable(),
  amountReceived: z.coerce.number().nullable().optional(),
  chain: z.string().nullable().optional(),
  expiresAt: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type TsdMintOrderStatus = z.infer<typeof mintOrderSchema>;

/** Poll a buy-TSD order (TSD Bridge only lets a key read its own orders). */
export const getTsdMintOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ apiKey, id: z.string().regex(/^[A-Za-z0-9-]{4,80}$/) }).parse(raw),
  )
  .handler(async ({ data }): Promise<TsdMintOrderStatus> => {
    return mintOrderSchema.parse(await fetchCashoutOrder(data.id, data.apiKey));
  });
