/**
 * TSD → USDC cash-outs sent from this wallet profile, kept on this device so
 * they can be listed in the swap history. Written as "sending" (with the txid
 * computed locally from the signed transaction) right before the TSD transfer
 * is broadcast, and upgraded to "sent" once the broadcast succeeds. A failed
 * or uncertain broadcast therefore still leaves a row the user can check
 * against the explorer — a broadcast error does not prove the transaction is
 * absent. Holds public facts only (txid, order id, amounts,
 * addresses) plus the 8-hex cash-out key fingerprint — never the key itself —
 * so a later key never polls another key's orders.
 *
 * TSD Swap has no "list my orders" endpoint, so cash-outs sent before this
 * record existed cannot be shown here.
 */
import { useEffect, useState } from "react";
import { scopedKey } from "@/lib/profiles";

export interface CashoutRecord {
  /** TSD transfer transaction id. */
  txid: string;
  kind: "account-inbox" | "one-time-order";
  /** One-time orders only. */
  orderId?: string;
  /** Exact TSD amount as reviewed. */
  amount: string;
  /** USDC TSD Swap said it would pay (estimate on the saved-address path). */
  payoutAmount: number;
  payoutAddress: string;
  depositAddress: string;
  keyFp: string;
  createdAt: number;
  /** "sending" until the broadcast succeeded. Records written before this field existed are sent. */
  status?: "sending" | "sent";
}

export function cashoutRecordStatus(rec: Pick<CashoutRecord, "status">): "sending" | "sent" {
  return rec.status === "sending" ? "sending" : "sent";
}

const BASE = "hme:tsd-cashout-orders";
const EVENT = "hme:tsd-cashout-orders-changed";
export const CASHOUT_HISTORY_MAX = 200;

export function readCashoutHistory(profileId: string): CashoutRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(BASE, profileId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? (list as CashoutRecord[]).filter((r) => r && typeof r.txid === "string" && r.txid.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function recordCashout(profileId: string, rec: CashoutRecord): void {
  if (typeof window === "undefined" || !rec.txid) return;
  try {
    const next = [rec, ...readCashoutHistory(profileId).filter((r) => r.txid !== rec.txid)];
    window.localStorage.setItem(scopedKey(BASE, profileId), JSON.stringify(next.slice(0, CASHOUT_HISTORY_MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* history is a convenience; the order itself lives at TSD Swap */
  }
}

/** Upgrade a "sending" record to "sent" (and adopt the broadcaster's txid if it differs). */
export function markCashoutSent(profileId: string, localTxid: string, txid: string = localTxid): void {
  if (typeof window === "undefined") return;
  const list = readCashoutHistory(profileId);
  const rec = list.find((r) => r.txid === localTxid);
  if (!rec) return;
  const rest = list.filter((r) => r.txid !== localTxid && r.txid !== txid);
  try {
    window.localStorage.setItem(
      scopedKey(BASE, profileId),
      JSON.stringify([{ ...rec, txid: txid || localTxid, status: "sent" }, ...rest].slice(0, CASHOUT_HISTORY_MAX)),
    );
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* convenience only */
  }
}

/**
 * Record the cash-out as "sending" before broadcasting, then "sent" after.
 * If the broadcast throws, the "sending" row stays and the error is re-thrown
 * unchanged, so the send screen's own error handling is not affected.
 */
export async function broadcastRecordedCashout(
  profileId: string,
  rec: Omit<CashoutRecord, "status">,
  broadcast: () => Promise<string>,
): Promise<string> {
  recordCashout(profileId, { ...rec, status: "sending" });
  const txid = await broadcast();
  markCashoutSent(profileId, rec.txid, txid);
  return txid;
}

export function useCashoutHistory(profileId: string): CashoutRecord[] {
  const [list, setList] = useState<CashoutRecord[]>([]);
  useEffect(() => {
    const load = () => setList(readCashoutHistory(profileId));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [profileId]);
  return list;
}
