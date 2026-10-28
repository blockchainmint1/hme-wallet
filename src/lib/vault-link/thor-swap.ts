/** Review-only THORChain preparation. This module never signs or broadcasts. */
import { address, payments, Psbt, script, Transaction } from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { erc20Abi, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from "viem";
import { THOR_CATALOG, THOR_EVM_ROUTERS, assertQuoteFresh, validateSwapMemo, validateThorDestination, toThorUnits, type ThorCatalogQuote, type ThorAssetId } from "@/lib/thorchain/catalog";
import { thorApprovalRequest, thorDepositRequest } from "@/lib/thorchain/execute";
import { EVM_CHAINS, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing } from "./pairing";
import { chainIo, type VaultUtxo } from "./scan";
import { vaultBytesToBase64, verifySignedAgainstPsbt } from "./psbt-build";

export function vaultThorAddress(pairing: VaultPairing, asset: ThorAssetId): string | null {
  const meta = THOR_CATALOG[asset];
  if (meta.kind !== "utxo") return pairing.evm?.address ?? null;
  const coin = meta.chain as "btc" | "ltc" | "doge";
  const purposes = VAULT_CHAIN_META[coin].purposes;
  const purpose = purposes.find(p => pairing.chains[coin]?.[String(p) as "44" | "49" | "84"]);
  return purpose ? deriveVaultAddress(pairing, coin, purpose, 0, 0).address : null;
}

export function validateVaultThorQuote(q: ThorCatalogQuote) {
  assertQuoteFresh(q);
  const from = THOR_CATALOG[q.from], to = THOR_CATALOG[q.to];
  if (q.provider !== "thorchain" || !from || !to || q.from === q.to || !/^[1-9]\d*$/.test(q.rawIn)) throw new Error("Invalid THORChain intent.");
  validateThorDestination(to, q.destination);
  validateThorDestination(from, q.inbound);
  if (toThorUnits(BigInt(q.rawIn), from.decimals) !== q.amountIn || validateSwapMemo(q.memo, to, q.destination, q.expectedOut, q.toleranceBps) !== q.minimumOut) throw new Error("Swap amount or minimum changed.");
  if (from.kind === "utxo") {
    if (q.router !== null || new TextEncoder().encode(q.memo).length > 80) throw new Error("Unsupported UTXO swap instructions.");
  } else if (q.router?.toLowerCase() !== THOR_EVM_ROUTERS[from.chain as "eth" | "base" | "bsc"].toLowerCase()) throw new Error("THORChain router changed.");
}

export interface VaultThorPrepared {
  payload: string;
  quote: ThorCatalogQuote;
  pairingIdentity: string;
  refundAddress: string;
  feeRaw: string;
  action: "utxo-deposit" | "approval-reset" | "approval" | "evm-deposit";
  inputs?: VaultUtxo[];
  evm?: { from: Address; chainId: number; nonce: number; to: Address; value: string; data: Hex; gas: string; type: "legacy" | "eip1559"; gasPrice?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string };
}

export async function prepareVaultThorSwap(pairing: VaultPairing, quote: ThorCatalogQuote, coins: VaultUtxo[], feeRate: number): Promise<VaultThorPrepared> {
  const q = Object.freeze({ ...quote });
  validateVaultThorQuote(q);
  const from = THOR_CATALOG[q.from];
  const base = { quote: q, pairingIdentity: JSON.stringify(pairing) };
  if (from.kind !== "utxo") {
    const evm = pairing.evm;
    if (!evm) throw new Error("Pair this Vault's Ethereum address first.");
    const chain = from.chain as EvmChainId;
    const pub = evmClient(chain);
    let action: VaultThorPrepared["action"] = "evm-deposit";
    if (from.kind === "evm-token") {
      if (!from.contract || !q.router) throw new Error("Missing token or router.");
      const allowance = await pub.readContract({ address: from.contract, abi: erc20Abi, functionName: "allowance", args: [evm.address as Address, q.router as Address] });
      if (allowance !== BigInt(q.rawIn)) action = allowance > 0n ? "approval-reset" : "approval";
      const balance = await pub.readContract({ address: from.contract, abi: erc20Abi, functionName: "balanceOf", args: [evm.address as Address] });
      if (balance < BigInt(q.rawIn)) throw new Error("Not enough tokens in the paired Vault address.");
    }
    const req = action === "evm-deposit" ? thorDepositRequest(q) : thorApprovalRequest(q, action === "approval-reset");
    const [nonce, estimate, fees, balance] = await Promise.all([
      pub.getTransactionCount({ address: evm.address as Address, blockTag: "pending" }),
      pub.estimateGas({ account: evm.address as Address, ...req }), pub.estimateFeesPerGas(), pub.getBalance({ address: evm.address as Address }),
    ]);
    const gas = (estimate * 120n + 99n) / 100n;
    const feeFields = fees.maxFeePerGas != null
      ? { type: "eip1559" as const, maxFeePerGas: (fees.maxFeePerGas * 2n).toString(), maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 0n).toString() }
      : { type: "legacy" as const, gasPrice: (fees.gasPrice ?? await pub.getGasPrice()).toString() };
    const feeRaw = gas * BigInt(feeFields.type === "legacy" ? feeFields.gasPrice : feeFields.maxFeePerGas);
    if (balance < req.value + feeRaw) throw new Error("Not enough native funds for the swap and network fee.");
    const tx = { from: evm.address as Address, chainId: EVM_CHAINS[chain].viemChain.id, nonce, to: req.to, value: req.value.toString(), data: req.data, gas: gas.toString(), ...feeFields };
    // PROPOSED protocol, intentionally distinct from transfer-only hm-evm-tx.
    const payload = JSON.stringify({ format: "hm-thor-swap", v: 1, fp: pairing.fp, path: evm.path, action, quote: q, transaction: tx });
    if (payload.length > 8192) throw new Error("Swap intent exceeds the review size limit.");
    return { ...base, payload, action, evm: tx, feeRaw: feeRaw.toString(), refundAddress: evm.address };
  }
  const coin = from.chain as "btc" | "ltc" | "doge";
  const cap = coin === "doge" ? 1_000_000 : 5_000;
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate >= cap) throw new Error("Fee estimate is unavailable or exceeds Vault's safety limit.");
  const amount = Number(q.rawIn);
  if (!Number.isSafeInteger(amount)) throw new Error("Swap amount exceeds the safe UTXO range.");
  const selected: VaultUtxo[] = [], seen = new Set<string>();
  let total = 0, fee = 0;
  for (const u of [...coins].sort((a, b) => b.value - a.value)) {
    const key = `${u.txid}:${u.vout}`;
    const derived = deriveVaultAddress(pairing, coin, u.purpose, u.change, u.index);
    if (seen.has(key) || !/^[0-9a-f]{64}$/.test(u.txid) || !Number.isSafeInteger(u.vout) || u.vout < 0 || !Number.isSafeInteger(u.value) || u.value <= 0 || u.path !== derived.path || u.address !== derived.address || !equal(u.pubkey, derived.pubkey)) throw new Error("Invalid or duplicate paired input.");
    seen.add(key); selected.push(u); total += u.value;
    if (!Number.isSafeInteger(total)) throw new Error("Input total exceeds safe range.");
    fee = (11 + selected.reduce((s, x) => s + (x.purpose === 84 ? 69 : x.purpose === 49 ? 92 : 149), 0) + 86 + 90) * feeRate;
    if (total >= amount + fee) break;
  }
  const first = selected[0];
  if (!first || total < amount + fee) throw new Error("Not enough paired funds for swap plus fee.");
  const psbt = new Psbt({ network: VAULT_CHAIN_META[coin].network });
  for (const u of selected) {
    const previous = Transaction.fromHex(await chainIo(coin).txHex(u.txid));
    const prev = previous.outs[u.vout];
    const expected = address.toOutputScript(u.address, VAULT_CHAIN_META[coin].network);
    if (previous.getId() !== u.txid || !prev || prev.value !== BigInt(u.value) || !equal(prev.script, expected)) throw new Error("Previous transaction does not match the paired input.");
    const derivation = [{ masterFingerprint: Uint8Array.from(pairing.fp.match(/../g) ?? [], h => parseInt(h, 16)), pubkey: u.pubkey, path: u.path }];
    if (u.purpose === 44) psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: previous.toBuffer(), bip32Derivation: derivation, sighashType: Transaction.SIGHASH_ALL });
    else {
      const redeemScript = u.purpose === 49 ? payments.p2wpkh({ pubkey: u.pubkey, network: VAULT_CHAIN_META[coin].network }).output : undefined;
      psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: prev, ...(redeemScript ? { redeemScript } : {}), bip32Derivation: derivation, sighashType: Transaction.SIGHASH_ALL });
    }
  }
  // THORChain deposit first, change to FIRST INPUT holder, memo last.
  psbt.addOutput({ address: q.inbound, value: BigInt(amount) });
  let change = total - amount - fee;
  const dust = coin === "doge" ? 100_000_000 : 546;
  if (change > 0 && change < dust) { fee += change; change = 0; }
  if (change) psbt.addOutput({ address: first.address, value: BigInt(change), bip32Derivation: [{ masterFingerprint: Uint8Array.from(pairing.fp.match(/../g) ?? [], h => parseInt(h, 16)), pubkey: first.pubkey, path: first.path }] });
  const memo = payments.embed({ data: [new TextEncoder().encode(q.memo)] }).output;
  if (!memo) throw new Error("Cannot encode swap memo.");
  psbt.addOutput({ script: memo, value: 0n });
  // Offline cap uses a lower bound; absorbed dust must not exceed it.
  const unsignedSize = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer()).virtualSize();
  if (fee >= unsignedSize * cap) throw new Error("Resulting fee exceeds conservative Vault cap.");
  const payload = vaultBytesToBase64(psbt.toBuffer());
  if (payload.length > 250_000) throw new Error("Swap exceeds Vault QR size limit.");
  return { ...base, payload, action: "utxo-deposit", inputs: selected, feeRaw: String(fee), refundAddress: first.address };
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Verification only. Even valid results cannot be broadcast by this preparation flow. */
export async function verifyVaultThorResult(hex: string, prepared: VaultThorPrepared): Promise<void> {
  validateVaultThorQuote(prepared.quote);
  if (prepared.evm) {
    const expected = prepared.evm;
    const tx = parseTransaction(hex as Hex);
    const signer = await recoverTransactionAddress({ serializedTransaction: hex as TransactionSerialized });
    const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
    if (!same(signer, expected.from) || tx.chainId !== expected.chainId || tx.nonce !== expected.nonce || !same(tx.to ?? undefined, expected.to) || !same(tx.data ?? "0x", expected.data) || (tx.value ?? 0n) !== BigInt(expected.value) || tx.gas !== BigInt(expected.gas) || tx.type !== expected.type || tx.accessList?.length) throw new Error("Signed swap fields changed.");
    if (expected.type === "legacy" ? tx.gasPrice !== BigInt(expected.gasPrice ?? "0") : tx.maxFeePerGas !== BigInt(expected.maxFeePerGas ?? "0") || tx.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas ?? "0")) throw new Error("Signed fee changed.");
    return;
  }
  verifySignedAgainstPsbt(hex, prepared.payload, "THORChain swap");
  const tx = Transaction.fromHex(hex), psbt = Psbt.fromBase64(prepared.payload);
  for (const [i, u] of (prepared.inputs ?? []).entries()) {
    const input = tx.ins[i];
    let signature: Uint8Array | undefined, pubkey: Uint8Array | undefined, digest: Uint8Array;
    if (u.purpose === 44) {
      const chunks = script.decompile(input.script);
      if (chunks?.length !== 2 || input.witness.length || !(chunks[0] instanceof Uint8Array) || !(chunks[1] instanceof Uint8Array)) throw new Error("Invalid legacy signature.");
      [signature, pubkey] = [chunks[0], chunks[1]];
      const prev = psbt.data.inputs[i].nonWitnessUtxo;
      if (!prev) throw new Error("Missing previous transaction.");
      digest = tx.hashForSignature(i, Transaction.fromBuffer(prev).outs[u.vout].script, Transaction.SIGHASH_ALL);
    } else {
      if (input.witness.length !== 2) throw new Error("Invalid witness signature.");
      [signature, pubkey] = input.witness;
      const code = payments.p2pkh({ pubkey: u.pubkey }).output;
      const redeem = psbt.data.inputs[i].redeemScript;
      const expectedScript = redeem ? script.compile([redeem]) : new Uint8Array();
      if (!code || !equal(input.script, expectedScript)) throw new Error("Witness input script changed.");
      digest = tx.hashForWitnessV0(i, code, BigInt(u.value), Transaction.SIGHASH_ALL);
    }
    if (!signature || !pubkey || !equal(pubkey, u.pubkey)) throw new Error("Signing key changed.");
    const sig = script.signature.decode(signature);
    if (sig.hashType !== Transaction.SIGHASH_ALL || !ecc.verify(digest, pubkey, sig.signature)) throw new Error("Invalid signature or signing policy.");
  }
}