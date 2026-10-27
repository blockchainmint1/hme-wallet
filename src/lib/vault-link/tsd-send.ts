/** Single-holder TXC Omni property-39 requests. No keys or signing online. */
import { address, payments, Psbt, script, Transaction } from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { TXC_NETWORK } from "@/lib/txc/network";
import { buildSimpleSendPayload, parseTokenAmount } from "@/lib/txc/tokens";
import { deriveVaultAddress } from "./derive";
import type { VaultPairing } from "./pairing";
import type { VaultUtxo } from "./scan";
import { vaultBytesToBase64, verifySignedAgainstPsbt } from "./psbt-build";

export const TSD_REFERENCE_SATS = 10_000;
export interface VaultTsdIntent { recipient: string; amount: string; sender: string; feeSats: number; changeSats: number }
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], h => Number.parseInt(h, 16));

export function vaultTsdHolder(pairing: VaultPairing) {
  if (!pairing.chains.txc?.["44"]) throw new Error("Pair the Vault's legacy TXC account to send TSD.");
  return deriveVaultAddress(pairing, "txc", 44, 0, 0);
}

/** Receiving and spending must use the identical legacy token holder. */
export function vaultTsdReceiveAddress(pairing: VaultPairing | null): string | null {
  return pairing?.chains.txc?.["44"] ? vaultTsdHolder(pairing).address : null;
}

/** Same largest-first fee policy as the builder; select before any previous-tx downloads. */
export function selectVaultTsdInputs(pairing: VaultPairing, inputs: VaultUtxo[], feeRate: number): VaultUtxo[] {
  const holder = vaultTsdHolder(pairing);
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate >= 5_000) throw new Error("The TXC fee estimate is unavailable or exceeds Vault's safety limit.");
  const picked: VaultUtxo[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const u of [...inputs].sort((a, b) => b.value - a.value)) {
    const key = `${u.txid}:${u.vout}`;
    if (seen.has(key)) throw new Error("Duplicate TXC input.");
    seen.add(key);
    if (u.purpose !== 44 || u.change !== 0 || u.index !== 0 || u.path !== holder.path || u.address !== holder.address || !equal(u.pubkey, holder.pubkey)) throw new Error("TSD fee inputs must belong to the paired TXC address #0.");
    if (!Number.isSafeInteger(u.value) || u.value <= 0 || !Number.isSafeInteger(u.vout) || u.vout < 0) throw new Error("Invalid TXC input amount or output index.");
    picked.push(u);
    total += u.value;
    if (!Number.isSafeInteger(total)) throw new Error("TXC input total exceeds the safe range.");
    if (total >= TSD_REFERENCE_SATS + (10 + picked.length * 149 + 34 * 2 + 31) * feeRate) return picked;
  }
  throw new Error(`Add TXC for fees to the Vault's TSD address: ${holder.address}. TXC on other addresses cannot fund this TSD transfer.`);
}

/** Zero balances are allowed for display but never silently substitute for a failed read. */
export function tsdBalanceUnits(balance: string): bigint {
  if (/^0(?:\.0{1,8})?$/.test(balance)) return 0n;
  return parseTokenAmount(balance, true);
}

export function buildVaultTsdPsbt(req: {
  pairing: VaultPairing; recipient: string; amount: string; balance: string;
  feeRate: number; inputs: VaultUtxo[]; prevTxHex: Record<string, string>;
}): { psbtBase64: string; intent: VaultTsdIntent } {
  const holder = vaultTsdHolder(req.pairing);
  const recipient = req.recipient.trim();
  let recipientScript: Uint8Array;
  try {
    recipientScript = address.toOutputScript(recipient, TXC_NETWORK);
    payments.p2pkh({ output: recipientScript, network: TXC_NETWORK });
  } catch { throw new Error("Enter a legacy TEXITcoin T… recipient address for TSD."); }
  if (recipient === holder.address) throw new Error("Choose a recipient different from this Vault's TSD address.");
  const amount = parseTokenAmount(req.amount, true);
  const payload = buildSimpleSendPayload(39, amount);
  if (amount > tsdBalanceUnits(req.balance)) throw new Error("Not enough TSD on the Vault's TXC address #0.");
  if (!Number.isSafeInteger(req.feeRate) || req.feeRate < 1 || req.feeRate >= 5_000) throw new Error("The TXC fee estimate is unavailable or exceeds Vault's safety limit.");
  const holderScript = payments.p2pkh({ pubkey: holder.pubkey, network: TXC_NETWORK }).output;
  if (!holderScript) throw new Error("Could not derive the TSD holder script.");
  const selected: { u: VaultUtxo; previous: Transaction }[] = [];
  const seen = new Set<string>();
  let total = 0;
  let feeSats = 0;
  for (const u of selectVaultTsdInputs(req.pairing, req.inputs, req.feeRate)) {
    const key = `${u.txid}:${u.vout}`;
    if (seen.has(key)) throw new Error("Duplicate TXC input.");
    seen.add(key);
    if (u.purpose !== 44 || u.change !== 0 || u.index !== 0 || u.path !== holder.path || u.address !== holder.address || !equal(u.pubkey, holder.pubkey)) throw new Error("TSD fee inputs must belong to the paired TXC address #0.");
    if (!Number.isSafeInteger(u.value) || u.value <= 0 || !Number.isSafeInteger(u.vout) || u.vout < 0) throw new Error("Invalid TXC input amount or output index.");
    const hex = req.prevTxHex[key];
    if (!hex || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Missing or invalid previous TXC transaction.");
    const previous = Transaction.fromHex(hex);
    const prev = previous.outs[u.vout];
    if (previous.getId() !== u.txid || !prev || prev.value !== BigInt(u.value) || !equal(prev.script, holderScript)) throw new Error("The previous TXC transaction does not match the Vault holder input.");
    selected.push({ u, previous });
    total += u.value;
    if (!Number.isSafeInteger(total)) throw new Error("TXC input total exceeds the safe range.");
    // Conservative signed legacy size, including data, reference and holder change.
    feeSats = (10 + selected.length * 149 + 34 * 2 + 31) * req.feeRate;
    if (total >= TSD_REFERENCE_SATS + feeSats) break;
  }
  if (!selected.length || total < TSD_REFERENCE_SATS + feeSats) throw new Error(`Add TXC for fees to the Vault's TSD address: ${holder.address}. TXC on other addresses cannot fund this TSD transfer.`);
  let changeSats = total - TSD_REFERENCE_SATS - feeSats;
  if (changeSats > 0 && changeSats < TSD_REFERENCE_SATS) { feeSats += changeSats; changeSats = 0; }
  // Keep absorbed dust from pushing the actual fee beyond the offline cap.
  const minVsize = 10 + selected.length * 147 + 34 * (changeSats ? 2 : 1) + 31;
  if (feeSats >= minVsize * 5_000) throw new Error("The resulting TXC fee exceeds Vault's safety limit.");
  const derivation = [{ masterFingerprint: bytes(req.pairing.fp), path: holder.path, pubkey: holder.pubkey }];
  const psbt = new Psbt({ network: TXC_NETWORK });
  for (const { u, previous } of selected) psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: previous.toBuffer(), sighashType: Transaction.SIGHASH_ALL, bip32Derivation: derivation });
  const data = payments.embed({ data: [payload] }).output;
  if (!data) throw new Error("Could not encode TSD payment.");
  psbt.addOutput({ script: data, value: 0n });
  psbt.addOutput({ script: recipientScript, value: BigInt(TSD_REFERENCE_SATS) });
  // Omni ignores sender-address change; a fresh HD change address could become the token recipient.
  if (changeSats) psbt.addOutput({ script: holderScript, value: BigInt(changeSats), bip32Derivation: derivation });
  const psbtBase64 = vaultBytesToBase64(psbt.toBuffer());
  if (psbtBase64.length > 250_000) throw new Error("This request exceeds Vault's QR signing limit. Consolidate the holder's TXC first.");
  return { psbtBase64, intent: { recipient, amount: req.amount.trim(), sender: holder.address, feeSats, changeSats } };
}

/** Bind every byte and verify every legacy signature is genuine and SIGHASH_ALL. */
export function verifyVaultTsdSigned(hex: string, psbtBase64: string): string {
  const txid = verifySignedAgainstPsbt(hex, psbtBase64, "TSD payment");
  const tx = Transaction.fromHex(hex.trim());
  const psbt = Psbt.fromBase64(psbtBase64, { network: TXC_NETWORK });
  for (let i = 0; i < tx.ins.length; i++) {
    const input = psbt.data.inputs[i];
    const previous = input.nonWitnessUtxo ? Transaction.fromBuffer(input.nonWitnessUtxo) : null;
    const prev = previous?.outs[tx.ins[i].index];
    const chunks = script.decompile(tx.ins[i].script);
    const sigBytes = chunks?.[0]; const pubkey = chunks?.[1];
    if (!prev || !chunks || chunks.length !== 2 || !(sigBytes instanceof Uint8Array) || !(pubkey instanceof Uint8Array) || tx.ins[i].witness.length) throw new Error("Invalid TSD input signature. Nothing was broadcast.");
    const decoded = script.signature.decode(sigBytes);
    const expected = payments.p2pkh({ pubkey, network: TXC_NETWORK }).output;
    if (decoded.hashType !== Transaction.SIGHASH_ALL || !expected || !equal(expected, prev.script) || !ecc.verify(tx.hashForSignature(i, prev.script, Transaction.SIGHASH_ALL), pubkey, decoded.signature)) throw new Error("Invalid TSD signature or signing policy. Nothing was broadcast.");
  }
  return txid;
}