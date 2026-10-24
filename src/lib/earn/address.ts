import type { BIP32Interface } from "bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { publicKeyToAddress } from "viem/accounts";

/** Display derives only a public address; no account/private-key object retained. */
export function earnAddress(root: BIP32Interface) {
  const compressed = root.derivePath("m/44'/60'/0'/0/0").publicKey;
  const publicKey = secp256k1.ProjectivePoint.fromHex(compressed).toRawBytes(false);
  return publicKeyToAddress(`0x${Array.from(publicKey, b => b.toString(16).padStart(2, "0")).join("")}`);
}