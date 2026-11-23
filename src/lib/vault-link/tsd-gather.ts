/**
 * Gather TSD that sits on Vault TXC receive addresses #1+ back to address #0.
 *
 * One Vault-signed transaction per holder: the holder's own coins come FIRST,
 * then (only if needed) confirmed coins from address #0 pay the fee. Outputs are
 * [0] Omni property-39 simple send of the holder's whole balance and [1] address
 * #0 with all input TXC minus fee (sole non-data output = unambiguous recipient).
 * Why this is safe: TEXITcoin Omni Class C (OP_RETURN) takes the sender from the
 * FIRST input's address, not the largest contributor. No keys or signing online.
 */
import { address as addr, payments, Psbt, script, Transaction } from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { TXC_NETWORK } from "@/lib/txc/network";
import { buildSimpleSendPayload } from "@/lib/txc/tokens";
import { deriveVaultAddress, type VaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import type { VaultUtxo } from "./scan";
import { vaultBytesToBase64, verifySignedAgainstPsbt } from "./psbt-build";
import { TSD_REFERENCE_SATS, tsdBalanceUnits, vaultTsdHolder } from "./tsd-send";

/** Highest receive index gathered (store sale addresses run past #30; Vault signs any index). */
export const TSD_GATHER_MAX_INDEX = 999;
/** The scan stops after this many never-used addresses in a row. */
export const TSD_GATHER_GAP = 20;
const MAX_FEE_RATE = 5_000;
const IN_VB = 149;
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], h => Number.parseInt(h, 16));

function checkRate(feeRate: number) {
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate >= MAX_FEE_RATE) throw new Error("The TXC fee estimate is unavailable or exceeds Vault's safety limit.");
}

/** Legacy TXC receive address #index (1..MAX). Never change addresses. */
export function vaultTsdReceiveHolder(pairing: VaultPairing, index: number): VaultAddress {
  if (!Number.isSafeInteger(index) || index < 1 || index > TSD_GATHER_MAX_INDEX) throw new Error("Invalid TXC receive address number.");
  vaultTsdHolder(pairing); // requires the legacy TXC account
  return deriveVaultAddress(pairing, "txc", 44, 0, index);
}

function holderScript(a: VaultAddress) {
  const s = payments.p2pkh({ pubkey: a.pubkey, network: TXC_NETWORK }).output;
  if (!s) throw new Error("Could not derive the TXC address script.");
  return s;
}

function addHolderInputs(psbt: Psbt, pairing: VaultPairing, holder: VaultAddress, inputs: VaultUtxo[], prevTxHex: Record<string, string>, label: string): number {
  const hs = holderScript(holder);
  const derivation = [{ masterFingerprint: bytes(pairing.fp), path: holder.path, pubkey: holder.pubkey }];
  const seen = new Set<string>();
  let total = 0;
  for (const u of inputs) {
    const key = `${u.txid}:${u.vout}`;
    if (seen.has(key)) throw new Error("Duplicate TXC input.");
    seen.add(key);
    if (u.purpose !== 44 || u.change !== 0 || u.index !== holder.index || u.path !== holder.path || u.address !== holder.address || !equal(u.pubkey, holder.pubkey)) throw new Error(`${label} inputs must all belong to ${holder.address}.`);
    if (!Number.isSafeInteger(u.value) || u.value <= 0 || !Number.isSafeInteger(u.vout) || u.vout < 0) throw new Error("Invalid TXC input amount or output index.");
    const hex = prevTxHex[key];
    if (!hex || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Missing or invalid previous TXC transaction.");
    const previous = Transaction.fromHex(hex);
    const prev = previous.outs[u.vout];
    if (previous.getId() !== u.txid || !prev || prev.value !== BigInt(u.value) || !equal(prev.script, hs)) throw new Error("The previous TXC transaction does not match the Vault input.");
    psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: previous.toBuffer(), sighashType: Transaction.SIGHASH_ALL, bip32Derivation: derivation });
    total += u.value;
    if (!Number.isSafeInteger(total)) throw new Error("TXC input total exceeds the safe range.");
  }
  return total;
}

export interface TsdGatherIntent { kind: "gather"; from: string; fromIndex: number; to: string; amount: string; txcSats: number; feeSats: number; holderInputs: number; feeInputs: number; feeInputSats: number }

const gatherFee = (inputs: number, feeRate: number) => (10 + inputs * IN_VB + 34 + 31) * feeRate;

/** Largest-first #0 fee coins, only as many as the holder's own TXC cannot cover. Select before downloading previous txs. */
export function selectTsdGatherFeeInputs(pairing: VaultPairing, holderInputs: VaultUtxo[], addr0Inputs: VaultUtxo[], feeRate: number): VaultUtxo[] {
  checkRate(feeRate);
  let total = holderInputs.reduce((s, u) => s + u.value, 0);
  const picked: VaultUtxo[] = [];
  const enough = () => total - gatherFee(holderInputs.length + picked.length, feeRate) >= TSD_REFERENCE_SATS;
  if (enough()) return picked;
  for (const u of [...addr0Inputs].sort((a, b) => b.value - a.value)) {
    picked.push(u); total += u.value;
    if (enough()) return picked;
  }
  throw new Error(`Not enough confirmed TXC on address #0 (${vaultTsdHolder(pairing).address}) to pay this network fee.`);
}

export function buildTsdGatherPsbt(req: { pairing: VaultPairing; index: number; balance: string; feeRate: number; holderInputs: VaultUtxo[]; feeInputs: VaultUtxo[]; prevTxHex: Record<string, string> }): { psbtBase64: string; intent: TsdGatherIntent } {
  checkRate(req.feeRate);
  const holder = vaultTsdReceiveHolder(req.pairing, req.index);
  const dest = vaultTsdHolder(req.pairing);
  const units = tsdBalanceUnits(req.balance);
  if (units <= 0n) throw new Error(`Address #${req.index} holds no TSD.`);
  if (!req.holderInputs.length) throw new Error(`Address #${req.index} has no confirmed TXC coin to act as the TSD sender.`);
  const keys = new Set(req.holderInputs.map(u => `${u.txid}:${u.vout}`));
  if (req.feeInputs.some(u => keys.has(`${u.txid}:${u.vout}`))) throw new Error("Duplicate TXC input.");
  const psbt = new Psbt({ network: TXC_NETWORK });
  // Holder coins first: Omni Class C uses the first input's address as sender.
  const holderTotal = addHolderInputs(psbt, req.pairing, holder, req.holderInputs, req.prevTxHex, "Gather");
  const feeInputSats = req.feeInputs.length ? addHolderInputs(psbt, req.pairing, dest, req.feeInputs, req.prevTxHex, "Fee") : 0;
  const n = req.holderInputs.length + req.feeInputs.length;
  const feeSats = gatherFee(n, req.feeRate);
  const txcSats = holderTotal + feeInputSats - feeSats;
  if (!Number.isSafeInteger(txcSats) || txcSats < TSD_REFERENCE_SATS) throw new Error(`Not enough TXC to pay the network fee for address #${req.index}.`);
  if (feeSats >= (10 + n * 147 + 34 + 31) * MAX_FEE_RATE) throw new Error("The resulting TXC fee exceeds Vault's safety limit.");
  const data = payments.embed({ data: [buildSimpleSendPayload(39, units)] }).output;
  if (!data) throw new Error("Could not encode TSD payment.");
  psbt.addOutput({ script: data, value: 0n });
  psbt.addOutput({ script: holderScript(dest), value: BigInt(txcSats), bip32Derivation: [{ masterFingerprint: bytes(req.pairing.fp), path: dest.path, pubkey: dest.pubkey }] });
  const psbtBase64 = vaultBytesToBase64(psbt.toBuffer());
  if (psbtBase64.length > 250_000) throw new Error("This request exceeds Vault's QR signing limit.");
  return { psbtBase64, intent: { kind: "gather", from: holder.address, fromIndex: req.index, to: dest.address, amount: req.balance.trim(), txcSats, feeSats, holderInputs: req.holderInputs.length, feeInputs: req.feeInputs.length, feeInputSats } };
}

/** Bind every byte to the reviewed PSBT and require genuine SIGHASH_ALL legacy signatures. */
export function verifyTsdGatherSigned(hex: string, psbtBase64: string): string {
  const txid = verifySignedAgainstPsbt(hex, psbtBase64, "TSD gather step");
  const tx = Transaction.fromHex(hex.trim());
  const psbt = Psbt.fromBase64(psbtBase64, { network: TXC_NETWORK });
  for (let i = 0; i < tx.ins.length; i++) {
    const input = psbt.data.inputs[i];
    const prev = input.nonWitnessUtxo ? Transaction.fromBuffer(input.nonWitnessUtxo).outs[tx.ins[i].index] : undefined;
    const chunks = script.decompile(tx.ins[i].script);
    const sig = chunks?.[0]; const pubkey = chunks?.[1];
    if (!prev || !chunks || chunks.length !== 2 || !(sig instanceof Uint8Array) || !(pubkey instanceof Uint8Array) || tx.ins[i].witness.length) throw new Error("Invalid TXC input signature. Nothing was broadcast.");
    const decoded = script.signature.decode(sig);
    const expected = payments.p2pkh({ pubkey, network: TXC_NETWORK }).output;
    if (decoded.hashType !== Transaction.SIGHASH_ALL || !expected || !equal(expected, prev.script) || !ecc.verify(tx.hashForSignature(i, prev.script, Transaction.SIGHASH_ALL), pubkey, decoded.signature)) throw new Error("Invalid TXC signature or signing policy. Nothing was broadcast.");
  }
  return txid;
}

export const isTxcAddress = (a: string) => { try { addr.toOutputScript(a, TXC_NETWORK); return true; } catch { return false; } };
