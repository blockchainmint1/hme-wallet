/**
 * Seeds' Stellar/TON/Sui pocket keys: Seeds' published test vectors
 * (docs/hme-wallet-extra-pockets.md, Nov 25 2026) and the release gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { hex, base64urlnopad } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";

const SEEDS = { host: "seeds.honest.money", label: "SEEDS", delegate: true, delegate_modes: ["approve", "access"] as ("approve" | "access")[], delegate_branches: [1106] };
vi.mock("@/lib/ecosystem-sites.functions", () => ({ getEcosystemSites: async () => ({ sites: [SEEDS], verified: true }) }));
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    dispatchEvent: () => true,
  });
});
afterEach(() => vi.unstubAllGlobals());

const { deriveExtraKey, isLinkExtraChain, extraAccountOf } = await import("./delegate-keys");
const { HOLD_FORMAT, SEEDS_HOLD_COINS_LIVE, tonAddress } = await import("./hold-coins");
const { validateDelegate } = await import("./delegate");
const { setEcosystemSites } = await import("@/lib/web-login-hosts");
const { validateRelayPost } = await import("@/lib/security/relay-policy");

const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed = mnemonicToSeedSync(WORDS);
const key = (chain: "XLM" | "TON" | "SUI") => deriveExtraKey({ chain, account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: true });

describe("Seeds Stellar / TON / Sui keys (pocket 1106)", () => {
  it("Stellar: G… address matches Seeds' vector", () => {
    const k = key("XLM");
    expect(k.path).toBe("m/44'/148'/1106'");
    expect(k.pub).toBe("GARWV2LPPTIXJYVWMINIZHNKNUCR3FDVANOPTZXGYV3765UZKSHWV5AI");
  });
  it("TON: lowercase hex key whose W5 address matches Seeds' vector", () => {
    const k = key("TON");
    expect(k.path).toBe("m/44'/607'/1106'");
    expect(k.pub).toMatch(/^[0-9a-f]{64}$/);
    expect(tonAddress(hex.decode(k.pub))).toBe("UQCsq4rzqzuJvOOkCj00SPdMru6-SHmeDuGf2_ecmdjlNwcm");
  });
  it("Sui: 0x address matches Seeds' vector", () => {
    const k = key("SUI");
    expect(k.path).toBe("m/44'/784'/1106'/0'/0'");
    expect(k.pub).toBe("0xc103715616f6451c7d969ef90d20d1016924dad27e9c36cd3c1bd5ee5c36b8a1");
  });
  it("private halves are lowercase hex and produce the public halves", () => {
    for (const c of ["XLM", "TON", "SUI"] as const) {
      const k = key(c);
      expect(k.priv).toMatch(/^[0-9a-f]{64}$/);
      const again = deriveExtraKey({ chain: c, account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: false });
      expect(again.pub).toBe(k.pub);
      expect(hex.encode(ed25519.getPublicKey(hex.decode(k.priv!))).length).toBe(64);
    }
  });
  it("accepts only each coin's exact pocket path", () => {
    expect(extraAccountOf("SUI", "m/44'/784'/1106'/0'/0'")).toBe(1106);
    expect(extraAccountOf("SUI", "m/44'/784'/1106'")).toBeNull();
    expect(extraAccountOf("XLM", "m/44'/148'/1106'/0'")).toBeNull();
  });
});

describe("release gate: Seeds is live (Nov 25 2026)", () => {
  it("is on in this build", () => expect(SEEDS_HOLD_COINS_LIVE).toBe(true));
  it("the link reader takes Stellar, TON and Sui, and still skips them when held", () => {
    setEcosystemSites([SEEDS], true);
    expect(isLinkExtraChain("XLM", false)).toBe(false);
    expect(isLinkExtraChain("XLM", true)).toBe(true);
    const host = "seeds.honest.money";
    const raw = {
      type: "hm-link-delegate", challenge_id: "abcdefgh123", challenge: "challenge-12345",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      recipient_pubkey: base64urlnopad.encode(x25519.getPublicKey(x25519.utils.randomPrivateKey())),
      submit_url: `https://${host}/api/public/hme-link/submit`, revoke_url: `https://${host}/api/public/hme-link/revoke`,
      request: [{ chain: "TXC", path: "m/44'/696969'/1106'" }],
      request_optional: [
        { chain: "DOGE", path: "m/44'/3'/1106'", format: "bip32" },
        { chain: "XLM", path: "m/44'/148'/1106'", format: HOLD_FORMAT.XLM },
        { chain: "TON", path: "m/44'/607'/1106'", format: HOLD_FORMAT.TON },
        { chain: "SUI", path: "m/44'/784'/1106'/0'/0'", format: HOLD_FORMAT.SUI },
      ],
    };
    const v = validateDelegate(raw, `https://${host}/api/public/hme-link/manifest/abc`, {});
    expect(v.extraChains).toEqual(["DOGE", "XLM", "TON", "SUI"]);
  });
  it("the relay takes Stellar, TON and Sui keys, and still refuses unknown coins", () => {
    const target = new URL("https://seeds.honest.money/api/public/hme-link/submit");
    const base = { token: "t", mode: "access", account: 1106, paths: ["m/44'/696969'/1106'"], identity_address: "T".repeat(34), signature: "A".repeat(88), message: "Honest Money - Link wallet (delegate)\n\nDomain: seeds.honest.money", xpubs: { TXC: "x".repeat(40) }, app_name: "honest.money wallet", app: { name: "honest.money wallet" } };
    expect(() => validateRelayPost({ ...base, paths: [...base.paths, "m/44'/148'/1106'", "m/44'/607'/1106'", "m/44'/784'/1106'/0'/0'"], xpubs: { ...base.xpubs, XLM: "GARWV2LPPTIXJYVWMINIZHNKNUCR3FDVANOPTZXGYV3765UZKSHWV5AI", TON: "a".repeat(64), SUI: "0xc103715616f6451c7d969ef90d20d1016924dad27e9c36cd3c1bd5ee5c36b8a1" } }, target)).not.toThrow();
    expect(() => validateRelayPost({ ...base, xpubs: { ...base.xpubs, FOO: "x".repeat(40) } }, target)).toThrow();
  });
});
