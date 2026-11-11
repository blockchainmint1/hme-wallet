/**
 * One-time cash-out address rules (TSD Bridge handoff, 2026-11-11).
 *
 * TSD Swap has two ways to cash out:
 *  - The account's PERMANENT inbox always pays the account's SAVED payout
 *    address at the moment the TSD arrives.
 *  - A ONE-TIME order (`POST /cashout/orders`) pays the address given for that
 *    order only, from a fresh deposit address that belongs to that order.
 *
 * Changing the saved address needs an emailed confirmation, so the wallet must
 * never "save then send to the inbox" to honour a different address: the
 * inbox would still pay the old saved one. This module holds the pure rules.
 */
import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

/** TEXITcoin legacy pay-to-pubkey-hash version byte ('T…'). */
const TXC_P2PKH_VERSION = 0x42;

/**
 * Orders closer than this to expiry are treated as expired. TSD Swap asked for
 * at least an hour (orders live 24h; larger cash-outs wait for up to six
 * TEXITcoin confirmations, ~2.5 min apart, before the order is paid), which
 * also covers the auditor's 30-minute minimum.
 */
export const ONE_TIME_EXPIRY_MARGIN_MS = 60 * 60_000;

/** TSD (Omni property 39) is divisible: 8 decimal places. */
const TSD_DECIMALS = 8;

/**
 * Exact TSD amount in base units from a plain decimal string or a JSON number,
 * or null when it isn't a plain non-negative decimal with at most 8 places.
 * Numbers go through `String(n)` (shortest round-trip form), so no float
 * arithmetic is involved; exponent forms are refused rather than guessed.
 */
export function tsdUnits(v: unknown): bigint | null {
  let s: string;
  if (typeof v === "string") s = v.trim();
  else if (typeof v === "number" && Number.isFinite(v)) s = String(v);
  else return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > TSD_DECIMALS) return null;
  return BigInt(m[1]) * 10n ** BigInt(TSD_DECIMALS) + BigInt(frac.padEnd(TSD_DECIMALS, "0") || "0");
}

export type CashoutPath = "account-inbox" | "one-time-order";

/**
 * The permanent inbox is only correct when the chosen payout address is
 * exactly the account's saved one. Anything else (no saved address, or a
 * different address) must be a one-time order.
 */
export function chooseCashoutPath(saved: string | null | undefined, chosen: string): CashoutPath {
  const s = (saved ?? "").trim().toLowerCase();
  const c = chosen.trim().toLowerCase();
  return s && c && s === c ? "account-inbox" : "one-time-order";
}

/** Checksum-valid legacy `T…` P2PKH TEXITcoin address (what Omni can credit). */
export function isLegacyTxcP2pkh(address: string): boolean {
  const v = (address ?? "").trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(v)) return false;
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(v);
  } catch {
    return false;
  }
  if (bytes.length !== 25 || bytes[0] !== TXC_P2PKH_VERSION) return false;
  const check = sha256(sha256(bytes.slice(0, 21))).slice(0, 4);
  for (let i = 0; i < 4; i++) if (check[i] !== bytes[21 + i]) return false;
  return true;
}

export interface OneTimeOrderRequest {
  /** TSD amount; compared to the reply as an exact decimal, never as a float. */
  amount: number | string;
  payoutAddress: string;
  refundAddress: string;
}

/** Raw order fields we rely on, as returned by TSD Swap. */
export interface OneTimeOrderResponse {
  id?: unknown;
  status?: unknown;
  depositAddress?: unknown;
  sendTo?: unknown;
  amountExpected?: unknown;
  payoutAddress?: unknown;
  refundAddress?: unknown;
  payoutAmount?: unknown;
  feeBps?: unknown;
  chain?: unknown;
  expiresAt?: unknown;
  accountTxcDepositAddress?: unknown;
}

export interface VerifiedOneTimeOrder {
  id: string;
  depositAddress: string;
  feeBps: number;
  payoutAddress: string;
  payoutAmount: number | null;
  amount: number;
  refundAddress: string;
  expiresAt: string;
}

export interface VerifyContext {
  /** The account's permanent inbox, as read from the account endpoint. */
  permanentInbox: string | null | undefined;
  /** Every TXC address this wallet derives; a deposit address may never be one. */
  ownAddresses?: readonly string[];
  now?: number;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/**
 * Accept a one-time order only if it is exactly what we asked for and the
 * deposit address is a fresh legacy inbox, not the account's permanent one.
 * Throws a user-readable message otherwise.
 */
export function verifyOneTimeOrder(
  req: OneTimeOrderRequest,
  res: OneTimeOrderResponse,
  ctx: VerifyContext,
): VerifiedOneTimeOrder {
  const now = ctx.now ?? Date.now();
  const fail = (why: string): never => {
    throw new Error(`TSD Swap's one-time order didn't match (${why}). Nothing was sent.`);
  };
  const id = str(res.id);
  if (!/^[A-Za-z0-9-]{4,80}$/.test(id)) fail("missing order id");
  if (str(res.status) !== "awaiting_deposit") fail("order is not waiting for a deposit");

  const deposit = str(res.depositAddress);
  if (!isLegacyTxcP2pkh(deposit)) fail("deposit address is not a legacy T… address");
  const sendTo = str(res.sendTo);
  if (sendTo && sendTo !== deposit) fail("deposit addresses disagree");
  const permanent = str(ctx.permanentInbox);
  const echoedPermanent = str(res.accountTxcDepositAddress);
  if (permanent && echoedPermanent && permanent !== echoedPermanent) {
    fail("TSD Swap named a different account deposit address");
  }
  const inboxes = [permanent, echoedPermanent].filter(Boolean);
  if (inboxes.includes(deposit)) fail("deposit address is the permanent inbox");
  if ((ctx.ownAddresses ?? []).some((a) => a.trim() === deposit)) {
    fail("deposit address belongs to this wallet");
  }

  if (str(res.payoutAddress).toLowerCase() !== req.payoutAddress.trim().toLowerCase()) {
    fail("payout address changed");
  }
  const refund = str(res.refundAddress);
  if (refund && refund !== req.refundAddress) fail("refund address changed");

  const wanted = tsdUnits(req.amount);
  const echoed = tsdUnits(res.amountExpected);
  if (wanted === null || echoed === null || wanted !== echoed) fail("amount changed");

  const chain = str(res.chain).toLowerCase();
  if (chain && chain !== "ethereum") fail("payout network is not Ethereum");

  const feeBps = num(res.feeBps);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10_000) fail("fee is missing");

  const expiresAt = str(res.expiresAt);
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) fail("no expiry time");
  if (exp - now <= ONE_TIME_EXPIRY_MARGIN_MS) fail("order already expired");

  const payout = num(res.payoutAmount);
  return {
    id,
    depositAddress: deposit,
    feeBps,
    payoutAddress: req.payoutAddress.trim(),
    payoutAmount: Number.isFinite(payout) ? payout : null,
    amount: Number(req.amount),
    refundAddress: req.refundAddress,
    expiresAt,
  };
}

/** True while a one-time order can still safely be paid. */
export function oneTimeOrderStillOpen(expiresAt: string, now: number = Date.now()): boolean {
  const exp = Date.parse(expiresAt);
  return Number.isFinite(exp) && exp - now > ONE_TIME_EXPIRY_MARGIN_MS;
}

/** The parts of a cash-out the wallet locked in at review time. */
export interface LockedCashout {
  orderId?: string;
  depositAddress: string;
  payoutAddress: string;
  amount: number | string;
  refundAddress?: string;
}

/**
 * Right before signing a one-time cash-out, the freshly polled order must
 * still be waiting for exactly this deposit (auditor, 2026-11-11). Throws a
 * user-readable message otherwise.
 */
export function recheckOneTimeOrder(
  locked: LockedCashout,
  order: OneTimeOrderResponse,
  now: number = Date.now(),
): void {
  const fail = (why: string): never => {
    throw new Error(`TSD Swap's order changed (${why}). Nothing was sent — start the cash-out again.`);
  };
  if (!locked.orderId || str(order.id) !== locked.orderId) fail("different order");
  if (str(order.status) !== "awaiting_deposit") fail("it is no longer waiting for a deposit");
  if (str(order.depositAddress) !== locked.depositAddress) fail("deposit address changed");
  if (str(order.payoutAddress).toLowerCase() !== locked.payoutAddress.trim().toLowerCase()) {
    fail("payout address changed");
  }
  const refund = str(order.refundAddress);
  if (locked.refundAddress && refund && refund !== locked.refundAddress) fail("refund address changed");
  const a = tsdUnits(locked.amount);
  const b = tsdUnits(order.amountExpected);
  if (a === null || b === null || a !== b) fail("amount changed");
  if (!oneTimeOrderStillOpen(str(order.expiresAt), now)) fail("less than an hour left");
}

/**
 * Right before signing a saved-address cash-out, the account must still have
 * the same permanent inbox and still pay the saved address the user reviewed.
 * The permanent inbox pays whatever is saved when the TSD arrives, so this is
 * the closest check the wallet can make on that path.
 */
export function recheckSavedInbox(
  locked: LockedCashout,
  account: { depositAddress: string; payoutAddress: string | null },
): void {
  if (account.depositAddress.trim() !== locked.depositAddress) {
    throw new Error("Your TSD Swap deposit address changed. Nothing was sent — start the cash-out again.");
  }
  if ((account.payoutAddress ?? "").trim().toLowerCase() !== locked.payoutAddress.trim().toLowerCase()) {
    throw new Error("Your saved cash-out address changed. Nothing was sent — start the cash-out again.");
  }
}
