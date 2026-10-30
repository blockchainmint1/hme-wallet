/**
 * Desktop bulk send ("send to many") for TXC and TXC Omni tokens.
 *
 * - TXC: one ordinary transaction with one output per recipient.
 * - Omni tokens: Omni Send To Many (type 7). The TXC node relays only one
 *   80-byte OP_RETURN per transaction, which fits 7 receivers, so longer lists
 *   are split into batches of 7 chained on the previous batch's change.
 *   Batches are NOT atomic: if one fails, earlier batches have already been
 *   broadcast and we stop.
 */
import { address as btcAddress } from "bitcoinjs-lib";
import { TXC_NETWORK, SATS_PER_TXC } from "./network";
import { isOmniCompatibleAddress, parseTokenAmount } from "./tokens";

export const BULK_MAX_RECIPIENTS = 100;
export const STM_BATCH_SIZE = 7;
/** Block where Omni Send To Many switches on for TXC mainnet. */
export const STM_ACTIVATION_HEIGHT = 364_100;
export const BULK_DUST_SATS = 10_000;

export interface BulkRow {
  line: number;
  address: string;
  units: bigint;
}

export interface BulkParse {
  rows: BulkRow[];
  errors: string[];
  duplicates: string[];
  total: bigint;
}

export function isValidTxcAddress(a: string): boolean {
  try {
    btcAddress.toOutputScript(a, TXC_NETWORK);
    return true;
  } catch {
    return false;
  }
}

/** Parse TXC amount ("1.5") into sats as bigint, 8 decimals max. */
export function parseTxcSats(amount: string): bigint {
  return parseTokenAmount(amount, true);
}

/**
 * Parse "address,amount" lines (comma, semicolon or tab; header row and blank
 * lines ignored). `kind` is "txc" or an Omni token's divisibility.
 */
export function parseBulkCsv(
  text: string,
  kind: { type: "txc" } | { type: "omni"; divisible: boolean },
): BulkParse {
  const rows: BulkRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  let total = 0n;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    const parts = s.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) {
      errors.push(`Line ${line}: expected "address,amount".`);
      return;
    }
    const [addr, amount] = parts;
    if (rows.length === 0 && errors.length === 0 && !isValidTxcAddress(addr) && /address/i.test(addr)) return; // header
    if (!isValidTxcAddress(addr)) {
      errors.push(`Line ${line}: "${addr}" is not a TEXITcoin address.`);
      return;
    }
    if (kind.type === "omni" && !isOmniCompatibleAddress(addr)) {
      errors.push(`Line ${line}: ${addr} is a txc1 address; tokens can't be received there.`);
      return;
    }
    let units: bigint;
    try {
      units = kind.type === "txc" ? parseTxcSats(amount) : parseTokenAmount(amount, kind.divisible);
    } catch {
      errors.push(`Line ${line}: "${amount}" is not a valid amount.`);
      return;
    }
    if (units <= 0n) {
      errors.push(`Line ${line}: amount must be greater than zero.`);
      return;
    }
    if (kind.type === "txc" && units < BigInt(BULK_DUST_SATS)) {
      errors.push(`Line ${line}: TXC amounts must be at least ${BULK_DUST_SATS / SATS_PER_TXC} TXC.`);
      return;
    }
    total += units;
    const at = seen.get(addr);
    if (at !== undefined) {
      // Same address listed again: merge into the first line (one output, one fee).
      duplicates.push(addr);
      rows[at] = { ...rows[at], units: rows[at].units + units };
      return;
    }
    seen.set(addr, rows.length);
    rows.push({ line, address: addr, units });
  });
  if (rows.length > BULK_MAX_RECIPIENTS) {
    errors.push(`Too many recipients: ${rows.length}. The limit is ${BULK_MAX_RECIPIENTS}.`);
  }
  return { rows, errors, duplicates: [...new Set(duplicates)], total };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Omni Send To Many payload (with the "omni" marker, without the OP_RETURN
 * opcode). Receivers point at output indexes in the same transaction.
 * Layout: "omni" | ver u16 | type u16 = 7 | prop u32 | n u8 | (vout u8, amount u64)*n
 */
export function buildSendToManyPayload(
  propertyId: number,
  receivers: { vout: number; units: bigint }[],
): Uint8Array {
  if (!Number.isInteger(propertyId) || propertyId <= 0 || propertyId > 0xffffffff) throw new Error("Invalid property id.");
  if (receivers.length < 1 || receivers.length > STM_BATCH_SIZE) throw new Error(`A batch needs 1–${STM_BATCH_SIZE} receivers.`);
  const out = new Uint8Array(13 + 9 * receivers.length);
  out.set([0x6f, 0x6d, 0x6e, 0x69], 0);
  out[6] = 0;
  out[7] = 7;
  new DataView(out.buffer).setUint32(8, propertyId);
  out[12] = receivers.length;
  receivers.forEach((r, i) => {
    if (!Number.isInteger(r.vout) || r.vout < 0 || r.vout > 255) throw new Error("Output index out of range.");
    if (r.units <= 0n || r.units > 0x7fffffffffffffffn) throw new Error("Invalid amount.");
    const at = 13 + 9 * i;
    out[at] = r.vout;
    new DataView(out.buffer).setBigUint64(at + 1, r.units);
  });
  if (out.length > 80) throw new Error("Payload too large for one OP_RETURN.");
  return out;
}

/** Estimated vsize. Inputs priced as legacy (worst case) unless told otherwise. */
export function estimateVsize(inputs: number, outputs: number, opReturnBytes = 0, inputVbytes = 148): number {
  return 10 + inputs * inputVbytes + outputs * 34 + (opReturnBytes ? 11 + opReturnBytes : 0);
}

/** Saved send-to-many progress, kept on this device until every batch settles. */
export type BulkStepStatus = "pending" | "ok" | "failed" | "waiting";
export type BulkDelivery = "checking" | "delivered" | "rejected";
export interface BulkSavedStep { label: string; status: BulkStepStatus; txid?: string; error?: string; delivery?: BulkDelivery; reason?: string }
export interface BulkSavedRun { asset: string; steps: BulkSavedStep[]; error?: string; savedAt: number }

export function bulkProgressKey(fingerprint: string): string {
  return `hm.desktop.bulk-send.progress.${fingerprint}`;
}

/** True once nothing more can change: no batch is sending or awaiting a token verdict. */
export function bulkRunSettled(run: BulkSavedRun): boolean {
  return run.steps.every((s) => s.status !== "pending" && !(s.status === "ok" && s.delivery === "checking"));
}

export function parseSavedRun(raw: string | null): BulkSavedRun | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as BulkSavedRun;
    if (!v || typeof v.asset !== "string" || !Array.isArray(v.steps)) return null;
    const statuses = ["pending", "ok", "failed", "waiting"];
    const steps = v.steps.filter((s) => s && typeof s.label === "string" && statuses.includes(s.status) && (s.txid === undefined || /^[0-9a-f]{64}$/i.test(s.txid)))
      // A reload interrupts any in-flight batch; we can't know if it went out.
      .map((s) => (s.status === "pending" ? { ...s, status: "failed" as const, error: "Interrupted by a page reload — check your activity before retrying." } : s));
    return { asset: v.asset, steps, error: typeof v.error === "string" ? v.error : undefined, savedAt: Number(v.savedAt) || 0 };
  } catch {
    return null;
  }
}
