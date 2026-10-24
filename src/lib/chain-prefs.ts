import { scopedKey } from "@/lib/profiles";
import type { PreferenceScope } from "./preference-scope";
/**
 * Chain preferences: which chains from the single HD seed to show tiles for.
 * Stored in localStorage so it persists across sessions on-device.
 *
 * APP-WIDE: chain on/off and tile order are device settings, shared by every
 * wallet profile. They used to be namespaced per profile; on first read we
 * copy the active profile's scoped values into the shared key (copy-only —
 * the old scoped keys are left in place, never deleted).
 */
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { isKeyOnlyWallet } from "@/lib/txc/storage";


export type ChainId = "txc" | "btc" | EvmChainId | "isk" | "ltc" | "doge" | "tron" | "solana" | "zcu";

export interface ChainMeta {
  id: ChainId;
  name: string;
  shortName: string;
  /** Not yet launched — toggle stays disabled/off. */
  soon?: boolean;
  /** Hex accent used by the tile gradient. */
  accent: string;
}

export const CHAIN_META: Record<ChainId, ChainMeta> = {
  txc: { id: "txc", name: "TEXITcoin", shortName: "TXC", accent: "#B45309" },
  btc: { id: "btc", name: "Bitcoin", shortName: "BTC", accent: "#F7931A" },
  eth: { id: "eth", name: "Ethereum", shortName: EVM_CHAINS.eth.shortName, accent: EVM_CHAINS.eth.accent },
  base: { id: "base", name: "Base", shortName: EVM_CHAINS.base.shortName, accent: EVM_CHAINS.base.accent },
  bsc: { id: "bsc", name: "Binance Chain", shortName: EVM_CHAINS.bsc.shortName, accent: EVM_CHAINS.bsc.accent },
  isk: { id: "isk", name: "IskanderCoin", shortName: "ISK", accent: "#22C55E" },
  ltc: { id: "ltc", name: "Litecoin", shortName: "LTC", accent: "#345D9D" },
  doge: { id: "doge", name: "Dogecoin", shortName: "DOGE", accent: "#C2A633" },
  tron: { id: "tron", name: "Tron", shortName: "TRX", accent: "#EF0027" },
  solana: { id: "solana", name: "Solana", shortName: "SOL", accent: "#14F195" },
  zcu: { id: "zcu", name: "Zero Chill", shortName: EVM_CHAINS.zcu.shortName, accent: EVM_CHAINS.zcu.accent },
};

export const CHAIN_ORDER: ChainId[] = [
  "txc", "btc", "eth", "base", "bsc", "isk", "ltc", "doge", "tron", "solana", "zcu",
];

const ORDER_KEY_BASE = "hme.chains.order.v1";
/** App-wide key (the default profile's historical unprefixed key). */
function ORDER_KEY(): string {
  return ORDER_KEY_BASE;
}

/**
 * One-time, copy-only migration: if the shared key has never been written but
 * a profile-scoped copy exists, adopt it. The scoped copy is NOT removed.
 */
function adoptLegacy(base: string): string | null {
  try {
    const legacy = localStorage.getItem(scopedKey(base));
    if (legacy != null) {
      localStorage.setItem(base, legacy);
      return legacy;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readOrder(): ChainId[] {
  if (typeof localStorage === "undefined") return [...CHAIN_ORDER];
  try {
    const raw = localStorage.getItem(ORDER_KEY()) ?? adoptLegacy(ORDER_KEY_BASE);
    if (!raw) return [...CHAIN_ORDER];
    const parsed = JSON.parse(raw) as string[];
    const seen = new Set<ChainId>();
    const out: ChainId[] = [];
    for (const id of parsed) {
      if ((CHAIN_ORDER as string[]).includes(id) && !seen.has(id as ChainId)) {
        out.push(id as ChainId);
        seen.add(id as ChainId);
      }
    }
    // Append any chains missing from the saved order (new chains added later).
    for (const id of CHAIN_ORDER) if (!seen.has(id)) out.push(id);
    return out;
  } catch {
    return [...CHAIN_ORDER];
  }
}

export function getChainOrder(): ChainId[] {
  return readOrder();
}

export function setChainOrder(order: ChainId[]): void {
  // Normalize: keep only valid ids, dedupe, append missing.
  const seen = new Set<ChainId>();
  const normalized: ChainId[] = [];
  for (const id of order) {
    if ((CHAIN_ORDER as string[]).includes(id) && !seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  }
  for (const id of CHAIN_ORDER) if (!seen.has(id)) normalized.push(id);
  try {
    localStorage.setItem(ORDER_KEY(), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("hme:chains-changed"));
  } catch {
    /* ignore */
  }
}

const STORAGE_KEY_BASE = "hme.chains.enabled.v1";
/** App-wide key (the default profile's historical unprefixed key). */
function STORAGE_KEY(): string {
  return STORAGE_KEY_BASE;
}
const DEFAULT_ENABLED: Record<ChainId, boolean> = {
  txc: true,
  btc: false,

  eth: false,
  base: false,
  bsc: false,
  isk: false,
  ltc: false,
  doge: false,
  tron: false,
  solana: false,
  zcu: false,
};

function read(scope: PreferenceScope = "phone"): Record<ChainId, boolean> {
  const defaults = scope === "desktop"
    ? Object.fromEntries(CHAIN_ORDER.map(id => [id, !CHAIN_META[id].soon])) as Record<ChainId, boolean>
    : DEFAULT_ENABLED;
  if (typeof localStorage === "undefined") return { ...defaults };
  try {
    const raw = scope === "desktop" ? localStorage.getItem("hme.desktop.chains.enabled.v1") : localStorage.getItem(STORAGE_KEY()) ?? adoptLegacy(STORAGE_KEY_BASE);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<Record<ChainId, boolean>>;
    const out = { ...defaults };
    for (const k of CHAIN_ORDER) { const value = parsed[k]; if (typeof value === "boolean") out[k] = value; }
    // "soon" chains can never be enabled.
    for (const k of CHAIN_ORDER) if (CHAIN_META[k].soon) out[k] = false;
    // TXC is always on.
    out.txc = true;
    return out;
  } catch {
    return { ...defaults };
  }
}

export function getChainPrefs(scope: PreferenceScope = "phone"): Record<ChainId, boolean> {
  return read(scope);
}

export function getEnabledChains(scope: PreferenceScope = "phone"): ChainId[] {
  // A key-only wallet has no seed, so there are no derived HD chain tiles —
  // only the imported WIF tiles.
  if (isKeyOnlyWallet()) return [];
  const prefs = read(scope);
  return (scope === "desktop" ? CHAIN_ORDER : readOrder()).filter((c) => prefs[c]);
}


export function setChainEnabled(id: ChainId, enabled: boolean, scope: PreferenceScope = "phone"): void {
  if (CHAIN_META[id].soon) return;
  if (id === "txc") return; // TXC is always on
  const prefs = read(scope);
  prefs[id] = enabled;
  try {
    localStorage.setItem(scope === "desktop" ? "hme.desktop.chains.enabled.v1" : STORAGE_KEY(), JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("hme:chains-changed"));
  } catch {
    /* ignore */
  }
}
