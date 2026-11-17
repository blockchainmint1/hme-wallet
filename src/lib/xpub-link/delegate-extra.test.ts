/**
 * Seeds' extra coins in a trading link: parsed from `request_optional`,
 * shared only in "access" (spend) links, at the same branch, and the sealed
 * private halves match the public halves exactly like Seeds checks them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { ed25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64url, base64urlnopad } from "@scure/base";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";

const SEEDS = { host: "seeds.honest.money", label: "SEEDS", delegate: true, delegate_modes: ["approve", "access"] as ("approve" | "access")[], delegate_branches: [1106] };
vi.mock("@/lib/ecosystem-sites.functions", () => ({ getEcosystemSites: async () => ({ sites: [SEEDS] }) }));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const { validateDelegate, submitDelegate } = await import("./delegate");
const { setEcosystemSites } = await import("@/lib/web-login-hosts");
const bip32 = BIP32Factory(ecc);
const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const CORE: Record<string, string> = {
  TXC: "m/44'/696969'/1106'",
  ISK: "m/44'/969696'/1106'",
  BTC: "m/84'/0'/1106'",
  LTC: "m/44'/2'/1106'",
  EVM: "m/44'/60'/1106'",
};
const EXTRA: Record<string, string> = {
  DOGE: "m/44'/3'/1106'",
  BCH: "m/44'/145'/1106'",
  DASH: "m/44'/5'/1106'",
  TRX: "m/44'/195'/1106'",
  SOL: "m/44'/501'/1106'/0'",
  ZEC: "m/44'/133'/1106'",
  XRP: "m/44'/144'/1106'",
  ATOM: "m/44'/118'/1106'",
  RUNE: "m/44'/931'/1106'",
  ADA: "m/1852'/1815'/1106'",
};

function seedsManifest(recipientPriv: Uint8Array, optional: Record<string, string> = EXTRA) {
  const host = "seeds.honest.money";
  return {
    raw: {
      type: "hm-link-delegate",
      challenge_id: "abcdefgh123",
      challenge: "challenge-12345",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      recipient_pubkey: base64urlnopad.encode(x25519.getPublicKey(recipientPriv)),
      submit_url: `https://${host}/api/public/hme-link/submit`,
      revoke_url: `https://${host}/api/public/hme-link/revoke`,
      request: Object.entries(CORE).map(([chain, path]) => ({ chain, path })),
      request_optional: [
        ...Object.entries(optional).map(([chain, path]) => ({ chain, path })),
        { chain: "FOO", path: "m/44'/9999'/1106'" },
      ],
    } as Record<string, unknown>,
    url: `https://${host}/api/public/hme-link/manifest/abc`,
  };
}

/** Same opening steps as Seeds' openSealed (src/lib/hme-link.server.ts). */
function openSealed(payload: string, recipientPriv: Uint8Array): Record<string, string> {
  const raw = base64url.decode(payload);
  const eph = raw.slice(0, 32);
  const nonce = raw.slice(32, 44);
  const shared = x25519.getSharedSecret(recipientPriv, eph);
  const salt = new Uint8Array(64);
  salt.set(eph, 0);
  salt.set(x25519.getPublicKey(recipientPriv), 32);
  const key = hkdf(sha256, shared, salt, new TextEncoder().encode("hm-link-delegate v1"), 32);
  return JSON.parse(new TextDecoder().decode(gcm(key, nonce).decrypt(raw.slice(44))));
}

function captureSubmit() {
  const sent: { body?: Record<string, unknown> } = {};
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ link_id: "link-1", linked_to: "Seeds Exchange" }), { status: 200 });
  });
  return sent;
}

describe("Seeds extra coins in a trading link", () => {
  it("reads every extra coin Seeds lists and skips coins it can't make keys for", () => {
    setEcosystemSites([SEEDS], true);
    const m = seedsManifest(x25519.utils.randomPrivateKey());
    const v = validateDelegate(m.raw, m.url, {});
    expect(v.chains).toEqual(["TXC", "ISK", "BTC", "LTC", "EVM"]);
    expect(v.extraChains).toEqual(["DOGE", "BCH", "DASH", "TRX", "SOL", "ZEC", "XRP", "ATOM", "RUNE", "ADA"]);
    expect(v.modes).toEqual(["approve", "access"]);
  });

  it("refuses an extra coin on the savings account or another branch", () => {
    setEcosystemSites([SEEDS], true);
    for (const path of ["m/44'/3'/0'", "m/44'/3'/1107'", "m/44'/3'/1106'/0/0", "m/44'/501'/1106'"]) {
      const m = seedsManifest(x25519.utils.randomPrivateKey(), { [path.includes("501") ? "SOL" : "DOGE"]: path });
      expect(() => validateDelegate(m.raw, m.url, {}), path).toThrow();
    }
  });

  it("offers only spend access when a required coin can't be approved in the wallet", () => {
    setEcosystemSites([SEEDS], true);
    const m = seedsManifest(x25519.utils.randomPrivateKey(), {});
    (m.raw.request as { chain: string; path: string }[]).push({ chain: "DOGE", path: EXTRA.DOGE! });
    expect(validateDelegate(m.raw, m.url, {}).modes).toEqual(["access"]);
  });

  it("spend access sends all 15 keys at branch 1106, signed and sealed, each private half matching", async () => {
    setEcosystemSites([SEEDS], true);
    const priv = x25519.utils.randomPrivateKey();
    const m = seedsManifest(priv);
    const manifest = validateDelegate(m.raw, m.url, {});
    const sent = captureSubmit();
    const rec = await submitDelegate({ manifest, mode: "access", mnemonic: WORDS });
    const body = sent.body!;
    const paths = body["paths"] as string[];
    expect(paths).toEqual([...Object.values(CORE), ...Object.values(EXTRA)]);
    for (const p of paths) expect(p).toMatch(/^m\/\d+'\/\d+'\/1106'(\/0')?$/);
    expect(String(body["message"])).toContain(`Paths: ${paths.join(",")}`);
    expect(String(body["message"])).toContain("I authorize this site to spend from these branches until I revoke.");
    const xpubs = body["xpubs"] as Record<string, string>;
    const xprvs = openSealed(String(body["payload"]), priv);
    expect(Object.keys(xprvs).sort()).toEqual([...Object.keys(CORE), ...Object.keys(EXTRA)].sort());
    for (const c of ["DOGE", "BCH", "DASH", "TRX", "ZEC", "XRP", "ATOM", "RUNE"]) {
      expect(bip32.fromBase58(xprvs[c]!).neutered().toBase58(), c).toBe(xpubs[c]);
    }
    expect(base58.encode(ed25519.getPublicKey(Uint8Array.from(Buffer.from(xprvs.SOL!, "hex"))))).toBe(xpubs.SOL);
    expect(xpubs.SOL).toBe("DXTivYcF78Vznitg6f8JGXouZwsm3xioik1LGWj2H1jV");
    expect(xprvs.ADA).toHaveLength(192);
    expect(xpubs.ADA!.slice(64)).toBe(xprvs.ADA!.slice(128));
    expect(rec.extraChains).toEqual(Object.keys(EXTRA));
  });

  it("approve-every-trade never sends extra coins or any private key", async () => {
    setEcosystemSites([SEEDS], true);
    const m = seedsManifest(x25519.utils.randomPrivateKey());
    const manifest = validateDelegate(m.raw, m.url, {});
    const sent = captureSubmit();
    const rec = await submitDelegate({ manifest, mode: "approve", mnemonic: WORDS });
    expect(sent.body!["paths"]).toEqual(Object.values(CORE));
    expect(Object.keys(sent.body!["xpubs"] as object)).toEqual(Object.keys(CORE));
    expect(sent.body!["payload"]).toBeUndefined();
    expect(rec.extraChains).toBeUndefined();
  });
});
