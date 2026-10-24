/** Actual local viem signing with a PUBLIC disposable test key; no network/funds. */
import { beforeEach, expect, it, vi } from "vitest";
import { createWalletClient, custom, decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, base, bsc } from "viem/chains";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { LIFI_DIAMOND, type LifiChain } from "./lifi-policy";
const rpc = vi.hoisted(() => ({
  getTransactionCount: vi.fn(), getBlock: vi.fn(), estimateMaxPriorityFeePerGas: vi.fn(),
  sendRawTransaction: vi.fn(), getTransaction: vi.fn(),
}));
vi.mock("@/lib/chains/evm", () => ({ evmClient: () => rpc }));
// Well-known public test key; NEVER fund this account.
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [LIFI_DIAMOND.eth, 100000000n] });
function wallet(chain: LifiChain = "eth") {
  const network = { eth: mainnet, base, bsc }[chain];
  const client = createWalletClient({ account, chain: network, transport: custom({
    request: async ({ method }) => {
      if (method === "eth_chainId") return `0x${network.id.toString(16)}`;
      throw new Error(`Unexpected test RPC: ${method}`);
    },
  }) });
  vi.spyOn(client, "prepareTransactionRequest").mockImplementation(async (request) => ({
    ...request, chainId: network.id, gas: 100000n, gasPrice: 1000000000n, type: "legacy",
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

// Synthetic ABI fixtures establish signer preservation, NOT downstream safety
// or successful on-chain swaps. Production execution gate is never changed.
const swapAbi = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensSingleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensSingleV3ERC20ToNative(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensSingleV3NativeToERC20(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData[])",
  "function swapTokensMultipleV3ERC20ToNative(bytes32,string,string,address,uint256,SwapData[])",
  "function swapTokensMultipleV3NativeToERC20(bytes32,string,string,address,uint256,SwapData[])",
]);
const families = ["ERC20ToERC20", "ERC20ToNative", "NativeToERC20"] as const;
const signedCases = (["eth", "base", "bsc"] as const).flatMap(chain =>
  (["Single", "Multiple"] as const).flatMap(shape => families.map(family => ({ chain, shape, family }))));
it.each(signedCases)("actual local swap signature preserves $chain $shape $family intent bytes", async ({chain,shape,family}) => {
  const nativeIn = family === "NativeToERC20";
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const name = `swapTokens${shape}V3${family}` as const;
  const hop = { callTo: token, approveTo: token, sendingAssetId: nativeIn ? zero : token,
    receivingAssetId: family === "ERC20ToNative" ? zero : LIFI_DIAMOND[chain], fromAmount: 100000000n,
    callData: "0x12345678" as Hex, requiresDeposit: true };
  const bytes = encodeFunctionData({ abi: swapAbi, functionName: name,
    args: [`0x${"33".repeat(32)}`, "synthetic", "", account.address, 99000000n, shape === "Single" ? hop : [hop]] });
  const client = wallet(chain);
  const timer = vi.spyOn(globalThis,"setTimeout").mockImplementation(((callback:()=>void)=>{callback();return 0;}) as typeof setTimeout);
  try {
    await sendEvmTransaction(chain,client,{to:LIFI_DIAMOND[chain],data:bytes,value:nativeIn?100000000n:0n,gas:100000n},prepared=>{
      expect(prepared.chainId).toBe({eth:1,base:8453,bsc:56}[chain]); expect(prepared.data).toBe(bytes);
    });
    const raw = rpc.sendRawTransaction.mock.calls[0]?.[0].serializedTransaction;
    const signed = parseTransaction(raw);
    expect(signed.chainId).toBe({eth:1,base:8453,bsc:56}[chain]);
    expect(signed.to?.toLowerCase()).toBe(LIFI_DIAMOND[chain].toLowerCase());
    expect(signed.value??0n).toBe(nativeIn?100000000n:0n); expect(signed.data).toBe(bytes);
    const decoded = decodeFunctionData({abi:swapAbi,data:signed.data??"0x"});
    expect(decoded.functionName).toBe(name); expect(decoded.args?.[3]).toBe(account.address); expect(decoded.args?.[4]).toBe(99000000n);
    expect((await recoverTransactionAddress({serializedTransaction:raw})).toLowerCase()).toBe(account.address.toLowerCase());
  } finally {timer.mockRestore();}
});