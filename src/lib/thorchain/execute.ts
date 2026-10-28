/**
 * THORChain swap execution for the desktop swap page.
 *
 * Every send is bound to a frozen, server-validated quote:
 * - UTXO sources build a deposit transaction with the quote's memo in an
 *   OP_RETURN and the exact quoted amount to the exact inbound address.
 * - EVM sources call the pinned router's depositWithExpiry with calldata
 *   rebuilt from the frozen quote; a beforeSign guard compares the actual
 *   prepared transaction bytes against that rebuild on every attempt, so a
 *   tampered request can never be signed.
 * - ERC-20 sources approve the exact quoted amount (resetting a stale
 *   allowance first), never an unlimited approval.
 */
import { encodeFunctionData, erc20Abi, zeroAddress, type Address, type Hex, type WalletClient } from "viem";
import type { BIP32Interface } from "bip32";
import {
  THOR_CATALOG,
  assertQuoteFresh,
  thorRouterAbi,
  type ThorAssetMeta,
  type ThorCatalogQuote,
  type ThorUtxoCoin,
} from "./catalog";
import { evmClient, type EvmChainId } from "@/lib/chains/evm";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { OP_RETURN_MAX_BYTES } from "@/lib/utxo/op-return";
import { buildAndSignTx as buildBtc } from "@/lib/btc/wallet";
import { buildAndSignTx as buildLtc } from "@/lib/ltc/wallet";
import { buildAndSignTx as buildDoge } from "@/lib/doge/wallet";
import * as btcNode from "@/lib/btc/mempool";
import * as ltcNode from "@/lib/ltc/mempool";
import * as dogeNode from "@/lib/doge/mempool";
import { BTC_DEFAULT_KIND } from "@/lib/btc/network";
import { LTC_DEFAULT_KIND } from "@/lib/ltc/network";
import { DOGE_DEFAULT_KIND } from "@/lib/doge/network";

interface UtxoInput {
  txid: string;
  vout: number;
  value: number;
}

export interface UtxoAccountLike {
  utxos: UtxoInput[];
  nextChangeAddress: string;
  nextChangeIndex: number;
}

interface UtxoThorConfig {
  kind: string;
  /** vsize model: native SegWit for BTC/LTC, legacy P2PKH for DOGE. */
  v: { input: number; output: number; overhead: number };
  fallbackFeeRate: number;
  getFeeEstimates: () => Promise<{ fastestFee: number; halfHourFee: number; hourFee: number; minimumFee: number }>;
  broadcast: (hex: string) => Promise<string>;
  explorerTxUrl: (txid: string) => string;
}

const OP_RETURN_VBYTES = 90;

export const THOR_UTXO_COINS: Record<ThorUtxoCoin, UtxoThorConfig> = {
  btc: {
    kind: BTC_DEFAULT_KIND,
    v: { input: 68, output: 31, overhead: 11 },
    fallbackFeeRate: 10,
    getFeeEstimates: btcNode.getFeeEstimates,
    broadcast: btcNode.broadcastTx,
    explorerTxUrl: btcNode.explorerTxUrl,
  },
  ltc: {
    kind: LTC_DEFAULT_KIND,
    v: { input: 68, output: 31, overhead: 11 },
    fallbackFeeRate: 100,
    getFeeEstimates: ltcNode.getFeeEstimates,
    broadcast: ltcNode.broadcastTx,
    explorerTxUrl: ltcNode.explorerTxUrl,
  },
  doge: {
    kind: DOGE_DEFAULT_KIND,
    v: { input: 148, output: 34, overhead: 10 },
    fallbackFeeRate: 1000,
    getFeeEstimates: dogeNode.getFeeEstimates,
    broadcast: dogeNode.broadcastTx,
    explorerTxUrl: dogeNode.explorerTxUrl,
  },
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Unsigned deposit transaction rebuilt from a frozen quote. */
export function thorDepositRequest(quote: ThorCatalogQuote): { to: Address; value: bigint; data: Hex } {
  const from = THOR_CATALOG[quote.from];
  if (!from || from.kind === "utxo" || !quote.router) throw new Error("Not an EVM THORChain route.");
  assertQuoteFresh(quote);
  const asset = from.kind === "evm-native" ? zeroAddress : from.contract;
  if (!asset) throw new Error("Token contract unavailable.");
  return {
    to: quote.router as Address,
    value: from.kind === "evm-native" ? BigInt(quote.rawIn) : 0n,
    data: encodeFunctionData({
      abi: thorRouterAbi,
      functionName: "depositWithExpiry",
      args: [quote.inbound as Address, asset, BigInt(quote.rawIn), quote.memo, BigInt(quote.expiry)],
    }),
  };
}

/** Unsigned exact-amount (or zero-reset) approval for an ERC-20 source. */
export function thorApprovalRequest(quote: ThorCatalogQuote, reset = false): { to: Address; value: bigint; data: Hex } {
  const from = THOR_CATALOG[quote.from];
  if (!from || from.kind !== "evm-token" || !from.contract || !quote.router) {
    throw new Error("Not an ERC-20 THORChain route.");
  }
  assertQuoteFresh(quote);
  return {
    to: from.contract,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [quote.router as Address, reset ? 0n : BigInt(quote.rawIn)],
    }),
  };
}

/**
 * Pre-signing guard: the prepared transaction must be byte-identical to the
 * request rebuilt from the frozen quote. Runs on every signing attempt.
 */
export function makeThorGuard(expected: { to: Address; value: bigint; data: Hex }) {
  return (request: { to?: Address | null; data?: Hex; value?: bigint }) => {
    if (!request.to || !same(request.to, expected.to)) {
      throw new Error("Transaction target changed. Nothing was signed.");
    }
    if ((request.data ?? "0x").toLowerCase() !== expected.data.toLowerCase()) {
      throw new Error("Transaction instructions changed. Nothing was signed.");
    }
    if ((request.value ?? 0n) !== expected.value) {
      throw new Error("Transaction value changed. Nothing was signed.");
    }
  };
}

/**
 * Execute an EVM-source THORChain swap. Returns the deposit transaction hash.
 * For ERC-20 sources this sends reset-approval (when a stale allowance
 * exists), exact-amount approval, then the deposit — each guarded.
 */
export async function executeEvmThorSwap(args: {
  quote: ThorCatalogQuote;
  walletClient: WalletClient;
}): Promise<{ hash: string }> {
  const { quote, walletClient } = args;
  const from = THOR_CATALOG[quote.from];
  if (!from || from.kind === "utxo") throw new Error("Not an EVM THORChain route.");
  assertQuoteFresh(quote);
  const account = walletClient.account;
  if (!account) throw new Error("Wallet locked");
  const chainId = from.chain as EvmChainId;

  if (from.kind === "evm-token") {
    if (!from.contract || !quote.router) throw new Error("Token route unavailable.");
    const pub = evmClient(chainId);
    const readAllowance = async () => (await pub.readContract({
      address: from.contract as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address as Address, quote.router as Address],
    })) as bigint;
    const sendApproval = async (reset: boolean) => {
      const request = thorApprovalRequest(quote, reset);
      const guard = makeThorGuard(request);
      const hash = await sendEvmTransaction(chainId, walletClient, request, (prepared) => {
        assertQuoteFresh(quote);
        guard(prepared);
      });
      let receipt;
      try {
        receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      } catch {
        throw new Error(`Token approval confirmation could not be verified (${hash}). The swap deposit was not sent. Check the approval before retrying.`);
      }
      if (receipt.status !== "success") {
        throw new Error(`Token approval failed (${hash}). The swap deposit was not sent.`);
      }
      assertQuoteFresh(quote);
      const expected = reset ? 0n : BigInt(quote.rawIn);
      if (await readAllowance() !== expected) {
        throw new Error("Confirmed token allowance does not match this swap. The swap deposit was not sent.");
      }
    };
    const allowance = await readAllowance();
    // An already-confirmed exact approval is safe to reuse after a failed
    // deposit preparation; never create unnecessary reset/approval sends.
    if (allowance !== BigInt(quote.rawIn)) {
      if (allowance > 0n) await sendApproval(true);
      await sendApproval(false);
    }
  }

  const deposit = thorDepositRequest(quote);
  const guard = makeThorGuard(deposit);
  const hash = await sendEvmTransaction(chainId, walletClient, deposit, (prepared) => {
    assertQuoteFresh(quote);
    guard(prepared);
  });
  return { hash };
}

export interface UtxoSwapPlan {
  inputs: UtxoInput[];
  feeSats: number;
  vsize: number;
}

/**
 * Pick inputs for a UTXO-source swap, sizing the fee as we go. Returns null
 * when the account cannot cover amount + fee.
 */
export function planUtxoThorSwap(
  coin: ThorUtxoCoin,
  utxos: UtxoInput[],
  amountSats: number,
  feeRate: number,
): UtxoSwapPlan | null {
  const cfg = THOR_UTXO_COINS[coin];
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const picked: UtxoInput[] = [];
  let acc = 0;
  for (const u of sorted) {
    picked.push(u);
    acc += u.value;
    const vsize = cfg.v.overhead + cfg.v.input * picked.length + cfg.v.output * 2 + OP_RETURN_VBYTES;
    const feeSats = Math.ceil(vsize * feeRate);
    if (acc >= amountSats + feeSats) return { inputs: picked, feeSats, vsize };
  }
  return null;
}

/**
 * Execute a UTXO-source THORChain swap: build the deposit transaction with
 * the quote's memo, sign locally and broadcast. Returns the txid.
 */
export async function executeUtxoThorSwap(args: {
  coin: ThorUtxoCoin;
  root: BIP32Interface;
  account: UtxoAccountLike;
  quote: ThorCatalogQuote;
  feeRate: number;
}): Promise<{ txid: string; feeSats: number }> {
  const { coin, root, account, quote, feeRate } = args;
  const from = THOR_CATALOG[quote.from];
  if (!from || from.kind !== "utxo" || from.chain !== coin) throw new Error("Quote does not match this coin.");
  assertQuoteFresh(quote);
  if (new TextEncoder().encode(quote.memo).length > OP_RETURN_MAX_BYTES) {
    throw new Error(`This route's memo is too long for a ${from.symbol} transaction. Pick another route.`);
  }
  const amountSats = Number(quote.rawIn);
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error("Invalid swap amount.");
  const plan = planUtxoThorSwap(coin, account.utxos, amountSats, feeRate);
  if (!plan) throw new Error("Not enough funds for this swap plus the network fee.");

  const build = coin === "btc" ? buildBtc : coin === "ltc" ? buildLtc : buildDoge;
  const built = build({
    root,
    kind: THOR_UTXO_COINS[coin].kind as never,
    inputs: plan.inputs as never,
    outputs: [{ address: quote.inbound, valueSats: amountSats }],
    changeAddress: account.nextChangeAddress,
    changeIndex: account.nextChangeIndex,
    feeSats: plan.feeSats,
    memo: quote.memo,
  });
  const txid = await THOR_UTXO_COINS[coin].broadcast(built.hex);
  return { txid, feeSats: plan.feeSats };
}

/** Source asset metadata helper for the UI. */
export function thorSourceMeta(quote: ThorCatalogQuote): ThorAssetMeta {
  return THOR_CATALOG[quote.from];
}
