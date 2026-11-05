import { describe, expect, it } from "vitest";
import { Psbt, payments, Transaction } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { TXC_NETWORK } from "@/lib/txc/network";
import { deriveVaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import { buildTsdGatherPsbt, selectTsdGatherFeeInputs, verifyTsdGatherSigned } from "./tsd-gather";

const root = rootFromSeed(new Uint8Array(32).fill(7));
const pairing: VaultPairing = { v: 1, fp: Buffer.from(root.fingerprint).toString("hex"), pairedAt: 0, chains: { txc: { "44": root.derivePath("m/44'/696969'/0'").neutered().toBase58() } } };
function coin(index: number, value: number, seed = 4) {
  const a = deriveVaultAddress(pairing, "txc", 44, 0, index);
  const prev = new Transaction();
  prev.addInput(new Uint8Array(32).fill(seed), 0);
  prev.addOutput(payments.p2pkh({ pubkey: a.pubkey, network: TXC_NETWORK }).output!, BigInt(value));
  return { a, u: { ...a, txid: prev.getId(), vout: 0, value }, hex: { [`${prev.getId()}:0`]: prev.toHex() } };
}
const addr0 = deriveVaultAddress(pairing, "txc", 44, 0, 0).address;

describe("Vault TSD gather", () => {
  it("puts the holder's coin first, #0 fee coins after, one output to #0", () => {
    const marker = coin(4, 10_000, 5); const big = coin(0, 1_000_000, 6); const small = coin(0, 20_000, 7);
    const feeInputs = selectTsdGatherFeeInputs(pairing, [marker.u], [small.u, big.u], 1);
    expect(feeInputs.map(u => u.value)).toEqual([1_000_000]);
    const b = buildTsdGatherPsbt({ pairing, index: 4, balance: "1250.5", feeRate: 1, holderInputs: [marker.u], feeInputs, prevTxHex: { ...marker.hex, ...big.hex } });
    const psbt = Psbt.fromBase64(b.psbtBase64, { network: TXC_NETWORK });
    expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe(marker.a.path);
    expect(psbt.data.inputs[1].bip32Derivation?.[0].path).toBe(big.a.path);
    const outs = psbt.txOutputs;
    expect(outs).toHaveLength(2);
    expect(Buffer.from(outs[0].script).toString("hex").startsWith("6a146f6d6e690000000000000027")).toBe(true);
    expect(Buffer.from(outs[0].script).toString("hex").endsWith((125_050_000_000n).toString(16).padStart(16, "0"))).toBe(true);
    expect(outs[1].address).toBe(addr0);
    expect(outs[1].value).toBe(BigInt(10_000 + 1_000_000 - (10 + 2 * 149 + 34 + 31)));
  });
  it("skips #0 coins when the holder can pay its own fee", () => {
    const own = coin(4, 50_000);
    expect(selectTsdGatherFeeInputs(pairing, [own.u], [coin(0, 1_000_000).u], 1)).toEqual([]);
  });
  it("refuses index 0, wrong-address coins, fee-only transactions and missing fee money", () => {
    const own = coin(4, 10_000); const zero = coin(0, 1_000_000, 9);
    expect(() => buildTsdGatherPsbt({ pairing, index: 0, balance: "1", feeRate: 1, holderInputs: [own.u], feeInputs: [], prevTxHex: own.hex })).toThrow();
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, holderInputs: [zero.u], feeInputs: [], prevTxHex: zero.hex })).toThrow(/must all belong/);
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, holderInputs: [own.u], feeInputs: [coin(3, 50_000, 8).u], prevTxHex: { ...own.hex } })).toThrow(/must all belong/);
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, holderInputs: [], feeInputs: [zero.u], prevTxHex: zero.hex })).toThrow(/sender/);
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, holderInputs: [own.u], feeInputs: [], prevTxHex: own.hex })).toThrow(/network fee/);
    expect(() => selectTsdGatherFeeInputs(pairing, [own.u], [], 1)).toThrow(/address #0/);
  });
  it("accepts a genuine signature and rejects a tampered output", () => {
    const fund = coin(4, 30_000);
    const b = buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, holderInputs: [fund.u], feeInputs: [], prevTxHex: fund.hex });
    const psbt = Psbt.fromBase64(b.psbtBase64, { network: TXC_NETWORK });
    psbt.signAllInputs(root.derivePath(fund.a.path)); psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    expect(verifyTsdGatherSigned(tx.toHex(), b.psbtBase64)).toBe(tx.getId());
    tx.outs[1].value -= 1n;
    expect(() => verifyTsdGatherSigned(tx.toHex(), b.psbtBase64)).toThrow(/does not match/);
  });
});
