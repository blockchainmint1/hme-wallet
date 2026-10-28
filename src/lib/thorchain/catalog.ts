/**
 * THORChain route catalog for the desktop swap page (client-safe).
 *
 * Every route is a direct native THORChain swap: the wallet sends the source
 * asset to THORChain's current vault (with a memo naming the payout), and the
 * network pays the destination asset to the chosen address. No wrapping, no
 * custodian, no aggregator, no affiliate fees.
 *
 * Safety model:
 * - Routers are PINNED here and cross-checked against live inbound_addresses
 *   on every quote (server side). A changed router refuses the route.
 * - The memo is validated to bind the exact destination asset, payout address
 *   and an after-fee minimum (liquidity_tolerance_bps, never feeless).
 * - Amounts are bigint-only and limited to THORChain's 1e8 precision, so the
 *   displayed amount, the quoted amount and the signed amount are identical.
 */
import { address as btcAddress } from "bitcoinjs-lib";
import { getAddress, isAddress, parseAbi, type Address } from "viem";
import { BTC_NETWORK } from "@/lib/btc/network";
import { LTC_NETWORK } from "@/lib/ltc/network";
import { DOGE_NETWORK } from "@/lib/doge/network";

export type ThorUtxoCoin = "btc" | "ltc" | "doge";
export type ThorEvmChain = "eth" | "base" | "bsc";
export type ThorAssetId =
  | ThorUtxoCoin
  | "eth"
  | "base-eth"
  | "bsc-bnb"
  | "usdc-eth"
  | "usdc-base"
  | "usdc-bsc"
  | "usdt-eth"
  | "usdt-bsc";

export interface ThorAssetMeta {
  id: ThorAssetId;
  /** Full THORChain asset string, e.g. ETH.USDC-0XA0B8… */
  thorAsset: string;
  symbol: string;
  label: string;
  /** Our internal chain id. */
  chain: ThorUtxoCoin | ThorEvmChain;
  /** THORChain chain code used for halt flags and inbound records. */
  thorChain: "BTC" | "DOGE" | "LTC" | "ETH" | "BASE" | "BSC";
  kind: "utxo" | "evm-native" | "evm-token";
  /** Chain-native decimals (BTC/LTC/DOGE 8, ETH/BNB 18, USDC/USDT 6). */
  decimals: number;
  /** ERC-20 contract for evm-token assets. */
  contract?: Address;
  /** THORChain's terse gas-asset memo code, as observed in live THORNode memos (b, d, l, e, f, s). */
  terse?: string;
}

/** Pinned THORChain routers, verified against live inbound_addresses. */
export const THOR_EVM_ROUTERS: Record<ThorEvmChain, Address> = {
  eth: getAddress("0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146"),
  base: getAddress("0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4"),
  bsc: getAddress("0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b"),
};

export const THOR_CATALOG: Record<ThorAssetId, ThorAssetMeta> = {
  btc: { id: "btc", thorAsset: "BTC.BTC", symbol: "BTC", label: "Bitcoin", chain: "btc", thorChain: "BTC", kind: "utxo", decimals: 8, terse: "b" },
  doge: { id: "doge", thorAsset: "DOGE.DOGE", symbol: "DOGE", label: "Dogecoin", chain: "doge", thorChain: "DOGE", kind: "utxo", decimals: 8, terse: "d" },
  ltc: { id: "ltc", thorAsset: "LTC.LTC", symbol: "LTC", label: "Litecoin", chain: "ltc", thorChain: "LTC", kind: "utxo", decimals: 8, terse: "l" },
  eth: { id: "eth", thorAsset: "ETH.ETH", symbol: "ETH", label: "Ethereum", chain: "eth", thorChain: "ETH", kind: "evm-native", decimals: 18, terse: "e" },
  "base-eth": { id: "base-eth", thorAsset: "BASE.ETH", symbol: "ETH", label: "ETH on Base", chain: "base", thorChain: "BASE", kind: "evm-native", decimals: 18, terse: "f" },
  "bsc-bnb": { id: "bsc-bnb", thorAsset: "BSC.BNB", symbol: "BNB", label: "BNB Chain", chain: "bsc", thorChain: "BSC", kind: "evm-native", decimals: 18, terse: "s" },
  "usdc-eth": { id: "usdc-eth", thorAsset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", symbol: "USDC", label: "USDC on Ethereum", chain: "eth", thorChain: "ETH", kind: "evm-token", decimals: 6, contract: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") },
  "usdc-base": { id: "usdc-base", thorAsset: "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", symbol: "USDC", label: "USDC on Base", chain: "base", thorChain: "BASE", kind: "evm-token", decimals: 6, contract: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") },
  "usdc-bsc": { id: "usdc-bsc", thorAsset: "BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D", symbol: "USDC", label: "USDC on BNB Chain", chain: "bsc", thorChain: "BSC", kind: "evm-token", decimals: 6, contract: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d") },
  "usdt-eth": { id: "usdt-eth", thorAsset: "ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7", symbol: "USDT", label: "USDT on Ethereum", chain: "eth", thorChain: "ETH", kind: "evm-token", decimals: 6, contract: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7") },
  "usdt-bsc": { id: "usdt-bsc", thorAsset: "BSC.USDT-0X55D398326F99059FF775485246999027B3197955", symbol: "USDT", label: "USDT on BNB Chain", chain: "bsc", thorChain: "BSC", kind: "evm-token", decimals: 6, contract: getAddress("0x55d398326f99059ff775485246999027B3197955") },
};

export const THOR_ASSET_IDS = Object.keys(THOR_CATALOG) as ThorAssetId[];

export const thorRouterAbi = parseAbi([
  "function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration) payable",
]);

/** THORChain tracks every asset in fixed 1e8 units. */
export const THOR_DECIMALS = 8;

/**
 * Parse a user-entered decimal amount into chain-native raw units.
 * Precision is capped at THORChain's 1e8 so the signed amount can never
 * differ from the quoted amount.
 */
export function parseAssetAmount(amount: string, decimals: number): bigint {
  const maxFrac = Math.min(decimals, THOR_DECIMALS);
  const re = new RegExp(`^(?:0|[1-9]\\d{0,30})(?:\\.\\d{1,${maxFrac}})?$`);
  if (!re.test(amount)) {
    throw new Error(`Enter a positive amount with at most ${maxFrac} decimal places.`);
  }
  const [whole, fraction = ""] = amount.split(".");
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(maxFrac, "0")) * 10n ** BigInt(decimals - maxFrac);
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  return raw;
}

/** Chain-native raw units → THORChain 1e8 units (exact by construction). */
export function toThorUnits(raw: bigint, decimals: number): string {
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  if (decimals === THOR_DECIMALS) return raw.toString();
  if (decimals < THOR_DECIMALS) return (raw * 10n ** BigInt(THOR_DECIMALS - decimals)).toString();
  const factor = 10n ** BigInt(decimals - THOR_DECIMALS);
  if (raw % factor !== 0n) throw new Error("Amount is more precise than THORChain can track.");
  return (raw / factor).toString();
}

/** THORChain 1e8 integer string → human number for display. */
export function thorUnitsToNumber(v: string | number): number {
  return Number(v) / 100_000_000;
}

/** Validate a payout address for the destination asset's chain. */
export function validateThorDestination(asset: ThorAssetMeta, destination: string): void {
  if (!destination || destination !== destination.trim() || destination.length > 120) {
    throw new Error(`Enter a valid ${asset.label} address.`);
  }
  try {
    if (asset.kind === "utxo") {
      const network = asset.chain === "btc" ? BTC_NETWORK : asset.chain === "ltc" ? LTC_NETWORK : DOGE_NETWORK;
      btcAddress.toOutputScript(destination, network);
    } else if (!isAddress(destination)) {
      throw new Error("bad evm address");
    }
  } catch {
    throw new Error(`Enter a valid ${asset.label} address.`);
  }
}

const positiveInteger = (value: string) => /^[1-9]\d{0,77}$/.test(value);

/**
 * Bind a THORChain swap memo to the exact destination asset, payout address
 * and an after-fee minimum. Affiliates and extra memo fields are forbidden.
 * Returns the enforced minimum output (1e8 units).
 */
export function validateSwapMemo(
  memo: string,
  to: ThorAssetMeta,
  destination: string,
  expectedOut: string,
  toleranceBps: number,
): string {
  if (!positiveInteger(expectedOut)) throw new Error("Invalid THORChain payout amount.");
  if (!Number.isInteger(toleranceBps) || toleranceBps < 1 || toleranceBps > 2000) {
    throw new Error("Invalid price protection.");
  }
  const parts = memo.split(":");
  const [action, asset, payout, limit] = parts;
  // THORChain memos may use the short asset form (BASE.USDC) or a verified
  // terse alias (b for BTC.BTC) instead of the full contract-suffixed form.
  // Only explicit per-asset aliases are accepted, so a memo can never resolve
  // to a different asset.
  const shortAsset = to.thorAsset.split("-")[0]!;
  const accepted = [to.thorAsset, shortAsset, ...(to.terse ? [to.terse] : [])];
  const assetOk = accepted.some((a) => a.toUpperCase() === (asset ?? "").toUpperCase());
  if (
    parts.length !== 4 ||
    !["=", "SWAP", "s"].includes(action ?? "") ||
    !assetOk ||
    payout !== destination
  ) {
    throw new Error("THORChain memo changed the destination, asset or added a fee recipient.");
  }
  const match = /^([1-9]\d{0,77})\/1\/(0)$/.exec(limit ?? "");
  if (!match?.[1]) throw new Error("THORChain memo has an unsupported price limit or streaming format.");
  const minimum = BigInt(match[1]);
  const expected = BigInt(expectedOut);
  // The memo minimum must protect the quoted AFTER-FEE payout within the
  // requested tolerance, and can never exceed the expected payout.
  const floor = (expected * BigInt(10_000 - toleranceBps)) / 10_000n;
  if (minimum < floor || minimum > expected) {
    throw new Error("THORChain minimum does not protect the quoted payout.");
  }
  return minimum.toString();
}

/**
 * Build the memo this wallet actually signs from its own validated parts —
 * never THORNode's memo string. EVM sources (no size limit) always use the
 * full contract-suffixed asset. UTXO sources use the shortest form that fits
 * THORChain's 80-byte OP_RETURN: the terse gas code, the full asset, or — for
 * tokens only — the short ticker form, but only when the caller has verified
 * it matches exactly one live pool (`shortIsUnique`).
 */
export const OP_RETURN_MEMO_MAX = 80;
export function buildSwapMemo(
  from: ThorAssetMeta,
  to: ThorAssetMeta,
  destination: string,
  minimumOut: string,
  shortIsUnique = false,
): string {
  if (!positiveInteger(minimumOut)) throw new Error("Invalid THORChain minimum payout.");
  validateThorDestination(to, destination);
  const tail = `:${destination}:${minimumOut}/1/0`;
  if (from.kind !== "utxo") return `=:${to.thorAsset}${tail}`;
  const candidates = [
    ...(to.terse ? [to.terse] : []),
    to.thorAsset,
    ...(to.kind === "evm-token" && shortIsUnique ? [to.thorAsset.split("-")[0]!] : []),
  ];
  for (const asset of candidates) {
    const memo = `=:${asset}${tail}`;
    if (new TextEncoder().encode(memo).length <= OP_RETURN_MEMO_MAX) return memo;
  }
  throw new Error(`This route's swap instruction is too long for a ${from.symbol} transaction. Pick another route.`);
}

/** A validated, frozen quote ready for review and signing. */
export interface ThorCatalogQuote {
  provider: "thorchain";
  from: ThorAssetId;
  to: ThorAssetId;
  /** Source amount in chain-native raw units (bigint string). */
  rawIn: string;
  /** Source amount in THORChain 1e8 units. */
  amountIn: string;
  destination: string;
  /** Refund address sent implicitly by the depositing address/inputs. */
  inbound: string;
  router: string | null;
  memo: string;
  expiry: number;
  /** Expected payout, 1e8 units of the destination asset. */
  expectedOut: string;
  /** Enforced minimum payout from the memo, 1e8 units. */
  minimumOut: string;
  /** Total fees, 1e8 units of the destination asset. */
  feeOut: string;
  seconds: number | null;
  toleranceBps: number;
  quotedAt: number;
}

/** Freshness rules shared by quoting and execution. */
export function assertQuoteFresh(quote: Pick<ThorCatalogQuote, "expiry" | "quotedAt">, now = Date.now()): void {
  if (!Number.isSafeInteger(quote.expiry) || quote.expiry * 1000 <= now + 60_000) {
    throw new Error("This quote is expiring. Get a new quote.");
  }
  if (quote.quotedAt > now || now - quote.quotedAt > 120_000) {
    throw new Error("This quote is stale. Get a new quote.");
  }
}
