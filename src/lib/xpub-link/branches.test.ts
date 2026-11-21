import { afterEach, describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { base64urlnopad } from "@scure/base";
import { chooseDelegateBranch, migrateBranchBook, type BranchBook } from "./branches";
import { validateDelegate } from "./delegate";
import { setEcosystemSites } from "@/lib/web-login-hosts";

const SEEDS = { host: "seeds.honest.money", label: "SEEDS", delegate: true, delegate_modes: ["approve", "access"], delegate_branches: [1106] };
const CHAT = { host: "chat.honest.money", label: "HME Chat", delegate: true, delegate_modes: ["approve"], delegate_branches: [1108, 1109] };

afterEach(() => setEcosystemSites([], true));

function manifest(host: string, account: number, chains = ["TXC", "EVM"]) {
  const paths: Record<string, string> = { TXC: `m/44'/696969'/${account}'`, EVM: `m/44'/60'/${account}'`, BTC: `m/84'/0'/${account}'` };
  return {
    raw: {
      type: "hm-link-delegate",
      challenge_id: "abcdefgh123",
      challenge: "challenge-12345",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      recipient_pubkey: base64urlnopad.encode(x25519.getPublicKey(x25519.utils.randomPrivateKey())),
      submit_url: `https://${host}/api/submit`,
      revoke_url: `https://${host}/api/revoke`,
      request: chains.map((c) => ({ chain: c, path: paths[c] })),
    } as Record<string, unknown>,
    url: `https://${host}/api/public/link/abc`,
  };
}

describe("choosing a trading branch", () => {
  const pick = (requested: number, reserved: number[], book: BranchBook = {}, host = "chat.honest.money") =>
    chooseDelegateBranch({ host, siteName: "HME Chat", requested, reserved, book });

  it("uses the branch honest.money reserved when the site asks for it", () => {
    expect(pick(1108, [1108])).toEqual({ ok: true, account: 1108, reusesRevoked: false });
  });
  it("refuses a branch honest.money did not reserve for the site", () => {
    expect(pick(1108, [1106]).ok).toBe(false);
  });
  it("refuses when honest.money reserved nothing", () => {
    expect(pick(1108, []).ok).toBe(false);
  });
  it("never gives a branch another site already used on this wallet, even after revoke", () => {
    expect(pick(1108, [1108], { "1108": { host: "seeds.honest.money", retired: false } }).ok).toBe(false);
    expect(pick(1108, [1108], { "1108": { host: "seeds.honest.money", retired: true } }).ok).toBe(false);
  });
  it("lets the same site link its own revoked branch again on the same path", () => {
    expect(pick(1108, [1108], { "1108": { host: "chat.honest.money", retired: true } })).toEqual({ ok: true, account: 1108, reusesRevoked: true });
    expect(pick(1108, [1108, 1109], { "1108": { host: "chat.honest.money", retired: true } })).toEqual({ ok: true, account: 1108, reusesRevoked: true });
  });
  it("never reuses a branch an old build retired without recording which site had it", () => {
    expect(pick(1108, [1108], { "1108": { host: "", retired: true } }).ok).toBe(false);
    expect(pick(1108, [1108, 1109], { "1108": { host: "", retired: true } })).toEqual({ ok: true, account: 1109, reusesRevoked: false });
  });
  it("lets the same site re-link on its own live branch", () => {
    expect(pick(1108, [1108], { "1108": { host: "chat.honest.money", retired: false } })).toEqual({ ok: true, account: 1108, reusesRevoked: false });
  });
  it("never hands out the card branch 1107 even if listed", () => {
    expect(pick(1107, [1107]).ok).toBe(false);
  });
});

describe("migrating older wallets", () => {
  it("retires every account below the old counter, skipping the card branch", () => {
    const book = migrateBranchBook({}, 1109, []);
    expect(book).toEqual({ "1106": { host: "", retired: true }, "1108": { host: "", retired: true } });
  });
  it("records existing links as owned by their site", () => {
    expect(migrateBranchBook({}, 1106, [{ host: "seeds.honest.money", account: 1106 }])).toEqual({
      "1106": { host: "seeds.honest.money", retired: false },
    });
  });
  it("is idempotent and never un-retires", () => {
    const once = migrateBranchBook({ "1106": { host: "seeds.honest.money", retired: true } }, 1108, [{ host: "seeds.honest.money", account: 1106 }]);
    expect(migrateBranchBook(once, 1108, [{ host: "seeds.honest.money", account: 1106 }])).toEqual(once);
    expect(once["1106"]).toEqual({ host: "seeds.honest.money", retired: true });
  });
  it("an old build's revoke landing later is still folded in", () => {
    const before = migrateBranchBook({}, 1106, [{ host: "seeds.honest.money", account: 1106 }]);
    expect(migrateBranchBook(before, 1108, [])["1106"]?.retired).toBe(true);
  });
});

describe("trading link codes", () => {
  it("HME Chat asking for its reserved branch 1108 is accepted, with only the modes honest.money allows", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("chat.honest.money", 1108);
    const v = validateDelegate(m.raw, m.url, {});
    expect(v.account).toBe(1108);
    expect(v.modes).toEqual(["approve"]);
  });
  it("HME Chat asking for 1108 is refused while honest.money reserves nothing for it", () => {
    setEcosystemSites([SEEDS, { host: "chat.honest.money", label: "HME Chat", delegate: false, delegate_modes: [], delegate_branches: [] }], true);
    const m = manifest("chat.honest.money", 1108);
    expect(() => validateDelegate(m.raw, m.url, {})).toThrow(/hasn't approved HME Chat/);
  });
  it("SEEDS asking for 1106 still works", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("seeds.honest.money", 1106);
    expect(validateDelegate(m.raw, m.url, {}).account).toBe(1106);
  });
  it("SEEDS re-linking pocket 1106 after a revoke gets 1106 again, Give access only", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("seeds.honest.money", 1106);
    const v = validateDelegate(m.raw, m.url, { "1106": { host: "seeds.honest.money", retired: true } }, []);
    expect(v.account).toBe(1106);
    expect(v.reusesRevoked).toBe(true);
    expect(v.modes).toEqual(["access"]);
  });
  it("a re-link of a revoked pocket is refused when the site may only ask for trade approval", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("chat.honest.money", 1108);
    expect(() => validateDelegate(m.raw, m.url, { "1108": { host: "chat.honest.money", retired: true } }, [])).toThrow(/old keys/);
  });
  it("a site cannot ask for another site's branch", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("seeds.honest.money", 1108);
    expect(() => validateDelegate(m.raw, m.url, {})).toThrow(/reserved 1106/);
  });
  it("refuses different branches on different chains", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    const m = manifest("chat.honest.money", 1108);
    (m.raw.request as { chain: string; path: string }[])[1]!.path = "m/44'/60'/1109'";
    expect(() => validateDelegate(m.raw, m.url, {})).toThrow(/different branches/);
  });
  it("refuses deeper or main-wallet paths", () => {
    setEcosystemSites([SEEDS, CHAT], true);
    for (const path of ["m/44'/696969'/1108'/0", "m/44'/696969'/0'", "m/44'/60'/1108'"]) {
      const m = manifest("chat.honest.money", 1108, ["TXC"]);
      (m.raw.request as { path: string }[])[0]!.path = path;
      expect(() => validateDelegate(m.raw, m.url, {})).toThrow();
    }
  });
});
