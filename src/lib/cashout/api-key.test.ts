import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nectar/link", () => ({
  canonicalJson: (v: unknown) => JSON.stringify(v),
  deriveWalletKeys: async () => ({ xpubs: { TXC: "xpub-test" } }),
}));
vi.mock("@/lib/txc/message-sign", () => ({
  signMessageWithSeed: async () => ({ signature: "sig", address: "TaddrIdentity" }),
}));

import {
  CASHOUT_KEY_BASE,
  CASHOUT_KEY_MIGRATED_MARKER,
  bindCashoutKey,
  cashoutBindingHolds,
  cashoutKeyFingerprint,
  getCashoutApiKey,
  migrateLegacyCashoutKey,
  setCashoutApiKey,
} from "./api-key";
import { removeTsdLink, saveTsdLink, submitTsdLink, tsdLinkRemovalClearsKey } from "@/lib/rewards/tsd-link";
import { deleteProfileWallet } from "@/lib/txc/storage";

const KEY_A = "tsd_live_AAAAAAAAAAAAAAAAAAAA";
const KEY_B = "tsd_live_BBBBBBBBBBBBBBBBBBBB";
const KEY_OLD_BUILD = "tsd_live_OLDBUILDOLDBUILDOLD";
const PROFILES = JSON.stringify([
  { id: "default", createdAt: 0 },
  { id: "pr_b", createdAt: 2 },
  { id: "pr_c", createdAt: 3 },
]);

let store: Map<string, string>;
let failWritesTo: string | null;

function fakeStorage(): Storage {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === failWritesTo) throw new Error("quota");
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
  } as Storage;
}

function setActive(id: string) {
  if (id === "default") store.delete("hme.profile.active.v1");
  else store.set("hme.profile.active.v1", id);
}

function link(accountId: string, linkedAt: string, keyFp?: string | null) {
  return { accountId, accountName: accountId, identity: "tsd.honest.money", linkedAt, ...(keyFp !== undefined ? { keyFp } : {}) };
}

beforeEach(() => {
  store = new Map();
  failWritesTo = null;
  const ls = fakeStorage();
  Object.assign(globalThis, {
    window: { localStorage: ls, dispatchEvent: () => true },
    localStorage: ls,
  });
  store.set("hme.profiles.v1", PROFILES);
});

/** Fresh install of the new build: nothing to migrate. */
function migrated() {
  store.set(CASHOUT_KEY_MIGRATED_MARKER, "1");
}

describe("per-wallet cash-out key", () => {
  it("a key saved on wallet A is not returned for wallet B", () => {
    migrated();
    setCashoutApiKey(KEY_A, "default");
    expect(getCashoutApiKey("default")).toBe(KEY_A);
    expect(getCashoutApiKey("pr_b")).toBeNull();
  });

  it("switching the active wallet changes the returned key", () => {
    migrated();
    setCashoutApiKey(KEY_A, "default");
    setCashoutApiKey(KEY_B, "pr_b");
    setActive("default");
    expect(getCashoutApiKey()).toBe(KEY_A);
    setActive("pr_b");
    expect(getCashoutApiKey()).toBe(KEY_B);
    setActive("pr_c");
    expect(getCashoutApiKey()).toBeNull();
  });

  it("a link claim stores the key on the wallet that started it, even after a mid-claim switch", async () => {
    migrated();
    setActive("pr_b");
    vi.stubGlobal("fetch", async () => {
      setActive("pr_c"); // user switches wallets while the claim is in flight
      return new Response(JSON.stringify({ api_key: KEY_B, account_id: "acct-1" }), { status: 200 });
    });
    const res = await submitTsdLink({
      manifest: {
        v: 1,
        type: "hm-link-xpubs",
        challenge_id: "c1",
        from: "tsd.honest.money",
        callback_url: "https://tsd.honest.money/cb",
        manifest_url: "https://tsd.honest.money/m",
        chains: ["TXC"],
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      mnemonic: "test",
      profileId: "pr_b",
    });
    vi.unstubAllGlobals();
    expect(getCashoutApiKey("pr_b")).toBe(KEY_B);
    expect(getCashoutApiKey("pr_c")).toBeNull();
    expect(getCashoutApiKey("default")).toBeNull();
    expect(res.api_key_fp).toBe(cashoutKeyFingerprint(KEY_B));
    expect(res.api_key_fp).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("one-time migration of the old device-wide key", () => {
  it("no link records: the first wallet keeps it, others get none, marker set", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    expect(migrateLegacyCashoutKey()).toBe("kept-default");
    expect(getCashoutApiKey("default")).toBe(KEY_A);
    expect(getCashoutApiKey("pr_b")).toBeNull();
    expect(getCashoutApiKey("pr_c")).toBeNull();
    expect(store.get(CASHOUT_KEY_MIGRATED_MARKER)).toBe("1");
  });

  it("moves the key to the wallet with the newest link and removes the shared copy", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-default", "2026-10-01T10:00:00.000Z"), "default");
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    expect(migrateLegacyCashoutKey()).toBe("moved");
    expect(store.get(`p:pr_b:${CASHOUT_KEY_BASE}`)).toBe(KEY_A);
    expect(store.has(CASHOUT_KEY_BASE)).toBe(false);
    expect(getCashoutApiKey("default")).toBeNull();
    expect(getCashoutApiKey("pr_c")).toBeNull();
  });

  it("two wallets linked in the same second: the first wallet keeps it", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.100Z"), "pr_b");
    saveTsdLink(link("acct-c", "2026-11-01T10:00:00.900Z"), "pr_c");
    expect(migrateLegacyCashoutKey()).toBe("kept-default");
    expect(getCashoutApiKey("default")).toBe(KEY_A);
    expect(getCashoutApiKey("pr_b")).toBeNull();
    expect(getCashoutApiKey("pr_c")).toBeNull();
  });

  it("an unreadable link date: the first wallet keeps it", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    saveTsdLink(link("acct-c", "not a date"), "pr_c");
    expect(migrateLegacyCashoutKey()).toBe("kept-default");
    expect(getCashoutApiKey("default")).toBe(KEY_A);
    expect(getCashoutApiKey("pr_b")).toBeNull();
  });

  it("copy then verify: a failed write leaves the shared key in place and retries next time", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    failWritesTo = `p:pr_b:${CASHOUT_KEY_BASE}`;
    expect(migrateLegacyCashoutKey()).toBe("failed");
    expect(store.get(CASHOUT_KEY_BASE)).toBe(KEY_A);
    expect(store.has(CASHOUT_KEY_MIGRATED_MARKER)).toBe(false);
    failWritesTo = null;
    expect(migrateLegacyCashoutKey()).toBe("moved");
    expect(getCashoutApiKey("pr_b")).toBe(KEY_A);
    expect(store.has(CASHOUT_KEY_BASE)).toBe(false);
  });

  it("never touches wallets, the wallet list or the active wallet", () => {
    const untouched = {
      "hme.wallet.v1": "encrypted-default",
      "p:pr_b:hme.wallet.v1": "encrypted-b",
      "hme.profiles.v1": PROFILES,
      "hme.profile.active.v1": "pr_c",
    };
    for (const [k, v] of Object.entries(untouched)) store.set(k, v);
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    migrateLegacyCashoutKey();
    for (const [k, v] of Object.entries(untouched)) expect(store.get(k)).toBe(v);
  });

  it("a shared key written later by an old phone app or extension stays with the first wallet", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    expect(migrateLegacyCashoutKey()).toBe("moved");
    store.set(CASHOUT_KEY_BASE, KEY_OLD_BUILD); // old build links again
    saveTsdLink(link("acct-b2", "2026-11-12T10:00:00.000Z"), "pr_b");
    expect(migrateLegacyCashoutKey()).toBe("already-done");
    expect(getCashoutApiKey("default")).toBe(KEY_OLD_BUILD);
    expect(getCashoutApiKey("pr_b")).toBe(KEY_A);
  });
});

describe("removing links and wallets", () => {
  it("removing wallet B deletes its key; removing the first wallet deletes the first wallet's key", () => {
    migrated();
    setCashoutApiKey(KEY_A, "default");
    setCashoutApiKey(KEY_B, "pr_b");
    deleteProfileWallet("pr_b");
    expect(store.has(`p:pr_b:${CASHOUT_KEY_BASE}`)).toBe(false);
    expect(getCashoutApiKey("default")).toBe(KEY_A);
    deleteProfileWallet("default");
    expect(store.has(CASHOUT_KEY_BASE)).toBe(false);
  });

  it("removing the owner wallet before any migration takes the old shared key with it", () => {
    store.set(CASHOUT_KEY_BASE, KEY_A);
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z"), "pr_b");
    deleteProfileWallet("pr_b");
    expect(getCashoutApiKey("default")).toBeNull();
    expect([...store.values()]).not.toContain(KEY_A);
  });

  it("forgetting the link that issued the key removes the key", () => {
    migrated();
    setCashoutApiKey(KEY_B, "pr_b");
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z", cashoutKeyFingerprint(KEY_B)), "pr_b");
    expect(tsdLinkRemovalClearsKey("acct-b", "pr_b")).toBe(true);
    expect(removeTsdLink("acct-b", "pr_b")).toEqual({ keyCleared: true });
    expect(getCashoutApiKey("pr_b")).toBeNull();
  });

  it("a key pasted over the issued one survives forgetting the link", () => {
    migrated();
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z", cashoutKeyFingerprint(KEY_A)), "pr_b");
    setCashoutApiKey(KEY_B, "pr_b");
    expect(removeTsdLink("acct-b", "pr_b")).toEqual({ keyCleared: false });
    expect(getCashoutApiKey("pr_b")).toBe(KEY_B);
  });

  it("a link that issued no key never removes one", () => {
    migrated();
    setCashoutApiKey(KEY_B, "pr_b");
    saveTsdLink(link("acct-b", "2026-11-01T10:00:00.000Z", null), "pr_b");
    expect(removeTsdLink("acct-b", "pr_b")).toEqual({ keyCleared: false });
    expect(getCashoutApiKey("pr_b")).toBe(KEY_B);
  });

  it("an older link record (no fingerprint) removes the key only when it is the last link", () => {
    migrated();
    setCashoutApiKey(KEY_B, "pr_b");
    saveTsdLink(link("acct-1", "2026-10-01T10:00:00.000Z"), "pr_b");
    saveTsdLink(link("acct-2", "2026-10-02T10:00:00.000Z"), "pr_b");
    expect(removeTsdLink("acct-1", "pr_b")).toEqual({ keyCleared: false });
    expect(getCashoutApiKey("pr_b")).toBe(KEY_B);
    expect(removeTsdLink("acct-2", "pr_b")).toEqual({ keyCleared: true });
    expect(getCashoutApiKey("pr_b")).toBeNull();
  });

  it("a hand-pasted key on wallet B survives removing wallet A's link", () => {
    migrated();
    setCashoutApiKey(KEY_A, "default");
    saveTsdLink(link("acct-a", "2026-11-01T10:00:00.000Z", cashoutKeyFingerprint(KEY_A)), "default");
    setCashoutApiKey(KEY_B, "pr_b"); // pasted by hand, no link records on B
    expect(removeTsdLink("acct-a", "default")).toEqual({ keyCleared: true });
    expect(getCashoutApiKey("default")).toBeNull();
    expect(getCashoutApiKey("pr_b")).toBe(KEY_B);
  });
});

describe("cash-out submission binding", () => {
  it("refuses when the active wallet changed after the order was created", () => {
    migrated();
    setCashoutApiKey(KEY_B, "pr_b");
    setCashoutApiKey(KEY_A, "pr_c");
    setActive("pr_b");
    const binding = bindCashoutKey(KEY_B)!;
    expect(binding).toEqual({ profileId: "pr_b", keyFp: cashoutKeyFingerprint(KEY_B) });
    expect(cashoutBindingHolds(binding)).toBe(true);
    setActive("pr_c");
    expect(cashoutBindingHolds(binding)).toBe(false);
  });

  it("refuses when the wallet's key was replaced or removed after the order was created", () => {
    migrated();
    setActive("pr_b");
    setCashoutApiKey(KEY_B, "pr_b");
    const binding = bindCashoutKey(KEY_B)!;
    setCashoutApiKey(KEY_A, "pr_b");
    expect(cashoutBindingHolds(binding)).toBe(false);
    setCashoutApiKey(null, "pr_b");
    expect(cashoutBindingHolds(binding)).toBe(false);
  });

  it("will not create an order with a key that isn't the open wallet's", () => {
    migrated();
    setCashoutApiKey(KEY_A, "default");
    setActive("pr_b");
    expect(bindCashoutKey(KEY_A)).toBeNull();
  });
});
