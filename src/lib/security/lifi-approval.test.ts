import { beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, type PublicClient, type WalletClient } from "viem";
import { LIFI_DIAMOND } from "./lifi-policy";
import { readApprovalAtReceipt, revokeLifiApproval, type LifiApproval } from "./lifi-approval";
const mocks = vi.hoisted(() => ({ send: vi.fn(), deployment: vi.fn() }));
vi.mock("@/lib/chains/evm-send", () => ({ sendEvmTransaction: mocks.send }));
vi.mock("./lifi-policy", async original => ({ ...await original<object>(), verifyLifiDeployment: mocks.deployment }));
const approval: LifiApproval = { chain: "eth", user: "0x000000000000000000000000000000000000dEaD",
  token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spender: LIFI_DIAMOND.eth,
  amount: 20_000000n, hash: `0x${"11".repeat(32)}`, status: "confirmed", blockNumber: 26262000n };
beforeEach(() => { vi.resetAllMocks(); });
it("pins allowance readback to the mined approval block", async () => {
  const readContract = vi.fn().mockResolvedValue(20_000000n);
  await readApprovalAtReceipt({ readContract } as unknown as PublicClient, approval);
  expect(readContract.mock.calls[0]?.[0].blockNumber).toBe(26262000n);
});
it("retries a transient unavailable receipt block once, never latest", async () => {
  vi.useFakeTimers();
  try {
    const readContract = vi.fn().mockRejectedValueOnce(new Error("block unavailable")).mockResolvedValue(20_000000n);
    const result = readApprovalAtReceipt({ readContract } as unknown as PublicClient, approval);
    await vi.runAllTimersAsync(); await result;
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract.mock.calls.map(call => call[0].blockNumber)).toEqual([26262000n, 26262000n]);
  } finally { vi.useRealTimers(); }
});
it("a real allowance mismatch aborts without retry", async () => {
  const readContract = vi.fn().mockResolvedValue(1n);
  await expect(readApprovalAtReceipt({ readContract } as unknown as PublicClient, approval)).rejects.toThrow("differs");
  expect(readContract).toHaveBeenCalledTimes(1);
});
it("revoke signs only approve(Diamond,0), even with swaps paused", async () => {
  const wallet = { account: { address: approval.user }, chain: { id: 1 } };
  mocks.send.mockImplementation(async (_chain, _wallet, tx, guard) => {
    await guard({ ...tx, chainId: 1, account: wallet.account }); return approval.hash;
  });
  await revokeLifiApproval({ approval, walletClient: wallet as unknown as WalletClient,
    publicClient: { estimateGas: vi.fn().mockResolvedValue(50000n) } as unknown as PublicClient, assertSession: vi.fn() });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const tx = mocks.send.mock.calls[0]?.[2];
  expect(tx.to).toBe(approval.token); expect(tx.value).toBe(0n);
  expect(decodeFunctionData({ abi: erc20Abi, data: tx.data }).args).toEqual([LIFI_DIAMOND.eth, 0n]);
});
it("revoke rejects a substituted spender before signing", async () => {
  await expect(revokeLifiApproval({ approval: { ...approval, spender: approval.user },
    walletClient: { account: { address: approval.user }, chain: { id: 1 } } as unknown as WalletClient,
    publicClient: {} as PublicClient, assertSession: vi.fn() })).rejects.toThrow("spender");
  expect(mocks.send).not.toHaveBeenCalled();
});