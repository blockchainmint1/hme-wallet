/**
 * Every Ethereum-family address of a paired Vault seed.
 *
 * HME Vault 1.0.1+ adds `evm.xpub`: the public account key at m/44'/60'/0'.
 * NectarPay derives a fresh sale address m/44'/60'/0'/0/n (n ≥ 1) from it, so
 * a store's money sits on many addresses of the same seed. We derive the same
 * addresses here (public keys only) so the wallet can find and gather them.
 * Older pairings carry only address #0 and stay limited to it.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { bytesToHex, getAddress, keccak256, type Address } from "viem";
import { TXC_NETWORK } from "@/lib/txc/network";
import type { VaultPairing } from "./pairing";

const bip32 = BIP32Factory(ecc);

/** HME Vault's batch-sweep path limit (m/44'/60'/0'/0/0–999). */
export const VAULT_EVM_MAX_INDEX = 999;
export const VAULT_EVM_ACCOUNT_PATH = "m/44'/60'/0'";

export function vaultEvmPath(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > VAULT_EVM_MAX_INDEX) throw new Error("Invalid Ethereum address number.");
  return `${VAULT_EVM_ACCOUNT_PATH}/0/${index}`;
}

/** Ethereum address of receive index `index` under an account xpub (m/44'/60'/0'). */
export function evmAddressFromAccountXpub(xpub: string, index: number): Address {
  vaultEvmPath(index);
  // Account xpubs use standard xpub version bytes on every coin (TXC network carries them).
  const node = bip32.fromBase58(xpub, TXC_NETWORK).neutered().derive(0).derive(index);
  const full = ecc.pointCompress(node.publicKey, false);
  if (!full || full.length !== 65) throw new Error("Could not derive the Ethereum address.");
  const hash = keccak256(bytesToHex(full.slice(1)));
  return getAddress(`0x${hash.slice(-40)}`);
}

export function vaultHasEvmAccountKey(pairing: VaultPairing | null): boolean {
  return !!pairing?.evm?.xpub;
}

export interface VaultEvmAccount { index: number; path: string; address: Address }

/** Address #index of this Vault. #0 works on every pairing; others need `evm.xpub`. */
export function vaultEvmAccount(pairing: VaultPairing, index: number): VaultEvmAccount {
  const evm = pairing.evm;
  if (!evm) throw new Error("Pair this Vault's Ethereum address first.");
  const path = vaultEvmPath(index);
  if (index === 0 && !evm.xpub) return { index, path: evm.path, address: getAddress(evm.address) };
  if (!evm.xpub) throw new Error("Update the Vault pairing to see more Ethereum addresses.");
  return { index, path, address: evmAddressFromAccountXpub(evm.xpub, index) };
}
