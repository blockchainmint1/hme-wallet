/**
 * Recent buy-TSD orders for one wallet profile, kept on this device so the
 * Swap page can keep showing their progress. Records carry the cash-out key
 * fingerprint so a later key never polls another key's orders.
 */
import { useEffect, useState } from "react";
import { scopedKey } from "@/lib/profiles";
import type { MintSourceId } from "./mint";

export interface MintRecord {
  orderId: string;
  txHash: string;
  sourceId: MintSourceId;
  amount: string;
  recipient: string;
  depositAddress: string;
  keyFp: string;
  createdAt: number;
}

const BASE = "hme:tsd-mint-orders";
const EVENT = "hme:tsd-mint-orders-changed";
const MAX = 20;

export function readMintHistory(profileId: string): MintRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(BASE, profileId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as MintRecord[]).filter((r) => r && typeof r.orderId === "string") : [];
  } catch {
    return [];
  }
}

export function recordMintOrder(profileId: string, rec: MintRecord): void {
  try {
    const list = [rec, ...readMintHistory(profileId).filter((r) => r.orderId !== rec.orderId)].slice(0, MAX);
    window.localStorage.setItem(scopedKey(BASE, profileId), JSON.stringify(list));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* history is a convenience; the order itself lives at TSD Bridge */
  }
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
