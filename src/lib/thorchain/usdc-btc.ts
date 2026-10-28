import { address as btcAddress } from "bitcoinjs-lib";
import { encodeFunctionData, erc20Abi, isAddress, parseAbi, type Address, type Hex } from "viem";
import { BTC_NETWORK } from "@/lib/btc/network";

/** Restricted direct THORChain route. Never enters LI.FI or selects another provider. */
export const THOR_USDC = {
  eth: { label: "Ethereum", chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", router: "0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146", chain: "ETH" },
  base: { label: "Base", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", router: "0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4", chain: "BASE" },
} as const;
export type ThorUsdcNetwork = keyof typeof THOR_USDC;
export type ThorBtcIntent = Readonly<{ network: ThorUsdcNetwork; amount: string; destination: string }>;
export type ThorBtcQuote = Readonly<{
  intent: ThorBtcIntent; provider: "thorchain"; inbound: Address; router: Address;
  memo: string; expiry: number; expectedSats: string; minimumSats: string;
  feeSats: string; seconds: number | null; quotedAt: number;
}>;
export const thorRouterAbi = parseAbi(["function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration) payable"]);

export function usdcRaw(amount: string): bigint {
  if (!/^(?:0|[1-9]\d{0,30})(?:\.\d{1,6})?$/.test(amount)) throw new Error("Enter a positive USDC amount with at most 6 decimal places.");
  const [whole, fraction = ""] = amount.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (raw <= 0n) throw new Error("USDC amount must be greater than zero.");
  return raw;
}
export function validateThorBtcIntent(intent: ThorBtcIntent): void {
  if (intent.network !== "eth" && intent.network !== "base") throw new Error("Select USDC on Ethereum or Base.");
  usdcRaw(intent.amount);
  if (intent.destination.length > 90 || intent.destination !== intent.destination.trim()) throw new Error("Enter a Bitcoin mainnet address.");
  try { btcAddress.toOutputScript(intent.destination, BTC_NETWORK); }
  catch { throw new Error("Enter a valid Bitcoin mainnet address, not an EVM address or payment link."); }
}
export function assertThorBtcExecution(): never {
  throw new Error("THORChain USDC-to-BTC spending awaits independent review and funded device testing. No approval or payment was sent.");
}
const positiveInteger = (value: string) => /^[1-9]\d{0,77}$/.test(value);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Memo is bound to a real BTC address, after-fee minimum and single-block streaming; affiliates forbidden. */
export function thorBtcMemoMinimum(memo: string, destination: string, expected: string, maximumStreaming: number): string {
  if (!positiveInteger(expected) || !Number.isSafeInteger(maximumStreaming) || maximumStreaming < 1) throw new Error("Invalid THORChain output or streaming limit.");
  const parts = memo.split(":");
  const [action, asset, payout, limit] = parts;
  if (parts.length !== 4 || !["=", "SWAP", "s"].includes(action ?? "") || !["B", "BTC", "BTC.BTC"].includes((asset ?? "").toUpperCase()) || payout !== destination) throw new Error("THORChain memo changed the Bitcoin destination, asset or fee recipient.");
  const match = /^([1-9]\d{0,77})\/1\/(0)$/.exec(limit ?? "");
  if (!match?.[1]) throw new Error("THORChain memo has an unsupported price limit or streaming format.");
  const minimum = BigInt(match[1]);
  const expectedSats = BigInt(expected);
  // Request exactly 1% price protection relative to output AFTER exchange fees.
  if (minimum < expectedSats * 9900n / 10000n || minimum > expectedSats || minimum <= 0n) throw new Error("THORChain minimum does not protect the quoted Bitcoin payout.");
  if (match[2] !== undefined && Number(match[2]) > maximumStreaming) throw new Error("THORChain streaming quantity exceeds this quote's limit.");
  return minimum.toString();
}
export function validateThorBtcQuote(quote: ThorBtcQuote, now = Date.now()): void {
  validateThorBtcIntent(quote.intent);
  const config = THOR_USDC[quote.intent.network];
  if (quote.provider !== "thorchain" || !isAddress(quote.inbound) || same(quote.inbound, "0x0000000000000000000000000000000000000000") || !same(quote.router, config.router)) throw new Error("THORChain router or deposit address changed.");
  if (!Number.isSafeInteger(quote.expiry) || quote.expiry * 1000 <= now + 60_000 || quote.quotedAt > now || now - quote.quotedAt > 60_000) throw new Error("Quote is stale or expiring. Get a new quote.");
  if (!positiveInteger(quote.minimumSats) || !positiveInteger(quote.expectedSats)) throw new Error("Invalid Bitcoin payout.");
  const minimum = thorBtcMemoMinimum(quote.memo, quote.intent.destination, quote.expectedSats, 1_000_000_000);
  if (minimum !== quote.minimumSats) throw new Error("Displayed Bitcoin minimum differs from signing instructions.");
}
/** Unsigned audit candidate ONLY. Exposing this builder never authorizes spending. */
export function thorBtcDeposit(quote: ThorBtcQuote, now = Date.now()): { to: Address; value: bigint; data: Hex } {
  validateThorBtcQuote(quote, now);
  const config = THOR_USDC[quote.intent.network];
  return { to: quote.router, value: 0n, data: encodeFunctionData({ abi: thorRouterAbi, functionName: "depositWithExpiry", args: [quote.inbound, config.token, usdcRaw(quote.intent.amount), quote.memo, BigInt(quote.expiry)] }) };
}
export function thorBtcApproval(quote: ThorBtcQuote, reset = false, now = Date.now()): { to: Address; value: bigint; data: Hex } {
  validateThorBtcQuote(quote, now);
  return { to: THOR_USDC[quote.intent.network].token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [quote.router, reset ? 0n : usdcRaw(quote.intent.amount)] }) };
}