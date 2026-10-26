import { describe, expect, it } from "vitest";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing, VaultUtxoChain } from "./pairing";
import { buildVaultPsbt, nextVaultChangeIndex, verifySignedAgainstPsbt, verifySignedTx } from "./psbt-build";

// Public fixtures derived from a deterministic test seed; never a user's wallet.
function fixture(chain: VaultUtxoChain) {
  const root = rootFromSeed(new Uint8Array(32).fill(7));
  const meta = VAULT_CHAIN_META[chain];
  const pairing: VaultPairing = { v: 1, fp: "73c5da0a", pairedAt: 0, chains: {
    [chain]: { "44": root.derivePath(`m/44'/${meta.coinType}'/0'`).neutered().toBase58() },
  } };
  const address = deriveVaultAddress(pairing, chain, 44, 0, 0);
  const recipient = deriveVaultAddress(pairing, chain, 44, 0, 1).address;
  const previous = new Transaction();
  previous.addInput(new Uint8Array(32).fill(1), 0);
  const script = payments.p2pkh({ pubkey: address.pubkey, network: meta.network }).output;
  if (!script) throw new Error("Missing fixture script");
  previous.addOutput(script, 200_000_000n);
  const built = buildVaultPsbt({ pairing, chain, inputs: [{ ...address, txid: previous.getId(), vout: 0, value: 200_000_000 }],
    prevTxHex: { [`${previous.getId()}:0`]: previous.toHex() }, outputs: [{ address: recipient, valueSats: 100_000_000 }],
    feeSats: 1000, changePurpose: 44, changeIndex: 8 });
  const psbt = Psbt.fromBase64(built.psbtBase64);
  const tx = new Transaction();
  tx.version = psbt.version;
  tx.locktime = psbt.locktime;
  for (const input of psbt.txInputs) tx.addInput(input.hash, input.index, input.sequence);
  for (const output of psbt.txOutputs) tx.addOutput(output.script, output.value);
  // Signature-shaped material only: this tests equivalence, not signature validity.
  tx.ins[0].script = new Uint8Array([1, 1]);
  return { tx, built, address, recipient, pairing };
}

describe.each<VaultUtxoChain>(["txc", "isk", "btc", "ltc", "doge"])("Vault %s frozen payment", (chain) => {
  it("accepts unchanged legacy payment fields and keeps readable recipient checks", () => {
    const { tx, built, recipient } = fixture(chain);
    expect(verifySignedAgainstPsbt(tx.toHex(), built.psbtBase64)).toBe(tx.getId());
    expect(verifySignedTx(tx.toHex(), chain, [{ address: recipient, valueSats: 100_000_000 }]).txid).toBe(tx.getId());
  });
  it("rejects redirected change even with the exact requested payment", () => {
    const { tx, built, recipient } = fixture(chain);
    tx.outs[1].script = tx.outs[0].script;
    // Demonstrate the pre-existing payment-only gap, then assert closure.
    expect(verifySignedTx(tx.toHex(), chain, [{ address: recipient, valueSats: 100_000_000 }]).txid).toBe(tx.getId());
    expect(() => verifySignedAgainstPsbt(tx.toHex(), built.psbtBase64)).toThrow("Nothing was broadcast");
  });
});

const mutations: [string, (tx: Transaction) => void][] = [
  ["input hash", tx => { tx.ins[0].hash = new Uint8Array(32).fill(2); }],
  ["input index", tx => { tx.ins[0].index = 1; }],
  ["input sequence", tx => { tx.ins[0].sequence = 1; }],
  ["extra input", tx => { tx.addInput(new Uint8Array(32).fill(3), 1); }],
  ["missing signature material", tx => { tx.ins[0].script = new Uint8Array(); }],
  ["payment value", tx => { tx.outs[0].value -= 1n; }],
  ["change value", tx => { tx.outs[1].value -= 1n; }],
  ["extra output", tx => { tx.addOutput(tx.outs[0].script, 1n); }],
  ["missing change", tx => { tx.outs.pop(); }],
  ["output order", tx => { tx.outs.reverse(); }],
  ["version", tx => { tx.version += 1; }],
  ["locktime", tx => { tx.locktime += 1; }],
];
describe("Vault frozen transaction mutations", () => {
  it.each(mutations)("rejects altered %s", (_, mutate) => {
    const { tx, built } = fixture("btc");
    mutate(tx);
    expect(() => verifySignedAgainstPsbt(tx.toHex(), built.psbtBase64)).toThrow("does not match this payment");
  });
});

describe("Vault next change address", () => {
  it("starts at zero when no change address has activity", () => {
    expect(nextVaultChangeIndex({ used: [] })).toBe(0);
  });
  it("uses highest historical change index even when old coins have been spent", () => {
    const { pairing } = fixture("btc");
    const used = [deriveVaultAddress(pairing, "btc", 44, 1, 7), deriveVaultAddress(pairing, "btc", 44, 1, 2),
      deriveVaultAddress(pairing, "btc", 44, 0, 99)];
    expect(nextVaultChangeIndex({ used })).toBe(8);
  });
});