import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, type PublicClient, type WalletClient } from "viem";
import { EARN, skyAbi, poolAbi } from "./protocols";
import { earnTransaction, executeEarn, previewEarn, readEarnPosition, verifyEarnDeployment, type EarnIntent } from "./direct";
import { earnAddress } from "./address";
import { rootFromSeed, seedFromMnemonic } from "@/lib/txc/wallet";
const user = "0x0000000000000000000000000000000000000001" as const;
const intent = (protocol: "sky" | "aave", action: "deposit" | "withdraw" = "deposit"): EarnIntent => ({ protocol, action, user, amount: protocol === "sky" ? 100n * 10n ** 18n : 100_000_000n, minimum: 1n });
function rpc(protocol: "sky" | "aave") {
  const p = EARN[protocol];
  return { getChainId: vi.fn(async () => 1), getCode: vi.fn(async () => "0x6000"), getBalance: vi.fn(async () => 10n ** 18n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }): Promise<unknown> => {
      switch (functionName) {
        case "asset": case "UNDERLYING_ASSET_ADDRESS": return p.underlying;
        case "POOL": case "getPool": return p.target;
        case "getReserveTokensAddresses": return [p.receipt, user, user];
        case "decimals": return p.decimals;
        case "ssr": return 10n ** 27n;
        case "getReserveData": return [0n,0n,0n,0n,0n,0n,0n,0n,0n,0n,0n,0n];
        case "getUserAccountData": return [0n,0n,0n,0n,0n,0n];
        case "getConfiguration": return { data: 1n << 56n };
        case "previewDeposit": case "previewRedeem": return 90n * 10n ** 18n;
        default: return 200n * 10n ** 18n;
      }
    }) };
}
describe("direct Ethereum Earn rules", () => {
  it("production gate rejects before any RPC or wallet side effect", async () => {
    const pub = rpc("sky"); const sign = vi.fn();
    await expect(executeEarn({ intent: intent("sky"), publicClient: pub as unknown as PublicClient, walletClient: { signTransaction: sign } as unknown as WalletClient, assertSession: vi.fn() })).rejects.toThrow("independent safety review");
    expect(pub.getChainId).not.toHaveBeenCalled(); expect(pub.readContract).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });
  it("Sky deposit encodes exactly 100 USDS to the selected wallet with zero ETH", () => {
    const tx = earnTransaction(intent("sky"));
    expect(tx.to).toBe("0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD"); expect(tx.value).toBe(0n);
    expect(decodeFunctionData({ abi: skyAbi, data: tx.data ?? "0x" }).args).toEqual([100n * 10n ** 18n, user]);
  });
  it("Sky withdrawal redeems shares owned by the same recipient", () => {
    const tx = earnTransaction(intent("sky", "withdraw"));
    expect(decodeFunctionData({ abi: skyAbi, data: tx.data ?? "0x" })).toMatchObject({ functionName: "redeem", args: [100n * 10n ** 18n, user, user] });
  });
  it("Aave supply encodes exactly 100 USDC, same beneficiary and referral zero", () => {
    const tx = earnTransaction(intent("aave"));
    expect(decodeFunctionData({ abi: poolAbi, data: tx.data ?? "0x" })).toMatchObject({ functionName: "supply", args: [EARN.aave.underlying,100_000_000n,user,0] });
  });
  it("Aave withdrawal requests exactly 100 USDC to selected wallet", () => {
    const tx = earnTransaction(intent("aave", "withdraw"));
    expect(decodeFunctionData({ abi: poolAbi, data: tx.data ?? "0x" })).toMatchObject({ functionName: "withdraw", args: [EARN.aave.underlying,100_000_000n,user] });
  });
  it("rejects zero amount", () => expect(() => earnTransaction({ ...intent("sky"), amount: 0n })).toThrow());
  it("rejects zero output floor", () => expect(() => earnTransaction({ ...intent("sky"), minimum: 0n })).toThrow());
  it("rejects another network", async () => { const c = rpc("sky"); c.getChainId.mockResolvedValue(8453); await expect(verifyEarnDeployment(c as unknown as PublicClient,"sky")).rejects.toThrow("Ethereum"); });
  it("rejects missing code", async () => { const c = rpc("sky"); c.getCode.mockResolvedValue("0x"); await expect(verifyEarnDeployment(c as unknown as PublicClient,"sky")).rejects.toThrow("unavailable"); });
  it("rejects substituted underlying", async () => { const c = rpc("sky"); const original = c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args => args.functionName === "asset" ? user : original?.(args)); await expect(verifyEarnDeployment(c as unknown as PublicClient,"sky")).rejects.toThrow("underlying changed"); });
  it("rejects changed receipt decimals", async () => { const c = rpc("sky"); const original = c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args => args.functionName === "decimals" ? 6 : original?.(args)); await expect(verifyEarnDeployment(c as unknown as PublicClient,"sky")).rejects.toThrow("decimals changed"); });
  it("rejects minimum above Sky preview", async () => { const c = rpc("sky"); await expect(previewEarn(c as unknown as PublicClient,{...intent("sky"),minimum:100n*10n**18n})).rejects.toThrow("minimum"); });
  it("rejects amount above wallet balance", async () => { const c = rpc("sky"); await expect(previewEarn(c as unknown as PublicClient,{...intent("sky"),amount:201n*10n**18n})).rejects.toThrow("balance"); });
  it("rejects paused Aave reserve", async () => { const c = rpc("aave"); const original = c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args => args.functionName === "getConfiguration" ? {data:(1n<<56n)|(1n<<60n)} : original?.(args)); await expect(previewEarn(c as unknown as PublicClient,intent("aave"))).rejects.toThrow("unavailable"); });
  it("excludes Aave accounts with existing debt", async () => { const c=rpc("aave"); const original=c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args=>args.functionName==="getUserAccountData"?[0n,1n,0n,0n,0n,0n]:original?.(args)); await expect(previewEarn(c as unknown as PublicClient,intent("aave"))).rejects.toThrow("borrowing"); });
  it("rejects withdrawal when Aave liquidity is below 100 USDC", async () => { const c=rpc("aave"); let balances=0; const original=c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args=>args.functionName==="balanceOf"&&++balances===2?99_000_000n:original?.(args)); await expect(previewEarn(c as unknown as PublicClient,intent("aave","withdraw"))).rejects.toThrow("liquidity"); });
  it("rejects Aave provider pointing at another pool", async () => { const c=rpc("aave"); const original=c.readContract.getMockImplementation(); c.readContract.mockImplementation(async args=>args.functionName==="getPool"?user:original?.(args)); await expect(verifyEarnDeployment(c as unknown as PublicClient,"aave")).rejects.toThrow("provider"); });
  it("rejects inherited-property protocol names before encoding", () => expect(()=>earnTransaction({...intent("sky"),protocol:"toString" as EarnIntent["protocol"]})).toThrow("Invalid"));
  it("zero savings rate growth is displayed as 0%", async () => { const c=rpc("sky"); expect((await readEarnPosition(c as unknown as PublicClient,"sky",user)).apy).toBe(0); });
  it("public display address matches the canonical Ethereum derivation", async () => {
    const root=rootFromSeed(await seedFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",""));
    expect(earnAddress(root)).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });
});