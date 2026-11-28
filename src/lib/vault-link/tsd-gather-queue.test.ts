import { describe, expect, it } from "vitest";
import { advanceGatherQueue, createGatherQueue, stopGatherQueue, unspentGatherInputs } from "./tsd-gather-queue";

describe("Vault consolidate-all queue", () => {
  it("requires one successful broadcast per address before advancing", () => {
    const first = createGatherQueue([1, 4, 7]);
    expect(first.cursor).toBe(0);
    expect(first.sent).toEqual([]);
    const second = advanceGatherQueue(first, 1, "a".repeat(64));
    expect(second.indexes[second.cursor]).toBe(4);
    expect(second.sent).toEqual([{ index: 1, txid: "a".repeat(64) }]);
    expect(() => advanceGatherQueue(second, 7, "b".repeat(64))).toThrow();
    const last = advanceGatherQueue(advanceGatherQueue(second, 4, "b".repeat(64)), 7, "c".repeat(64));
    expect(last.active).toBe(false);
    expect(last.sent).toHaveLength(3);
  });
  it("stops on failure or user cancellation without forgetting earlier payments", () => {
    const stopped = stopGatherQueue(advanceGatherQueue(createGatherQueue([1, 2, 3]), 1, "a".repeat(64)));
    expect(stopped.active).toBe(false);
    expect(stopped.cursor).toBe(1);
    expect(stopped.sent).toEqual([{ index: 1, txid: "a".repeat(64) }]);
    expect(() => advanceGatherQueue(stopped, 2, "b".repeat(64))).toThrow();
  });
  it("never reuses a spent address-zero fee coin even if the indexer still lists it", () => {
    const inputs = [{ txid: "a", vout: 0 }, { txid: "a", vout: 1 }, { txid: "b", vout: 0 }];
    expect(unspentGatherInputs(inputs, new Set(["a:0", "b:0"]))).toEqual([{ txid: "a", vout: 1 }]);
  });
  it("refuses duplicate addresses, address zero and empty runs", () => {
    for (const indexes of [[], [0], [1, 1], [1000]]) expect(() => createGatherQueue(indexes)).toThrow();
  });
});