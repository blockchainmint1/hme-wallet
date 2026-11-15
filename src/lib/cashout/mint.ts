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
import { isLegacyTxcP2pkh } from "./one-time";

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

/**
 * Where MINT_SOURCES' contracts come from. TSD Bridge's public feed names
 * deposit tokens by symbol only, so the five contracts are pinned from TSD
 * Bridge's own deposit-watcher list (detection reads only these contracts).
 * `writtenConfirmation` stays null until TSD Bridge confirms the list in
 * writing; while it is null `availableMintSources` offers nothing and the
 * server refuses to open orders. Once the feed or an order publishes
 * contracts, any difference from this pin is refused.
 */
export const TSD_BRIDGE_CONTRACT_PIN: Readonly<{ source: string; writtenConfirmation: string | null }> = Object.freeze({
  source: "TSD Bridge src/lib/bridge-config.ts TOKENS (project snapshot 693bace2, read 2026-11-15)",
  writtenConfirmation:
    "TSD Bridge written reply 2026-11-15 (reply-to-hme-wallet-buy-tsd-v2): all five contracts confirmed as accepted; no PYUSD on Base listed",
});

/**
 * TSD Bridge's written promise about late or wrong-amount deposits, shown on
 * the review dialog verbatim. Null until TSD Bridge commits in writing — the
 * wallet never makes that promise on its behalf.
 */
export const TSD_BRIDGE_LATE_DEPOSIT_POLICY: string | null =
  "TSD Swap creates TSD for the amount that actually arrives, even if it is more or less than the order. A payment sent after the order expires is not processed automatically; contact TSD Swap support and it will be reviewed by hand.";

/**
 * Time that must remain on a mint order to pay it. TSD Bridge asks that no
 * payment is made within 1 hour of `expiresAt` (orders last 24 hours); the
 * extra hour covers the confirmation prompt, broadcast and mining.
 */
export const MINT_EXPIRY_MARGIN_MS = 2 * 60 * 60 * 1000;

/** Gas ceiling used to check the network fee before review (ERC-20 transfer to a fresh address is ~45–70k). */
export const MINT_TRANSFER_GAS_CEILING = 100_000n;

/** True when the native balance covers the transfer's network fee with 25% headroom. */
export function mintGasCovered(native: bigint, maxFeePerGas: bigint, gasLimit: bigint = MINT_TRANSFER_GAS_CEILING): boolean {
  if (native <= 0n || maxFeePerGas <= 0n || gasLimit <= 0n) return false;
  return native >= (gasLimit * maxFeePerGas * 5n) / 4n;
}

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
  /**
   * Contracts TSD Bridge publishes per chain and token
   * (`depositTokenContracts: { ethereum: { USDC: "0x…" } }`), or null while
   * the feed names tokens by symbol only.
   */
  tokenContracts?: Partial<Record<"ethereum" | "base", Record<string, string>>> | null;
}

/**
 * True once TSD Bridge has confirmed the pinned contract list in writing.
 * Until then no stablecoin source is offered and no order can be opened, so
 * publishing the code cannot switch the route on by accident.
 */
export function mintContractsConfirmed(
  pin: { writtenConfirmation: string | null } = TSD_BRIDGE_CONTRACT_PIN,
): boolean {
  return typeof pin.writtenConfirmation === "string" && pin.writtenConfirmation.trim().length > 0;
}

/**
 * Sources offered right now: TSD Bridge has confirmed the pin in writing,
 * both registries agree and TSD Bridge is live. `pin` exists for tests only.
 */
export function availableMintSources(
  terms: TsdBridgeTerms | null | undefined,
  pin: { writtenConfirmation: string | null } = TSD_BRIDGE_CONTRACT_PIN,
): MintSource[] {
  if (!mintContractsConfirmed(pin)) return [];
  if (!terms?.live) return [];
  const tokens = new Set(terms.depositTokens.map((t) => t.toUpperCase()));
  const chains = new Set(terms.chains.map((c) => c.toLowerCase()));
  const published = terms.tokenContracts;
  return MINT_SOURCES.filter((s) => {
    if (!tokens.has(s.symbol) || !chains.has(s.bridgeChain)) return false;
    if (!published) return true; // symbol-only feed: rely on the pinned contracts
    const c = published[s.bridgeChain]?.[s.symbol];
    return typeof c === "string" && c.trim().toLowerCase() === s.contract.toLowerCase();
  });
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
  /** Token contract TSD Bridge will credit, once it echoes one. */
  depositTokenContract?: unknown;
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
  /** TSD Bridge chain name and the exact token contract the wallet will pay. */
  chain: "ethereum" | "base";
  tokenContract: Address;
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
 * this wallet, a token contract or the zero address, and more than two hours
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
  const echoedContract = str(res.depositTokenContract);
  if (echoedContract && echoedContract.toLowerCase() !== req.source.contract.toLowerCase()) {
    fail("TSD Bridge expects a different token contract");
  }
  if (!isLegacyTxcP2pkh(req.recipient) || str(res.recipient) !== req.recipient.trim()) {
    fail("TSD recipient changed");
  }

  const wanted = decimalUnits(req.amount, req.source.decimals);
  const echoed = decimalUnits(res.amountExpected, req.source.decimals);
  if (wanted === null || wanted <= 0n || echoed === null || wanted !== echoed) fail("amount changed");

  // Only `mintFeeBps`: on mint orders `feeBps` describes cash-outs (TSD Bridge, 2026-11-15).
  const feeRaw = res.mintFeeBps;
  const feeBps = typeof feeRaw === "number" ? feeRaw : typeof feeRaw === "string" && feeRaw.trim() ? Number(feeRaw) : NaN;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) fail("fee is missing");

  const expiresAt = str(res.expiresAt);
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) fail("no expiry time");
  if (exp - now <= MINT_EXPIRY_MARGIN_MS) fail("less than two hours left on the order");

  return {
    id,
    sourceId: req.source.id,
    chain: req.source.bridgeChain,
    tokenContract: req.source.contract,
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
  return Number.isFinite(exp) && exp - now > MINT_EXPIRY_MARGIN_MS;
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
  // Checked whenever TSD Bridge echoes them (requested; not in today's reply).
  const dir = str(order.direction).toLowerCase();
  if (dir && dir !== "mint") fail("not a TSD purchase order");
  const rcpt = str(order.recipient);
  if (rcpt && rcpt !== locked.recipient) fail("TSD recipient changed");
  const token = str(order.depositToken).toUpperCase();
  if (token && token !== source!.symbol) fail("stablecoin changed");
  const contract = str(order.depositTokenContract);
  if (contract && contract.toLowerCase() !== source!.contract.toLowerCase()) fail("token contract changed");
  if (!mintOrderStillOpen(str(order.expiresAt), now)) fail("less than two hours left");
}

export interface MintLockContext {
  ownEvmAddresses: readonly string[];
  /** Deposit addresses from this wallet's earlier mint orders (any state). */
  priorOrders: readonly { orderId: string; depositAddress: string }[];
  now?: number;
}

/**
 * Device-side check of an order the server already verified (or one being
 * reused from local history): it must be exactly the request, pay the pinned
 * contract, use a deposit address no earlier order of this wallet used, and
 * still have the expiry margin left. Throws a user-readable message.
 */
export function confirmLockedMintOrder(
  locked: VerifiedMintOrder,
  expected: { sourceId: MintSourceId; amount: string; recipient: string },
  ctx: MintLockContext,
): void {
  const fail = (why: string): never => {
    throw new Error(`TSD Bridge's order didn't match (${why}). Nothing was sent.`);
  };
  const source = mintSource(expected.sourceId);
  if (!source || locked.sourceId !== source.id) fail("stablecoin changed");
  if (locked.chain !== source!.bridgeChain) fail("network changed");
  if (locked.tokenContract.toLowerCase() !== source!.contract.toLowerCase()) fail("token contract changed");
  if (locked.amount !== expected.amount.trim()) fail("amount changed");
  const units = parseMintAmount(expected.amount, source!);
  if (units === null || units.toString() !== locked.units) fail("amount changed");
  if (!isLegacyTxcP2pkh(locked.recipient) || locked.recipient !== expected.recipient.trim()) fail("TSD recipient changed");
  const deposit = locked.depositAddress.toLowerCase();
  if (!EVM_RE.test(locked.depositAddress) || deposit === ZERO) fail("deposit address is not a valid 0x… address");
  if (ctx.ownEvmAddresses.some((a) => a.trim().toLowerCase() === deposit)) fail("deposit address belongs to this wallet");
  if (MINT_SOURCES.some((s) => s.contract.toLowerCase() === deposit)) fail("deposit address is a token contract");
  if (ctx.priorOrders.some((o) => o.orderId !== locked.id && o.depositAddress.toLowerCase() === deposit)) {
    fail("this deposit address was used by an earlier order — try again for a fresh one");
  }
  if (!mintOrderStillOpen(locked.expiresAt, ctx.now ?? Date.now())) fail("less than two hours left");
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
  if (request.chainId !== source!.chainId) fail("is on the wrong network");
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
