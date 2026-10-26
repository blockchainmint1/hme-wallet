import { scopedKey } from "@/lib/profiles";
export interface BalancePoint { at: number; usd: number; coverage: string }
/** Zero holdings need no market price; positive holdings must have a finite valuation. */
export function balanceHistoryBlockers(rows: readonly { name: string; amount: number | null; price: number | null }[]): string[] {
  return rows.filter(row => row.amount === null || !Number.isFinite(row.amount) || row.amount < 0 ||
    (row.amount > 0 && (row.price === null || !Number.isFinite(row.price) || row.price <= 0))).map(row => row.name);
}
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
  if (last && (point.at <= last.at || (point.at - last.at < 300_000 && point.usd === last.usd))) return points;
  return [...points, point].slice(-2000);
}
export function readBalanceHistory(profileId: string, fingerprint: string): BalancePoint[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(balanceHistoryKey(profileId, fingerprint)) ?? "[]"); return Array.isArray(data) ? data.filter((p): p is BalancePoint => p && Number.isFinite(p.at) && Number.isFinite(p.usd) && p.usd >= 0 && typeof p.coverage === "string") : []; } catch { return []; }
}

/** Selected windows never manufacture observations or borrow a different asset set. */
export function portfolioChartWindow(points: BalancePoint[], coverage: string, range: string, now: number) {
  const days = range === "1D" ? 1 : range === "1W" ? 7 : range === "1Y" ? 365 : 30;
  const matching = points.filter(p => p.coverage === coverage && p.at <= now).sort((a, b) => a.at - b.at);
  const start = range === "ALL" ? matching[0]?.at ?? now - 86400000 : now - days * 86400000;
  const visible = matching.filter(p => p.at >= start);
  const values = visible.map(p => p.usd);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const padding = Math.max((max - min) * 0.15, max * 0.0001, 0.01);
  return { visible, timeDomain: [start, Math.max(now, start + 1)] as [number, number], valueDomain: [Math.max(0, min - padding), max + padding] as [number, number] };
}
