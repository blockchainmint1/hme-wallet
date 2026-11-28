import { beforeEach, describe, expect, it, vi } from "vitest";
import { rootFromSeed } from "@/lib/txc/wallet";
import { vaultEvmAccount } from "./evm-accounts";
import type { VaultPairing } from "./pairing";
import { scanVaultEvm } from "./evm-roundup";

const rpc = vi.hoisted(() => ({
  getBalance: vi.fn(), getTransactionCount: vi.fn(), readContract: vi.fn(),
}));
vi.mock("@/lib/chains/evm", () => ({ evmClient: () => rpc }));

const root = rootFromSeed(new Uint8Array(32).fill(71));
const pairing: VaultPairing = {
  v: 1, fp: "12345678", chains: {}, pairedAt: 1,
  evm: { address: "", path: "m/44'/60'/0'/0/0", xpub: root.derivePath("m/44'/60'/0'").neutered().toBase58() },
};
const address67 = vaultEvmAccount(pairing, 67).address;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.getBalance.mockImplementation(async ({ address }: { address: string }) => address === address67 ? 100_000_000_000_000n : 0n);
  rpc.getTransactionCount.mockResolvedValue(0);
  rpc.readContract.mockResolvedValue(0n);
});

describe("Vault round-up extended search", () => {
  it("checks another 20 each time even across empty gaps, discovering Ethereum #67", async () => {
    const initial = await scanVaultEvm(pairing, "eth");
    expect(initial.checked).toBe(20);
    const used = [...initial.used];
    let checked = initial.checked;
    for (const expected of [40, 60, 80]) {
      const page = await scanVaultEvm(pairing, "eth", { startIndex: checked, count: 20 });
      expect(page.checked).toBe(expected);
      checked = page.checked;
      used.push(...page.used);
    }
    expect(used.map((row) => row.index)).toEqual([0, 67]);
    expect(used.find((row) => row.index === 67)?.native).toBe(100_000_000_000_000n);
    expect(rpc.getBalance).toHaveBeenCalledTimes(80);
    expect(new Set(rpc.getBalance.mock.calls.map(([arg]) => (arg as { address: string }).address)).size).toBe(80);
  });

  it("refreshes the expanded range even when all 80 addresses are now empty", async () => {
    rpc.getBalance.mockResolvedValue(0n);
    const refreshed = await scanVaultEvm(pairing, "eth", { minChecked: 80 });
    expect(refreshed.checked).toBe(80);
    expect(rpc.getBalance).toHaveBeenCalledTimes(80);
    expect(refreshed.used.map((row) => row.index)).toEqual([0]);
  });

  it("rejects a failed page without returning a cursor, allowing the same page to be retried", async () => {
    const failed = vaultEvmAccount(pairing, 75).address;
    rpc.getBalance.mockImplementation(async ({ address }: { address: string }) => {
      if (address === failed) throw new Error("Network unavailable");
      return address === address67 ? 100_000_000_000_000n : 0n;
    });
    await expect(scanVaultEvm(pairing, "eth", { startIndex: 60, count: 20 })).rejects.toThrow("Network unavailable");
    rpc.getBalance.mockImplementation(async ({ address }: { address: string }) => address === address67 ? 100_000_000_000_000n : 0n);
    const retry = await scanVaultEvm(pairing, "eth", { startIndex: 60, count: 20 });
    expect(retry.checked).toBe(80);
    expect(retry.used.map((row) => row.index)).toEqual([67]);
  });

  it("caps the final page at #999 and refuses pages larger than 20", async () => {
    const page = await scanVaultEvm(pairing, "eth", { startIndex: 995, count: 20 });
    expect(page.checked).toBe(1000);
    expect(rpc.getBalance).toHaveBeenCalledTimes(5);
    await expect(scanVaultEvm(pairing, "eth", { startIndex: 1000, count: 20 })).resolves.toEqual({ used: [], checked: 1000 });
    await expect(scanVaultEvm(pairing, "eth", { startIndex: 1001, count: 20 })).rejects.toThrow(/range/);
    await expect(scanVaultEvm(pairing, "eth", { startIndex: 20, count: 21 })).rejects.toThrow(/range/);
  });
});