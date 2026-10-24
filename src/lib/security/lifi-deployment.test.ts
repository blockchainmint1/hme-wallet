import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { LIFI_TIMELOCK, verifyLifiDeployment } from "./lifi-policy";

function rpc() {
  return {
    getChainId: vi.fn().mockResolvedValue(1),
    getCode: vi.fn().mockResolvedValue("0x1234"),
    readContract: vi.fn().mockImplementation(async ({ functionName }) => {
      if (functionName === "owner") return LIFI_TIMELOCK.eth;
      if (functionName === "getMinDelay") return 10800n;
      return "0x000000000000000000000000000000000000beef";
    }),
  };
}
describe("LI.FI deployment fails closed", () => {
  it("wrong RPC chain", async () => {
    const c = rpc(); c.getChainId.mockResolvedValue(56);
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("RPC network");
  });
  it("absent Diamond code", async () => {
    const c = rpc(); c.getCode.mockResolvedValue("0x");
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("no contract");
  });
  it("changed owner", async () => {
    const c = rpc(); c.readContract.mockResolvedValue("0x000000000000000000000000000000000000beef");
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("owner changed");
  });
  it("governance delay below 10800 seconds", async () => {
    const c = rpc(); c.readContract.mockResolvedValueOnce(LIFI_TIMELOCK.eth).mockResolvedValueOnce(10799n);
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("10800");
  });
  it("changed facet despite unchanged owner", async () => {
    const c = rpc();
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("implementation changed");
  });
  it("RPC outage", async () => {
    const c = rpc(); c.getChainId.mockRejectedValue(new Error("offline"));
    await expect(verifyLifiDeployment("eth", c as unknown as PublicClient)).rejects.toThrow("offline");
  });
});