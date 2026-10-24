import { scopedKey } from "@/lib/profiles";
export interface BalancePoint { at: number; usd: number; coverage: string }
export function balanceHistoryKey(profileId: string) { return scopedKey("hme.desktop.balance-history.v1", profileId); }
export function appendBalancePoint(points: BalancePoint[], point: BalancePoint, complete: boolean): BalancePoint[] {
  if (!complete || !Number.isFinite(point.usd) || point.usd < 0 || !Number.isFinite(point.at)) return points;
  const compatible = points.filter(p => p.coverage === point.coverage);
  const last = compatible.at(-1);
  if (last && point.at - last.at < 300_000) return compatible;
  return [...compatible, point].slice(-2000);
}
export function readBalanceHistory(profileId: string): BalancePoint[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(balanceHistoryKey(profileId)) ?? "[]"); return Array.isArray(data) ? data.filter((p): p is BalancePoint => p && Number.isFinite(p.at) && Number.isFinite(p.usd) && p.usd >= 0 && typeof p.coverage === "string") : []; } catch { return []; }
}
