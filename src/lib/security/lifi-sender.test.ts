/** Actual local viem signing with a PUBLIC disposable test key; no network/funds. */
import { beforeEach, expect, it, vi } from "vitest";
import { createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, parseTransaction, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { LIFI_DIAMOND } from "./lifi-policy";
const rpc = vi.hoisted(() => ({
  getTransactionCount: vi.fn(), getBlock: vi.fn(), estimateMaxPriorityFeePerGas: vi.fn(),
  sendRawTransaction: vi.fn(), getTransaction: vi.fn(),
}));
vi.mock("@/lib/chains/evm", () => ({ evmClient: () => rpc }));
// Well-known public test key; NEVER fund this account.
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [LIFI_DIAMOND.eth, 100000000n] });
function wallet() {
  const client = createWalletClient({ account, chain: mainnet, transport: http("http://localhost:8080") });
  vi.spyOn(client, "prepareTransactionRequest").mockImplementation(async (request) => ({
    ...request, chainId: 1, gas: 100000n, gasPrice: 1000000000n, type: "legacy",
  }) as Awaited<ReturnType<typeof client.prepareTransactionRequest>>);
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  rpc.getTransactionCount.mockResolvedValue(0);
  rpc.getBlock.mockResolvedValue({});
  rpc.sendRawTransaction.mockResolvedValue(`0x${"22".repeat(32)}`);
  rpc.getTransaction.mockResolvedValue({});
});
it("actual signer produces exactly the confirmed 100 USDC approval bytes", async () => {
  const client = wallet(); const guard = vi.fn();
  // Avoid the sender's propagation wait only; signing itself is real.
  const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
    callback(); return 0;
  }) as typeof setTimeout);
  try {
    await sendEvmTransaction("eth", client, { to: token, data, value: 0n, gas: 100000n }, guard);
    const raw = rpc.sendRawTransaction.mock.calls[0]?.[0].serializedTransaction;
    const signed = parseTransaction(raw);
    expect(signed.chainId).toBe(1);
    expect(signed.to?.toLowerCase()).toBe(token.toLowerCase());
    expect(signed.value ?? 0n).toBe(0n);
    expect(signed.data).toBe(data);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed.data ?? "0x" }).args).toEqual([LIFI_DIAMOND.eth, 100000000n]);
    expect((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase()).toBe(account.address.toLowerCase());
    expect(guard).toHaveBeenCalledTimes(1);
  } finally { timer.mockRestore(); }
});
it("guard rejection prevents actual local signing and broadcast", async () => {
  const client = wallet(); const sign = vi.spyOn(client, "signTransaction");
  await expect(sendEvmTransaction("eth", client, { to: token, data, value: 0n }, () => {
    throw new Error("prepared calldata changed");
  })).rejects.toThrow("calldata changed");
  expect(sign).not.toHaveBeenCalled();
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("nonce retry re-runs the guard before a second signature", async () => {
  const client = wallet(); const sign = vi.spyOn(client, "signTransaction");
  rpc.sendRawTransaction.mockRejectedValueOnce(new Error("nonce too low"));
  const guard = vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("approval cancelled"); });
  await expect(sendEvmTransaction("eth", client, { to: token, data, value: 0n }, guard)).rejects.toThrow("cancelled");
  expect(guard).toHaveBeenCalledTimes(2);
  expect(sign).toHaveBeenCalledTimes(1);
  expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
});