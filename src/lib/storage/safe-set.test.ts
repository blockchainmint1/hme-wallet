import { describe, expect, it, vi } from "vitest";
import { safeSetItem, StorageFullError } from "./safe-set";
import { balanceHistoryKey, coverageId, readBalanceHistory } from "@/lib/desktop/history";

class Mem implements Storage {
  m = new Map<string, string>(); constructor(public cap: number) {}
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  setItem(k: string, v: string) {
    const used = [...this.m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > this.cap) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
}

describe("saving settings when storage is full", () => {
  it("trims chart history and saves the token list", () => {
    const s = new Mem(12_000);
    const hist = "hme.desktop.balance-history.v1.ab";
    s.setItem(hist, JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ at: i, usd: 1, coverage: "x" }))));
    safeSetItem("hme:tokens:custom:v1", "y".repeat(3000), s);
    expect(s.getItem("hme:tokens:custom:v1")).toHaveLength(3000);
    expect(JSON.parse(s.getItem(hist) ?? "[]").length).toBeLessThan(300);
  });
  it("never deletes non-history data; reports full when nothing can be trimmed", () => {
    const s = new Mem(100); s.setItem("txc.wallet.v1", "w".repeat(90));
    expect(() => safeSetItem("hme:tokens:custom:v1", "y".repeat(50), s)).toThrow(StorageFullError);
    expect(s.getItem("txc.wallet.v1")).toHaveLength(90);
  });
});

describe("chart coverage id", () => {
  it("is short, order-independent, and old long records map to it", () => {
    const id = coverageId(["b", "a"]);
    expect(id).toBe(coverageId(["a", "b"]));
    expect(id.length).toBeLessThanOrEqual(18);
    vi.stubGlobal("localStorage", new Mem(1_000_000));
    localStorage.setItem(balanceHistoryKey("default", "fp"), JSON.stringify([{ at: 1, usd: 2, coverage: "a,b" }]));
    expect(readBalanceHistory("default", "fp")[0]?.coverage).toBe(id);
  });
});
