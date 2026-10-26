import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { appendBalancePoint, balanceHistoryKey, balanceHistoryBlockers, clearBalanceHistory, readBalanceHistory, portfolioChartWindow } from "./history";
describe("desktop balance history", () => {
  beforeAll(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", new Proxy(store, {
      get: (t, p) =>
        p === "getItem" ? (k: string) => t[k] ?? null
        : p === "setItem" ? (k: string, v: string) => { t[k] = String(v); }
        : p === "removeItem" ? (k: string) => { delete t[k]; }
        : p === "clear" ? () => { for (const k of Object.keys(t)) delete t[k]; }
        : Reflect.get(t, p),
    }));
  });
  beforeEach(() => localStorage.clear());
  it("reports unknown balances instead of treating them as zero", () => {
    expect(balanceHistoryBlockers([{ name: "Zero Chill", amount: null, price: 1 }, { name: "Bitcoin", amount: 2, price: 60000 }])).toEqual(["Zero Chill"]);
  });
  it("requires a valid price for funded holdings but not known zero holdings", () => {
    expect(balanceHistoryBlockers([{ name: "Zero Chill", amount: 2, price: null }, { name: "Ethereum", amount: 0, price: null }])).toEqual(["Zero Chill"]);
    expect(balanceHistoryBlockers([{ name: "Bitcoin", amount: 1, price: NaN }])).toEqual(["Bitcoin"]);
  });
  it("isolates two wallet profiles without changing envelope keys", () => { expect(balanceHistoryKey("default", "aa")).toBe("hme.desktop.balance-history.v1.aa"); expect(balanceHistoryKey("second", "bb")).toBe("p:second:hme.desktop.balance-history.v1.bb"); });
  it("keys history by wallet fingerprint so a new seed never inherits old history", () => { localStorage.setItem(balanceHistoryKey("default", "oldseed"), JSON.stringify([{ at: 1, usd: 100, coverage: "btc" }])); expect(readBalanceHistory("default", "newseed")).toEqual([]); expect(readBalanceHistory("default", "oldseed")).toEqual([{ at: 1, usd: 100, coverage: "btc" }]); });
  it("clears fingerprinted and legacy history when the wallet is deleted", () => { localStorage.setItem(balanceHistoryKey("default", "aa"), "[]"); localStorage.setItem("hme.desktop.balance-history.v1", "[]"); localStorage.setItem(balanceHistoryKey("second", "bb"), "[]"); clearBalanceHistory("default"); expect(localStorage.getItem("hme.desktop.balance-history.v1.aa")).toBeNull(); expect(localStorage.getItem("hme.desktop.balance-history.v1")).toBeNull(); expect(localStorage.getItem("p:second:hme.desktop.balance-history.v1.bb")).not.toBeNull(); });
  it("never records incomplete outage values as losses", () => { const saved = [{at: 1, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 600001, usd: 0, coverage: "btc"}, false)).toEqual(saved); });
  it("removes per-currency observations with the deleted profile only", () => {
    const own=balanceHistoryKey("default","aa.currency.btc");
    const other=balanceHistoryKey("second","aa.currency.btc");
    localStorage.setItem(own,"[]"); localStorage.setItem(other,"[]");
    clearBalanceHistory("default");
    expect(localStorage.getItem(own)).toBeNull(); expect(localStorage.getItem(other)).toBe("[]");
  });
  it("keeps points from other coverage sets instead of wiping them", () => { const saved = [{at: 1, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 600001, usd: 50, coverage: "btc,eth"}, true)).toEqual([{at: 1, usd: 100, coverage: "btc"}, {at: 600001, usd: 50, coverage: "btc,eth"}]); });
  it("throttles unchanged points within five minutes", () => { const saved = [{at: 1, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 100000, usd: 100, coverage: "btc"}, true)).toEqual(saved); });
  it("records a changed complete balance immediately", () => { const saved = [{at: 1, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 100000, usd: 101, coverage: "btc"}, true).at(-1)?.usd).toBe(101); });
  it("does not append older observations", () => { const saved = [{at: 100000, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 1, usd: 101, coverage: "btc"}, true)).toEqual(saved); });
  it("uses distinct day and month windows even with today's history only", () => {
    const now = 40 * 86400000;
    const points = [{at: now - 3600000, usd: 475440.40, coverage: "btc"}, {at: now, usd: 475540.40, coverage: "btc"}];
    const day = portfolioChartWindow(points, "btc", "1D", now);
    const month = portfolioChartWindow(points, "btc", "1M", now);
    expect(day.timeDomain).toEqual([now - 86400000, now]);
    expect(month.timeDomain).toEqual([now - 30 * 86400000, now]);
    expect(month.visible).toEqual(points);
    expect(day.valueDomain[0]).toBeGreaterThan(475000);
    expect(day.valueDomain[1]).toBeGreaterThan(475540.40);
  });
  it("excludes older, future and differently covered observations", () => {
    const now = 40 * 86400000;
    expect(portfolioChartWindow([{at: 1, usd: 10, coverage: "btc"}, {at: now, usd: 20, coverage: "eth"}, {at: now + 1, usd: 30, coverage: "btc"}], "btc", "1D", now).visible).toEqual([]);
  });
});
