import { safeSetItem } from "@/lib/storage/safe-set";
/**
 * TSD Swap API key, one per wallet profile.
 *
 * Cash-out is off by default: the wallet only shows the off-ramp once the user
 * has a TSD Swap account and has pasted (or a link has issued) the key for it.
 * The key both authorises the order and tells TSD Swap which account (and
 * therefore which fee tier) applies, so the wallet never quotes a rate itself.
 *
 * It is a per-account capability token, not spending authority: it can only
 * create redeem orders that pay out to an address the user types on the
 * device. Because it identifies a TSD Swap account, it is stored per wallet
 * through `scopedKey` like every other key-tied store: the default wallet keeps
 * the historical unprefixed key, other wallets use `p:<id>:hme:tsd-cashout-key`.
 *
 * Older builds stored one device-wide key. `migrateLegacyCashoutKey` moves it,
 * once, to the wallet that most plausibly issued it (see that function). The
 * key is never logged and never stored in link records (only an 8-hex
 * fingerprint is).
 */
import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  DEFAULT_PROFILE_ID,
  PROFILES_CHANGED_EVENT,
  activeProfileId,
  listProfileIds,
  scopedKey,
} from "@/lib/profiles";
import { listTsdLinks, type TsdLinkRecord } from "@/lib/rewards/tsd-link-records";

export const CASHOUT_KEY_BASE = "hme:tsd-cashout-key";
/** Device-wide marker: the legacy device-wide key has been assigned to a wallet. */
export const CASHOUT_KEY_MIGRATED_MARKER = "hme:tsd-cashout-key.scope-migrated.v1";
/**
 * Device-wide one-time notice: the migration removed the legacy key because its
 * owner could not be told apart (see the conflict case below). "1" = not yet
 * seen, "seen" = dismissed.
 */
export const CASHOUT_KEY_CONFLICT_NOTICE = "hme:tsd-cashout-key.conflict-notice.v1";
const EVENT = "hme:tsd-cashout-key-changed";

/** Loose shape check so obvious paste mistakes are caught on the device. */
export const TSD_API_KEY_RE = /^[A-Za-z0-9_.:-]{16,200}$/;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function emit() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* SSR / test */
  }
}

/** First 8 hex characters of SHA-256(key). Identifies a key without revealing it. */
export function cashoutKeyFingerprint(key: string): string {
  const digest = sha256(new TextEncoder().encode(key));
  let hex = "";
  for (let i = 0; i < 4; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}

/* ------------------------------------------------------------------ */
/* One-time migration of the legacy device-wide key                    */
/* ------------------------------------------------------------------ */

/**
 * Which wallet owns the legacy device-wide key.
 *
 * Every claim overwrote the device key, so the wallet with the newest link is
 * the most likely issuer. Falls back to the default wallet (which already holds
 * the key in its slot) when there are no link records (hand-pasted key), when
 * any record has an unparseable `linkedAt`, or when two different wallets
 * share the newest `linkedAt` to the second. No copies are ever made.
 */
export function resolveLegacyKeyOwner(
  byProfile: { profileId: string; records: TsdLinkRecord[] }[],
): string {
  let bestSec = -Infinity;
  let bestProfile: string | null = null;
  let tie = false;
  for (const { profileId, records } of byProfile) {
    for (const r of records) {
      const t = typeof r?.linkedAt === "string" ? Date.parse(r.linkedAt) : NaN;
      if (!Number.isFinite(t)) return DEFAULT_PROFILE_ID;
      const sec = Math.floor(t / 1000);
      if (sec > bestSec) {
        bestSec = sec;
        bestProfile = profileId;
        tie = false;
      } else if (sec === bestSec && profileId !== bestProfile) {
        tie = true;
      }
    }
  }
  if (!bestProfile || tie) return DEFAULT_PROFILE_ID;
  return bestProfile;
}

export type CashoutKeyMigration =
  | "unavailable"
  | "already-done"
  | "no-key"
  | "kept-default"
  | "conflict-removed"
  | "moved"
  | "failed";

/**
 * Runs before every key read or write. localStorage only: never touches
 * envelopes, the profile list or the active profile.
 *
 * Order is copy → verify → delete legacy → verify → set marker. Any failure
 * leaves the marker unset (and the legacy key in place unless it was already
 * safely copied), so the next load retries; a retry after a successful copy
 * finds the identical copy and carries on.
 *
 * Idempotent on a re-appearing key: once the marker is set, an unprefixed key
 * (for example written by an older APK or extension build on this device) is
 * the default wallet's key by convention and is left alone.
 */
export function migrateLegacyCashoutKey(): CashoutKeyMigration {
  const s = storage();
  if (!s) return "unavailable";
  try {
    if (s.getItem(CASHOUT_KEY_MIGRATED_MARKER)) return "already-done";
    const legacy = s.getItem(CASHOUT_KEY_BASE);
    if (!legacy) {
      s.setItem(CASHOUT_KEY_MIGRATED_MARKER, "1");
      return "no-key";
    }
    const owner = resolveLegacyKeyOwner(
      listProfileIds().map((profileId) => ({ profileId, records: listTsdLinks(profileId) })),
    );
    if (owner === DEFAULT_PROFILE_ID) {
      s.setItem(CASHOUT_KEY_MIGRATED_MARKER, "1");
      return "kept-default";
    }
    const target = scopedKey(CASHOUT_KEY_BASE, owner);
    const existing = s.getItem(target);
    if (existing && existing !== legacy) {
      // The owner already has a different key of its own: never overwrite it.
      // Ownership of the legacy key is then unknown, and leaving it in the
      // default wallet's slot would hand an account to a wallet that never
      // earned it. Delete it (verify), raise the one-time notice, then mark.
      // Any failure leaves the marker unset so the next load retries.
      s.removeItem(CASHOUT_KEY_BASE);
      if (s.getItem(CASHOUT_KEY_BASE) !== null) return "failed";
      s.setItem(CASHOUT_KEY_CONFLICT_NOTICE, "1");
      if (s.getItem(CASHOUT_KEY_CONFLICT_NOTICE) !== "1") return "failed";
      s.setItem(CASHOUT_KEY_MIGRATED_MARKER, "1");
      return "conflict-removed";
    }
    if (!existing) {
      safeSetItem(target, legacy, s);
      if (s.getItem(target) !== legacy) {
        try {
          s.removeItem(target);
        } catch {
          /* noop */
        }
        return "failed";
      }
    }
    s.removeItem(CASHOUT_KEY_BASE);
    if (s.getItem(CASHOUT_KEY_BASE) !== null) return "failed";
    s.setItem(CASHOUT_KEY_MIGRATED_MARKER, "1");
    return "moved";
  } catch {
    return "failed";
  }
}

/** True until the user dismisses the "old shared key was removed" notice. */
export function cashoutKeyConflictNoticePending(): boolean {
  const s = storage();
  if (!s) return false;
  migrateLegacyCashoutKey();
  try {
    return s.getItem(CASHOUT_KEY_CONFLICT_NOTICE) === "1";
  } catch {
    return false;
  }
}

export function dismissCashoutKeyConflictNotice(): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(CASHOUT_KEY_CONFLICT_NOTICE, "seen");
  } catch {
    /* noop */
  }
  emit();
}

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */

export function getCashoutApiKey(profileId: string = activeProfileId()): string | null {
  const s = storage();
  if (!s) return null;
  migrateLegacyCashoutKey();
  try {
    return s.getItem(scopedKey(CASHOUT_KEY_BASE, profileId)) || null;
  } catch {
    return null;
  }
}

/** Writes (or clears) one wallet's key. Returns false if the write did not stick. */
export function setCashoutApiKey(
  key: string | null,
  profileId: string = activeProfileId(),
): boolean {
  const s = storage();
  if (!s) return false;
  // Migrate first, so a new write can never be mistaken for the legacy key.
  migrateLegacyCashoutKey();
  const slot = scopedKey(CASHOUT_KEY_BASE, profileId);
  try {
    if (key) safeSetItem(slot, key, s);
    else s.removeItem(slot);
    emit();
    return (s.getItem(slot) || null) === (key || null);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Link removal                                                        */
/* ------------------------------------------------------------------ */

/**
 * Does removing this link record also remove the wallet's cash-out key?
 *  - Record carries a fingerprint: only if it matches the current key (that
 *    link issued it). A different, hand-pasted key is kept.
 *  - Record says the claim issued no key (`keyFp: null`): never.
 *  - Record predates fingerprints: only when it is the wallet's last TSD link.
 */
export function linkRemovalClearsKey(
  records: TsdLinkRecord[],
  accountId: string,
  currentKey: string | null,
): boolean {
  if (!currentKey) return false;
  const rec = records.find((r) => r.accountId === accountId);
  if (!rec) return false;
  if (typeof rec.keyFp === "string") return rec.keyFp === cashoutKeyFingerprint(currentKey);
  if (rec.keyFp === null) return false;
  return records.every((r) => r.accountId === accountId);
}

/* ------------------------------------------------------------------ */
/* Submission-time binding                                             */
/* ------------------------------------------------------------------ */

export interface CashoutKeyBinding {
  profileId: string;
  keyFp: string;
}

/**
 * Bind a cash-out plan to the wallet and key it was created with. Returns null
 * when `key` is not the active wallet's stored key (a stale screen after a
 * wallet switch), so no plan is ever built on another wallet's account.
 */
export function bindCashoutKey(key: string | null): CashoutKeyBinding | null {
  if (!key) return null;
  const profileId = activeProfileId();
  if (getCashoutApiKey(profileId) !== key) return null;
  return { profileId, keyFp: cashoutKeyFingerprint(key) };
}

/** Re-read right before signing: same active wallet, same stored key. */
export function cashoutBindingHolds(binding: CashoutKeyBinding): boolean {
  if (activeProfileId() !== binding.profileId) return false;
  const key = getCashoutApiKey(binding.profileId);
  return !!key && cashoutKeyFingerprint(key) === binding.keyFp;
}

/* ------------------------------------------------------------------ */
/* React hook                                                          */
/* ------------------------------------------------------------------ */

/**
 * Hydration-safe: null on the server and first render, then the active
 * wallet's key. Re-reads when the key changes or the wallet is switched.
 */
export function useCashoutApiKey(): [string | null, (k: string | null) => void] {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const h = () => setKey(getCashoutApiKey());
    h();
    window.addEventListener(EVENT, h);
    window.addEventListener(PROFILES_CHANGED_EVENT, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(EVENT, h);
      window.removeEventListener(PROFILES_CHANGED_EVENT, h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return [
    key,
    (k: string | null) => {
      setCashoutApiKey(k, activeProfileId());
      setKey(getCashoutApiKey());
    },
  ];
}

/** Mask for display: keeps the first and last few characters only. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
