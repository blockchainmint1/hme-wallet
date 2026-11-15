/**
 * Buy TSD with stablecoins through TSD Bridge (tsd.honest.money) — the pure
 * rules. The member's own TSD Swap API key opens a MINT order
 * (`POST /api/public/v1/stables/orders`, direction "mint"); TSD Bridge answers
 * with a fresh deposit address on Ethereum or Base and mints TSD to the
 * chosen legacy T… address once the stablecoins confirm.
 *
 * Order deposit addresses come from a rotating pool, so a deposit sent after
 * the order expired can land on an address that later belongs to someone
 * else. The wallet therefore refuses to sign unless the freshly polled order
 * is still open with at least the cash-out expiry margin left, and the signed
 * bytes are exactly one ERC-20 `transfer(deposit, amount)` on the reviewed
 * token contract.
 */
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { isLegacyTxcP2pkh, ONE_TIME_EXPIRY_MARGIN_MS } from "./one-time";

export type MintChain = "eth" | "base";
export type MintSourceId = "usdc-eth" | "usdt-eth" | "pyusd-eth" | "usdc-base" | "usdt-base";

export interface MintSource {
  id: MintSourceId;
  chain: MintChain;
  /** Chain name TSD Bridge uses. */
  bridgeChain: "ethereum" | "base";
  chainId: number;
  /** Token symbol TSD Bridge uses for `token` / `depositToken`. */
  symbol: "USDC" | "USDT" | "PYUSD";
  label: string;
  contract: Address;
  decimals: number;
}

/**
 * Stablecoins this wallet recognises AND TSD Bridge watches, with the exact
 * contracts from both registries (TSD Bridge src/lib/bridge-config.ts,
 * this wallet src/lib/chains/erc20.ts). A token missing from either side is
 * never offered: a deposit on any other contract would not be credited.
 */
export const MINT_SOURCES: readonly MintSource[] = [
  { id: "usdc-eth", chain: "eth", bridgeChain: "ethereum", chainId: 1, symbol: "USDC", label: "USDC on Ethereum", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  { id: "usdt-eth", chain: "eth", bridgeChain: "ethereum", chainId: 1, symbol: "USDT", label: "USDT on Ethereum", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  { id: "pyusd-eth", chain: "eth", bridgeChain: "ethereum", chainId: 1, symbol: "PYUSD", label: "PYUSD on Ethereum", contract: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", decimals: 6 },
  { id: "usdc-base", chain: "base", bridgeChain: "base", chainId: 8453, symbol: "USDC", label: "USDC on Base", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { id: "usdt-base", chain: "base", bridgeChain: "base", chainId: 8453, symbol: "USDT", label: "USDT on Base", contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
];

export const MINT_SOURCE_IDS = MINT_SOURCES.map((s) => s.id) as [MintSourceId, ...MintSourceId[]];

export function mintSource(id: string): MintSource | null {
  return MINT_SOURCES.find((s) => s.id === id) ?? null;
}

/** Live TSD terms published by TSD Bridge (`/stables/assets`). */
export interface TsdBridgeTerms {
  live: boolean;
  minAmount: number;
  maxAmount: number;
  mintFeeBps: number;
  redeemFeeBps: number;
  depositTokens: string[];
  chains: string[];
}

/** Sources offered right now: both registries agree and TSD Bridge is live. */
export function availableMintSources(terms: TsdBridgeTerms | null | undefined): MintSource[] {
  if (!terms?.live) return [];
  const tokens = new Set(terms.depositTokens.map((t) => t.toUpperCase()));
  const chains = new Set(terms.chains.map((c) => c.toLowerCase()));
  return MINT_SOURCES.filter((s) => tokens.has(s.symbol) && chains.has(s.bridgeChain));
}

/**
 * Exact base units from a plain decimal string or JSON number, or null when
 * it isn't a plain non-negative decimal with at most `decimals` places.
 * No float arithmetic; exponent forms are refused.
 */
export function decimalUnits(v: unknown, decimals: number): bigint | null {
  let s: string;
  if (typeof v === "string") s = v.trim();
  else if (typeof v === "number" && Number.isFinite(v)) s = String(v);
  else return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Typed amount → token units, or null when empty, zero or malformed. */
export function parseMintAmount(input: string, source: MintSource): bigint | null {
  const u = decimalUnits(input, source.decimals);
  return u !== null && u > 0n ? u : null;
}

/** Amount within TSD Bridge's published limits (whole-token bounds). */
export function mintAmountInLimits(units: bigint, source: MintSource, terms: TsdBridgeTerms): boolean {
  const min = decimalUnits(String(terms.minAmount), source.decimals);
  const max = decimalUnits(String(terms.maxAmount), source.decimals);
  if (min === null || max === null) return false;
  return units >= min && units <= max;
}

/** TSD (8 decimals) expected for a stablecoin deposit after the mint fee. */
export function estimateTsdOut(units: bigint, source: MintSource, feeBps: number): bigint {
  if (units <= 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) return 0n;
  const scaled = units * 10n ** BigInt(8 - source.decimals);
  return (scaled * BigInt(10_000 - feeBps)) / 10_000n;
}

export function formatUnitsPlain(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

export interface MintOrderRequest {
  source: MintSource;
  /** Exactly as sent to TSD Bridge (plain decimal string). */
  amount: string;
  recipient: string;
}

/** Raw mint-order fields as returned by TSD Bridge. */
export interface MintOrderResponse {
  id?: unknown;
  status?: unknown;
  direction?: unknown;
  asset?: unknown;
  depositAddress?: unknown;
  sendTo?: unknown;
  address?: unknown;
  depositToken?: unknown;
  recipient?: unknown;
  chain?: unknown;
  amountExpected?: unknown;
  mintFeeBps?: unknown;
  feeBps?: unknown;
  expiresAt?: unknown;
}

export interface VerifiedMintOrder {
  id: string;
  sourceId: MintSourceId;
  depositAddress: Address;
  /** Stablecoin base units the wallet will transfer. */
  units: string;
  amount: string;
  recipient: string;
  feeBps: number;
  expiresAt: string;
}

export interface MintVerifyContext {
  /** This wallet's own EVM addresses; a deposit address may never be one. */
  ownEvmAddresses?: readonly string[];
  now?: number;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Accept a mint order only if it is exactly what we asked for: same token,
 * chain, amount and TSD recipient, a fresh EVM deposit address that is not
 * this wallet, a token contract or the zero address, and at least an hour
 * before it expires. Throws a user-readable message otherwise.
 */
export function verifyMintOrder(
  req: MintOrderRequest,
  res: MintOrderResponse,
  ctx: MintVerifyContext = {},
): VerifiedMintOrder {
  const now = ctx.now ?? Date.now();
  const fail = (why: string): never => {
    throw new Error(`TSD Bridge's order didn't match (${why}). Nothing was sent.`);
  };
  const id = str(res.id);
  if (!/^[A-Za-z0-9-]{4,80}$/.test(id)) fail("missing order id");
  if (str(res.direction).toLowerCase() !== "mint") fail("not a TSD purchase order");
  if (str(res.asset).toUpperCase() !== "TSD") fail("not a TSD order");
  if (str(res.status) !== "awaiting_deposit") fail("order is not waiting for a deposit");

  const deposit = str(res.depositAddress);
  if (!EVM_RE.test(deposit) || deposit.toLowerCase() === ZERO) fail("deposit address is not a valid 0x… address");
  for (const alias of [str(res.sendTo), str(res.address)]) {
    if (alias && alias.toLowerCase() !== deposit.toLowerCase()) fail("deposit addresses disagree");
  }
  const lower = deposit.toLowerCase();
  if ((ctx.ownEvmAddresses ?? []).some((a) => a.trim().toLowerCase() === lower)) {
    fail("deposit address belongs to this wallet");
  }
  if (MINT_SOURCES.some((s) => s.contract.toLowerCase() === lower)) fail("deposit address is a token contract");

  if (str(res.chain).toLowerCase() !== req.source.bridgeChain) fail("network changed");
  if (str(res.depositToken).toUpperCase() !== req.source.symbol) fail("stablecoin changed");
  if (!isLegacyTxcP2pkh(req.recipient) || str(res.recipient) !== req.recipient.trim()) {
    fail("TSD recipient changed");
  }

  const wanted = decimalUnits(req.amount, req.source.decimals);
  const echoed = decimalUnits(res.amountExpected, req.source.decimals);
  if (wanted === null || wanted <= 0n || echoed === null || wanted !== echoed) fail("amount changed");

  const feeRaw = res.mintFeeBps ?? res.feeBps;
  const feeBps = typeof feeRaw === "number" ? feeRaw : typeof feeRaw === "string" && feeRaw.trim() ? Number(feeRaw) : NaN;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) fail("fee is missing");

  const expiresAt = str(res.expiresAt);
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) fail("no expiry time");
  if (exp - now <= ONE_TIME_EXPIRY_MARGIN_MS) fail("order already expired");

  return {
    id,
    sourceId: req.source.id,
    depositAddress: deposit as Address,
    units: wanted!.toString(),
    amount: req.amount.trim(),
    recipient: req.recipient.trim(),
    feeBps,
    expiresAt,
  };
}

/** True while a mint order can still safely be paid. */
export function mintOrderStillOpen(expiresAt: string, now: number = Date.now()): boolean {
  const exp = Date.parse(expiresAt);
  return Number.isFinite(exp) && exp - now > ONE_TIME_EXPIRY_MARGIN_MS;
}

/**
 * Right before signing, the freshly polled order must still be waiting for
 * exactly this deposit. TSD Bridge's order-status reply does not echo the TSD
 * recipient or token; those were verified when the order was created.
 */
export function recheckMintOrder(
  locked: VerifiedMintOrder,
  order: MintOrderResponse,
  now: number = Date.now(),
): void {
  const fail = (why: string): never => {
    throw new Error(`TSD Bridge's order changed (${why}). Nothing was sent — start again.`);
  };
  const source = mintSource(locked.sourceId);
  if (!source) fail("unknown stablecoin");
  if (str(order.id) !== locked.id) fail("different order");
  if (str(order.status) !== "awaiting_deposit") fail("it is no longer waiting for a deposit");
  if (str(order.depositAddress).toLowerCase() !== locked.depositAddress.toLowerCase()) fail("deposit address changed");
  const chain = str(order.chain).toLowerCase();
  if (chain && chain !== source!.bridgeChain) fail("network changed");
  const echoed = decimalUnits(order.amountExpected, source!.decimals);
  if (echoed === null || echoed.toString() !== locked.units) fail("amount changed");
  if (!mintOrderStillOpen(str(order.expiresAt), now)) fail("less than an hour left");
}

/** The single ERC-20 transfer that pays a verified mint order. */
export function buildMintTransfer(locked: VerifiedMintOrder): { to: Address; data: Hex; value: bigint } {
  const source = mintSource(locked.sourceId);
  if (!source) throw new Error("Unknown stablecoin. Nothing was sent.");
  return {
    to: source.contract,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [locked.depositAddress, BigInt(locked.units)],
    }),
    value: 0n,
  };
}

/**
 * Pre-signing guard for `sendEvmTransaction`: the prepared request must be
 * exactly the reviewed transfer on the reviewed chain — no value, no other
 * contract, recipient or amount.
 */
export function assertMintTransferRequest(
  locked: VerifiedMintOrder,
  request: { to?: Address | null; data?: Hex; value?: bigint; chainId?: number },
): void {
  const source = mintSource(locked.sourceId);
  const fail = (why: string): never => {
    throw new Error(`Signing refused: the transaction ${why}. Nothing was sent.`);
  };
  if (!source) fail("names an unknown stablecoin");
  if (request.chainId !== undefined && request.chainId !== source!.chainId) fail("is on the wrong network");
  if ((request.to ?? "").toLowerCase() !== source!.contract.toLowerCase()) fail("targets a different contract");
  if (request.value !== undefined && request.value !== 0n) fail("carries a coin value");
  const expected = buildMintTransfer(locked).data.toLowerCase();
  if ((request.data ?? "").toLowerCase() !== expected) {
    try {
      const d = decodeFunctionData({ abi: erc20Abi, data: request.data ?? "0x" });
      if (d.functionName !== "transfer") fail("is not a plain transfer");
    } catch {
      fail("is not a plain transfer");
    }
    fail("pays a different address or amount");
  }
}

/** Human copy for a mint order's status. */
export function mintStatusLabel(status: string): string {
  switch (status) {
    case "awaiting_deposit":
      return "Waiting for your stablecoins";
    case "detected":
      return "Received — confirming";
    case "paying":
      return "Sending TSD";
    case "released":
      return "TSD sent";
    case "refunded":
      return "Refunded";
    case "expired":
      return "Order expired";
    case "failed":
      return "Needs TSD Bridge's help";
    default:
      return "In progress";
  }
}
