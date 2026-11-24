import { safeSetItem } from "@/lib/storage/safe-set";
/**
 * Local TSD Swap link records, one list per wallet profile.
 *
 * Kept in its own dependency-free module (only `@/lib/profiles`) so the
 * cash-out key store can read every profile's records during its one-time
 * migration without importing the network/signing code in `tsd-link.ts`.
 */
import { activeProfileId, scopedKey } from "@/lib/profiles";

export interface TsdLinkRecord {
  accountId: string;
  accountName: string;
  identity: string;
  linkedAt: string;
  /**
   * First 8 hex chars of SHA-256 of the cash-out key this link issued.
   * `null` = the claim issued no key. Absent = record predates fingerprints.
   * Never the key itself.
   */
  keyFp?: string | null;
}

export const TSD_LINK_STORE_BASE = "hme:tsd-account-link";

export function listTsdLinks(profileId: string = activeProfileId()): TsdLinkRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(TSD_LINK_STORE_BASE, profileId));
    const parsed = raw ? (JSON.parse(raw) as TsdLinkRecord[]) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => !!r && typeof r === "object") : [];
  } catch {
    return [];
  }
}

export function saveTsdLink(record: TsdLinkRecord, profileId: string = activeProfileId()) {
  try {
    const next = [
      ...listTsdLinks(profileId).filter((l) => l.accountId !== record.accountId),
      record,
    ];
    safeSetItem(scopedKey(TSD_LINK_STORE_BASE, profileId), JSON.stringify(next));
  } catch {
    /* noop */
  }
}

export function writeTsdLinks(list: TsdLinkRecord[], profileId: string = activeProfileId()) {
  try {
    safeSetItem(scopedKey(TSD_LINK_STORE_BASE, profileId), JSON.stringify(list));
  } catch {
    /* noop */
  }
}
