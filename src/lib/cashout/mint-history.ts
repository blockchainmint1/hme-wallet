/**
 * Buy-TSD orders for one wallet profile, kept on this device. Each record is
 * written when the order is opened at Review, so the wallet has its own copy
 * of what was agreed (order id, chain, token contract, amount, recipient,
 * deposit address) independent of TSD Bridge's reply. Records carry the
 * cash-out key fingerprint so a later key never polls another key's orders.
 *
 * States: "reviewed" (opened, not paid — reusable while it has the expiry
 * margin left, never polled), "sent"/"pending"/"confirmed" (paid; tracked),
 * "failed" (payment reverted on-chain), "abandoned" (superseded, expired
 * unpaid or failed its re-check; never polled or reused).
 */
import { useEffect, useState } from "react";
import { scopedKey } from "@/lib/profiles";
import { mintOrderStillOpen, type MintSourceId, type VerifiedMintOrder } from "./mint";

export type MintRecordState = "reviewed" | "sent" | "pending" | "confirmed" | "failed" | "abandoned";

export interface MintRecord {
  orderId: string;
  /** Payment transaction, once signed. */
  txHash?: string;
  sourceId: MintSourceId;
  chain?: "ethereum" | "base";
  tokenContract?: string;
  amount: string;
  units?: string;
  recipient: string;
  /** False when the TSD goes to an address this wallet didn't derive. */
  recipientOwn?: boolean;
  depositAddress: string;
  expiresAt?: string;
  feeBps?: number;
  keyFp: string;
  createdAt: number;
  /** Missing on records from before states existed: those were all paid. */
  state?: MintRecordState;
}

const BASE = "hme:tsd-mint-orders";
const EVENT = "hme:tsd-mint-orders-changed";
/** Kept long so the reused-deposit-address check sees older orders too. */
export const MINT_HISTORY_MAX = 200;

export function recordState(r: MintRecord): MintRecordState {
  return r.state ?? (r.txHash ? "sent" : "abandoned");
}

/** Paid orders the tracker keeps polling until TSD Bridge reports an end state. */
export function isPaidMintRecord(r: MintRecord): boolean {
  const s = recordState(r);
  return s === "sent" || s === "pending" || s === "confirmed";
}

export function readMintHistory(profileId: string): MintRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(BASE, profileId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? (list as MintRecord[]).filter((r) => r && typeof r.orderId === "string" && typeof r.depositAddress === "string")
      : [];
  } catch {
    return [];
  }
}

function write(profileId: string, list: MintRecord[]): void {
  try {
    window.localStorage.setItem(scopedKey(BASE, profileId), JSON.stringify(list.slice(0, MINT_HISTORY_MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* history is a convenience; the order itself lives at TSD Bridge */
  }
}

export function recordMintOrder(profileId: string, rec: MintRecord): void {
  write(profileId, [rec, ...readMintHistory(profileId).filter((r) => r.orderId !== rec.orderId)]);
}

export function updateMintRecord(profileId: string, orderId: string, patch: Partial<MintRecord>): void {
  write(profileId, readMintHistory(profileId).map((r) => (r.orderId === orderId ? { ...r, ...patch } : r)));
}

/** Local record for a freshly opened (reviewed, unpaid) order. */
export function reviewedRecord(locked: VerifiedMintOrder, keyFp: string, recipientOwn: boolean, now = Date.now()): MintRecord {
  return {
    orderId: locked.id, sourceId: locked.sourceId, chain: locked.chain, tokenContract: locked.tokenContract,
    amount: locked.amount, units: locked.units, recipient: locked.recipient, recipientOwn,
    depositAddress: locked.depositAddress, expiresAt: locked.expiresAt, feeBps: locked.feeBps,
    keyFp, createdAt: now, state: "reviewed",
  };
}

/** Rebuild the verified order from a local "reviewed" record. */
export function lockedFromRecord(r: MintRecord): VerifiedMintOrder | null {
  if (!r.chain || !r.tokenContract || !r.units || !r.expiresAt || r.feeBps === undefined) return null;
  return {
    id: r.orderId, sourceId: r.sourceId, chain: r.chain, tokenContract: r.tokenContract as VerifiedMintOrder["tokenContract"],
    depositAddress: r.depositAddress as VerifiedMintOrder["depositAddress"], units: r.units, amount: r.amount,
    recipient: r.recipient, feeBps: r.feeBps, expiresAt: r.expiresAt,
  };
}

/**
 * An earlier unpaid order with the identical source, amount, recipient and
 * key that still has more than the expiry margin left — reused instead of
 * opening another order at TSD Bridge.
 */
export function findReusableMintOrder(
  list: readonly MintRecord[],
  want: { sourceId: MintSourceId; units: string; recipient: string; keyFp: string },
  now = Date.now(),
): MintRecord | null {
  return (
    list.find(
      (r) =>
        recordState(r) === "reviewed" &&
        r.keyFp === want.keyFp &&
        r.sourceId === want.sourceId &&
        r.units === want.units &&
        r.recipient === want.recipient &&
        !!r.expiresAt &&
        mintOrderStillOpen(r.expiresAt, now),
    ) ?? null
  );
}

/** Unpaid orders for this key that should be abandoned (all but `keep`). */
export function staleReviewedOrders(list: readonly MintRecord[], keyFp: string, keep: string | null): MintRecord[] {
  return list.filter((r) => recordState(r) === "reviewed" && r.keyFp === keyFp && r.orderId !== keep);
}

export function useMintHistory(profileId: string): MintRecord[] {
  const [list, setList] = useState<MintRecord[]>([]);
  useEffect(() => {
    const load = () => setList(readMintHistory(profileId));
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
