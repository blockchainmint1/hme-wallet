import { describe, expect, it } from "vitest";
import { moveBackBlockReason, seedsLinks, utxoExplorerUrl } from "./pocket-view";
import { mainReceiveAddress, pocketReceiveAddress } from "./pocket";
import { mnemonicToSeedSync } from "@scure/bip39";

describe("desktop Seeds Pocket rules", () => {
  it("shows only Seeds links (nav item hidden without one)", () => {
    expect(seedsLinks([{ host: "chat.honest.money" }])).toHaveLength(0);
    expect(seedsLinks([{ host: "seeds.honest.money" }, { host: "chat.honest.money" }])).toHaveLength(1);
  });
  it("refuses moving TXC back while TSD is in the pocket or unknown", () => {
    expect(moveBackBlockReason("TXC", 85_000_000_000n)).toMatch(/TSD/);
    expect(moveBackBlockReason("TXC", null)).not.toBeNull();
    expect(moveBackBlockReason("TXC", 0n)).toBeNull();
    expect(moveBackBlockReason("BTC", 5n)).toBeNull();
  });
  it("Move back goes to the wallet's own address #0, never the pocket", () => {
    const seed = mnemonicToSeedSync("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    for (const c of ["TXC", "BTC", "EVM"] as const) {
      expect(mainReceiveAddress(seed, c)).not.toBe(pocketReceiveAddress(seed, c, 1106));
    }
    expect(mainReceiveAddress(seed, "BTC")).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });
  it("explorer links point at public explorers", () => {
    expect(utxoExplorerUrl("TXC", "Tabc")).toBe("https://mempool.texitcoin.org/address/Tabc");
  });
});
