import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, type PublicClient, type WalletClient } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import { executeLifiSwap } from "./lifi-execution";
import { LIFI_DIAMOND, LIFI_NATIVE, type SwapIntent } from "./lifi-policy";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), deployment: vi.fn(), send: vi.fn() }));
vi.mock("./execution-policy", () => ({ assertReviewedExecution: mocks.gate }));
vi.mock("./lifi-policy", async (original) => ({ ...await original<object>(), verifyLifiDeployment: mocks.deployment }));
vi.mock("@/lib/chains/evm-send", () => ({ sendEvmTransaction: mocks.send }));
const USER = "0x000000000000000000000000000000000000dEaD";
const ATTACKER = "0x000000000000000000000000000000000000beef";
const ETH = JSON.parse(readFileSync(new URL("./fixtures/lifi-quote-eth.json", import.meta.url), "utf8")) as SwapQuote;
const BASE = JSON.parse(readFileSync(new URL("./fixtures/lifi-quote-base.json", import.meta.url), "utf8")) as SwapQuote;
const HASH = `0x${"11".repeat(32)}`;
function harness(q: SwapQuote = ETH) {
  const base = q === BASE;
  const intent: SwapIntent = {
    chain: base ? "base" : "eth", user: USER,
    fromToken: base ? LIFI_NATIVE : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    toToken: base ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : LIFI_NATIVE,
    fromAmount: BigInt(q.estimate.fromAmount), minAmountOutFloor: BigInt(q.estimate.toAmountMin),
  };
  const rpc = {
    readContract: vi.fn().mockResolvedValue(intent.fromAmount),
    estimateGas: vi.fn().mockResolvedValue(100000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  };
  const wallet = { account: { address: USER }, chain: { id: base ? 8453 : 1 } };
  const refreshQuote = vi.fn().mockImplementation(async () => structuredClone(q));
  return { input: { intent, shown: structuredClone(q), walletClient: wallet as unknown as WalletClient,
    publicClient: rpc as unknown as PublicClient, refreshQuote }, rpc, wallet, refreshQuote };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.send.mockImplementation(async (_chain, _wallet, tx, guard) => {
    await guard({ ...tx, chainId: _wallet.chain.id });
    return HASH;
  });
});

describe("shared LI.FI executor signing boundary (release gate mocked open ONLY in tests)", () => {
  it("paused execution makes zero RPC, approval or sender calls", async () => {
    mocks.gate.mockImplementation(() => { throw new Error("paused"); });
    const h = harness();
    await expect(executeLifiSwap(h.input)).rejects.toThrow("paused");
    expect(h.refreshQuote).not.toHaveBeenCalled();
    expect(h.rpc.readContract).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    ["target", (q: SwapQuote) => { q.transactionRequest.to = ATTACKER; }],
    ["chain", (q: SwapQuote) => { q.transactionRequest.chainId = 56; }],
    ["spender", (q: SwapQuote) => { q.estimate.approvalAddress = ATTACKER; }],
    ["native value", (q: SwapQuote) => { q.transactionRequest.value = "0x1"; }],
    ["calldata", (q: SwapQuote) => { q.transactionRequest.data = "0xdeadbeef"; }],
  ])("rejects hostile shown %s before any approval/payment", async (_name, mutate) => {
    const h = harness(); mutate(h.input.shown);
    await expect(executeLifiSwap(h.input)).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(h.rpc.readContract).not.toHaveBeenCalled();
  });
  it("checks refreshed spender before creating an allowance", async () => {
    const h = harness(); const bad = structuredClone(ETH); bad.estimate.approvalAddress = ATTACKER;
    h.refreshQuote.mockResolvedValue(bad);
    await expect(executeLifiSwap(h.input)).rejects.toThrow("approval spender");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("encodes exact 100 USDC approval after zero reset, not unlimited authority", async () => {
    const h = harness(); h.rpc.readContract.mockResolvedValueOnce(1n).mockResolvedValueOnce(100000000n);
    await executeLifiSwap(h.input);
    const calls = mocks.send.mock.calls;
    expect(calls).toHaveLength(3);
    for (const [index, amount] of [[0, 0n], [1, 100000000n]] as const) {
      const tx = calls[index]?.[2];
      expect(tx.to).toBe(h.input.intent.fromToken);
      expect(tx.value).toBe(0n);
      expect(decodeFunctionData({ abi: erc20Abi, data: tx.data }).args).toEqual([LIFI_DIAMOND.eth, amount]);
    }
    expect(calls[2]?.[2].data).toBe(ETH.transactionRequest.data);
  });
  it("failed reset receipt prevents the positive approval and swap", async () => {
    const h = harness(); h.rpc.readContract.mockResolvedValueOnce(1n);
    h.rpc.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    await expect(executeLifiSwap(h.input)).rejects.toThrow("approval failed");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(decodeFunctionData({ abi: erc20Abi, data: mocks.send.mock.calls[0]?.[2].data }).args?.[1]).toBe(0n);
  });
  it("normalizes an existing unlimited allowance to exactly 100 USDC", async () => {
    const h = harness(); h.rpc.readContract.mockResolvedValueOnce(2n ** 256n - 1n).mockResolvedValueOnce(100000000n);
    await executeLifiSwap(h.input);
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(decodeFunctionData({ abi: erc20Abi, data: mocks.send.mock.calls[0]?.[2].data }).args?.[1]).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: mocks.send.mock.calls[1]?.[2].data }).args?.[1]).toBe(100000000n);
  });
  it("failed allowance read-back prevents the swap", async () => {
    const h = harness(); h.rpc.readContract.mockResolvedValue(0n);
    await expect(executeLifiSwap(h.input)).rejects.toThrow("allowance differs");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("rejects hostile final route after approval without signing a swap", async () => {
    const h = harness(); h.rpc.readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(100000000n);
    const bad = structuredClone(ETH); bad.transactionRequest.to = ATTACKER;
    h.refreshQuote.mockResolvedValueOnce(ETH).mockResolvedValueOnce(bad);
    await expect(executeLifiSwap(h.input)).rejects.toThrow("not the LI.FI Diamond");
    expect(mocks.send).toHaveBeenCalledTimes(1); // Completed approval cannot be rolled back.
  });
  it("simulation failure never falls back to quote gas or signs the native swap", async () => {
    const h = harness(BASE); h.rpc.estimateGas.mockRejectedValue(new Error("simulation reverted"));
    await expect(executeLifiSwap(h.input)).rejects.toThrow("simulation reverted");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rechecks deployment after the final refresh", async () => {
    const h = harness(BASE); mocks.deployment.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("facet changed"));
    await expect(executeLifiSwap(h.input)).rejects.toThrow("facet changed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("pre-sign guard rejects altered prepared calldata", async () => {
    const h = harness(BASE);
    mocks.send.mockImplementation(async (_chain, _wallet, tx, guard) => {
      await guard({ ...tx, chainId: 8453, data: "0xdeadbeef" }); return HASH;
    });
    await expect(executeLifiSwap(h.input)).rejects.toThrow("prepared transaction differs");
  });
  it("rejects signing account/network mismatch before approvals", async () => {
    const h = harness(); h.wallet.account.address = ATTACKER;
    await expect(executeLifiSwap(h.input)).rejects.toThrow("signing account");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});