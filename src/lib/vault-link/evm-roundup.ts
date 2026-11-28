/**
 * Vault "round up": find every stablecoin and ETH on the Vault seed's
 * Ethereum/Base addresses (m/44'/60'/0'/0/i, the addresses NectarPay hands
 * out per sale) and bring it to address #0 with HME Vault's `sweep-batch`
 * (up to 25 plain transfers to ONE destination, one approval). Addresses that
 * hold tokens but no ETH for the fee get a top-up first through Vault's
 * `native-disperse` (pinned Disperse contract, one approval).
 *
 * Only the stablecoins TSD Bridge accepts are gathered (MINT_SOURCES), plus
 * the chain's own ETH. Every request is built here from fresh chain reads and
 * every signed transaction is checked field-by-field before broadcast.
 * See HME Vault docs/offline-signing-handoff.md ("Batch sweep", "Disperse").
 */
import {
  encodeFunctionData, formatUnits, getAddress, keccak256, parseTransaction, recoverTransactionAddress, stringToBytes,
  erc20Abi, type Address, type Hex, type TransactionSerialized,
} from "viem";
import { MINT_SOURCES, type MintSourceId } from "@/lib/cashout/mint";
import { evmClient } from "@/lib/chains/evm";
import { verifyVaultEvmSend } from "./evm-send";
import { assertReviewedVaultBatchSurface } from "@/lib/security/execution-policy";
import type { EvmIntent } from "./evm-intent";
import { vaultEvmAccount, VAULT_EVM_MAX_INDEX } from "./evm-accounts";
import type { VaultPairing } from "./pairing";

export type RoundupChain = "eth" | "base";
export const ROUNDUP_CHAINS: RoundupChain[] = ["eth", "base"];
export const ROUNDUP_CHAIN_ID: Record<RoundupChain, number> = { eth: 1, base: 8453 };
export const ROUNDUP_CHAIN_NAME: Record<RoundupChain, string> = { eth: "Ethereum", base: "Base" };

/** Vault's frozen single-payment fee ceilings (EVM_FEE_CEILINGS): 0.02 ETH / 0.002 ETH on Base. */
export const VAULT_FEE_CEILING_WEI: Record<RoundupChain, bigint> = {
  eth: 20_000_000_000_000_000n,
  base: 2_000_000_000_000_000n,
};
export const VAULT_BATCH_FEE_MULTIPLIER = 5n;
export const VAULT_BATCH_MAX_ITEMS = 25;
export const VAULT_BATCH_MAX_TEXT = 32_768;
export const NATIVE_GAS = 21_000n;
export const TOKEN_GAS_MIN = 30_000n;
export const TOKEN_GAS_MAX = 200_000n;
/** Stop scanning after this many unused addresses in a row. */
export const ROUNDUP_GAP = 20;
export const ROUNDUP_PAGE_SIZE = 20;

/** Disperse.app, pinned by HME Vault on Ethereum and Base (release-time eth_getCode hashes). */
export const DISPERSE_ADDRESS: Address = "0xD152f549545093347A162Dce210e7293f1452150";
export const DISPERSE_CODE_HASH: Record<RoundupChain, Hex> = {
  eth: "0x65660051e320731a70b9ddcd5ec9fd4f565cf85e2f6caf0eb71589fb544b9996",
  base: "0xc0a38c227d2c70248fc51ed0dd3a72df3adf5b41494c7f3cc19c16c38523244d",
};
export const DISPERSE_PER_RECIPIENT_FEE_WEI: Record<RoundupChain, bigint> = {
  eth: 500_000_000_000_000n,
  base: 50_000_000_000_000n,
};
export const DISPERSE_MAX_RECIPIENTS = 50;
const DISPERSE_ABI = [{
  type: "function", name: "disperseEther", stateMutability: "payable",
  inputs: [{ name: "recipients", type: "address[]" }, { name: "values", type: "uint256[]" }], outputs: [],
}] as const;

export interface RoundupToken { sourceId: MintSourceId; contract: Address; symbol: string; decimals: number }
export function roundupTokens(chain: RoundupChain): RoundupToken[] {
  return MINT_SOURCES.filter((s) => s.chain === chain).map((s) => ({ sourceId: s.id, contract: getAddress(s.contract), symbol: s.symbol, decimals: s.decimals }));
}

export interface ScannedAddress {
  index: number;
  path: string;
  address: Address;
  native: bigint;
  /** Pending nonce. */
  nonce: number;
  /** Raw balance per token contract (checksummed key). */
  tokens: Record<string, bigint>;
}
export interface Fees { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

export function addressUsed(a: ScannedAddress): boolean {
  return a.native > 0n || a.nonce > 0 || Object.values(a.tokens).some((v) => v > 0n);
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

export type RoundupItem =
  | { kind: "erc20-transfer"; index: number; path: string; from: Address; token: Address; amount: bigint; nonce: number; gas: bigint }
  | { kind: "native-transfer"; index: number; path: string; from: Address; value: bigint; nonce: number; gas: bigint };

export interface GasNeed { index: number; address: Address; path: string; native: bigint; needed: bigint }
export interface RoundupPlan {
  chain: RoundupChain;
  destination: Address;
  batches: RoundupItem[][];
  /** Token holders without enough ETH for their own transfer fees. */
  needsGas: GasNeed[];
  /** `retry`: a passing network problem, not a Vault limit — checking again may include it. */
  skipped: RoundupSkip[];
}
export interface RoundupSkip { index: number; reason: string; retry?: boolean }

/** Result of a token-transfer gas estimate: a gas limit, or why the estimate failed. */
export type TokenGasEstimate = bigint | { error: string };

const itemFee = (gas: bigint, f: Fees) => gas * f.maxFeePerGas;

/**
 * Pure planner. `tokenGas(address, token)` is the gas limit to use for that
 * transfer (callers pass a padded estimate). Address #0 is the destination.
 */
export function planRoundup(args: {
  chain: RoundupChain;
  destination: Address;
  addresses: ScannedAddress[];
  fees: Fees;
  tokenGas: (from: Address, token: Address) => TokenGasEstimate;
}): RoundupPlan {
  const { chain, fees } = args;
  const destination = getAddress(args.destination);
  const ceiling = VAULT_FEE_CEILING_WEI[chain];
  if (fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas)
    throw new Error("Network fee estimate is unavailable. Try again.");
  if (itemFee(TOKEN_GAS_MAX, fees) > ceiling && itemFee(NATIVE_GAS, fees) > ceiling)
    throw new Error(`${ROUNDUP_CHAIN_NAME[chain]} fees are above HME Vault's safety limit right now. Try again later.`);
  const tokens = roundupTokens(chain);
  const groups: RoundupItem[][] = [];
  const needsGas: GasNeed[] = [];
  const skipped: RoundupSkip[] = [];
  const nativeFee = itemFee(NATIVE_GAS, fees);

  for (const a of [...args.addresses].sort((x, y) => x.index - y.index)) {
    if (getAddress(a.address) === destination) continue;
    const held = tokens.filter((t) => (a.tokens[t.contract] ?? 0n) > 0n);
    const tokenItems: { token: Address; amount: bigint; gas: bigint }[] = [];
    for (const t of held) {
      const est = args.tokenGas(a.address, t.contract);
      if (typeof est !== "bigint") {
        skipped.push({ index: a.index, reason: `${t.symbol}: couldn't work out the network fee (${est.error})`, retry: true });
        continue;
      }
      let gas = est;
      if (gas < TOKEN_GAS_MIN) gas = TOKEN_GAS_MIN;
      if (gas > TOKEN_GAS_MAX || itemFee(gas, fees) > ceiling) {
        skipped.push({ index: a.index, reason: `${t.symbol} transfer needs more gas than HME Vault allows` });
        continue;
      }
      tokenItems.push({ token: t.contract, amount: a.tokens[t.contract]!, gas });
    }
    const tokenFees = tokenItems.reduce((s, t) => s + itemFee(t.gas, fees), 0n);
    if (tokenItems.length && a.native < tokenFees) {
      needsGas.push({ index: a.index, address: getAddress(a.address), path: a.path, native: a.native, needed: tokenFees - a.native });
      continue;
    }
    const items: RoundupItem[] = [];
    let nonce = a.nonce;
    for (const t of tokenItems) {
      items.push({ kind: "erc20-transfer", index: a.index, path: a.path, from: getAddress(a.address), token: t.token, amount: t.amount, nonce: nonce++, gas: t.gas });
    }
    // Leftover ETH goes last ("everything minus the fees"), only when it's worth more than its own fee.
    const rest = a.native - tokenFees - nativeFee;
    if (rest > nativeFee && nativeFee <= ceiling) {
      items.push({ kind: "native-transfer", index: a.index, path: a.path, from: getAddress(a.address), value: rest, nonce: nonce++, gas: NATIVE_GAS });
    }
    if (items.length) groups.push(items);
  }

  // Pack whole address groups into batches: ≤25 items and ≤5× the single-payment fee ceiling.
  const batches: RoundupItem[][] = [];
  let cur: RoundupItem[] = [];
  let curFee = 0n;
  const batchCap = ceiling * VAULT_BATCH_FEE_MULTIPLIER;
  for (const g of groups) {
    const gFee = g.reduce((s, i) => s + itemFee(i.gas, fees), 0n);
    if (cur.length && (cur.length + g.length > VAULT_BATCH_MAX_ITEMS || curFee + gFee > batchCap)) {
      batches.push(cur); cur = []; curFee = 0n;
    }
    cur.push(...g); curFee += gFee;
  }
  if (cur.length) batches.push(cur);
  return { chain, destination, batches, needsGas, skipped };
}

/* ------------------------------------------------------------------ */
/* sweep-batch request + reply                                         */
/* ------------------------------------------------------------------ */

export function buildSweepBatchRequest(pairing: VaultPairing, chain: RoundupChain, destination: Address, items: RoundupItem[], fees: Fees): string {
  assertReviewedVaultBatchSurface("vault-sweep-batch-to-own-address-0");
  if (!items.length || items.length > VAULT_BATCH_MAX_ITEMS) throw new Error(`A Vault batch holds 1–${VAULT_BATCH_MAX_ITEMS} payments.`);
  const dest = getAddress(destination);
  const fee = { type: "eip1559" as const, maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() };
  const out = items.map((i) => {
    // The sender must be this seed's own address at the stated path.
    const own = vaultEvmAccount(pairing, i.index);
    if (own.address !== getAddress(i.from) || own.path !== i.path) throw new Error(`Address #${i.index} doesn't belong to this Vault.`);
    if (own.address === dest) throw new Error("The destination can't also be a sender.");
    if (i.index > VAULT_EVM_MAX_INDEX) throw new Error("Address number is beyond HME Vault's batch limit.");
    return i.kind === "erc20-transfer"
      ? { kind: i.kind, path: i.path, from: own.address, to: dest, token: getAddress(i.token), amount: i.amount.toString(), nonce: i.nonce, gas: i.gas.toString(), ...fee }
      : { kind: i.kind, path: i.path, from: own.address, to: dest, value: i.value.toString(), nonce: i.nonce, gas: i.gas.toString(), ...fee };
  });
  const text = JSON.stringify({ format: "hm-evm-tx", v: 1, kind: "sweep-batch", fp: pairing.fp, chainId: ROUNDUP_CHAIN_ID[chain], destination: dest, items: out });
  if (text.length > VAULT_BATCH_MAX_TEXT) throw new Error("This batch is too large for one Vault request.");
  return text;
}

/** Each item of a request we built, as the single-payment intent it stands for. */
export function sweepBatchIntents(requestText: string): EvmIntent[] {
  const r = JSON.parse(requestText) as { fp: string; chainId: number; items: Record<string, unknown>[] };
  return r.items.map((i) => ({ ...i, format: "hm-evm-tx", v: 1, fp: r.fp, chainId: r.chainId }) as unknown as EvmIntent);
}

export function base64ToHex(b64: string): Hex {
  const damaged = () => new Error("The Vault reply has a damaged transaction. Nothing was broadcast — scan it again.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw damaged();
  let bin: string;
  try { bin = atob(b64); } catch { throw damaged(); }
  let hex = "0x";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex as Hex;
}

/**
 * Check Vault's `hm-evm-signed-batch` reply against the exact request text.
 * Returns the signed transactions in item order. The intent hash is only a
 * convenience binding: every transaction is still checked field by field.
 */
export async function verifySweepBatchReply(reply: string, requestText: string): Promise<Hex[]> {
  let o: Record<string, unknown>;
  try { o = JSON.parse(reply.trim()) as Record<string, unknown>; } catch { throw new Error("That QR isn't a signed Vault batch."); }
  if (!o || typeof o !== "object" || o.format !== "hm-evm-signed-batch" || o.v !== 1) throw new Error("That QR isn't a signed Vault batch.");
  if (Object.keys(o).some((k) => !["format", "v", "intentHash", "signed"].includes(k))) throw new Error("The Vault reply has unexpected fields. Nothing was broadcast.");
  if (typeof o.intentHash !== "string" || o.intentHash.toLowerCase() !== keccak256(stringToBytes(requestText)).toLowerCase())
    throw new Error("That signed batch is for a different request. Nothing was broadcast.");
  const intents = sweepBatchIntents(requestText);
  if (!Array.isArray(o.signed) || o.signed.length !== intents.length || o.signed.some((s) => typeof s !== "string"))
    throw new Error("The signed batch doesn't hold one transaction per payment. Nothing was broadcast.");
  const signed = (o.signed as string[]).map(base64ToHex);
  if (new Set(signed.map((s) => s.toLowerCase())).size !== signed.length) throw new Error("The signed batch repeats a transaction. Nothing was broadcast.");
  for (let i = 0; i < signed.length; i++) await verifyVaultEvmSend(signed[i]!, intents[i]!);
  return signed;
}

/* ------------------------------------------------------------------ */
/* Gas top-up through Disperse                                          */
/* ------------------------------------------------------------------ */

export interface TopUpPlan {
  funder: ScannedAddress;
  recipients: Address[];
  values: bigint[];
  total: bigint;
  gas: bigint;
  /** Address number of each recipient, same order. */
  needsIndexes: number[];
}

/** Each needy address gets 1.5× its shortfall so a small fee rise doesn't strand it. */
export function topUpAmount(need: GasNeed): bigint {
  return (need.needed * 3n + 1n) / 2n;
}

/** One line of the "fund from another wallet" list. */
export interface ExternalTopUp { index: number; address: Address; wei: bigint; amount: string }

const EXTERNAL_STEP_WEI = 10n ** 12n; // 0.000001 ETH

/**
 * Fee money for paying from another wallet instead of a Vault signature: each
 * address is re-derived from the paired Vault key (never taken from the scan
 * alone) and the 1.5× top-up is rounded UP to 6 decimals so it's easy to type.
 */
export function externalTopUpList(pairing: VaultPairing, needs: GasNeed[]): ExternalTopUp[] {
  return needs.map((n) => {
    const own = vaultEvmAccount(pairing, n.index).address;
    if (own !== getAddress(n.address)) throw new Error(`Address #${n.index} doesn't belong to this Vault.`);
    const wei = ((topUpAmount(n) + EXTERNAL_STEP_WEI - 1n) / EXTERNAL_STEP_WEI) * EXTERNAL_STEP_WEI;
    return { index: n.index, address: own, wei, amount: formatUnits(wei, 18) };
  });
}

/** "address,amount" lines, the format bulk-send tools accept. */
export function externalTopUpText(list: ExternalTopUp[]): string {
  return list.map((l) => `${l.address},${l.amount}`).join("\n");
}

export function disperseGasRange(recipients: number): { min: bigint; max: bigint } {
  const k = BigInt(recipients);
  return { min: 21_000n + 9_000n * k, max: 60_000n + 40_000n * k };
}

/** Pure: pick the address with the most ETH (not a recipient) to pay every top-up. */
export function planTopUp(args: { chain: RoundupChain; addresses: ScannedAddress[]; needs: GasNeed[]; fees: Fees; gas?: bigint }): TopUpPlan {
  const needs = args.needs.slice(0, DISPERSE_MAX_RECIPIENTS);
  if (!needs.length) throw new Error("No address needs fee money.");
  const needy = new Set(needs.map((n) => getAddress(n.address)));
  const values = needs.map(topUpAmount);
  const total = values.reduce((s, v) => s + v, 0n);
  const range = disperseGasRange(needs.length);
  const gas = args.gas ?? range.max;
  if (gas < range.min || gas > range.max) throw new Error("The fee top-up needs more gas than HME Vault allows.");
  const fee = gas * args.fees.maxFeePerGas;
  if (fee > VAULT_FEE_CEILING_WEI[args.chain] + DISPERSE_PER_RECIPIENT_FEE_WEI[args.chain] * BigInt(needs.length))
    throw new Error(`${ROUNDUP_CHAIN_NAME[args.chain]} fees are above HME Vault's safety limit right now. Try again later.`);
  const funder = [...args.addresses]
    .filter((a) => !needy.has(getAddress(a.address)))
    .sort((x, y) => (y.native > x.native ? 1 : y.native < x.native ? -1 : x.index - y.index))[0];
  if (!funder || funder.native < total + fee)
    throw new Error(`Not enough ${args.chain === "eth" ? "ETH" : "Base ETH"} on any one address to pay the fees for the others.`);
  return { funder, recipients: needs.map((n) => getAddress(n.address)), values, total, gas, needsIndexes: needs.map((n) => n.index) };
}

export interface DisperseIntent {
  format: "hm-evm-tx"; v: 1; kind: "native-disperse"; fp: string; path: string; chainId: number;
  from: Address; to: Address; recipients: Address[]; values: string[]; value: string;
  nonce: number; gas: string; type: "eip1559"; maxFeePerGas: string; maxPriorityFeePerGas: string;
}

export function buildDisperseIntent(pairing: VaultPairing, chain: RoundupChain, plan: TopUpPlan, fees: Fees): string {
  assertReviewedVaultBatchSurface("vault-native-disperse-fee-topup");
  const own = vaultEvmAccount(pairing, plan.funder.index);
  if (own.address !== getAddress(plan.funder.address)) throw new Error("The paying address doesn't belong to this Vault.");
  if (plan.recipients.some((r) => r === own.address || r === DISPERSE_ADDRESS)) throw new Error("Invalid fee top-up recipient.");
  // Fee money only ever goes to this Vault's own addresses (the Vault itself doesn't check this yet).
  const ownRecipients = new Set(plan.needsIndexes.map((i) => vaultEvmAccount(pairing, i).address));
  if (plan.recipients.length !== plan.needsIndexes.length || plan.recipients.some((r) => !ownRecipients.has(getAddress(r))))
    throw new Error("A fee top-up recipient isn't one of this Vault's own addresses.");
  const intent: DisperseIntent = {
    format: "hm-evm-tx", v: 1, kind: "native-disperse", fp: pairing.fp, path: own.path, chainId: ROUNDUP_CHAIN_ID[chain],
    from: own.address, to: DISPERSE_ADDRESS, recipients: plan.recipients, values: plan.values.map(String), value: plan.total.toString(),
    nonce: plan.funder.nonce, gas: plan.gas.toString(), type: "eip1559",
    maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
  };
  const text = JSON.stringify(intent);
  if (text.length > 8192) throw new Error("Too many addresses for one fee top-up.");
  return text;
}

export function disperseCalldata(recipients: Address[], values: bigint[]): Hex {
  return encodeFunctionData({ abi: DISPERSE_ABI, functionName: "disperseEther", args: [recipients, values] });
}

/** The signed top-up must be exactly the reviewed Disperse call. */
export async function verifyVaultDisperse(serialized: Hex, intentText: string): Promise<void> {
  const i = JSON.parse(intentText) as DisperseIntent;
  const tx = parseTransaction(serialized);
  const from = await recoverTransactionAddress({ serializedTransaction: serialized as TransactionSerialized });
  const data = disperseCalldata(i.recipients, i.values.map((v) => BigInt(v)));
  const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
  if (!same(from, i.from) || tx.chainId !== i.chainId || tx.nonce !== i.nonce || !same(tx.to, DISPERSE_ADDRESS) ||
      (tx.value ?? 0n) !== BigInt(i.value) || !same(tx.data, data) || tx.gas !== BigInt(i.gas) || tx.type !== "eip1559" ||
      tx.maxFeePerGas !== BigInt(i.maxFeePerGas) || tx.maxPriorityFeePerGas !== BigInt(i.maxPriorityFeePerGas) || tx.accessList?.length)
    throw new Error("The signed fee top-up doesn't match the request. Nothing was broadcast.");
}

/* ------------------------------------------------------------------ */
/* Chain reads                                                          */
/* ------------------------------------------------------------------ */

export async function readFees(chain: RoundupChain): Promise<Fees> {
  const pub = evmClient(chain);
  const f = await pub.estimateFeesPerGas();
  if (f.maxFeePerGas == null || f.maxFeePerGas <= 0n) throw new Error("Network fee estimate is unavailable. Try again.");
  // Same headroom as single Vault sends: twice the estimate, priority as quoted.
  const maxFeePerGas = f.maxFeePerGas * 2n;
  const prio = f.maxPriorityFeePerGas ?? 0n;
  return { maxFeePerGas, maxPriorityFeePerGas: prio > maxFeePerGas ? maxFeePerGas : prio };
}

export async function readAddress(pairing: VaultPairing, chain: RoundupChain, index: number): Promise<ScannedAddress> {
  const acct = vaultEvmAccount(pairing, index);
  const pub = evmClient(chain);
  const tokens = roundupTokens(chain);
  const [native, nonce, ...bals] = await Promise.all([
    pub.getBalance({ address: acct.address }),
    pub.getTransactionCount({ address: acct.address, blockTag: "pending" }),
    ...tokens.map((t) => pub.readContract({ address: t.contract, abi: erc20Abi, functionName: "balanceOf", args: [acct.address] }) as Promise<bigint>),
  ]);
  return { index, path: acct.path, address: acct.address, native, nonce, tokens: Object.fromEntries(tokens.map((t, k) => [t.contract, bals[k] ?? 0n])) };
}

/**
 * Scan #0, #1, … until ROUNDUP_GAP unused addresses in a row (or the Vault
 * limit). Without `evm.xpub` only #0 can be read. A failed read throws —
 * a partial scan must never look like "nothing left".
 */
export async function scanVaultEvm(pairing: VaultPairing, chain: RoundupChain, opts: {
  gap?: number;
  /** Continue from the first address not yet checked. */
  startIndex?: number;
  /** Explicit pages ignore the unused-address gap and read exactly this many (within the Vault limit). */
  count?: number;
  /** Refreshes must retain the user's expanded search range. */
  minChecked?: number;
  onProgress?: (checked: number) => void;
} = {}): Promise<{ used: ScannedAddress[]; checked: number }> {
  const gap = opts.gap ?? ROUNDUP_GAP;
  const maxIndex = pairing.evm?.xpub ? VAULT_EVM_MAX_INDEX : 0;
  const start = opts.startIndex ?? 0;
  const minChecked = opts.minChecked ?? 0;
  if (!Number.isInteger(start) || start < 0 || start > maxIndex + 1 ||
      !Number.isInteger(gap) || gap < 1 ||
      !Number.isInteger(minChecked) || minChecked < 0 || minChecked > maxIndex + 1 ||
      (opts.count !== undefined && (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > ROUNDUP_PAGE_SIZE)))
    throw new Error("Invalid Vault address search range.");
  const end = opts.count === undefined ? maxIndex + 1 : Math.min(start + opts.count, maxIndex + 1);
  const used: ScannedAddress[] = [];
  let empty = 0;
  let next = start;
  while (next < end && (opts.count !== undefined || next < minChecked || empty < gap)) {
    const batch = Array.from({ length: Math.min(10, end - next) }, (_, k) => next + k);
    const rows = await Promise.all(batch.map((i) => readAddress(pairing, chain, i)));
    for (const r of rows) {
      if (r.index === 0 || addressUsed(r)) { used.push(r); empty = addressUsed(r) ? 0 : empty + 1; }
      else empty++;
    }
    next += batch.length;
    opts.onProgress?.(next);
  }
  return { used, checked: next };
}

/** Padded token-transfer gas estimate per (sender, token), clamped to Vault's range by the planner. */
export async function estimateTokenGas(chain: RoundupChain, from: Address, token: Address, amount: bigint, to: Address): Promise<bigint> {
  const pub = evmClient(chain);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
  const est = await pub.estimateGas({ account: from, to: token, data });
  return (est * 120n + 99n) / 100n;
}

export async function estimateDisperseGas(chain: RoundupChain, from: Address, recipients: Address[], values: bigint[]): Promise<bigint> {
  const pub = evmClient(chain);
  const total = values.reduce((s, v) => s + v, 0n);
  const est = await pub.estimateGas({ account: from, to: DISPERSE_ADDRESS, value: total, data: disperseCalldata(recipients, values) });
  const padded = (est * 120n + 99n) / 100n;
  const range = disperseGasRange(recipients.length);
  return padded < range.min ? range.min : padded;
}

/** Defence in depth: the Disperse contract on chain must still be the code Vault pinned. */
export async function assertDisperseCode(chain: RoundupChain): Promise<void> {
  const code = await evmClient(chain).getCode({ address: DISPERSE_ADDRESS });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== DISPERSE_CODE_HASH[chain]) {
    throw new Error("The bulk-payment contract on this network isn't the one HME Vault pinned. Nothing was prepared.");
  }
}
