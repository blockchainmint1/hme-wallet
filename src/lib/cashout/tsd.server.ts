/**
 * Server-side HTTP client for the TSD Swap public cash-out API
 * (https://tsd.honest.money). Kept off the device so the endpoint host can
 * change server-side and the strict CSP `connect-src` stays closed.
 *
 * Auth is the *user's own* TSD Swap API key, minted on their account page and
 * saved in wallet Settings. It travels from the device to our server function
 * and is forwarded as `x-api-key`; we never store it. The key identifies the
 * account, so TSD Swap decides the fee tier — the wallet does no pricing.
 *
 * Contract lives in docs/tsd-cashout-api.md.
 */
import type { CashoutOrder, CashoutSettings } from "./tsd";
import type { MempoolTx } from "@/lib/txc/mempool";

const DEFAULT_BASE = "https://tsd.honest.money";

/** Label the bridge team asked for so every order traces back to this wallet. */
export const CASHOUT_SOURCE = "HME Wallet";

function baseUrl(): string {
  return (process.env["TSD_SWAP_URL"] || DEFAULT_BASE).replace(/\/+$/, "");
}

async function call<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new Error("Couldn't reach the TSD cash-out service. Try again in a moment.");
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = `Cash-out service error (${res.status})`;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      if (j.error || j.message) msg = String(j.error ?? j.message);
    } catch {
      /* keep the status message */
    }
    if (res.status === 401 || res.status === 403) {
      msg = "Your TSD Swap API key was rejected. Check it in Settings.";
    }
    if (res.status === 404) {
      msg = "The cash-out service isn't available yet. Please try again later.";
    }
    throw new Error(msg);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The cash-out service returned an unexpected response.");
  }
}

export function fetchCashoutSettings(apiKey: string): Promise<CashoutSettings> {
  return call<CashoutSettings>("/api/public/v1/cashout/settings", apiKey);
}

export interface CreateArgs {
  apiKey: string;
  amount: number;
  payoutAddress: string;
  refundAddress: string;
}

/**
 * One-time cash-out: TSD Swap issues a fresh deposit address that pays
 * `payoutAddress` for this order only. The account's saved address is not
 * touched and no confirmation email is sent.
 */
export function createCashout(args: CreateArgs): Promise<unknown> {
  return call<unknown>("/api/public/v1/cashout/orders", args.apiKey, {
    method: "POST",
    body: JSON.stringify({
      amount: args.amount,
      payoutAddress: args.payoutAddress,
      refundAddress: args.refundAddress,
      chain: "ethereum",
      source: CASHOUT_SOURCE,
    }),
  });
}

export function fetchCashoutOrder(id: string, apiKey: string): Promise<CashoutOrder> {
  return call<CashoutOrder>(`/api/public/v1/cashout/orders/${encodeURIComponent(id)}`, apiKey);
}

/**
 * Permanent deposit address for the account that owns the key, plus its fee
 * tier. Safe to cache — TSD Swap keeps it stable per account.
 */
export function fetchDepositAddress(apiKey: string): Promise<unknown> {
  return call<unknown>("/api/public/v1/cashout/deposit-address", apiKey);
}

/**
 * Change the account's SAVED payout address. Replacing an existing one needs
 * the member's emailed confirmation (`status: "pending_confirmation"`), and
 * until then the permanent inbox keeps paying the old address — so this must
 * never be used to redirect a single cash-out.
 */
export function saveDepositPayoutAddress(apiKey: string, payoutAddress: string): Promise<unknown> {
  return call<unknown>("/api/public/v1/cashout/payout-address", apiKey, {
    method: "POST",
    body: JSON.stringify({ payoutAddress }),
  });
}

export interface DepositNotice {
  apiKey: string;
  txid: string;
  amount: number;
  depositAddress: string;
  payoutAddress: string;
}

/** Read a TEXITcoin transaction from the public explorer, waiting briefly for a fresh broadcast. */
async function fetchTxcTx(txid: string): Promise<unknown> {
  const { MEMPOOL_API } = await import("@/lib/txc/network");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${MEMPOOL_API}/tx/${txid}`, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`explorer ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  throw new Error("Transaction not found on TEXITcoin yet");
}

/**
 * Heads-up to TSD Swap that a cash-out deposit was just broadcast, so it can
 * watch for it instead of waiting to discover it. Signed with the dedicated
 * TSD_NOTIFY_SIGNING_KEY (HMAC-SHA256 over `${timestamp}.${body}`) so TSD Swap
 * knows it came from our server, plus the user's x-api-key for the account.
 *
 * Our signature must only vouch for facts this server verified: the deposit
 * address and payout must be the key's own account inbox and saved address,
 * and the txid must be a real TSD Simple Send of exactly that amount into the
 * inbox (src/lib/cashout/deposit-notice.ts). Anything else is not sent.
 */
export async function notifyDeposit(n: DepositNotice): Promise<void> {
  const secret = process.env["TSD_NOTIFY_SIGNING_KEY"];
  // Cash-out still works without this optional hint; do not expose a shared
  // cross-partner signing oracle while a dedicated key is being coordinated.
  if (!secret) return;
  const { checkNoticeAccount, checkNoticeTx, noticeAccountFrom } = await import("./deposit-notice");
  checkNoticeAccount(n, noticeAccountFrom(await fetchDepositAddress(n.apiKey)));
  checkNoticeTx((await fetchTxcTx(n.txid)) as MempoolTx, n);

  const { createHmac } = await import("crypto");
  const body = JSON.stringify({
    txid: n.txid,
    amount: n.amount,
    depositAddress: n.depositAddress,
    payoutAddress: n.payoutAddress,
    source: CASHOUT_SOURCE,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": n.apiKey,
    "x-hme-timestamp": ts,
    "x-hme-signature": createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex"),
  };
  const res = await fetch(`${baseUrl()}/api/public/v1/cashout/notify`, { method: "POST", headers, body });
  if (!res.ok) console.warn("TSD deposit notice not accepted", res.status);
}
