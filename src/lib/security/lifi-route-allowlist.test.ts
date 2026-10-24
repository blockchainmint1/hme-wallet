import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { LIFI_DIAMOND, type VerifiedSwap } from "./lifi-policy";
import { verifyLifiRouteAllowlisted } from "./lifi-route-allowlist";

const TARGET = "0x0000000000000000000000000000000000000001";
const SPENDER = "0x0000000000000000000000000000000000000002";
function harness() {
  const verified: VerifiedSwap = { functionName: "swapTokensMultipleV3ERC20ToERC20", receiver: TARGET,
    minAmountOut: 1n, value: 0n, hops: [{ callTo: TARGET, approveTo: TARGET, callData: "0x3f0bde25",
      sendingAssetId: TARGET, receivingAssetId: SPENDER, fromAmount: 1n, requiresDeposit: true }] };
  const pub = { getChainId: vi.fn().mockResolvedValue(1), getBlockNumber: vi.fn().mockResolvedValue(123n),
    readContract: vi.fn().mockResolvedValue(true) };
  return { verified, pub, client: pub as unknown as PublicClient };
}
describe("LI.FI direct-hop compatibility (not semantic acceptance)", () => {
  it("checks the call pair on the pinned Diamond at the observed block", async () => {
    const h = harness(); await verifyLifiRouteAllowlisted("eth", h.verified, h.client);
    expect(h.pub.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: LIFI_DIAMOND.eth,
      args: [TARGET, "0x3f0bde25"], blockNumber: 123n }));
  });
  it("uses 0xffffffff for a distinct approval target", async () => {
    const h = harness(); const hop = h.verified.hops[0]; if (!hop) throw new Error("missing fixture");
    hop.approveTo = SPENDER;
    await verifyLifiRouteAllowlisted("eth", h.verified, h.client);
    expect(h.pub.readContract).toHaveBeenNthCalledWith(2, expect.objectContaining({ args: [SPENDER, "0xffffffff"], blockNumber: 123n }));
  });
  it("does not check approval-only membership for single native input", async () => {
    const h = harness(); h.verified.functionName = "swapTokensSingleV3NativeToERC20";
    const hop = h.verified.hops[0]; if (!hop) throw new Error("missing fixture"); hop.approveTo = SPENDER;
    await verifyLifiRouteAllowlisted("eth", h.verified, h.client);
    expect(h.pub.readContract).toHaveBeenCalledTimes(1);
  });
  it.each([false, undefined])("fails closed on a non-true permission (%s)", async allowed => {
    const h = harness(); h.pub.readContract.mockResolvedValue(allowed);
    await expect(verifyLifiRouteAllowlisted("eth", h.verified, h.client)).rejects.toThrow("permission is unavailable");
  });
  it("fails closed on RPC failure", async () => {
    const h = harness(); h.pub.readContract.mockRejectedValue(new Error("RPC unavailable"));
    await expect(verifyLifiRouteAllowlisted("eth", h.verified, h.client)).rejects.toThrow("RPC unavailable");
  });
  it("rejects wrong-chain RPC before permission reads", async () => {
    const h = harness(); h.pub.getChainId.mockResolvedValue(56);
    await expect(verifyLifiRouteAllowlisted("eth", h.verified, h.client)).rejects.toThrow("network differs");
    expect(h.pub.readContract).not.toHaveBeenCalled();
  });
  it("checks every hop and refuses a rejected later hop", async () => {
    const h = harness(); const hop = h.verified.hops[0]; if (!hop) throw new Error("missing fixture");
    h.verified.hops.push({ ...hop, callTo: SPENDER, approveTo: SPENDER });
    h.pub.readContract.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(verifyLifiRouteAllowlisted("eth", h.verified, h.client)).rejects.toThrow("permission is unavailable");
    expect(h.pub.readContract).toHaveBeenCalledTimes(2);
  });
});