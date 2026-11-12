import { describe, expect, it } from "vitest";
import type { MempoolTx } from "@/lib/txc/mempool";
import { checkNoticeAccount, checkNoticeTx, noticeAccountFrom, type NoticeClaim } from "./deposit-notice";

const INBOX = "TInboxAddress1111111111111111111";
const SENDER = "TSenderAddress111111111111111111";
const PAYOUT = "0x" + "ab".repeat(20);

function payload(type: number, prop: number, units: bigint, version = 0): string {
  const h = (n: number | bigint, bytes: number) => n.toString(16).padStart(bytes * 2, "0");
  return "6a14" + "6f6d6e69" + h(version, 2) + h(type, 2) + h(prop, 4) + h(units, 8);
}

function tx(over: Partial<{ script: string; to: string; from: string; txid: string; extra: string[] }> = {}): MempoolTx {
  return {
    txid: over.txid ?? "a".repeat(64),
    version: 2,
    size: 0,
    weight: 0,
    fee: 0,
    vin: [{ txid: "b".repeat(64), vout: 0, prevout: { scriptpubkey: "", scriptpubkey_address: over.from ?? SENDER, value: 10_000 } }],
    vout: [
      { scriptpubkey: over.script ?? payload(0, 39, 4_000n * 100_000_000n), value: 0 },
      ...(over.extra ?? []).map((s) => ({ scriptpubkey: s, value: 0 })),
      { scriptpubkey: "76a9", scriptpubkey_address: SENDER, value: 5_000 },
      { scriptpubkey: "76a9", scriptpubkey_address: over.to ?? INBOX, value: 546 },
    ],
    status: { confirmed: false },
  };
}

const claim: NoticeClaim = { txid: "a".repeat(64), amount: 4000, depositAddress: INBOX, payoutAddress: PAYOUT };

describe("deposit notice account check", () => {
  it("accepts the key's own inbox and saved payout", () => {
    expect(() => checkNoticeAccount(claim, { depositAddress: INBOX, payoutAddress: PAYOUT.toUpperCase().replace("0X", "0x") })).not.toThrow();
  });
  it("refuses another inbox, another payout, or no saved payout", () => {
    expect(() => checkNoticeAccount(claim, { depositAddress: "TOther", payoutAddress: PAYOUT })).toThrow();
    expect(() => checkNoticeAccount(claim, { depositAddress: INBOX, payoutAddress: "0x" + "cd".repeat(20) })).toThrow();
    expect(() => checkNoticeAccount(claim, { depositAddress: INBOX, payoutAddress: null })).toThrow();
  });
  it("reads either inbox field name", () => {
    expect(noticeAccountFrom({ address: INBOX, payoutAddress: PAYOUT })).toEqual({ depositAddress: INBOX, payoutAddress: PAYOUT });
    expect(noticeAccountFrom(null)).toEqual({ depositAddress: "", payoutAddress: null });
  });
});

describe("deposit notice transaction check", () => {
  it("accepts the exact TSD simple send into the inbox", () => {
    expect(() => checkNoticeTx(tx(), claim)).not.toThrow();
    expect(() => checkNoticeTx(tx(), { ...claim, txid: "A".repeat(64) })).not.toThrow();
  });
  it("refuses a different txid", () => {
    expect(() => checkNoticeTx(tx({ txid: "c".repeat(64) }), claim)).toThrow();
  });
  it("refuses a different amount, including sub-unit drift", () => {
    expect(() => checkNoticeTx(tx(), { ...claim, amount: 4000.00000001 })).toThrow();
    expect(() => checkNoticeTx(tx(), { ...claim, amount: 40000 })).toThrow();
  });
  it("refuses other tokens, message types and versions", () => {
    expect(() => checkNoticeTx(tx({ script: payload(0, 31, 4_000n * 100_000_000n) }), claim)).toThrow();
    expect(() => checkNoticeTx(tx({ script: payload(7, 39, 4_000n * 100_000_000n) }), claim)).toThrow();
    expect(() => checkNoticeTx(tx({ script: payload(0, 39, 4_000n * 100_000_000n, 1) }), claim)).toThrow();
  });
  it("refuses a transfer to another address or from the inbox itself", () => {
    expect(() => checkNoticeTx(tx({ to: "TSomeoneElse" }), claim)).toThrow();
    expect(() => checkNoticeTx(tx({ from: INBOX, to: INBOX }), claim)).toThrow();
  });
  it("refuses plain TXC and ambiguous double payloads", () => {
    expect(() => checkNoticeTx(tx({ script: "76a9" }), claim)).toThrow();
    expect(() => checkNoticeTx(tx({ extra: [payload(0, 39, 1n)] }), claim)).toThrow();
  });
});
