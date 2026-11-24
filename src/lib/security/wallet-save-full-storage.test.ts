import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWallet } from "@/lib/txc/storage";
import { StorageFullError } from "@/lib/storage/safe-set";

class Mem implements Storage {
  m = new Map<string, string>(); constructor(public cap: number) {}
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  setItem(k: string, v: string) {
    const used = [...this.m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > this.cap) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
}

describe("saving a wallet into full storage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("throws and leaves no entry in the profile list", async () => {
    const s = new Mem(50);
    vi.stubGlobal("localStorage", s);
    vi.stubGlobal("window", { localStorage: s, dispatchEvent: () => true });
    await expect(saveWallet({ mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", passphrase: "", kind: "bip44", label: "Main", mode: "seed" }, "Safety words 8294!")).rejects.toBeInstanceOf(StorageFullError);
    expect(s.getItem("hme.profiles.v1")).toBeNull();
    expect(s.length).toBe(0);
  });
});
