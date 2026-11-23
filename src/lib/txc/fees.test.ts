import { describe, expect, it } from "vitest";
import { txcFeeRate } from "./fees";

describe("txcFeeRate", () => {
  it("pays 1 sat/vB when the network asks for 1", () => {
    expect(txcFeeRate({ fastestFee: 1, halfHourFee: 1, hourFee: 1, minimumFee: 1 })).toBe(1);
  });
  it("follows a higher estimate for the chosen speed", () => {
    expect(txcFeeRate({ fastestFee: 12, halfHourFee: 7, hourFee: 3, minimumFee: 1 }, "fastestFee")).toBe(12);
    expect(txcFeeRate({ fastestFee: 12, halfHourFee: 7, hourFee: 3, minimumFee: 1 }, "hourFee")).toBe(3);
  });
  it("never goes below the node's reported minimum", () => {
    expect(txcFeeRate({ hourFee: 1, minimumFee: 4 }, "hourFee")).toBe(4);
  });
  it("rounds fractional rates up to whole sats", () => {
    expect(txcFeeRate({ halfHourFee: 1.2, minimumFee: 1 })).toBe(2);
  });
  it("falls back to 10 sat/vB when the estimate is missing or broken", () => {
    expect(txcFeeRate(null)).toBe(10);
    expect(txcFeeRate({ halfHourFee: Number.NaN, minimumFee: 0 })).toBe(10);
  });
});

import { payments } from "bitcoinjs-lib";
import { buildAndSignTx, deriveAddress, rootFromSeed } from "./wallet";
import { TXC_NETWORK } from "./network";

describe("buildAndSignTx fee floor", () => {
  const root = rootFromSeed(new Uint8Array(64).fill(7));
  const own = deriveAddress(root, "bip84", 0, 0);
  const script = payments.p2wpkh({ pubkey: own.pubkey, network: TXC_NETWORK }).output!;
  const hex = Array.from(script, (b) => b.toString(16).padStart(2, "0")).join("");
  const args = (feeSats: number) => ({
    root,
    kind: "bip84" as const,
    inputs: [{ txid: "11".repeat(32), vout: 0, value: 1_000_000, witnessScriptHex: hex, change: 0 as const, index: 0 }],
    outputs: [{ address: deriveAddress(root, "bip84", 0, 1).address, valueSats: 500_000 }],
    changeAddress: deriveAddress(root, "bip84", 1, 0).address,
    changeIndex: 0,
    feeSats,
  });

  it("refuses a fee below 1 sat per vbyte of the signed size", () => {
    expect(() => buildAndSignTx(args(100))).toThrow(/below the network minimum/);
  });
  it("accepts 1 sat/vB with the shared size estimate", () => {
    const built = buildAndSignTx(args(11 + 68 + 31 * 2));
    expect(built.feeSats).toBe(141);
  });
});
