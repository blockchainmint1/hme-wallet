import { beforeEach, describe, expect, it } from "vitest";
import { readCashoutHistory, recordCashout, type CashoutRecord } from "./cashout-history";

const rec = (over: Partial<CashoutRecord> = {}): CashoutRecord => ({
  txid: "a".repeat(64),
  kind: "one-time-order",
  orderId: "ord_1",
  amount: "40000",
  payoutAmount: 39800,
  payoutAddress: "0x1111111111111111111111111111111111111111",
  depositAddress: "TDeposit",
  keyFp: "abcd1234",
  createdAt: 1,
  ...over,
});

describe("TSD cash-out history", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    Object.assign(globalThis, { window: { localStorage: storage, dispatchEvent: () => true }, localStorage: storage });
  });

  it("lists a sent cash-out for the wallet that sent it", () => {
    recordCashout("default", rec());
    expect(readCashoutHistory("default").map((r) => r.amount)).toEqual(["40000"]);
  });

  it("is kept per wallet: another wallet does not see it", () => {
    recordCashout("default", rec());
    expect(readCashoutHistory("pr_b")).toEqual([]);
  });

  it("records the same transaction once", () => {
    recordCashout("default", rec());
    recordCashout("default", rec({ createdAt: 2 }));
    expect(readCashoutHistory("default")).toHaveLength(1);
  });

  it("never stores the cash-out key itself", () => {
    recordCashout("default", rec());
    const raw = [...data.values()].join("");
    expect(raw).not.toContain("tsd_live_");
    expect(raw).toContain("abcd1234");
  });
});
