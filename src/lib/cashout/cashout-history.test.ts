import { beforeEach, describe, expect, it } from "vitest";
import { broadcastRecordedCashout, cashoutRecordStatus, readCashoutHistory, recordCashout, type CashoutRecord } from "./cashout-history";

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

  it("a failed broadcast still leaves a visible 'sending' row with the local txid", async () => {
    const r = rec({ txid: "b".repeat(64) });
    await expect(
      broadcastRecordedCashout("default", r, async () => {
        throw new Error("HTTP 520");
      }),
    ).rejects.toThrow("HTTP 520");
    const list = readCashoutHistory("default");
    expect(list).toHaveLength(1);
    expect(list[0].txid).toBe("b".repeat(64));
    expect(cashoutRecordStatus(list[0])).toBe("sending");
  });

  it("the row is saved before the broadcast starts", async () => {
    let seenDuringBroadcast: string | undefined;
    await broadcastRecordedCashout("default", rec(), async () => {
      seenDuringBroadcast = readCashoutHistory("default")[0]?.status;
      return "a".repeat(64);
    });
    expect(seenDuringBroadcast).toBe("sending");
  });

  it("a successful broadcast upgrades the same row to 'sent' without a duplicate", async () => {
    await broadcastRecordedCashout("default", rec(), async () => "a".repeat(64));
    const list = readCashoutHistory("default");
    expect(list).toHaveLength(1);
    expect(cashoutRecordStatus(list[0])).toBe("sent");
  });

  it("records saved by the earlier build (no status) read as sent", () => {
    recordCashout("default", rec());
    expect(cashoutRecordStatus(readCashoutHistory("default")[0])).toBe("sent");
  });
});
