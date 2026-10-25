import { beforeEach, expect, it } from "vitest";
import { coldStorageEntries, previewVaultBalance } from "./cold-storage";
import { BIP32Factory } from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import type { VaultPairing } from "@/lib/vault-link/pairing";

let map: Map<string, string>;
beforeEach(() => {
  map = new Map();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value) };
  Object.assign(globalThis, { localStorage: storage, window: { localStorage: storage } });
});
it("previews linked coins and Vaults without changing the active profile or envelopes", () => {
  map.set("hme.profile.active.v1", "default");
  map.set("hme.watch-only.v1", JSON.stringify([{ id: "coin", label: "Cold coin", chain: "btc", address: "public-address" }]));
  map.set("p:vault:hme.vault-link.v1", JSON.stringify({ v: 1, fp: "abcdef12", chains: {}, pairedAt: 1 }));
  map.set("p:vault:hme.watch-only.v1", JSON.stringify([{ id: "other", chain: "txc", address: "other-address" }]));
  map.set("wallet-envelope", "unchanged");
  const before = [...map];
  const entries = coldStorageEntries([{ id: "default", label: "Main", createdAt: 0, mode: "seed", isActive: true }, { id: "vault", label: "Offline", createdAt: 1, mode: "vault", isActive: false }]);
  expect(entries.watches.map(w => [w.profile.id, w.wallet.id])).toEqual([["default", "coin"], ["vault", "other"]]);
  expect(entries.vaults[0]?.pairing?.fp).toBe("abcdef12");
  expect([...map]).toEqual(before);
});
const pairing = (): VaultPairing => ({ v: 1, fp: "abcdef12", pairedAt: 1, chains: { btc: { "44": BIP32Factory(ecc).fromSeed(new Uint8Array(32).fill(7)).neutered().toBase58() } } });
it("reports failed Vault address reads as unavailable rather than zero", async () => {
  await expect(previewVaultBalance(pairing(), "btc", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
});
it("includes confirmed and pending balance on both Vault branches", async () => {
  const stats = { chain_stats: { funded_txo_sum: 100, spent_txo_sum: 20, tx_count: 0 }, mempool_stats: { funded_txo_sum: 10, spent_txo_sum: 5, tx_count: 0 } };
  expect(await previewVaultBalance(pairing(), "btc", async () => ({ address: "unused", ...stats }))).toBe(3400);
});