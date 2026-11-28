import { describe, expect, it } from "vitest";
import { Psbt, payments, Transaction } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { TXC_NETWORK } from "@/lib/txc/network";
import { deriveVaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import { buildVaultTsdManyPsbt } from "./tsd-many";
import { verifyVaultTsdSigned } from "./tsd-send";

function fixture(n: number) {
  const root = rootFromSeed(new Uint8Array(32).fill(7));
  const pairing: VaultPairing = { v: 1, fp: Buffer.from(root.fingerprint).toString("hex"), pairedAt: 0, chains: { txc: { "44": root.derivePath("m/44'/696969'/0'").neutered().toBase58() } } };
  const holder = deriveVaultAddress(pairing, "txc", 44, 0, 0);
  const prev = new Transaction(); prev.addInput(new Uint8Array(32).fill(4), 0);
  prev.addOutput(payments.p2pkh({ pubkey: holder.pubkey, network: TXC_NETWORK }).output!, 100_000_000n);
  const u = { ...holder, txid: prev.getId(), vout: 0, value: 100_000_000 };
  const recipients = Array.from({ length: n }, (_, i) => ({ address: deriveVaultAddress(pairing, "txc", 44, 0, i + 1).address, units: BigInt(i + 1) * 100_000_000n }));
  return { root, holder, req: { pairing, recipients, balanceUnits: 10_000n * 100_000_000n, feeRate: 1, inputs: [u], prevTxHex: { [`${u.txid}:0`]: prev.toHex() } } };
}

describe("Vault TSD send to many", () => {
  it("builds the type-7 layout Vault decodes: data at 0, recipients 1..n, change to #0", () => {
    const { req, holder } = fixture(7);
    const psbt = Psbt.fromBase64(buildVaultTsdManyPsbt(req).psbtBase64, { network: TXC_NETWORK });
    const outs = psbt.txOutputs;
    expect(outs[0].script[0]).toBe(0x6a);
    expect(Array.from(outs[0].script.subarray(1, 3))).toEqual([0x4c, 76]); // 7 receivers = 76-byte PUSHDATA1
    const p = outs[0].script.subarray(3);
    expect(Array.from(p.subarray(0, 13))).toEqual([0x6f, 0x6d, 0x6e, 0x69, 0, 0, 0, 7, 0, 0, 0, 39, 7]);
    for (let i = 0; i < 7; i++) { expect(p[13 + 9 * i]).toBe(i + 1); expect(outs[i + 1].address).toBe(req.recipients[i].address); expect(outs[i + 1].value).toBe(10_000n); }
    expect(outs[8].address).toBe(holder.address);
  });
  it("refuses more than 7, duplicates, zero amounts, own address and overspending TSD", () => {
    const f = fixture(8);
    expect(() => buildVaultTsdManyPsbt(f.req)).toThrow(/1–7/);
    const d = fixture(2); d.req.recipients[1] = d.req.recipients[0];
    expect(() => buildVaultTsdManyPsbt(d.req)).toThrow(/twice/);
    const z = fixture(1); z.req.recipients[0].units = 0n;
    expect(() => buildVaultTsdManyPsbt(z.req)).toThrow(/above zero/);
    const o = fixture(1); o.req.recipients[0].address = o.holder.address;
    expect(() => buildVaultTsdManyPsbt(o.req)).toThrow(/own TSD/);
    const b = fixture(2); b.req.balanceUnits = 1n;
    expect(() => buildVaultTsdManyPsbt(b.req)).toThrow(/Not enough TSD/);
    const r = fixture(1); r.req.feeRate = 5_000;
    expect(() => buildVaultTsdManyPsbt(r.req)).toThrow(/safety limit/);
  });
  it("accepts a genuine Vault signature over the exact request", () => {
    const { req, root, holder } = fixture(3);
    const built = buildVaultTsdManyPsbt(req);
    const psbt = Psbt.fromBase64(built.psbtBase64, { network: TXC_NETWORK });
    psbt.signAllInputs(root.derivePath(holder.path)); psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    expect(verifyVaultTsdSigned(tx.toHex(), built.psbtBase64)).toBe(tx.getId());
  });
});
