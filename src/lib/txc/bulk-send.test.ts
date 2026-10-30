import { describe, expect, it } from "vitest";
import { buildSendToManyPayload, chunk, parseBulkCsv, STM_BATCH_SIZE } from "./bulk-send";
import { decodeOmniSend } from "./omni-decode";
import type { MempoolTx } from "./mempool";

const A = "Tst3dVnJbFrnx5ChmK6qj9F3M8YNsHWR44";

describe("bulk send", () => {
  it("parses CSV with header and exact token units", () => {
    const r = parseBulkCsv(`address,amount\n${A},0.8\n`, { type: "omni", divisible: true });
    expect(r.errors).toEqual([]);
    expect(r.rows[0].units).toBe(80_000_000n);
  });
  it("rejects bad addresses and zero amounts", () => {
    const r = parseBulkCsv(`nope,1\n${A},0`, { type: "omni", divisible: true });
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });
  it("rejects TXC amounts below dust", () => {
    expect(parseBulkCsv(`${A},0.00001`, { type: "txc" }).errors).toHaveLength(1);
  });
  it("splits Omni lists into batches of 7", () => {
    expect(chunk(Array.from({ length: 50 }), STM_BATCH_SIZE).map((b) => b.length)).toEqual([7, 7, 7, 7, 7, 7, 7, 1]);
  });
  it("7-receiver payload fits one OP_RETURN and decodes back", () => {
    const p = buildSendToManyPayload(39, [{ vout: 1, units: 80_000_000n }]);
    expect(buildSendToManyPayload(39, Array.from({ length: 7 }, (_, i) => ({ vout: i + 1, units: 1n }))).length).toBe(76);
    const hex = Array.from(p, (b) => b.toString(16).padStart(2, "0")).join("");
    const tx = {
      txid: "x", vin: [{ prevout: { scriptpubkey_address: "sender", value: 1 } }],
      vout: [{ scriptpubkey: "6a" + p.length.toString(16).padStart(2, "0") + hex, value: 0 }, { scriptpubkey: "", scriptpubkey_address: A, value: 10000 }],
      status: { confirmed: true },
    } as unknown as MempoolTx;
    const d = decodeOmniSend(tx);
    expect(d?.propertyId).toBe(39);
    expect(d?.allocations).toEqual([{ address: A, amount: 80_000_000n }]);
  });
  it("refuses more than 7 receivers per payload", () => {
    expect(() => buildSendToManyPayload(39, Array.from({ length: 8 }, (_, i) => ({ vout: i, units: 1n })))).toThrow();
  });
});

import { parseSavedRun, bulkRunSettled } from "./bulk-send";
import { TXC_MAX_FEE_RATE } from "./wallet";

describe("bulk send audit fixes", () => {
  it("merges a repeated address into one payment with the combined amount", () => {
    const r = parseBulkCsv(`${A},1\n${A},2.5\n`, { type: "txc" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].units).toBe(350_000_000n);
    expect(r.total).toBe(350_000_000n);
    expect(r.duplicates).toEqual([A]);
  });
  it("fee ceiling is 5,000 sat/vB", () => {
    expect(TXC_MAX_FEE_RATE).toBe(5_000);
  });
  it("a reload marks an in-flight batch as failed, keeps sent ones", () => {
    const tx = "a".repeat(64);
    const run = parseSavedRun(JSON.stringify({ asset: "39", savedAt: 1, steps: [
      { label: "T1", status: "ok", txid: tx, delivery: "checking" }, { label: "T2", status: "pending" }] }));
    expect(run!.steps[0]).toMatchObject({ status: "ok", txid: tx });
    expect(run!.steps[1].status).toBe("failed");
    expect(bulkRunSettled(run!)).toBe(false); // T1 still awaiting token verdict
    run!.steps[0].delivery = "delivered";
    expect(bulkRunSettled(run!)).toBe(true);
  });
});
