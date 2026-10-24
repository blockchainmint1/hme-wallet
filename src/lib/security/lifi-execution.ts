/** Shared LI.FI approval/signing flow; the release gate cannot be bypassed by UI preferences. */
import { encodeFunctionData, erc20Abi, type Hex, type PublicClient, type WalletClient } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import { sendEvmTransaction, type EvmTxRequest } from "@/lib/chains/evm-send";
import { assertReviewedExecution } from "./execution-policy";
import { verifyReviewedLifiQuote } from "./lifi-reviewed-route";
import { verifyLifiRouteAllowlisted } from "./lifi-route-allowlist";
import {
  LIFI_CHAIN_IDS, LIFI_NATIVE, requiredSpender, verifyLifiDeployment, verifyLifiQuote,
  type SwapIntent,
} from "./lifi-policy";

export async function executeLifiSwap(input: {
  intent: SwapIntent;
  shown: SwapQuote;
  walletClient: WalletClient;
  publicClient: PublicClient;
  refreshQuote: () => Promise<SwapQuote>;
  assertSession: () => void;
  assertExecutionAvailable: () => Promise<void>;
  stage?: (message: string) => void;
}): Promise<Hex> {
  assertReviewedExecution("lifi");
  input.assertSession();
  const { walletClient, publicClient: pub, stage = () => undefined } = input;
  // Snapshot both consent and provider bytes before the first await. Quote refetches
  // or form edits must not mutate an in-flight approval/payment.
  const intent = Object.freeze({ ...input.intent });
  const shown = structuredClone(input.shown);
  const account = walletClient.account;
  if (!account || account.address.toLowerCase() !== intent.user.toLowerCase()) {
    throw new Error("Swap blocked: signing account differs from the confirmed wallet");
  }
  if (walletClient.chain?.id !== LIFI_CHAIN_IDS[intent.chain]) {
    throw new Error("Swap blocked: signing network differs from the confirmed network");
  }
  const shownVerified = verifyLifiQuote(shown, intent);
  verifyReviewedLifiQuote(shown, intent);
  await input.assertExecutionAvailable();
  await verifyLifiRouteAllowlisted(intent.chain, shownVerified, pub);
  input.assertSession();
  const send = (tx: EvmTxRequest) => sendEvmTransaction(intent.chain, walletClient, tx, async (prepared) => {
    assertReviewedExecution("lifi");
    input.assertSession();
    const sender = typeof prepared.account === "string" ? prepared.account : (prepared.account as { address?: string } | undefined)?.address;
    if (walletClient.account?.address.toLowerCase() !== intent.user.toLowerCase() ||
        sender?.toLowerCase() !== intent.user.toLowerCase() ||
        prepared.chainId !== LIFI_CHAIN_IDS[intent.chain] ||
        prepared.to?.toLowerCase() !== tx.to.toLowerCase() ||
        prepared.data !== tx.data || (prepared.value ?? 0n) !== (tx.value ?? 0n)) {
      throw new Error("Swap blocked: prepared transaction differs from the confirmed payment");
    }
    // Sender preparation and nonce retries can take time; recheck the deployment
    // on every actual signature attempt, not just before estimating gas.
    await verifyLifiDeployment(intent.chain, pub);
    await input.assertExecutionAvailable();
    input.assertSession();
  });
  stage("Checking LI.FI contract…");
  await verifyLifiDeployment(intent.chain, pub);

  // Refresh and validate BEFORE any approval too. A hostile new route must not
  // leave a new allowance behind merely because the displayed route was safe.
  stage("Refreshing route…");
  const beforeApproval = structuredClone(await input.refreshQuote());
  const beforeApprovalVerified = verifyLifiQuote(beforeApproval, intent);
  verifyReviewedLifiQuote(beforeApproval, intent);
  await verifyLifiRouteAllowlisted(intent.chain, beforeApprovalVerified, pub);
  const nativeIn = intent.fromToken.toLowerCase() === LIFI_NATIVE;
  if (!nativeIn) {
    const token = intent.fromToken as `0x${string}`;
    const spender = requiredSpender(intent.chain, beforeApproval);
    stage("Checking approval…");
    const current = await pub.readContract({
      address: token, abi: erc20Abi, functionName: "allowance", args: [intent.user, spender],
    });
    if (current !== intent.fromAmount) {
      const approve = async (amount: bigint) => {
        // Recheck deployment before each allowance-changing signature.
        await verifyLifiDeployment(intent.chain, pub);
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
        // Do not sign approvals that cannot be simulated; never use quote gas.
        const gas = (await pub.estimateGas({ account, to: token, data, value: 0n }) * 130n) / 100n;
        const hash = await send({ to: token, data, value: 0n, gas });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Token approval failed on-chain");
        input.assertSession();
      };
      if (current > 0n) {
        stage("Resetting approval…");
        await approve(0n);
      }
      stage("Approving…");
      await approve(intent.fromAmount);
      const allowance = await pub.readContract({
        address: token, abi: erc20Abi, functionName: "allowance", args: [intent.user, spender],
      });
      if (allowance !== intent.fromAmount) throw new Error("Swap blocked: token allowance differs from the approved amount");
    }
  }

  stage("Refreshing route…");
  const finalQuote = structuredClone(await input.refreshQuote());
  const verified = verifyLifiQuote(finalQuote, intent);
  verifyReviewedLifiQuote(finalQuote, intent);
  await verifyLifiRouteAllowlisted(intent.chain, verified, pub);
  await verifyLifiDeployment(intent.chain, pub);
  const tx = { to: finalQuote.transactionRequest.to, data: finalQuote.transactionRequest.data, value: verified.value };
  stage("Checking swap…");
  // Failure aborts. Destination/data/value come from the same validated snapshot.
  const gas = (await pub.estimateGas({ account, ...tx }) * 130n) / 100n;
  stage("Swapping…");
  return send({ ...tx, gas });
}