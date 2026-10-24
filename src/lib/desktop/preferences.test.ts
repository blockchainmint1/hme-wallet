import { beforeEach, describe, expect, it } from "vitest";
import { CHAIN_ORDER, getChainPrefs, setChainEnabled } from "../chain-prefs";
import { isFeatureEnabled, setFeatureEnabled, type FeatureId } from "../feature-prefs";
import { setActiveProfileId } from "../profiles";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  Object.assign(globalThis, { localStorage: storage, window: { localStorage: storage, dispatchEvent: () => true } });
});
describe("separate desktop defaults", () => {
  it("enables all 11 supported desktop networks without enabling phone networks", () => {
    expect(CHAIN_ORDER).toHaveLength(11);
    for (const id of CHAIN_ORDER) expect(getChainPrefs("desktop")[id]).toBe(true);
    expect(getChainPrefs().doge).toBe(false);
    expect(getChainPrefs().txc).toBe(true);
    expect(store.size).toBe(0);
  });
  it("keeps explicit desktop network opt-outs separate from saved phone values", () => {
    store.set("hme.chains.enabled.v1", JSON.stringify({ doge: false, btc: true }));
    const savedPhone = store.get("hme.chains.enabled.v1");
    setChainEnabled("doge", false, "desktop");
    expect(getChainPrefs("desktop").doge).toBe(false);
    expect(getChainPrefs("desktop").ltc).toBe(true);
    expect(store.get("hme.chains.enabled.v1")).toBe(savedPhone);
  });
  it("enables all six desktop feature toggles but preserves phone defaults", () => {
    const ids: FeatureId[] = ["evmSwap", "utxoSwap", "sharedWallets", "confirmLast4", "hideSpamTokens", "tsdConsolidateNudge"];
    for (const id of ids) expect(isFeatureEnabled(id, "desktop")).toBe(true);
    expect(isFeatureEnabled("evmSwap")).toBe(false);
    expect(isFeatureEnabled("sharedWallets")).toBe(false);
  });
  it("never rewrites phone feature or device spam settings", () => {
    store.set("hme:features", JSON.stringify({ utxoSwap: false }));
    store.set("hme:tokens:hide-spam:v1", "false");
    setFeatureEnabled("utxoSwap", true, "desktop");
    setFeatureEnabled("hideSpamTokens", true, "desktop");
    expect(isFeatureEnabled("utxoSwap")).toBe(false);
    expect(isFeatureEnabled("hideSpamTokens")).toBe(false);
  });
  it("isolates desktop features by profile while desktop networks follow the device", () => {
    store.set("hme.profiles.v1", JSON.stringify([{ id: "default", createdAt: 0 }, { id: "second", createdAt: 1 }]));
    setFeatureEnabled("sharedWallets", false, "desktop");
    setChainEnabled("doge", false, "desktop");
    setActiveProfileId("second");
    expect(isFeatureEnabled("sharedWallets", "desktop")).toBe(true);
    expect(getChainPrefs("desktop").doge).toBe(false);
    setFeatureEnabled("utxoSwap", false, "desktop");
    setActiveProfileId("default");
    expect(isFeatureEnabled("sharedWallets", "desktop")).toBe(false);
    expect(isFeatureEnabled("utxoSwap", "desktop")).toBe(true);
  });
});
