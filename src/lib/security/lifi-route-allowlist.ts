/** Compatibility check only: membership never replaces nested instruction review. */
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { LIFI_CHAIN_IDS, LIFI_DIAMOND, LifiPolicyError, type LifiChain, type VerifiedSwap } from "./lifi-policy";

const ABI = parseAbi(["function isContractSelectorWhitelisted(address,bytes4) view returns (bool)"]);
export const LIFI_APPROVE_ONLY_SELECTOR = "0xffffffff" as const;

/** Reproduce the pinned facet's branch-specific direct-call permissions at one block. */
export async function verifyLifiRouteAllowlisted(chain: LifiChain, verified: VerifiedSwap, pub: PublicClient): Promise<void> {
  if (await pub.getChainId() !== LIFI_CHAIN_IDS[chain]) throw new LifiPolicyError("allowlist RPC network differs from intent");
  if (verified.hops.length === 0 || verified.hops.length > 4) throw new LifiPolicyError("invalid allowlist hop count");
  const blockNumber = await pub.getBlockNumber();
  const check = async (address: Address, selector: Hex) => {
    const allowed = await pub.readContract({ address: LIFI_DIAMOND[chain], abi: ABI,
      functionName: "isContractSelectorWhitelisted", args: [address, selector], blockNumber });
    if (allowed !== true) throw new LifiPolicyError("route contract permission is unavailable; no approval authorized");
  };
  for (const hop of verified.hops) {
    if (!/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(hop.callData)) throw new LifiPolicyError("route has no valid selector");
    await check(hop.callTo, hop.callData.slice(0, 10) as Hex);
    // Single native entrypoint does not create token approvals. Other families
    // require the approval-only sentinel, NOT the callable router's selector.
    if (verified.functionName !== "swapTokensSingleV3NativeToERC20" &&
        hop.approveTo.toLowerCase() !== hop.callTo.toLowerCase()) {
      await check(hop.approveTo, LIFI_APPROVE_ONLY_SELECTOR);
    }
  }
}