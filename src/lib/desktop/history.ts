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
  return thinOlderBalancePoints([...points, point], point.at).slice(-2000);
}

/** Keep actual observations only: last sample in each five-minute older bucket,
 * separately per coverage. Recent observations retain their full resolution. */
export function thinOlderBalancePoints(points: BalancePoint[], now: number): BalancePoint[] {
  const cutoff = now - 86400000;
  const buckets = new Map<string, BalancePoint>();
  const recent: BalancePoint[] = [];
  for (const point of points) {
    if (point.at >= cutoff) recent.push(point);
    else {
      const key = `${point.coverage}:${Math.floor(point.at / 300_000)}`;
      const prior = buckets.get(key);
      if (!prior || point.at > prior.at) buckets.set(key, point);
    }
  }
  return [...buckets.values(), ...recent].sort((a, b) => a.at - b.at);
}
/** Short stable id for an asset set: repeating the full key list in every sample filled browser storage. */
export function coverageId(keys: readonly string[]): string {
  const text = [...keys].sort().join(",");
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "h:" + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
const isCoverageId = (c: string) => c.startsWith("h:");
export function readBalanceHistory(profileId: string, fingerprint: string): BalancePoint[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(balanceHistoryKey(profileId, fingerprint)) ?? "[]"); return Array.isArray(data) ? data.filter((p): p is BalancePoint => p && Number.isFinite(p.at) && Number.isFinite(p.usd) && p.usd >= 0 && typeof p.coverage === "string").map(p => isCoverageId(p.coverage) ? p : { ...p, coverage: coverageId(p.coverage ? p.coverage.split(",") : []) }) : []; } catch { return []; }
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
