import { describe, expect, it } from "vitest";
import {
  buildSendToManyPayload,
  chunk,
  parseBulkCsv,
  STM_BATCH_SIZE,
  tokenSourceProblem,
} from "./bulk-send";
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
    expect(chunk(Array.from({ length: 50 }), STM_BATCH_SIZE).map((b) => b.length)).toEqual([
      7, 7, 7, 7, 7, 7, 7, 1,
    ]);
  });
  it("7-receiver payload fits one OP_RETURN and decodes back", () => {
    const p = buildSendToManyPayload(39, [{ vout: 1, units: 80_000_000n }]);
    expect(
      buildSendToManyPayload(
        39,
        Array.from({ length: 7 }, (_, i) => ({ vout: i + 1, units: 1n })),
      ).length,
    ).toBe(76);
    const hex = Array.from(p, (b) => b.toString(16).padStart(2, "0")).join("");
    const tx = {
      txid: "x",
      vin: [{ prevout: { scriptpubkey_address: "sender", value: 1 } }],
      vout: [
        { scriptpubkey: "6a" + p.length.toString(16).padStart(2, "0") + hex, value: 0 },
        { scriptpubkey: "", scriptpubkey_address: A, value: 10000 },
      ],
      status: { confirmed: true },
    } as unknown as MempoolTx;
    const d = decodeOmniSend(tx);
    expect(d?.propertyId).toBe(39);
    expect(d?.allocations).toEqual([{ address: A, amount: 80_000_000n }]);
  });
  it("refuses more than 7 receivers per payload", () => {
    expect(() =>
      buildSendToManyPayload(
        39,
        Array.from({ length: 8 }, (_, i) => ({ vout: i, units: 1n })),
      ),
    ).toThrow();
  });
});

import { parseSavedRun, bulkRunSettled, recordBulkAttempt, recoverBulkSteps } from "./bulk-send";
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
  it("a reload keeps an in-flight batch uncertain and blocks retries, leaving sent ones untouched", () => {
    const tx = "a".repeat(64);
    const run = parseSavedRun(
      JSON.stringify({
        asset: "39",
        savedAt: 1,
        steps: [
          { label: "T1", status: "ok", txid: tx, delivery: "checking" },
          { label: "T2", status: "pending" },
        ],
      }),
    );
    if (!run) throw new Error("Expected saved run");
    expect(run.steps[0]).toMatchObject({ status: "ok", txid: tx });
    expect(run.steps[1]?.status).toBe("uncertain");
    expect(bulkRunSettled(run)).toBe(false);
    const settledFirst = {
      ...run,
      steps: run.steps.map((s, i) => (i === 0 ? { ...s, delivery: "delivered" as const } : s)),
    };
    expect(bulkRunSettled(settledFirst)).toBe(false); // unknown T2 still blocks
  });
  it("records the local txid and input reservation before submission and restores it on reload", () => {
    let value = "";
    const storage = {
      setItem: (_k: string, v: string) => {
        value = v;
      },
    } as Storage;
    const id = "b".repeat(64);
    recordBulkAttempt(
      "test",
      { asset: "39", savedAt: 1, steps: [{ label: "T1", status: "waiting" }] },
      0,
      id,
      [{ txid: "c".repeat(64), vout: 2 }],
      storage,
    );
    expect(parseSavedRun(value)?.steps[0]).toMatchObject({
      status: "uncertain",
      txid: id,
      spent: [`${"c".repeat(64)}:2`],
      attemptedAt: expect.any(Number),
    });
  });
  it("gives a legacy uncertain bulk step one persistent fresh wait", () => {
    const id = "b".repeat(64);
    const raw = JSON.stringify({
      asset: "39",
      savedAt: 1,
      steps: [{ label: "T1", status: "uncertain", txid: id }],
    });
    const first = parseSavedRun(raw, 1_800_000_000_000);
    const second = parseSavedRun(JSON.stringify(first), 1_800_000_000_100);
    expect(first?.steps[0]?.attemptedAt).toBe(1_800_000_000_000);
    expect(second?.steps[0]?.attemptedAt).toBe(1_800_000_000_000);
  });
  it("cannot proceed when the attempt cannot be saved", () => {
    const storage = {
      setItem: () => {
        throw new Error("storage unavailable");
      },
    } as unknown as Storage;
    expect(() =>
      recordBulkAttempt(
        "test",
        { asset: "39", savedAt: 1, steps: [{ label: "T1", status: "waiting" }] },
        0,
        "a".repeat(64),
        [],
        storage,
      ),
    ).toThrow("storage unavailable");
  });
  it("only a positive lookup resolves uncertainty; token delivery still waits for Omni", () => {
    const id = "a".repeat(64);
    const run = {
      asset: "39",
      savedAt: 1,
      steps: [{ label: "T1", status: "uncertain" as const, txid: id }],
    };
    expect(bulkRunSettled({ ...run, steps: recoverBulkSteps(run.steps, [], "39") })).toBe(false);
    const found = recoverBulkSteps(run.steps, [id], "39");
    expect(found[0]).toMatchObject({ status: "ok", delivery: "checking", txid: id });
    expect(bulkRunSettled({ ...run, steps: found })).toBe(false);
    expect(recoverBulkSteps(run.steps, [id], "txc")[0]).toMatchObject({ status: "ok", txid: id });
  });
  it("does not change settled payment records during recovery", () => {
    const settled = {
      label: "T1",
      status: "ok" as const,
      txid: "a".repeat(64),
      delivery: "delivered" as const,
    };
    expect(recoverBulkSteps([settled], [settled.txid], "39")[0]).toBe(settled);
  });
  it("a token send waits until the holding address is known (no send while the lookup is loading or failed)", () => {
    expect(tokenSourceProblem({ symbol: "TSD", lookup: "loading", holderFound: false })).toBe(
      "Checking which address holds your TSD…",
    );
    expect(tokenSourceProblem({ symbol: "TSD", lookup: "failed", holderFound: false })).toMatch(
      /^Couldn't check/,
    );
    expect(tokenSourceProblem({ symbol: "TSD", lookup: "done", holderFound: false })).toBe(
      "No TSD found in this wallet.",
    );
    expect(tokenSourceProblem({ symbol: "TSD", lookup: "done", holderFound: true })).toBeNull();
  });
});
