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
