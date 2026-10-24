import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import { LIFI_DIAMOND, type LifiChain, type SwapIntent } from "./lifi-policy";
import { REVIEWED_ROUTER, REVIEWED_SWAP_ABI, verifyReviewedLifiQuote } from "./lifi-reviewed-route";

const abi = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensSingleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData[])",
]);
const user = "0x000000000000000000000000000000000000dEaD" as Address;
const tokenIn = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const tokenOut = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;
const attacker = "0x000000000000000000000000000000000000beef" as Address;
export function candidateRoute(chain: LifiChain = "eth") {
  const intent: SwapIntent = { chain, user, fromToken: tokenIn, toToken: tokenOut, fromAmount: 20_000000n, minAmountOutFloor: 19_800000n };
  const params = { tokenIn, tokenOut, fee: 500, recipient: LIFI_DIAMOND[chain], amountIn: intent.fromAmount,
    amountOutMinimum: intent.minAmountOutFloor, sqrtPriceLimitX96: 0n };
  const hop = { callTo: REVIEWED_ROUTER[chain], approveTo: REVIEWED_ROUTER[chain], sendingAssetId: tokenIn,
    receivingAssetId: tokenOut, fromAmount: intent.fromAmount, requiresDeposit: true,
    callData: encodeFunctionData({ abi: REVIEWED_SWAP_ABI, functionName: "exactInputSingle", args: [params] }) };
  const quote: SwapQuote = { estimate: { fromAmount: "20000000", toAmount: "19900000", toAmountMin: "19800000",
    approvalAddress: LIFI_DIAMOND[chain], executionDuration: 0 }, tool: "synthetic-reviewed-candidate",
    transactionRequest: { to: LIFI_DIAMOND[chain], chainId: { eth: 1, base: 8453, bsc: 56 }[chain], value: "0x0", data: "0x" } };
  const encode = () => { quote.transactionRequest.data = encodeFunctionData({ abi, functionName: "swapTokensSingleV3ERC20ToERC20",
    args: [`0x${"11".repeat(32)}`, "", "", user, intent.minAmountOutFloor, hop] }); };
  encode();
  return { intent, quote, hop, params, encode, encodeInner: () => { hop.callData = encodeFunctionData({ abi: REVIEWED_SWAP_ABI, functionName: "exactInputSingle", args: [params] }); encode(); } };
}
describe("reviewed-only fee-free nested route candidate (not release approval)", () => {
  it.each(["eth", "base", "bsc"] as const)("binds exact inner bytes on %s", chain => {
    const h = candidateRoute(chain); expect(verifyReviewedLifiQuote(h.quote, h.intent).poolFee).toBe(500);
  });
  it("rejects integrator fee-forwarder/multi-hop routes regardless of quote labels", () => {
    const h = candidateRoute(); h.quote.transactionRequest.data = encodeFunctionData({ abi, functionName: "swapTokensMultipleV3ERC20ToERC20",
      args: [`0x${"11".repeat(32)}`, "", "", user, h.intent.minAmountOutFloor, [h.hop]] });
    expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("fee and opaque routes");
  });
  it.each(["callTo", "approveTo"] as const)("rejects substituted %s", field => {
    const h = candidateRoute(); h.hop[field] = attacker; h.encode(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("reviewed exchange");
  });
  it.each(["recipient", "tokenIn", "tokenOut"] as const)("rejects nested %s substitution", field => {
    const h = candidateRoute(); h.params[field] = attacker; h.encodeInner(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("differ from consent");
  });
  it.each(["amountIn", "amountOutMinimum", "sqrtPriceLimitX96"] as const)("rejects changed inner %s", field => {
    const h = candidateRoute(); h.params[field] += 1n; h.encodeInner(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("differ from consent");
  });
  it("rejects unreviewed pool tier", () => { const h = candidateRoute(); h.params.fee = 42; h.encodeInner(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow(); });
  it("rejects trailing inner bytes", () => { const h = candidateRoute(); h.hop.callData = `${h.hop.callData}00` as Hex; h.encode(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("extra bytes"); });
  it("rejects deposit-flag change", () => { const h = candidateRoute(); h.hop.requiresDeposit = false; h.encode(); expect(() => verifyReviewedLifiQuote(h.quote, h.intent)).toThrow("exact deposit"); });
});