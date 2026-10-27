import { describe, expect, it } from "vitest";
import { Psbt, payments, Transaction } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { TXC_NETWORK } from "@/lib/txc/network";
import { deriveVaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import { buildVaultTsdPsbt, verifyVaultTsdSigned } from "./tsd-send";

function fixture(value = 100_000_000) {
  const root = rootFromSeed(new Uint8Array(32).fill(7));
  const pairing: VaultPairing = { v: 1, fp: Buffer.from(root.fingerprint).toString("hex"), pairedAt: 0, chains: { txc: { "44": root.derivePath("m/44'/696969'/0'").neutered().toBase58() } } };
  const holder = deriveVaultAddress(pairing, "txc", 44, 0, 0);
  const recipient = deriveVaultAddress(pairing, "txc", 44, 0, 1).address;
  const previous = new Transaction();
  previous.addInput(new Uint8Array(32).fill(4), 0);
  const output = payments.p2pkh({ pubkey: holder.pubkey, network: TXC_NETWORK }).output;
  if (!output) throw new Error("Fixture script missing");
  previous.addOutput(output, BigInt(value));
  const u = { ...holder, txid: previous.getId(), vout: 0, value };
  const request = { pairing, recipient, amount: "1", balance: "167588.113721", feeRate: 1, inputs: [u], prevTxHex: { [`${u.txid}:0`]: previous.toHex() } };
  return { root, holder, previous, request };
}
function signedFixture() {
  const f = fixture();
  const built = buildVaultTsdPsbt(f.request);
  const psbt = Psbt.fromBase64(built.psbtBase64, { network: TXC_NETWORK });
  const key = f.root.derivePath(f.holder.path);
  psbt.signAllInputs(key); psbt.finalizeAllInputs();
  return { ...f, built, tx: psbt.extractTransaction() };
}

describe("Vault TSD single-holder signing", () => {
  it("encodes exactly 1 TSD on property 39 and sends change to TXC address zero", () => {
    const f = fixture(); const built = buildVaultTsdPsbt(f.request);
    const psbt = Psbt.fromBase64(built.psbtBase64, { network: TXC_NETWORK });
    expect(Buffer.from(psbt.txOutputs[0].script).toString("hex")).toBe("6a146f6d6e6900000000000000270000000005f5e100");
    expect(psbt.txOutputs.map(o => o.value)).toEqual([0n, 10_000n, 99_989_742n]);
    expect(psbt.txOutputs[1].address).toBe(f.request.recipient);
    expect(psbt.txOutputs[2].address).toBe(f.holder.address);
    expect(psbt.data.outputs[2].bip32Derivation?.[0].path).toBe("m/44'/696969'/0'/0/0");
    expect(psbt.data.inputs[0].sighashType).toBe(Transaction.SIGHASH_ALL);
    expect(built.intent.feeSats).toBe(258);
  });
  it("accepts genuine SIGHASH_ALL signatures", () => {
    const { tx, built } = signedFixture();
    expect(verifyVaultTsdSigned(tx.toHex(), built.psbtBase64)).toBe(tx.getId());
  });
  it.each(["0", "-1", "1e3", "0.000000001", "92233720368.54775808"])("refuses invalid amount %s", amount => {
    const { request } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, amount, balance: "999999999999" })).toThrow();
  });
  it("preserves a single smallest token unit", () => {
    const { request } = fixture();
    const b = buildVaultTsdPsbt({ ...request, amount: "0.00000001" });
    expect(Buffer.from(Psbt.fromBase64(b.psbtBase64).txOutputs[0].script).toString("hex")).toBe("6a146f6d6e6900000000000000270000000000000001");
  });
  it("refuses insufficient address-zero TSD despite a portfolio balance", () => {
    const { request } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, balance: "0.9" })).toThrow("Not enough TSD");
  });
  it("refuses an unfunded token holder rather than using other addresses", () => {
    const { request } = fixture(10_000); expect(() => buildVaultTsdPsbt(request)).toThrow("Add TXC for fees");
  });
  it.each(["index", "purpose", "path", "address", "pubkey"])("refuses wrong holder %s", field => {
    const { request } = fixture();
    const bad = { ...request.inputs[0], [field]: field === "pubkey" ? new Uint8Array(33) : field === "index" ? 1 : field === "purpose" ? 84 : "wrong" };
    expect(() => buildVaultTsdPsbt({ ...request, inputs: [bad as typeof request.inputs[0]] })).toThrow("paired TXC address #0");
  });
  it.each(["", "not-an-address", "bc1qbad", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"])("refuses invalid or wrong-network recipient %s", recipient => {
    const { request } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, recipient })).toThrow("legacy TEXITcoin");
  });
  it("refuses self sends", () => {
    const { request, holder } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, recipient: holder.address })).toThrow("different");
  });
  it("validates previous transaction values", () => {
    const { request } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, inputs: [{ ...request.inputs[0], value: 1_000_000 }] })).toThrow("previous TXC transaction does not match");
  });
  it("validates previous transaction hashes", () => {
    const { request } = fixture(); const wrong = fixture(2_000_000).previous.toHex();
    expect(() => buildVaultTsdPsbt({ ...request, prevTxHex: { [`${request.inputs[0].txid}:0`]: wrong } })).toThrow("does not match");
  });
  it.each([0, NaN, Infinity, 5_000])("refuses invalid or capped fees %s", feeRate => {
    const { request } = fixture(); expect(() => buildVaultTsdPsbt({ ...request, feeRate })).toThrow("fee estimate");
  });
  it("absorbs sub-dust change into the disclosed fee", () => {
    const { request } = fixture(20_257); const b = buildVaultTsdPsbt(request);
    expect(b.intent.changeSats).toBe(0); expect(b.intent.feeSats).toBe(10_257);
    expect(Psbt.fromBase64(b.psbtBase64).txOutputs).toHaveLength(2);
  });
  it("retains change exactly at the dust threshold", () => {
    const { request } = fixture(20_258); const b = buildVaultTsdPsbt(request);
    expect(b.intent.changeSats).toBe(10_000); expect(b.intent.feeSats).toBe(258);
  });
  it.each(["payload", "recipient", "change", "order", "sequence", "locktime"])("refuses changed %s before broadcast", field => {
    const { tx, built } = signedFixture();
    if (field === "payload") tx.outs[0].script[13] ^= 1;
    if (field === "recipient") tx.outs[1].script = tx.outs[2].script;
    if (field === "change") tx.outs[2].value -= 1n;
    if (field === "order") tx.outs.reverse();
    if (field === "sequence") tx.ins[0].sequence -= 1;
    if (field === "locktime") tx.locktime += 1;
    expect(() => verifyVaultTsdSigned(tx.toHex(), built.psbtBase64)).toThrow("Nothing was broadcast");
  });
  it("refuses fake signature material even if all outputs match", () => {
    const { tx, built } = signedFixture(); tx.ins[0].script = new Uint8Array([1, 1]);
    expect(() => verifyVaultTsdSigned(tx.toHex(), built.psbtBase64)).toThrow("Invalid TSD input signature");
  });
});