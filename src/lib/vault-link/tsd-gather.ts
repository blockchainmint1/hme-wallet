/**
 * Gather TSD that sits on Vault TXC receive addresses #1+ back to address #0.
 *
 * Two Vault-signed steps, never mixed:
 *  1. Funding: plain TXC from address #0 (only) to each TSD holder, change back to #0.
 *  2. Gather: per holder, an Omni property-39 simple send of the holder's whole
 *     TSD balance whose ONLY non-data output is address #0, spending ONLY that
 *     holder's coins. All of the holder's TXC (minus fee) rides along as the
 *     reference output, so nothing is stranded and no change output exists.
 * Why separate: Omni picks the sender from the inputs, so fee coins from #0 in the
 * same transaction could make #0 the sender. No keys or signing online.
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

export const TSD_GATHER_MAX_INDEX = 30;
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

/** TXC each holder needs so its gather transaction (up to 3 inputs) pays its own fee. */
export function tsdGatherFundingSats(feeRate: number): number {
  checkRate(feeRate);
  return TSD_REFERENCE_SATS + (10 + 3 * IN_VB + 34 + 31) * feeRate;
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

export interface TsdFundingIntent { kind: "fund"; from: string; targets: { index: number; address: string; sats: number }[]; feeSats: number; changeSats: number }
export interface TsdGatherIntent { kind: "gather"; from: string; fromIndex: number; to: string; amount: string; txcSats: number; feeSats: number }

/** Largest-first selection of address #0 coins for a funding transaction. */
export function selectTsdFundingInputs(pairing: VaultPairing, inputs: VaultUtxo[], targetCount: number, feeRate: number): VaultUtxo[] {
  const per = tsdGatherFundingSats(feeRate);
  const picked: VaultUtxo[] = [];
  let total = 0;
  for (const u of [...inputs].sort((a, b) => b.value - a.value)) {
    picked.push(u); total += u.value;
    if (total >= per * targetCount + (10 + picked.length * IN_VB + 34 * (targetCount + 1)) * feeRate) return picked;
  }
  throw new Error(`Not enough TXC on address #0 (${vaultTsdHolder(pairing).address}) to fund ${targetCount} address${targetCount === 1 ? "" : "es"}.`);
}

export function buildTsdFundingPsbt(req: { pairing: VaultPairing; targetIndexes: number[]; feeRate: number; inputs: VaultUtxo[]; prevTxHex: Record<string, string> }): { psbtBase64: string; intent: TsdFundingIntent } {
  checkRate(req.feeRate);
  const indexes = [...new Set(req.targetIndexes)];
  if (!indexes.length || indexes.length !== req.targetIndexes.length || indexes.length > TSD_GATHER_MAX_INDEX) throw new Error("Choose the TSD addresses to fund.");
  const source = vaultTsdHolder(req.pairing);
  const per = tsdGatherFundingSats(req.feeRate);
  const psbt = new Psbt({ network: TXC_NETWORK });
  const total = addHolderInputs(psbt, req.pairing, source, req.inputs, req.prevTxHex, "Funding");
  const targets = indexes.map(index => { const a = vaultTsdReceiveHolder(req.pairing, index); return { index, address: a.address, sats: per, script: holderScript(a) }; });
  let feeSats = (10 + req.inputs.length * IN_VB + 34 * (targets.length + 1)) * req.feeRate;
  let changeSats = total - per * targets.length - feeSats;
  if (changeSats < 0) throw new Error("Not enough TXC on address #0 for this funding plus the network fee.");
  if (changeSats < TSD_REFERENCE_SATS) { feeSats += changeSats; changeSats = 0; }
  const minVsize = 10 + req.inputs.length * 147 + 34 * (targets.length + (changeSats ? 1 : 0));
  if (feeSats >= minVsize * MAX_FEE_RATE) throw new Error("The resulting TXC fee exceeds Vault's safety limit.");
  for (const t of targets) psbt.addOutput({ script: t.script, value: BigInt(t.sats) });
  if (changeSats) psbt.addOutput({ script: holderScript(source), value: BigInt(changeSats), bip32Derivation: [{ masterFingerprint: bytes(req.pairing.fp), path: source.path, pubkey: source.pubkey }] });
  const psbtBase64 = vaultBytesToBase64(psbt.toBuffer());
  if (psbtBase64.length > 250_000) throw new Error("This request exceeds Vault's QR signing limit.");
  return { psbtBase64, intent: { kind: "fund", from: source.address, targets: targets.map(({ index, address, sats }) => ({ index, address, sats })), feeSats, changeSats } };
}

export function buildTsdGatherPsbt(req: { pairing: VaultPairing; index: number; balance: string; feeRate: number; inputs: VaultUtxo[]; prevTxHex: Record<string, string> }): { psbtBase64: string; intent: TsdGatherIntent } {
  checkRate(req.feeRate);
  const holder = vaultTsdReceiveHolder(req.pairing, req.index);
  const dest = vaultTsdHolder(req.pairing);
  const units = tsdBalanceUnits(req.balance);
  if (units <= 0n) throw new Error(`Address #${req.index} holds no TSD.`);
  if (!req.inputs.length) throw new Error(`Address #${req.index} has no confirmed TXC. Fund it first and wait for a confirmation.`);
  const psbt = new Psbt({ network: TXC_NETWORK });
  const total = addHolderInputs(psbt, req.pairing, holder, req.inputs, req.prevTxHex, "Gather");
  const feeSats = (10 + req.inputs.length * IN_VB + 34 + 31) * req.feeRate;
  const txcSats = total - feeSats;
  if (txcSats < TSD_REFERENCE_SATS) throw new Error(`Address #${req.index} needs more TXC for the network fee. Fund it first.`);
  const data = payments.embed({ data: [buildSimpleSendPayload(39, units)] }).output;
  if (!data) throw new Error("Could not encode TSD payment.");
  psbt.addOutput({ script: data, value: 0n });
  // Sole non-data output: the reference recipient is unambiguously address #0.
  psbt.addOutput({ script: holderScript(dest), value: BigInt(txcSats), bip32Derivation: [{ masterFingerprint: bytes(req.pairing.fp), path: dest.path, pubkey: dest.pubkey }] });
  const psbtBase64 = vaultBytesToBase64(psbt.toBuffer());
  if (psbtBase64.length > 250_000) throw new Error("This request exceeds Vault's QR signing limit.");
  return { psbtBase64, intent: { kind: "gather", from: holder.address, fromIndex: req.index, to: dest.address, amount: req.balance.trim(), txcSats, feeSats } };
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
