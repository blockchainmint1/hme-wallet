/**
 * View-only pocket addresses for Seeds' extra coins (desktop Seeds Pocket).
 * One receive address per coin, exactly as Seeds derives it from the keys
 * the wallet shared: secp256k1 coins at account/0/0, SOL = the account key
 * itself, ADA = Icarus base address (payment /0/0, stake /2/0), XMR = primary
 * address. Pinned to Seeds' own vectors in extra-addresses.test.ts.
 * No keys are shown, exported or used for spending here.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { ed25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { base58, base58xrp, bech32, createBase58check } from "@scure/base";
import { cardanoAccountKey, extraAccountPath, moneroAccountKey, slip10Ed25519, type ExtraChain } from "@/lib/xpub-link/delegate-keys";

const bip32 = BIP32Factory(ecc);
const b58c = createBase58check(sha256);
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

function p2pkh(version: number[], pub: Uint8Array): string {
  return b58c.encode(cat(Uint8Array.from(version), hash160(pub)));
}

export function cashAddrP2PKH(hash: Uint8Array): string {
  const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l", PREFIX = "bitcoincash";
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  const payload: number[] = [];
  let acc = 0, bits = 0;
  for (const byte of [0, ...hash]) {
    acc = ((acc << 8) | byte) & 0xfff; bits += 8;
    while (bits >= 5) { bits -= 5; payload.push((acc >>> bits) & 31); }
  }
  if (bits > 0) payload.push((acc << (5 - bits)) & 31);
  let chk = 1n;
  for (const v of [...Array.from(PREFIX, (c) => c.charCodeAt(0) & 31), 0, ...payload, ...Array<number>(8).fill(0)]) {
    const top = chk >> 35n;
    chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(v);
    for (const [i, g] of GEN.entries()) if ((top & (1n << BigInt(i))) !== 0n) chk ^= g;
  }
  chk ^= 1n;
  const out = [...payload];
  for (let i = 7; i >= 0; i--) out.push(Number((chk >> BigInt(5 * i)) & 31n));
  return `${PREFIX}:${out.map((v) => ALPHABET[v]).join("")}`;
}

function xrpAddress(pub: Uint8Array): string {
  const body = cat(Uint8Array.of(0), hash160(pub));
  return base58xrp.encode(cat(body, sha256(sha256(body)).slice(0, 4)));
}

function tronAddress(pub: Uint8Array): string {
  const unc = ecc.pointCompress(pub, false).slice(1);
  return b58c.encode(cat(Uint8Array.of(0x41), keccak_256(unc).slice(-20)));
}

/* Cardano soft public child (BIP32-Ed25519): A_i = A + 8·ZL·G. */
const N = ed25519.CURVE.n;
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const leToBig = (b: Uint8Array) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!); return n; };
function softPublicChild(xpub: Uint8Array, index: number): Uint8Array {
  const A = xpub.slice(0, 32), cc = xpub.slice(32, 64), idx = le32(index);
  const Z = hmac(sha512, cc, cat(Uint8Array.of(0x02), A, idx));
  const I = hmac(sha512, cc, cat(Uint8Array.of(0x03), A, idx));
  const zl8 = (leToBig(Z.slice(0, 28)) * 8n) % N;
  const child = ed25519.ExtendedPoint.fromHex(A).add(ed25519.ExtendedPoint.BASE.multiply(zl8 === 0n ? N : zl8));
  return cat(child.toRawBytes(), I.slice(32, 64));
}
export function cardanoBaseAddress(accountXpub: Uint8Array): string {
  const pay = softPublicChild(softPublicChild(accountXpub, 0), 0).slice(0, 32);
  const stake = softPublicChild(softPublicChild(accountXpub, 2), 0).slice(0, 32);
  const bytes = cat(Uint8Array.of(0x01), blake2b(pay, { dkLen: 28 }), blake2b(stake, { dkLen: 28 }));
  return bech32.encode("addr", bech32.toWords(bytes), 200);
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** Seeds' receive address for one extra coin at this pocket branch. */
export function extraPocketAddress(args: { chain: ExtraChain; account: number; seed: Uint8Array; mnemonic: string; passphrase: string }): string {
  const { chain, account, seed, mnemonic, passphrase } = args;
  if (chain === "XMR") return moneroAccountKey(seed, account).address;
  if (chain === "SOL") {
    const k = slip10Ed25519(seed, extraAccountPath("SOL", account));
    try { return base58.encode(ed25519.getPublicKey(k)); } finally { k.fill(0); }
  }
  if (chain === "ADA") {
    const k = cardanoAccountKey(mnemonic, passphrase, account);
    return cardanoBaseAddress(fromHex(k.pub));
  }
  const pub = bip32.fromSeed(seed).derivePath(extraAccountPath(chain, account)).derive(0).derive(0).publicKey;
  switch (chain) {
    case "DOGE": return p2pkh([30], pub);
    case "ZEC": return p2pkh([0x1c, 0xb8], pub);
    case "DASH": return p2pkh([76], pub);
    case "BCH": return cashAddrP2PKH(hash160(pub));
    case "XRP": return xrpAddress(pub);
    case "TRX": return tronAddress(pub);
    case "ATOM": return bech32.encode("cosmos", bech32.toWords(hash160(pub)));
    case "RUNE": return bech32.encode("thor", bech32.toWords(hash160(pub)));
  }
}

/** Public explorer page for an extra coin's address; Monero has none (balances are private). */
export function extraExplorerUrl(chain: ExtraChain, address: string): string | null {
  const a = encodeURIComponent(address);
  switch (chain) {
    case "DOGE": return `https://blockchair.com/dogecoin/address/${a}`;
    case "BCH": return `https://blockchair.com/bitcoin-cash/address/${a}`;
    case "DASH": return `https://blockchair.com/dash/address/${a}`;
    case "ZEC": return `https://blockchair.com/zcash/address/${a}`;
    case "XRP": return `https://xrpscan.com/account/${a}`;
    case "TRX": return `https://tronscan.org/#/address/${a}`;
    case "SOL": return `https://solscan.io/account/${a}`;
    case "ATOM": return `https://www.mintscan.io/cosmos/address/${a}`;
    case "RUNE": return `https://runescan.io/address/${a}`;
    case "ADA": return `https://cardanoscan.io/address/${a}`;
    case "XMR": return null;
  }
}

/** Display units per coin (balances come back as whole-unit integers). */
export const EXTRA_DECIMALS: Record<ExtraChain, number> = {
  DOGE: 8, BCH: 8, DASH: 8, ZEC: 8, XRP: 6, TRX: 6, SOL: 9, ATOM: 6, RUNE: 8, ADA: 6, XMR: 12,
};
