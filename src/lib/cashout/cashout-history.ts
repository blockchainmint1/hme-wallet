/**
 * TSD → USDC cash-outs sent from this wallet profile, kept on this device so
 * they can be listed in the swap history. Written only after the TSD transfer
 * has been broadcast. Holds public facts only (txid, order id, amounts,
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
