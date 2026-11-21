/**
 * Per-wallet "branch book" for trading links.
 *
 * honest.money reserves one or more Trading branches (hardened accounts, e.g.
 * SEEDS = 1106') for each trading site. This book remembers, per wallet, which
 * site each branch was first given to and whether it has been retired:
 *
 * - A branch belongs to the first site it was shared with, forever. It is never
 *   handed to a different site on this wallet, even after revoke, because that
 *   site has already seen its addresses (and maybe its key).
 * - A branch whose spending key was shared and then revoked is retired: it is
 *   never handed to any other site, but the same site may link it again (the
 *   member's choice, so a revoke can be undone on the same path). That site
 *   already holds the old keys, so a re-link of a retired branch is
 *   "Give access" only and the member is told it reuses the revoked pocket.
 *
 * The book is profile-scoped. Older builds kept a single counter that moved up
 * on every spending revoke; every account below it is imported as retired, on
 * every read, so a revoke done in an old APK or extension is never forgotten.
 */
import { scopedKey } from "@/lib/profiles";
import { NON_TRADING_ACCOUNTS, POCKET_BASE_ACCOUNT, isDelegableAccount, isPocketAccount } from "@/lib/seeds/branch-rules";

export interface BranchUse {
  /** Host the branch was first shared with ("" = an earlier link the old counter retired). */
  host: string;
  retired: boolean;
}
export type BranchBook = Record<string, BranchUse>;

export const BRANCH_BOOK_KEY = "hme:trading-branches";

/** Idempotent: add legacy retirements and existing links without ever clearing anything. */
export function migrateBranchBook(
  book: BranchBook,
  legacyActive: number | null,
  links: readonly { host: string; account: number }[],
): BranchBook {
  const next: BranchBook = { ...book };
  if (legacyActive != null && isPocketAccount(legacyActive)) {
    for (let a = POCKET_BASE_ACCOUNT; a < legacyActive; a++) {
      if (NON_TRADING_ACCOUNTS.has(a)) continue;
      const cur = next[String(a)];
      next[String(a)] = { host: cur?.host ?? "", retired: true };
    }
  }
  for (const l of links) {
    const k = String(l.account);
    if (!next[k]) next[k] = { host: l.host.toLowerCase(), retired: false };
  }
  return next;
}

export type BranchChoice =
  | { ok: true; account: number; /** Same site re-linking a pocket it was revoked from. */ reusesRevoked: boolean }
  | { ok: false; reason: string };

/**
 * Pick the branch to use for `host`. The site must ask for one of the branches
 * honest.money reserved for it; if this wallet already retired that one (or
 * another site owns it here), the next reserved branch is used instead.
 */
export function chooseDelegateBranch(args: {
  host: string;
  siteName: string;
  requested: number;
  reserved: readonly number[];
  book: BranchBook;
}): BranchChoice {
  const host = args.host.toLowerCase();
  const reserved = args.reserved.filter(isDelegableAccount);
  if (reserved.length === 0)
    return { ok: false, reason: `honest.money hasn't reserved a trading branch for ${args.siteName} yet.` };
  if (!reserved.includes(args.requested))
    return {
      ok: false,
      reason: `${args.siteName} asked for trading branch ${args.requested}, but honest.money reserved ${reserved.join(", ")} for it.`,
    };
  // Only a known owner may take a retired branch back; "" (retired by an old
  // build's counter, owner unknown) is never handed out again.
  const usable = (a: number) => {
    const u = args.book[String(a)];
    return !u || u.host === host;
  };
  for (const a of [args.requested, ...reserved.filter((b) => b !== args.requested)]) {
    if (usable(a)) return { ok: true, account: a, reusesRevoked: args.book[String(a)]?.retired === true };
  }
  return {
    ok: false,
    reason: `Every trading branch honest.money reserved for ${args.siteName} (${reserved.join(", ")}) has already been used on this wallet. Ask honest.money to reserve a new one.`,
  };
}

/* ------------------------------ storage ------------------------------ */

function readRaw(): BranchBook {
  try {
    const v = JSON.parse(window.localStorage.getItem(scopedKey(BRANCH_BOOK_KEY)) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: BranchBook = {};
    for (const [k, u] of Object.entries(v as Record<string, unknown>)) {
      const e = u as Partial<BranchUse> | null;
      if (!/^\d+$/.test(k) || !e || typeof e !== "object") continue;
      out[k] = { host: typeof e.host === "string" ? e.host : "", retired: e.retired === true };
    }
    return out;
  } catch {
    return {};
  }
}

function write(book: BranchBook): void {
  window.localStorage.setItem(scopedKey(BRANCH_BOOK_KEY), JSON.stringify(book));
}

/** Current book for the active wallet, with legacy state folded in (and saved). */
export function loadBranchBook(legacyActive: number | null, links: readonly { host: string; account: number }[]): BranchBook {
  if (typeof window === "undefined") return {};
  const raw = readRaw();
  const book = migrateBranchBook(raw, legacyActive, links);
  if (JSON.stringify(book) !== JSON.stringify(raw)) write(book);
  return book;
}

/** Record that `account` is being shared with `host` (call BEFORE anything leaves the device). */
export function claimBranch(book: BranchBook, host: string, account: number): void {
  const k = String(account);
  const cur = book[k];
  if (cur && cur.host !== host.toLowerCase()) throw new Error("That trading branch is no longer available on this wallet.");
  write({ ...readRaw(), ...book, [k]: { host: host.toLowerCase(), retired: false } });
}

/** A spending key for `account` was revoked: never hand that branch to another site, and only "Give access" to the same one. */
export function retireBranch(account: number, host: string): void {
  const book = readRaw();
  const k = String(account);
  book[k] = { host: book[k]?.host || host.toLowerCase(), retired: true };
  write(book);
}
