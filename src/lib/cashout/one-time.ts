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

/** Orders closer than this to expiry are treated as expired. */
export const ONE_TIME_EXPIRY_MARGIN_MS = 2 * 60_000;

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
  amount: number;
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
  expiresAt: string;
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
  permanentInbox: string | null | undefined,
  now: number = Date.now(),
): VerifiedOneTimeOrder {
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
  const inboxes = [str(permanentInbox), str(res.accountTxcDepositAddress)].filter(Boolean);
  if (inboxes.includes(deposit)) fail("deposit address is the permanent inbox");

  if (str(res.payoutAddress).toLowerCase() !== req.payoutAddress.trim().toLowerCase()) {
    fail("payout address changed");
  }
  const refund = str(res.refundAddress);
  if (refund && refund !== req.refundAddress) fail("refund address changed");

  const amount = num(res.amountExpected);
  if (!Number.isFinite(amount) || Math.abs(amount - req.amount) > 1e-8) fail("amount changed");

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
    amount: req.amount,
    expiresAt,
  };
}

/** True while a one-time order can still safely be paid. */
export function oneTimeOrderStillOpen(expiresAt: string, now: number = Date.now()): boolean {
  const exp = Date.parse(expiresAt);
  return Number.isFinite(exp) && exp - now > ONE_TIME_EXPIRY_MARGIN_MS;
}
