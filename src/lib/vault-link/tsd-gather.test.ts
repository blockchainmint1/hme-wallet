import { describe, expect, it } from "vitest";
import { Psbt, payments, Transaction } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { TXC_NETWORK } from "@/lib/txc/network";
import { deriveVaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import { buildTsdFundingPsbt, buildTsdGatherPsbt, tsdGatherFundingSats, verifyTsdGatherSigned } from "./tsd-gather";

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
  it("funds each holder from address #0 only, change back to #0", () => {
    const c = coin(0, 1_000_000);
    const b = buildTsdFundingPsbt({ pairing, targetIndexes: [2, 5], feeRate: 1, inputs: [c.u], prevTxHex: c.hex });
    const outs = Psbt.fromBase64(b.psbtBase64, { network: TXC_NETWORK }).txOutputs;
    const per = tsdGatherFundingSats(1);
    expect(per).toBe(10_522);
    expect(outs.map(o => o.address)).toEqual([deriveVaultAddress(pairing, "txc", 44, 0, 2).address, deriveVaultAddress(pairing, "txc", 44, 0, 5).address, addr0]);
    expect(outs[0].value).toBe(BigInt(per));
    expect(outs.some(o => payments.embed({ output: o.script }, { validate: false }).data)).toBe(false);
  });
  it("refuses funding coins that are not on address #0", () => {
    const c = coin(3, 1_000_000);
    expect(() => buildTsdFundingPsbt({ pairing, targetIndexes: [2], feeRate: 1, inputs: [c.u], prevTxHex: c.hex })).toThrow(/must all belong/);
  });
  it("gathers the whole TSD balance with #0 as the only non-data output", () => {
    const dust = coin(4, 10_000, 5); const fund = coin(4, 10_522, 6);
    const b = buildTsdGatherPsbt({ pairing, index: 4, balance: "1250.5", feeRate: 1, inputs: [dust.u, fund.u], prevTxHex: { ...dust.hex, ...fund.hex } });
    const outs = Psbt.fromBase64(b.psbtBase64, { network: TXC_NETWORK }).txOutputs;
    expect(outs).toHaveLength(2);
    expect(Buffer.from(outs[0].script).toString("hex")).toBe("6a146f6d6e69000000000000002700001c6e5a7a4500".slice(0, 4) + Buffer.from(outs[0].script).toString("hex").slice(4));
    expect(Buffer.from(outs[0].script).toString("hex").endsWith((125_050_000_000n).toString(16).padStart(16, "0"))).toBe(true);
    expect(outs[1].address).toBe(addr0);
    expect(outs[1].value).toBe(BigInt(10_000 + 10_522 - (10 + 2 * 149 + 34 + 31)));
  });
  it("refuses gathering from address #0, foreign coins, or without fee money", () => {
    const own = coin(4, 10_000);
    expect(() => buildTsdGatherPsbt({ pairing, index: 0, balance: "1", feeRate: 1, inputs: [own.u], prevTxHex: own.hex })).toThrow();
    const other = coin(0, 1_000_000);
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, inputs: [other.u], prevTxHex: other.hex })).toThrow(/must all belong/);
    expect(() => buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, inputs: [own.u], prevTxHex: own.hex })).toThrow(/more TXC/);
  });
  it("accepts a genuine signature and rejects a tampered output", () => {
    const fund = coin(4, 30_000);
    const b = buildTsdGatherPsbt({ pairing, index: 4, balance: "1", feeRate: 1, inputs: [fund.u], prevTxHex: fund.hex });
    const psbt = Psbt.fromBase64(b.psbtBase64, { network: TXC_NETWORK });
    psbt.signAllInputs(root.derivePath(fund.a.path)); psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    expect(verifyTsdGatherSigned(tx.toHex(), b.psbtBase64)).toBe(tx.getId());
    tx.outs[1].value -= 1n;
    expect(() => verifyTsdGatherSigned(tx.toHex(), b.psbtBase64)).toThrow(/does not match/);
  });
});
