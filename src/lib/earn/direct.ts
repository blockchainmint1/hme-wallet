import { encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { sendEvmTransaction, type EvmTxRequest } from "@/lib/chains/evm-send";
import { EARN, skyAbi, poolAbi, aTokenAbi, assertEarnExecution, AAVE_DATA_PROVIDER, AAVE_ADDRESSES_PROVIDER, providerAbi, dataProviderAbi, type EarnProtocol, type EarnAction } from "./protocols";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type EarnIntent = Readonly<{ protocol: EarnProtocol; action: EarnAction; user: Address; amount: bigint; minimum: bigint }>;

export function earnTransaction(intent: EarnIntent): EvmTxRequest {
  if (!(intent.protocol in EARN) || !["deposit", "withdraw"].includes(intent.action) || intent.amount <= 0n || intent.minimum <= 0n) throw new Error("Invalid Earn amount or route");
  const p = EARN[intent.protocol];
  const data = intent.protocol === "sky"
    ? intent.action === "deposit"
      ? encodeFunctionData({ abi: skyAbi, functionName: "deposit", args: [intent.amount, intent.user] })
      : encodeFunctionData({ abi: skyAbi, functionName: "redeem", args: [intent.amount, intent.user, intent.user] })
    : intent.action === "deposit"
      ? encodeFunctionData({ abi: poolAbi, functionName: "supply", args: [p.underlying, intent.amount, intent.user, 0] })
      : encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [p.underlying, intent.amount, intent.user] });
  return { to: p.target, data, value: 0n };
}

export async function verifyEarnDeployment(pub: PublicClient, protocol: EarnProtocol) {
  if (await pub.getChainId() !== 1) throw new Error("Earn requires Ethereum");
  const p = EARN[protocol];
  for (const address of new Set([p.underlying, p.receipt, p.target])) {
    const code = await pub.getCode({ address });
    if (!code || code === "0x") throw new Error("Earn contract unavailable");
  }
  const decimals = await pub.readContract({ address: p.underlying, abi: erc20Abi, functionName: "decimals" });
  const receiptDecimals = await pub.readContract({ address: p.receipt, abi: erc20Abi, functionName: "decimals" });
  if (decimals !== p.decimals || receiptDecimals !== p.decimals) throw new Error("Earn token decimals changed");
  if (protocol === "sky") {
    const asset = await pub.readContract({ address: p.target, abi: skyAbi, functionName: "asset" });
    if (!same(asset, p.underlying)) throw new Error("Sky underlying changed");
  } else {
    const [asset, pool] = await Promise.all([
      pub.readContract({ address: p.receipt, abi: aTokenAbi, functionName: "UNDERLYING_ASSET_ADDRESS" }),
      pub.readContract({ address: p.receipt, abi: aTokenAbi, functionName: "POOL" }),
    ]);
    if (!same(asset, p.underlying) || !same(pool, p.target)) throw new Error("Aave reserve changed");
    const livePool = await pub.readContract({ address: AAVE_ADDRESSES_PROVIDER, abi: providerAbi, functionName: "getPool" });
    const reserve = await pub.readContract({ address: AAVE_DATA_PROVIDER, abi: dataProviderAbi, functionName: "getReserveTokensAddresses", args: [p.underlying] });
    if (!same(livePool, p.target) || !same(reserve[0], p.receipt)) throw new Error("Aave deployment changed");
  }
}

export async function readEarnPosition(pub: PublicClient, protocol: EarnProtocol, user: Address) {
  await verifyEarnDeployment(pub, protocol);
  const p = EARN[protocol];
  const [available, shares, eth] = await Promise.all([
    pub.readContract({ address: p.underlying, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
    pub.readContract({ address: p.receipt, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
    pub.getBalance({ address: user }),
  ]);
  let assets = shares;
  let apy: number | null = null;
  if (protocol === "sky") {
    assets = await pub.readContract({ address: p.target, abi: skyAbi, functionName: "convertToAssets", args: [shares] });
    const rate = await pub.readContract({ address: p.target, abi: skyAbi, functionName: "ssr" });
    // Annualized current per-second RAY rate, not a guaranteed future return.
    apy = Math.expm1(Math.log1p(Number(rate - 10n ** 27n) / 1e27) * 31_536_000) * 100;
    if (!Number.isFinite(apy) || apy < 0) throw new Error("Invalid savings rate");
  } else {
    const reserve = await pub.readContract({ address: AAVE_DATA_PROVIDER, abi: dataProviderAbi, functionName: "getReserveData", args: [p.underlying] });
    apy = Math.expm1(Math.log1p(Number(reserve[5]) / 1e27 / 31_536_000) * 31_536_000) * 100;
    if (!Number.isFinite(apy) || apy < 0) throw new Error("Invalid lending rate");
  }
  return { available, shares, assets, eth, apy };
}

export async function previewEarn(pub: PublicClient, intent: EarnIntent) {
  earnTransaction(intent);
  const p = EARN[intent.protocol];
  await verifyEarnDeployment(pub, intent.protocol);
  const token = intent.action === "deposit" ? p.underlying : p.receipt;
  const balance = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [intent.user] });
  if (intent.amount > balance) throw new Error("Amount exceeds wallet balance");
  if (intent.protocol === "sky") {
    const limit = intent.action === "deposit"
      ? await pub.readContract({ address: p.target, abi: skyAbi, functionName: "maxDeposit", args: [intent.user] })
      : await pub.readContract({ address: p.target, abi: skyAbi, functionName: "maxRedeem", args: [intent.user] });
    if (intent.amount > limit) throw new Error("Sky deposit or withdrawal limit exceeded");
    const output = intent.action === "deposit"
      ? await pub.readContract({ address: p.target, abi: skyAbi, functionName: "previewDeposit", args: [intent.amount] })
      : await pub.readContract({ address: p.target, abi: skyAbi, functionName: "previewRedeem", args: [intent.amount] });
    if (output < intent.minimum) throw new Error("Output below confirmed minimum");
    return output;
  }
  const config = await pub.readContract({ address: p.target, abi: poolAbi, functionName: "getConfiguration", args: [p.underlying] });
  const active = (config.data & (1n << 56n)) !== 0n;
  const frozen = (config.data & (1n << 57n)) !== 0n;
  const paused = (config.data & (1n << 60n)) !== 0n;
  if (!active || paused || (intent.action === "deposit" && frozen)) throw new Error("Aave reserve unavailable");
  if (intent.action === "withdraw") {
    const liquidity = await pub.readContract({ address: p.underlying, abi: erc20Abi, functionName: "balanceOf", args: [p.receipt] });
    if (liquidity < intent.amount) throw new Error("Insufficient Aave withdrawal liquidity");
  }
  if (intent.amount < intent.minimum) throw new Error("Output below confirmed minimum");
  return intent.amount;
}

/** Prepared for audit only. The first statement blocks ALL side effects in production. */
export async function executeEarn(input: { intent: EarnIntent; walletClient: WalletClient; publicClient: PublicClient; assertSession: () => void; stage?: (message: string) => void; onBroadcast?: (hash: Hex, step: string) => void }) {
  assertEarnExecution();
  const intent = Object.freeze({ ...input.intent });
  const { publicClient: pub, walletClient: wallet, assertSession, stage = () => undefined } = input;
  if (!wallet.account || !same(wallet.account.address, intent.user) || wallet.chain?.id !== 1) throw new Error("Wallet or network changed");
  const account = wallet.account;
  const p = EARN[intent.protocol];
  const send = async (tx: EvmTxRequest, step: string) => {
    assertSession();
    await verifyEarnDeployment(pub, intent.protocol);
    const gas = (await pub.estimateGas({ account, ...tx }) * 130n) / 100n;
    const hash = await sendEvmTransaction("eth", wallet, tx, async prepared => {
      assertEarnExecution(); assertSession();
      if (!same(wallet.account?.address ?? "", intent.user) || prepared.chainId !== 1 || !same(prepared.to ?? "", tx.to) || prepared.data !== tx.data || (prepared.value ?? 0n) !== 0n) throw new Error("Prepared Earn payment changed");
      await previewEarn(pub, intent);
    });
    input.onBroadcast?.(hash, step);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${step} failed on-chain`);
    return hash;
  };
  stage("Checking balances and route");
  await previewEarn(pub, intent);
  if (intent.action === "deposit") {
    const allowance = await pub.readContract({ address: p.underlying, abi: erc20Abi, functionName: "allowance", args: [intent.user, p.target] });
    if (allowance !== intent.amount) {
      const approve = async (amount: bigint) => send({ to: p.underlying, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.target, amount] }), value: 0n }, "Approval");
      if (allowance > 0n) { stage("Resetting approval"); await approve(0n); }
      stage("Approving exact deposit amount"); await approve(intent.amount);
      const actual = await pub.readContract({ address: p.underlying, abi: erc20Abi, functionName: "allowance", args: [intent.user, p.target] });
      if (actual !== intent.amount) throw new Error("Approval differs from confirmed amount");
    }
  }
  await previewEarn(pub, intent);
  const outputToken = intent.action === "deposit" ? p.receipt : p.underlying;
  const before = await pub.readContract({ address: outputToken, abi: erc20Abi, functionName: "balanceOf", args: [intent.user] });
  stage(intent.action === "deposit" ? "Depositing" : "Withdrawing");
  const hash = await send(earnTransaction(intent), intent.action);
  const after = await pub.readContract({ address: outputToken, abi: erc20Abi, functionName: "balanceOf", args: [intent.user] });
  if (after - before < intent.minimum) throw new Error("Transaction confirmed; received balance needs investigation. Do not retry.");
  return hash;
}