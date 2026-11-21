import { describe, expect, it } from "vitest";
import { Transaction, payments, address as addr } from "bitcoinjs-lib";
import { mnemonicToSeedSync } from "@scure/bip39";
import { TXC_NETWORK } from "@/lib/txc/network";
import { mainReceiveAddress, pocketAddresses } from "./pocket";
import { buildPocketTsdMove, pocketTsdFee, selectPocketFeeCoins, type PocketCoin } from "./pocket-tsd";

const seed = mnemonicToSeedSync("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const addrs = pocketAddresses(seed, "TXC", 1106);
const holder = addrs[0]!;
const other = addrs[10]!; // change address /1/0
const to = mainReceiveAddress(seed, "TXC");

function coin(a: typeof holder, value: number, tag: number): { c: PocketCoin; hex: string } {
  const tx = new Transaction();
  tx.addInput(new Uint8Array(32).fill(tag), 0);
  tx.addOutput(payments.p2pkh({ pubkey: a.node.publicKey, network: TXC_NETWORK }).output!, BigInt(value));
  return { c: { a, txid: tx.getId(), vout: 0, value }, hex: tx.toHex() };
}

describe("moving TSD out of the Seeds pocket", () => {
  it("sends the whole TSD balance from the holder to main address #0, holder coin first, all TXC home", () => {
    const h = coin(holder, 100_010_000, 1); // 1.0001 TXC, like Bobby's pocket
    const units = 2_000n * 100_000_000n;
    const r = buildPocketTsdMove({ holder, holderCoins: [h.c], feeCoins: [], prevTxHex: { [h.c.txid]: h.hex }, units, to, feeRate: 10 });
    const tx = Transaction.fromHex(r.hex);
    expect(Buffer.from(tx.ins[0]!.hash).reverse().toString("hex")).toBe(h.c.txid);
    expect(tx.outs).toHaveLength(2);
    const data = tx.outs[0]!.script.subarray(2);
    expect(Buffer.from(data.subarray(0, 4)).toString()).toBe("omni");
    expect(new DataView(data.buffer, data.byteOffset).getUint32(8)).toBe(39);
    expect(new DataView(data.buffer, data.byteOffset).getBigUint64(12)).toBe(units);
    expect(addr.fromOutputScript(tx.outs[1]!.script, TXC_NETWORK)).toBe(to);
    expect(to).toBe(mainReceiveAddress(seed, "TXC"));
    expect(Number(tx.outs[1]!.value)).toBe(100_010_000 - pocketTsdFee(1, 10));
  });
  it("uses another pocket address's coin for the fee only after the holder's own", () => {
    const h = coin(holder, 5_000, 2);
    const f = coin(other, 1_000_000, 3);
    const picked = selectPocketFeeCoins([h.c], [f.c], 10);
    expect(picked).toEqual([f.c]);
    const r = buildPocketTsdMove({ holder, holderCoins: [h.c], feeCoins: picked, prevTxHex: { [h.c.txid]: h.hex, [f.c.txid]: f.hex }, units: 1n, to, feeRate: 10 });
    const tx = Transaction.fromHex(r.hex);
    expect(Buffer.from(tx.ins[0]!.hash).reverse().toString("hex")).toBe(h.c.txid);
  });
  it("picks no fee coins when the holder can pay", () => {
    expect(selectPocketFeeCoins([coin(holder, 1_000_000, 4).c], [coin(other, 9_000_000, 5).c], 10)).toEqual([]);
  });
  it("refuses when the holder has no TXC to act as the TSD sender", () => {
    expect(() => buildPocketTsdMove({ holder, holderCoins: [], feeCoins: [], prevTxHex: {}, units: 1n, to, feeRate: 10 })).toThrow(/no TXC to send it with/);
  });
  it("refuses a previous transaction that doesn't match the coin", () => {
    const h = coin(holder, 1_000_000, 6);
    const wrong = coin(other, 1_000_000, 6);
    expect(() => buildPocketTsdMove({ holder, holderCoins: [h.c], feeCoins: [], prevTxHex: { [h.c.txid]: wrong.hex }, units: 1n, to, feeRate: 10 })).toThrow(/doesn't match/);
  });
  it("refuses an unusually high fee rate and too little TXC", () => {
    const h = coin(holder, 1_000_000, 7);
    expect(() => buildPocketTsdMove({ holder, holderCoins: [h.c], feeCoins: [], prevTxHex: { [h.c.txid]: h.hex }, units: 1n, to, feeRate: 5_000 })).toThrow(/unusually high/);
    const tiny = coin(holder, 12_000, 8);
    expect(() => buildPocketTsdMove({ holder, holderCoins: [tiny.c], feeCoins: [], prevTxHex: { [tiny.c.txid]: tiny.hex }, units: 1n, to, feeRate: 10 })).toThrow(/enough TXC/);
  });
  it("never takes holder coins as fee coins or sends anywhere but the given main address", () => {
    const h = coin(holder, 1_000_000, 9);
    expect(() => buildPocketTsdMove({ holder, holderCoins: [h.c], feeCoins: [h.c], prevTxHex: { [h.c.txid]: h.hex }, units: 1n, to, feeRate: 10 })).toThrow(/other pocket addresses/);
  });
});
