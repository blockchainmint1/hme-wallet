import { encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { LIFI_CHAIN_IDS, LIFI_DIAMOND, verifyLifiDeployment, type LifiChain } from "./lifi-policy";

export type LifiApproval = { chain: LifiChain; user: Address; token: Address; spender: Address; amount: bigint;
  hash: Hex; status: "pending" | "confirmed" | "reverted" | "unknown"; blockNumber?: bigint };

/** Historic read at the successful receipt block; no fallback to a stale latest block. */
export async function readApprovalAtReceipt(pub: PublicClient, approval: LifiApproval) {
  if (approval.blockNumber === undefined || approval.status !== "confirmed") throw new Error("Approval is not confirmed");
  const request = { address: approval.token, abi: erc20Abi, functionName: "allowance" as const,
    args: [approval.user, approval.spender] as const, blockNumber: approval.blockNumber };
  let allowance: bigint;
  try { allowance = await pub.readContract(request); }
  catch {
    // One bounded retry for RPC block availability. Never retry an actual mismatch.
    await new Promise(resolve => setTimeout(resolve, 2000));
    allowance = await pub.readContract(request);
  }
  if (allowance !== approval.amount) throw new Error("Swap blocked: token allowance differs from the approved amount");
}

/** Removing an allowance is available even when new swaps are disabled. No automatic calls. */
export async function revokeLifiApproval(input: {
  approval: LifiApproval; walletClient: WalletClient; publicClient: PublicClient; assertSession: () => void;
}): Promise<Hex> {
  const approval = Object.freeze({ ...input.approval });
  const account = input.walletClient.account;
  if (!account || account.address.toLowerCase() !== approval.user.toLowerCase() ||
      input.walletClient.chain?.id !== LIFI_CHAIN_IDS[approval.chain] ||
      approval.spender.toLowerCase() !== LIFI_DIAMOND[approval.chain].toLowerCase()) throw new Error("Approval wallet, chain or spender changed");
  input.assertSession();
  const tx = { to: approval.token, value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender, 0n] }) };
  const gas = (await input.publicClient.estimateGas({ account, ...tx }) * 130n) / 100n;
  return sendEvmTransaction(approval.chain, input.walletClient, { ...tx, gas }, async prepared => {
    input.assertSession();
    const sender = typeof prepared.account === "string" ? prepared.account : (prepared.account as { address?: string } | undefined)?.address;
    if (sender?.toLowerCase() !== approval.user.toLowerCase() ||
        input.walletClient.account?.address.toLowerCase() !== approval.user.toLowerCase() ||
        prepared.chainId !== LIFI_CHAIN_IDS[approval.chain] || prepared.to?.toLowerCase() !== tx.to.toLowerCase() ||
        prepared.data !== tx.data || (prepared.value ?? 0n) !== 0n) throw new Error("Prepared revoke differs from the confirmed approval");
    await verifyLifiDeployment(approval.chain, input.publicClient);
    input.assertSession();
  });
}