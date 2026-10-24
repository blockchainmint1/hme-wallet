import { scopedKey } from "@/lib/profiles";
export interface BalancePoint { at: number; usd: number; coverage: string }
const PREFIX = "hme.desktop.balance-history.v1";
/** Keyed by wallet fingerprint so a different seed never inherits another wallet's history. */
export function balanceHistoryKey(profileId: string, fingerprint: string) { return scopedKey(`${PREFIX}.${fingerprint}`, profileId); }
/** Remove every balance-history key for a profile, including legacy un-fingerprinted keys. */
export function clearBalanceHistory(profileId: string): void {
  if (typeof localStorage === "undefined") return;
  const prefix = scopedKey(PREFIX, profileId);
  for (const key of Object.keys(localStorage)) {
    if (key === prefix || key.startsWith(`${prefix}.`)) localStorage.removeItem(key);
  }
}
export function appendBalancePoint(points: BalancePoint[], point: BalancePoint, complete: boolean): BalancePoint[] {
  if (!complete || !Number.isFinite(point.usd) || point.usd < 0 || !Number.isFinite(point.at)) return points;
  // Keep points from other coverage sets; renderers filter to the coverage they display.
  const last = points.filter(p => p.coverage === point.coverage).at(-1);
  if (last && point.at - last.at < 300_000) return points;
  return [...points, point].slice(-2000);
}
export function readBalanceHistory(profileId: string, fingerprint: string): BalancePoint[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(balanceHistoryKey(profileId, fingerprint)) ?? "[]"); return Array.isArray(data) ? data.filter((p): p is BalancePoint => p && Number.isFinite(p.at) && Number.isFinite(p.usd) && p.usd >= 0 && typeof p.coverage === "string") : []; } catch { return []; }
}
