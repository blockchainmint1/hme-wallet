import { describe, expect, it } from "vitest";
import {
  checkRecipient,
  differingPositions,
  isLookalike,
  tronSuspiciousReason,
  tronTrustedDestinations,
  utxoTrustedDestinations,
  verdictBlocks,
} from "./address-lookalike";
import type { TronTransfer } from "@/lib/tron/api";
import type { MempoolTx } from "@/lib/txc/mempool";

const REAL = "0x704d88A6" + "1".repeat(28) + "Fb47";
const LOOK = "0x704d11A4" + "2".repeat(28) + "fb47";

describe("lookalike addresses", () => {
  it("matches the member's planted patterns, case-insensitively for 0x", () => {
    expect(isLookalike(REAL, LOOK, "evm")).toBe(true);
    expect(isLookalike(REAL, "0x7041BE99" + "3".repeat(28) + "Fb47", "evm")).toBe(true);
    expect(isLookalike(REAL, REAL.toLowerCase(), "evm")).toBe(false);
  });
  it("needs both ends: 3+ characters each and 7 in total", () => {
    expect(isLookalike(REAL, "0x704d" + "9".repeat(32) + "0000", "evm")).toBe(false);
    expect(isLookalike(REAL, "0x70" + "9".repeat(34) + "fb47", "evm")).toBe(false);
    expect(isLookalike(REAL, "0x704" + "9".repeat(32) + "b47", "evm")).toBe(false);
  });
  it("ignores the fixed start of Tron and bech32 addresses", () => {
    const a = "TAbcD" + "1".repeat(25) + "wXyZ";
    expect(isLookalike(a, "TQrsT" + "1".repeat(25) + "wXyZ", "tron")).toBe(false);
    expect(isLookalike(a, "TAbcE" + "2".repeat(25) + "wXyZ", "tron")).toBe(true);
    expect(isLookalike("bc1qxyz" + "a".repeat(30) + "kk9p", "bc1qwvu" + "c".repeat(30) + "kk9p", "utxo")).toBe(false);
  });
  it("highlights exactly the characters that differ", () => {
    const d = differingPositions(LOOK, REAL, "evm");
    expect(d.slice(0, 6).every((x) => !x)).toBe(true);
    expect(d[6]).toBe(true);
    expect(d.slice(-4).every((x) => !x)).toBe(true);
  });
});

describe("send-screen verdicts", () => {
  const sources = { family: "evm" as const, trusted: [REAL], flagged: ["0x" + "f".repeat(40)], complete: true };
  it("stops a lookalike and names the real address", () => {
    const v = checkRecipient(LOOK, sources);
    expect(v).toEqual({ kind: "lookalike", match: REAL });
    expect(verdictBlocks(v)).toBe(true);
  });
  it("passes the real address quietly", () => {
    expect(checkRecipient(REAL.toLowerCase(), sources).kind).toBe("known");
  });
  it("soft note for a brand-new address; 'unchecked' when history is incomplete", () => {
    const fresh = "0x" + "a".repeat(40);
    expect(checkRecipient(fresh, sources)).toEqual({ kind: "first-time" });
    expect(verdictBlocks({ kind: "first-time" })).toBe(false);
    expect(checkRecipient(fresh, { ...sources, complete: false })).toEqual({ kind: "unchecked" });
  });
  it("stops an address seen only on a flagged transfer", () => {
    expect(checkRecipient("0x" + "F".repeat(40), sources)).toEqual({ kind: "flagged-only" });
  });
  it("still stops a lookalike while history is incomplete", () => {
    expect(checkRecipient(LOOK, { ...sources, complete: false }).kind).toBe("lookalike");
  });
});

describe("Tron and UTXO sources", () => {
  const SELF = "TSelf" + "1".repeat(29);
  const PAID = "TPaid" + "2".repeat(25) + "abcd";
  const LOOKT = "TPaiX" + "3".repeat(25) + "abcd";
  const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const row = (p: Partial<TronTransfer>): TronTransfer => ({ txid: "t", timestamp: 1, from: SELF, to: PAID, value: 5n, symbol: "USDT", decimals: 6, kind: "trc20", contract: USDT, confirmed: true, ...p });
  const verified = new Set([USDT]);
  it("trusts real USDT sends, not fake-token claims", () => {
    expect([...tronTrustedDestinations([row({}), row({ to: LOOKT, contract: "TFake" + "9".repeat(29) })], SELF, verified)]).toEqual([PAID]);
  });
  it("flags zero-value USDT, counterfeit USDT and lookalike senders", () => {
    const trusted = new Set([PAID]);
    expect(tronSuspiciousReason(row({ from: LOOKT, to: SELF, value: 0n }), SELF, trusted, verified)).toMatch(/Zero-value/);
    expect(tronSuspiciousReason(row({ from: "TOther" + "4".repeat(28), to: SELF, contract: "TFake" + "9".repeat(29) }), SELF, trusted, verified)).toMatch(/Counterfeit USDT/);
    expect(tronSuspiciousReason(row({ from: LOOKT, to: SELF, kind: "trx", symbol: "TRX", contract: undefined, value: 1n }), SELF, trusted, verified)).toMatch(/Lookalike/);
    expect(tronSuspiciousReason(row({}), SELF, trusted, verified)).toBeNull();
  });
  it("UTXO: outputs of spends from own addresses become trusted", () => {
    const tx = (vinAddr: string, outs: string[]): MempoolTx => ({ txid: "x", version: 1, size: 1, weight: 1, fee: 0,
      vin: [{ txid: "p", vout: 0, prevout: { scriptpubkey: "", scriptpubkey_address: vinAddr, value: 1 } }],
      vout: outs.map((a) => ({ scriptpubkey: "", scriptpubkey_address: a, value: 1 })), status: { confirmed: true } });
    const own = new Set(["Tmine"]);
    expect([...utxoTrustedDestinations([tx("Tmine", ["Tpaid", "Tmine"]), tx("Tstranger", ["Tmine"])], own)]).toEqual(["Tpaid"]);
  });
});
