import { beforeEach, describe, expect, it } from "vitest";
import { canTrackSwap, recordSwap, recordOpenedSwap, openedSwapState, readAllSwaps, swapsForWallet, updateSwap, type SavedSwap } from "./swap-history";

const destination = "0x14de43dc534c6911c46ca5ca44323e785f07e9ef";
const swap: SavedSwap = { txid: "11".repeat(32), coin: "doge", provider: "fixedfloat", orderId: "order", token: "ref",
  amountSats: 100_000_000, amountOut: 0.1, dest: { asset: "BASE.USDC", chain: "base", symbol: "USDC", label: "USDC on Base" },
  destination, createdAt: Date.now(), done: false, failed: false, outboundTxid: null };
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
  Object.assign(globalThis, { window: { localStorage: storage, dispatchEvent: () => true }, localStorage: storage });
});
describe("swap history ownership and status", () => {
  it("isolates new records by wallet and legacy records by payout address without changing them", () => {
    const records = [swap, { ...swap, txid: "22".repeat(32), profileId: "main" }, { ...swap, txid: "33".repeat(32), destination: "0x45E5D44F376ea133CDaC00017E4FA92d8eF30BEa" }];
    expect(swapsForWallet(records, "vault", destination).map((s) => s.txid)).toEqual([swap.txid]);
    expect(swapsForWallet(records, "main", null).map((s) => s.txid)).toEqual(["22".repeat(32)]);
    expect(records[0].profileId).toBeUndefined();
  });
  it("preserves completed status and unrelated wallet storage", () => {
    data.set("txc.wallet.v1", "unchanged encrypted wallet");
    recordSwap({ ...swap, profileId: "vault" });
    updateSwap(swap.txid, { done: true, outboundTxid: "0xpayout" });
    updateSwap(swap.txid, { done: false });
    expect(readAllSwaps()[0].done).toBe(true);
    expect(readAllSwaps()[0].profileId).toBe("vault");
    expect(data.get("txc.wallet.v1")).toBe("unchanged encrypted wallet");
  });
  it("does not poll FixedFloat without its required order ID and token", () => {
    expect(canTrackSwap(swap)).toBe(true);
    expect(canTrackSwap({ ...swap, token: null })).toBe(false);
    expect(canTrackSwap({ ...swap, orderId: null })).toBe(false);
    expect(canTrackSwap({ ...swap, provider: "thorchain", orderId: null, token: null })).toBe(true);
  });
  it("records a profile-owned unpaid order without claiming broadcast or completion", () => {
    recordOpenedSwap({...swap, profileId: "main", expiry: 100});
    const opened = readAllSwaps()[0];
    expect(opened.txid).toBe("");
    expect(opened.lifecycle).toBe("opened");
    expect(opened.done).toBe(false);
    expect(canTrackSwap(opened)).toBe(false);
    expect(swapsForWallet([opened], "other", destination)).toEqual([]);
    expect(openedSwapState(opened, 99999)).toBe("opened");
    expect(openedSwapState(opened, 100000)).toBe("expired");
  });
  it("upgrades the matching opened order on broadcast without duplicating or changing other profiles", () => {
    recordOpenedSwap({...swap, profileId: "main"});
    recordOpenedSwap({...swap, profileId: "other"});
    recordOpenedSwap({...swap, profileId: "main"});
    expect(readAllSwaps()).toHaveLength(2);
    recordSwap({...swap, profileId: "main"});
    expect(readAllSwaps()).toHaveLength(2);
    expect(readAllSwaps()[0].lifecycle).toBe("sent");
    expect(readAllSwaps()[0].txid).toBe(swap.txid);
    expect(openedSwapState(readAllSwaps()[0])).toBeNull();
    expect(readAllSwaps()[1].lifecycle).toBe("opened");
  });
  it("does not record THORChain quotes as opened instant-exchange orders", () => {
    recordOpenedSwap({...swap, provider: "thorchain", profileId: "main"});
    expect(readAllSwaps()).toEqual([]);
  });
});