/** Narrow candidate route policy. This validator does not open the release gate. */
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import { LIFI_DIAMOND, LifiPolicyError, verifyLifiQuote, type LifiChain, type SwapIntent } from "./lifi-policy";

export const REVIEWED_ROUTER: Record<LifiChain, `0x${string}`> = {
  eth: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  base: "0x2626664c2603336E57B271c5C0b26F421741e481",
  bsc: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
};
export const REVIEWED_SWAP_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const blocked = (message: string): never => { throw new LifiPolicyError(message); };

/** Reject fee-forwarders, arbitrary programs, native, split and multi-hop routes. */
export function verifyReviewedLifiQuote(quote: SwapQuote, intent: SwapIntent) {
  const outer = verifyLifiQuote(quote, intent);
  if (outer.functionName !== "swapTokensSingleV3ERC20ToERC20" || outer.hops.length !== 1) {
    return blocked("only reviewed single-hop token routes are supported; fee and opaque routes are unavailable");
  }
  const hop = outer.hops[0];
  if (!hop || !hop.requiresDeposit || !same(hop.callTo, REVIEWED_ROUTER[intent.chain]) ||
      !same(hop.approveTo, REVIEWED_ROUTER[intent.chain])) {
    return blocked("route does not use the reviewed exchange and exact deposit");
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof REVIEWED_SWAP_ABI>>;
  try { decoded = decodeFunctionData({ abi: REVIEWED_SWAP_ABI, data: hop.callData }); }
  catch { return blocked("unreviewed exchange instructions"); }
  const params = decoded.args[0];
  if (encodeFunctionData({ abi: REVIEWED_SWAP_ABI, functionName: "exactInputSingle", args: [params] }).toLowerCase() !== hop.callData.toLowerCase()) {
    return blocked("exchange instructions contain noncanonical or extra bytes");
  }
  if (!same(params.tokenIn, intent.fromToken) || !same(params.tokenOut, intent.toToken) ||
      !same(params.tokenIn, hop.sendingAssetId) || !same(params.tokenOut, hop.receivingAssetId) ||
      !same(params.recipient, LIFI_DIAMOND[intent.chain]) || params.amountIn !== intent.fromAmount ||
      params.amountOutMinimum !== outer.minAmountOut || params.sqrtPriceLimitX96 !== 0n ||
      ![100, 500, 3000, 10000].includes(params.fee)) {
    return blocked("exchange assets, recipient, amount, minimum or pool settings differ from consent");
  }
  return { ...outer, poolFee: params.fee };
}