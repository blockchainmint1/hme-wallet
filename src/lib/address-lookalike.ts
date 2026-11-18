/**
 * Address-poisoning defence, shared by the send screens and Activity.
 *
 * A scammer plants an address in the member's history that shares the start
 * and end of one they really paid, hoping it gets copied next time. The
 * wallet compares addresses on the characters people actually glance at.
 *
 * "Trusted" destinations come only from payments the member's own key signed
 * (native sends, and sends of tokens on the wallet's verified contract list),
 * plus saved contacts. A Transfer event is not a signature: a fake token can
 * claim the member sent it anywhere, so it never makes an address trusted.
 *
 * Advisory only: nothing here changes balances, stored history or signing.
 */
import type { EvmTransfer } from "@/lib/chains/history.functions";
import type { TronTransfer } from "@/lib/tron/api";
import type { SolanaTransfer } from "@/lib/solana/api";
import type { MempoolTx } from "@/lib/txc/mempool";

export type AddressFamily = "evm" | "tron" | "solana" | "utxo";

/** Leading characters shared by every address of the kind (0x, version byte, bech32 hrp). */
function fixedPrefixLength(addr: string, family: AddressFamily): number {
  if (family === "evm") return 2;
  if (family === "solana") return 0;
  if (family === "tron") return 1;
  const bech = /^([a-z]{1,10})1[02-9ac-hj-np-z]+$/i.exec(addr);
  return bech ? bech[1]!.length + 2 : 1;
}

/** Comparable form: EVM and bech32 addresses are case-insensitive; base58 is not. */
export function normalizeAddress(addr: string, family: AddressFamily): string {
  const a = addr.trim();
  if (family === "evm") return a.toLowerCase();
  if (family === "utxo" && /^[a-z]{1,10}1[02-9ac-hj-np-z]+$/i.test(a)) return a.toLowerCase();
  return a;
}

/** Characters of the start and end two different addresses share, past the fixed prefix. */
export function sharedEnds(a: string, b: string, family: AddressFamily): { lead: number; trail: number } {
  const x = normalizeAddress(a, family);
  const y = normalizeAddress(b, family);
  const p = Math.min(fixedPrefixLength(x, family), fixedPrefixLength(y, family));
  let lead = 0;
  while (p + lead < x.length && p + lead < y.length && x[p + lead] === y[p + lead]) lead++;
  let trail = 0;
  while (trail < x.length - p - lead && trail < y.length - p - lead && x[x.length - 1 - trail] === y[y.length - 1 - trail]) trail++;
  return { lead, trail };
}

/**
 * Different address with a matching start and end — the poisoning pattern.
 * At least 3 characters each side and 7 in total: planted lookalikes match
 * 3–5 at the start and 4 at the end, while two unrelated addresses share that
 * much by chance less than once in 250 million pairs.
 */
export function isLookalike(a: string, b: string, family: AddressFamily): boolean {
  const x = normalizeAddress(a, family);
  const y = normalizeAddress(b, family);
  if (!x || !y || x === y || x.length !== y.length) return false;
  const { lead, trail } = sharedEnds(x, y, family);
  return lead >= 3 && trail >= 3 && lead + trail >= 7;
}

/** Positions where `a` differs from `b` (same length), for highlighting. */
export function differingPositions(a: string, b: string, family: AddressFamily): boolean[] {
  const x = normalizeAddress(a, family);
  const y = normalizeAddress(b, family);
  return Array.from(a, (_, i) => x[i] !== y[i]);
}

export type RecipientVerdict =
  | { kind: "empty" }
  | { kind: "known" }
  | { kind: "lookalike"; match: string }
  | { kind: "flagged-only" }
  | { kind: "first-time" }
  | { kind: "unchecked" };

export interface RecipientSources {
  family: AddressFamily;
  /** Addresses this wallet has paid (signed sends) or saved as contacts. */
  trusted: Iterable<string>;
  /** Counterparties seen only on transfers the wallet flagged as suspicious. */
  flagged?: Iterable<string>;
  /** Addresses of this wallet itself (never warned about). */
  own?: Iterable<string>;
  /** Whether the past-payment list is complete enough to call an address "new". */
  complete: boolean;
}

/** Compare a recipient with past payments. Lookalike wins over everything but an exact match. */
export function checkRecipient(to: string, s: RecipientSources): RecipientVerdict {
  const target = normalizeAddress(to, s.family);
  if (!target) return { kind: "empty" };
  const trusted = [...s.trusted];
  const own = new Set([...(s.own ?? [])].map((a) => normalizeAddress(a, s.family)));
  if (own.has(target)) return { kind: "known" };
  if (trusted.some((t) => normalizeAddress(t, s.family) === target)) return { kind: "known" };
  let best: { addr: string; score: number } | null = null;
  for (const t of [...trusted, ...(s.own ?? [])]) {
    if (!isLookalike(t, target, s.family)) continue;
    const { lead, trail } = sharedEnds(t, target, s.family);
    if (!best || lead + trail > best.score) best = { addr: t, score: lead + trail };
  }
  if (best) return { kind: "lookalike", match: best.addr };
  if ([...(s.flagged ?? [])].some((f) => normalizeAddress(f, s.family) === target)) return { kind: "flagged-only" };
  return s.complete ? { kind: "first-time" } : { kind: "unchecked" };
}

/** Verdicts that must stop the send until the member ticks they checked. */
export function verdictBlocks(v: RecipientVerdict): boolean {
  return v.kind === "lookalike" || v.kind === "flagged-only";
}

// ---------- Trusted destinations per chain family ----------

const ZERO = /^0(?:\.0*)?$/;

/** EVM: native sends this key signed, plus nonzero sends of verified token contracts. */
export function evmTrustedDestinations(history: EvmTransfer[], verifiedContracts: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const t of history) {
    if (!t.outgoing || !t.to || !/^0x[0-9a-fA-F]{40}$/.test(t.to)) continue;
    if (ZERO.test(t.value)) continue;
    const signed = t.category === "external";
    const verifiedToken = t.category === "erc20" && !t.spam && !!t.contractAddress && verifiedContracts.has(t.contractAddress.toLowerCase());
    if (signed || verifiedToken) out.add(t.to.toLowerCase());
  }
  return out;
}

/** Tron: TRX sends and nonzero sends of the wallet's listed TRC-20 contracts. */
export function tronTrustedDestinations(history: TronTransfer[], self: string, verifiedContracts: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const t of history) {
    if (t.from !== self || !t.to || t.to === self || t.value <= 0n || !t.confirmed) continue;
    if (t.kind === "trx" || (t.contract && verifiedContracts.has(t.contract))) out.add(t.to);
  }
  return out;
}

/** Tron rows that look like poisoning: zero-value tokens, unlisted tokens, lookalike counterparties. */
export function tronSuspiciousReason(t: TronTransfer, self: string, trusted: ReadonlySet<string>, verifiedContracts: ReadonlySet<string>): string | null {
  const outgoing = t.from === self;
  const counterparty = outgoing ? t.to : t.from;
  if (t.kind === "trc20" && t.value === 0n) return "Zero-value token transfer — possible address poisoning";
  if (t.kind === "trc20" && t.contract && !verifiedContracts.has(t.contract) && !outgoing) {
    const listedSymbol = ["USDT", "USDC"].includes(t.symbol.toUpperCase().replace(/[^A-Z]/g, ""));
    if (listedSymbol) return `Counterfeit ${t.symbol} token — unverified contract`;
  }
  if (trusted.has(counterparty)) return null;
  for (const a of trusted) if (isLookalike(a, counterparty, "tron")) return "Lookalike of an address you've paid — possible address poisoning";
  return null;
}

/** Solana: native SOL this key sent. */
export function solanaTrustedDestinations(history: SolanaTransfer[]): Set<string> {
  const out = new Set<string>();
  for (const t of history) if (!t.incoming && t.confirmed && t.lamports > 0 && t.to) out.add(t.to);
  return out;
}

/** UTXO: outputs of transactions this wallet's addresses spent from (change included). */
export function utxoTrustedDestinations(history: MempoolTx[], own: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const tx of history) {
    if (!tx.vin.some((v) => v.prevout?.scriptpubkey_address && own.has(v.prevout.scriptpubkey_address))) continue;
    for (const o of tx.vout) if (o.scriptpubkey_address && !own.has(o.scriptpubkey_address)) out.add(o.scriptpubkey_address);
  }
  return out;
}
