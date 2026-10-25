import { balanceHistoryKey } from "./history";

export interface CurrencyPoint { at: number; usd: number; price: number | null; amount: number }
export function currencyHistoryKey(profileId: string, fingerprint: string, asset: string) {
  return balanceHistoryKey(profileId, `${fingerprint}.currency.${encodeURIComponent(asset)}`);
}
export function appendCurrencyPoint(points: CurrencyPoint[], point: CurrencyPoint, ready: boolean): CurrencyPoint[] {
  if (!ready || !Number.isFinite(point.at) || !Number.isFinite(point.amount) || point.amount < 0 ||
      !Number.isFinite(point.usd) || point.usd < 0 ||
      (point.amount > 0 && (point.price === null || !Number.isFinite(point.price) || point.price <= 0))) return points;
  if (points.at(-1) && point.at - (points.at(-1)?.at ?? 0) < 300_000) return points;
  return [...points, { ...point, price: point.price !== null && Number.isFinite(point.price) && point.price > 0 ? point.price : null }].slice(-2000);
}
export function readCurrencyHistory(key: string): CurrencyPoint[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(data) ? data.filter((p): p is CurrencyPoint => p && Number.isFinite(p.at) && Number.isFinite(p.usd) && p.usd >= 0 && Number.isFinite(p.amount) && p.amount >= 0 && (p.price === null || (Number.isFinite(p.price) && p.price > 0))) : [];
  } catch { return []; }
}
export function matchesCurrency(row: { chain: string; currencyKey?: string | null }, asset: string): boolean {
  return row.currencyKey === asset;
}