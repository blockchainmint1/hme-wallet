/**
 * Vault TSD "send to many": one Omni Send To Many (type 7, property 39) per batch
 * of up to 7 recipients, funded only by the paired legacy TXC address #0, change
 * back to #0. Prepared here as an unsigned PSBT; HME Vault signs it by QR.
 */
import { address, payments, Psbt, Transaction } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { buildSendToManyPayload, STM_BATCH_SIZE } from "@/lib/txc/bulk-send";
import { vaultTsdHolder, TSD_REFERENCE_SATS } from "./tsd-send";
import type { VaultPairing } from "./pairing";
import type { VaultUtxo } from "./scan";
import { vaultBytesToBase64 } from "./psbt-build";

export const VAULT_FEE_CAP = 5_000;
export interface VaultTsdManyIntent { recipients: { address: string; units: bigint }[]; sender: string; feeSats: number; changeSats: number; totalUnits: bigint }
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], h => Number.parseInt(h, 16));
const vsize = (inputs: number, recipients: number, change: boolean) => 10 + inputs * 149 + 34 * (recipients + (change ? 1 : 0)) + 11 + 13 + 9 * recipients;

export function buildVaultTsdManyPsbt(req: {
  pairing: VaultPairing; recipients: { address: string; units: bigint }[]; balanceUnits: bigint;
  feeRate: number; inputs: VaultUtxo[]; prevTxHex: Record<string, string>;
}): { psbtBase64: string; intent: VaultTsdManyIntent } {
  const holder = vaultTsdHolder(req.pairing);
  const n = req.recipients.length;
  if (n < 1 || n > STM_BATCH_SIZE) throw new Error(`A Vault batch needs 1–${STM_BATCH_SIZE} recipients.`);
  if (!Number.isSafeInteger(req.feeRate) || req.feeRate < 1 || req.feeRate >= VAULT_FEE_CAP) throw new Error("The TXC fee estimate is unavailable or exceeds Vault's safety limit.");
  const seen = new Set<string>();
  let totalUnits = 0n;
  const scripts = req.recipients.map(r => {
    const a = r.address.trim();
    if (seen.has(a)) throw new Error(`${a} is listed twice in one batch.`);
    seen.add(a);
    if (a === holder.address) throw new Error("A recipient can't be this Vault's own TSD address.");
    if (r.units <= 0n) throw new Error("Every amount must be above zero.");
    totalUnits += r.units;
    try { const s = address.toOutputScript(a, TXC_NETWORK); payments.p2pkh({ output: s, network: TXC_NETWORK }); return s; }
    catch { throw new Error(`${a} is not a legacy TEXITcoin T… address.`); }
  });
  if (totalUnits > req.balanceUnits) throw new Error("Not enough TSD on the Vault's TXC address #0.");
  const holderScript = payments.p2pkh({ pubkey: holder.pubkey, network: TXC_NETWORK }).output;
  if (!holderScript) throw new Error("Could not derive the TSD holder script.");
  const need = TSD_REFERENCE_SATS * n;
  const selected: { u: VaultUtxo; previous: Transaction }[] = [];
  const used = new Set<string>();
  let total = 0; let feeSats = 0;
  for (const u of [...req.inputs].sort((a, b) => b.value - a.value)) {
    const key = `${u.txid}:${u.vout}`;
    if (used.has(key)) throw new Error("Duplicate TXC input.");
    used.add(key);
    if (u.purpose !== 44 || u.change !== 0 || u.index !== 0 || u.path !== holder.path || u.address !== holder.address || !equal(u.pubkey, holder.pubkey)) throw new Error("TSD fee inputs must belong to the paired TXC address #0.");
    if (!Number.isSafeInteger(u.value) || u.value <= 0 || !Number.isSafeInteger(u.vout) || u.vout < 0) throw new Error("Invalid TXC input amount or output index.");
    const hex = req.prevTxHex[key];
    if (!hex || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Missing or invalid previous TXC transaction.");
    const previous = Transaction.fromHex(hex);
    const prev = previous.outs[u.vout];
    if (previous.getId() !== u.txid || !prev || prev.value !== BigInt(u.value) || !equal(prev.script, holderScript)) throw new Error("The previous TXC transaction does not match the Vault holder input.");
    selected.push({ u, previous });
    total += u.value;
    feeSats = vsize(selected.length, n, true) * req.feeRate;
    if (total >= need + feeSats) break;
  }
  if (!selected.length || total < need + feeSats) throw new Error(`Add TXC for fees to the Vault's TSD address: ${holder.address}.`);
  let changeSats = total - need - feeSats;
  if (changeSats > 0 && changeSats < TSD_REFERENCE_SATS) { feeSats += changeSats; changeSats = 0; }
  if (feeSats >= (vsize(selected.length, n, changeSats > 0) - 2 * selected.length) * VAULT_FEE_CAP) throw new Error("The resulting TXC fee exceeds Vault's safety limit.");
  const derivation = [{ masterFingerprint: bytes(req.pairing.fp), path: holder.path, pubkey: holder.pubkey }];
  const psbt = new Psbt({ network: TXC_NETWORK });
  for (const { u, previous } of selected) psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: previous.toBuffer(), sighashType: Transaction.SIGHASH_ALL, bip32Derivation: derivation });
  // Data is vout 0, recipients 1..n (matching the payload), change last.
  const payload = buildSendToManyPayload(39, req.recipients.map((r, i) => ({ vout: i + 1, units: r.units })));
  const data = payments.embed({ data: [payload] }).output;
  if (!data) throw new Error("Could not encode TSD payment.");
  psbt.addOutput({ script: data, value: 0n });
  for (const s of scripts) psbt.addOutput({ script: s, value: BigInt(TSD_REFERENCE_SATS) });
  if (changeSats) psbt.addOutput({ script: holderScript, value: BigInt(changeSats), bip32Derivation: derivation });
  const psbtBase64 = vaultBytesToBase64(psbt.toBuffer());
  if (psbtBase64.length > 250_000) throw new Error("This request exceeds Vault's QR signing limit. Consolidate the holder's TXC first.");
  return { psbtBase64, intent: { recipients: req.recipients.map(r => ({ address: r.address.trim(), units: r.units })), sender: holder.address, feeSats, changeSats, totalUnits } };
}
