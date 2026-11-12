/**
 * Server-side checks for the TSD Swap deposit notice (security fix 2026-11-12).
 *
 * The notice is signed with our server secret, so our signature must only
 * ever vouch for facts the server checked itself — never for whatever a caller
 * typed in. Before signing, the server requires:
 *  - the deposit address is the permanent inbox of the account that owns the
 *    caller's API key, and the payout address is that account's saved address
 *    (TSD Swap only accepts notices for the permanent inbox anyway);
 *  - the transaction exists on TEXITcoin and is a single Omni Simple Send of
 *    TSD (property 39) whose reference output is that inbox, for exactly the
 *    claimed amount, from a different sending address.
 * Pure functions only; the network reads live in tsd.server.ts.
 */
import type { MempoolTx } from "@/lib/txc/mempool";
import { TSD_PROPERTY_ID } from "./tsd";
import { tsdUnits } from "./one-time";

export interface NoticeClaim {
  txid: string;
  amount: number;
  depositAddress: string;
  payoutAddress: string;
}

export interface NoticeAccount {
  depositAddress: string;
  payoutAddress: string | null;
}

const OMNI_MAGIC = "6f6d6e69"; // "omni"

/** Inbox + saved payout from a `/cashout/deposit-address` reply (field names vary). */
export function noticeAccountFrom(raw: unknown): NoticeAccount {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dep = typeof r.depositAddress === "string" ? r.depositAddress : typeof r.address === "string" ? r.address : "";
  const pay = typeof r.payoutAddress === "string" ? r.payoutAddress : null;
  return { depositAddress: dep.trim(), payoutAddress: pay ? pay.trim() : null };
}

/** Throws unless the claim names this account's own inbox and saved payout. */
export function checkNoticeAccount(claim: NoticeClaim, account: NoticeAccount): void {
  if (!account.depositAddress || account.depositAddress !== claim.depositAddress.trim()) {
    throw new Error("Deposit address is not this account's permanent inbox");
  }
  const saved = (account.payoutAddress ?? "").toLowerCase();
  if (!saved || saved !== claim.payoutAddress.trim().toLowerCase()) {
    throw new Error("Payout address is not this account's saved address");
  }
}

/** Throws unless `tx` is exactly the claimed TSD Simple Send into the inbox. */
export function checkNoticeTx(tx: MempoolTx, claim: NoticeClaim): void {
  if (!tx || typeof tx.txid !== "string" || tx.txid.toLowerCase() !== claim.txid.toLowerCase()) {
    throw new Error("Transaction id mismatch");
  }
  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const vin = Array.isArray(tx.vin) ? tx.vin : [];

  const payloads = vout
    .map((v) => String(v?.scriptpubkey ?? "").toLowerCase())
    .filter((s) => s.startsWith("6a") && s.includes(OMNI_MAGIC));
  if (payloads.length !== 1) throw new Error("Expected exactly one Omni payload");
  const s = payloads[0]!;
  const p = s.slice(s.indexOf(OMNI_MAGIC) + OMNI_MAGIC.length);
  if (p.length < 32) throw new Error("Omni payload too short");
  const version = parseInt(p.slice(0, 4), 16);
  const type = parseInt(p.slice(4, 8), 16);
  if (version !== 0 || type !== 0) throw new Error("Not an Omni Simple Send");
  const propertyId = parseInt(p.slice(8, 16), 16);
  if (propertyId !== TSD_PROPERTY_ID) throw new Error("Not a TSD transfer");
  const onChain = BigInt("0x" + p.slice(16, 32));
  const claimed = tsdUnits(claim.amount);
  if (claimed === null || claimed <= 0n || onChain !== claimed) throw new Error("Amount mismatch");

  const sender = vin[0]?.prevout?.scriptpubkey_address ?? null;
  const inbox = claim.depositAddress.trim();
  if (!sender || sender === inbox) throw new Error("Unexpected sending address");
  // Omni Class C reference = last addressed output that isn't the sender.
  const refs = vout.map((v) => v?.scriptpubkey_address).filter((a): a is string => !!a && a !== sender);
  if (refs.length === 0 || refs[refs.length - 1] !== inbox) throw new Error("TSD is not sent to the inbox");
}
