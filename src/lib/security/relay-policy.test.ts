import { describe, expect, it } from "vitest";
import { DELEGATE_RELAY_CHAINS, validateRelayPost } from "./relay-policy";
import { EXTRA_CHAINS } from "@/lib/xpub-link/delegate-keys";
import { POCKET_CHAINS } from "@/lib/seeds/pocket";
describe("partner relay schema", () => {
  const target = new URL("https://example.com/api/login");
  it("rejects arbitrary exfiltration bodies", () => expect(() => validateRelayPost({ seed: "secret" }, target)).toThrow());
  it("rejects unexpected additional fields", () => expect(() => validateRelayPost({ id: "a", address: "T".repeat(34), signature: "A".repeat(88), message: "fake", password: "secret" }, target)).toThrow());
  it("preserves domain-bound TXC sign-in protocol", () => {
    const input = { id: "abc", address: "T".repeat(34), signature: "A".repeat(88), message: "example.com wants you to sign in with your TXC wallet.\n\nNonce: abcdefghijklmnop\nIssued At: 2026-10-20T11:40:00Z\nBy signing, you authorize a sign-in session for Example.\nThis signature does not authorize any payment." };
    expect(validateRelayPost(input, target)).toEqual(input);
  });
  it("passes exactly the trading-pocket coins plus the wallet's fixed extra-coin list", () => {
    expect([...DELEGATE_RELAY_CHAINS].sort()).toEqual([...POCKET_CHAINS, ...EXTRA_CHAINS].sort());
  });
  it("still refuses a trading-link key for a coin outside that list", () => {
    const target = new URL("https://seeds.honest.money/api/public/hme-link/submit");
    const base = { token: "t", mode: "access", account: 1106, paths: ["m/44'/696969'/1106'"], identity_address: "T".repeat(34), signature: "A".repeat(88), message: "Honest Money - Link wallet (delegate)\n\nDomain: seeds.honest.money", xpubs: { TXC: "x".repeat(40) }, app_name: "honest.money wallet", app: { name: "honest.money wallet" } };
    expect(() => validateRelayPost(base, target)).not.toThrow();
    expect(() => validateRelayPost({ ...base, xpubs: { ...base.xpubs, FOO: "x".repeat(40) } }, target)).toThrow();
    expect(() => validateRelayPost({ ...base, paths: ["m/0'/1'/2'/3'/4'"] }, target)).toThrow();
  });
});
