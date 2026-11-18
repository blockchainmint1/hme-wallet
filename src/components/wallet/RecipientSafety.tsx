/**
 * Send-screen defence against address poisoning. Compares the recipient with
 * every address this wallet has really paid (signed sends) and saved contacts:
 *   - lookalike of one of them → red stop, both addresses with the differing
 *     characters marked, and a required tick before sending;
 *   - seen only on a flagged (suspicious) transfer → red stop + tick;
 *   - never used → soft "first time" note; history unavailable → says so.
 * Advisory only: never changes the address, the amount or the signing path.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { getEvmHistory, type EvmChainId, type EvmTransfer } from "@/lib/chains/history.functions";
import { getEnabledChains } from "@/lib/chain-prefs";
import { contactsForChain, type ContactChain } from "@/lib/address-book";
import { suspiciousActivityReason } from "@/lib/suspicious-activity";
import {
  checkRecipient,
  differingPositions,
  evmTrustedDestinations,
  solanaTrustedDestinations,
  tronSuspiciousReason,
  tronTrustedDestinations,
  utxoTrustedDestinations,
  verdictBlocks,
  type AddressFamily,
  type RecipientVerdict,
} from "@/lib/address-lookalike";
import { getKnownTokens } from "@/lib/token-prefs";
import { getTronHistory, type TronTransfer } from "@/lib/tron/api";
import { TRC20_TOKENS } from "@/lib/tron/network";
import { getSolanaHistory } from "@/lib/solana/api";
import type { MempoolTx } from "@/lib/txc/mempool";

export type UtxoCoin = "txc" | "isk" | "btc" | "ltc" | "doge";
export type RecipientTarget =
  | { family: "evm"; self: string | null }
  | { family: "tron"; self: string | null }
  | { family: "solana"; self: string | null }
  | { family: "utxo"; coin: UtxoCoin };

const EVM_IDS: EvmChainId[] = ["eth", "base", "bsc", "zcu"];
const UTXO_KEY: Record<UtxoCoin, string> = { txc: "txs", isk: "isk-txs", btc: "btc-txs", ltc: "ltc-txs", doge: "doge-txs" };

interface Sources {
  trusted: Set<string>;
  flagged: Set<string>;
  own: Set<string>;
  complete: boolean;
}

function useEvmSources(self: string | null, on: boolean): Sources {
  const fetchHistory = useServerFn(getEvmHistory);
  const chains = useMemo(() => {
    const enabled = new Set([...getEnabledChains("phone"), ...getEnabledChains("desktop")]);
    return EVM_IDS.filter((c) => enabled.has(c));
  }, []);
  const queries = useQueries({
    queries: chains.map((chain) => ({
      // Same cache entry the wallet's activity list uses.
      queryKey: ["evm-history", chain, self],
      enabled: on && !!self,
      queryFn: () => fetchHistory({ data: { chain, address: self! } }),
      staleTime: 300_000,
    })),
  });
  return useMemo(() => {
    const trusted = new Set<string>();
    const flagged = new Set<string>();
    let complete = on && !!self && chains.length > 0;
    queries.forEach((q, i) => {
      const data = q.data as { transfers?: EvmTransfer[]; unavailable?: boolean } | undefined;
      if (!q.isSuccess || !data || data.unavailable) complete = false;
      const list = data?.transfers ?? [];
      const chain = chains[i]!;
      const verified = new Set(getKnownTokens(chain).map((t) => t.address.toLowerCase()));
      for (const a of evmTrustedDestinations(list, verified)) trusted.add(a);
      for (const t of list) {
        if (!suspiciousActivityReason(t, list, chain)) continue;
        const cp = (t.outgoing ? t.to : t.from)?.toLowerCase();
        if (cp) flagged.add(cp);
      }
    });
    for (const a of trusted) flagged.delete(a);
    return { trusted, flagged, own: new Set(self ? [self.toLowerCase()] : []), complete };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt + ":" + q.status).join("|"), self, on]);
}

function useTronSources(self: string | null, on: boolean): Sources {
  const q = useQuery({
    queryKey: ["tron-history", self],
    enabled: on && !!self,
    queryFn: () => getTronHistory(self!),
    staleTime: 20_000,
  });
  return useMemo(() => {
    const list: TronTransfer[] = q.data ?? [];
    const verified = new Set(TRC20_TOKENS.map((t) => t.contract));
    const trusted = self ? tronTrustedDestinations(list, self, verified) : new Set<string>();
    const flagged = new Set<string>();
    if (self) for (const t of list) if (tronSuspiciousReason(t, self, trusted, verified)) flagged.add(t.from === self ? t.to : t.from);
    for (const a of trusted) flagged.delete(a);
    return { trusted, flagged, own: new Set(self ? [self] : []), complete: on && q.isSuccess };
  }, [q.data, q.isSuccess, self, on]);
}

function useSolanaSources(self: string | null, on: boolean): Sources {
  const q = useQuery({
    queryKey: ["solana-history", self],
    enabled: on && !!self,
    queryFn: () => getSolanaHistory(self!),
    staleTime: 20_000,
  });
  return useMemo(
    () => ({ trusted: solanaTrustedDestinations(q.data ?? []), flagged: new Set(), own: new Set(self ? [self] : []), complete: on && q.isSuccess }),
    [q.data, q.isSuccess, self, on],
  );
}

/** UTXO history is heavy to fetch, so read what the wallet already loaded on this device. */
function useUtxoSources(coin: UtxoCoin | null): Sources {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const version = useSyncExternalStore(
    (cb) => cache.subscribe(cb),
    () => cache.getAll().length + ":" + cache.getAll().reduce((n, q) => n + q.state.dataUpdatedAt, 0),
    () => "0",
  );
  return useMemo(() => {
    const trusted = new Set<string>();
    const own = new Set<string>();
    let found = false;
    if (coin) {
      const entries = [
        ...qc.getQueriesData<MempoolTx[]>({ queryKey: [UTXO_KEY[coin]] }).map(([key, data]) => ({ addrs: String(key[1] ?? ""), data })),
        ...qc.getQueriesData<MempoolTx[]>({ queryKey: ["desktop-txs"] })
          .filter(([key]) => key[2] === coin)
          .map(([key, data]) => ({ addrs: String(key[3] ?? ""), data })),
        // Imported private keys keep their own history.
        ...qc.getQueriesData<MempoolTx[]>({ queryKey: ["wif-txs"] })
          .filter(([key]) => key[1] === coin)
          .map(([key, data]) => ({ addrs: String(key[2] ?? ""), data })),
      ];
      for (const e of entries) {
        if (!Array.isArray(e.data)) continue;
        found = true;
        const mine = new Set(e.addrs.split(",").filter(Boolean));
        mine.forEach((a) => own.add(a));
        for (const a of utxoTrustedDestinations(e.data, mine)) trusted.add(a);
      }
    }
    for (const a of own) trusted.delete(a);
    return { trusted, flagged: new Set(), own, complete: found };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, version]);
}

const CONTACT_CHAIN: Record<string, ContactChain> = { evm: "eth", tron: "tron", solana: "solana", txc: "txc", isk: "isk", btc: "btc", ltc: "ltc", doge: "doge" };

export interface RecipientSafety {
  family: AddressFamily;
  to: string;
  verdict: RecipientVerdict;
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  /** True while a warning needs the member's tick: the send must not proceed. */
  blocked: boolean;
}

/** Everything the wallet knows about past recipients for this coin, contacts included. */
function useRecipientSources(target: RecipientTarget): Sources & { family: AddressFamily } {
  const evm = useEvmSources(target.family === "evm" ? target.self : null, target.family === "evm");
  const tron = useTronSources(target.family === "tron" ? target.self : null, target.family === "tron");
  const sol = useSolanaSources(target.family === "solana" ? target.self : null, target.family === "solana");
  const utxo = useUtxoSources(target.family === "utxo" ? target.coin : null);
  const src = { evm, tron, solana: sol, utxo }[target.family];
  const contactKey = CONTACT_CHAIN[target.family === "utxo" ? target.coin : target.family]!;
  return useMemo(() => {
    let contacts: string[] = [];
    try {
      contacts = contactsForChain(contactKey).map((c) => c.address);
    } catch {
      /* no storage */
    }
    return { ...src, trusted: new Set([...src.trusted, ...contacts]), family: target.family };
  }, [src, contactKey, target.family]);
}

/** `valid` = the address already passed the chain's own format check. */
export function useRecipientSafety(target: RecipientTarget, to: string, valid: boolean): RecipientSafety {
  const src = useRecipientSources(target);
  const trimmed = to.trim();
  const verdict = useMemo<RecipientVerdict>(
    () => (!valid || !trimmed ? { kind: "empty" } : checkRecipient(trimmed, src)),
    [valid, trimmed, src],
  );
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [trimmed]);
  return { family: target.family, to: trimmed, verdict, acknowledged, setAcknowledged, blocked: verdictBlocks(verdict) && !acknowledged };
}

export interface RecipientListSafety {
  family: AddressFamily;
  warnings: { address: string; verdict: Extract<RecipientVerdict, { kind: "lookalike" | "flagged-only" }> }[];
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  blocked: boolean;
}

/** Send to many: the same check on every line. */
export function useRecipientListSafety(target: RecipientTarget, addresses: string[]): RecipientListSafety {
  const src = useRecipientSources(target);
  const key = addresses.join("\n");
  const warnings = useMemo(() => {
    const out: RecipientListSafety["warnings"] = [];
    for (const address of new Set(addresses.map((a) => a.trim()).filter(Boolean))) {
      const v = checkRecipient(address, src);
      if (v.kind === "lookalike" || v.kind === "flagged-only") out.push({ address, verdict: v });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, src]);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [key]);
  return { family: target.family, warnings, acknowledged, setAcknowledged, blocked: warnings.length > 0 && !acknowledged };
}

export function RecipientListSafetyNotice({ safety }: { safety: RecipientListSafety }) {
  if (safety.warnings.length === 0) return null;
  return (
    <div role="alert" className="mt-3 space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
      <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Stop — {safety.warnings.length === 1 ? "one address looks" : `${safety.warnings.length} addresses look`} suspicious
      </p>
      <ul className="space-y-2">
        {safety.warnings.map(({ address, verdict }) => (
          <li key={address} className="space-y-1">
            {verdict.kind === "lookalike" ? (
              <>
                <p>Lookalike of {short(verdict.match)}, which you've used before, but the middle is different:</p>
                <Marked addr={address} other={verdict.match} family={safety.family} />
              </>
            ) : (
              <>
                <p>Only seen on a transfer the wallet flagged as suspicious:</p>
                <code className="block break-all rounded bg-background/60 p-2 font-mono">{address}</code>
              </>
            )}
          </li>
        ))}
      </ul>
      <p>Scammers plant lookalike addresses in your history hoping you'll copy one. This is a common scam.</p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={safety.acknowledged}
          onCheckedChange={(c) => safety.setAcknowledged(c === true)}
          aria-label="I've checked these addresses with the receivers"
        />
        <span>I've checked {safety.warnings.length === 1 ? "this exact address" : "these exact addresses"} with the receivers and still want to send.</span>
      </label>
    </div>
  );
}

function Marked({ addr, other, family }: { addr: string; other: string; family: AddressFamily }) {
  const diff = differingPositions(addr, other, family);
  return (
    <code className="block break-all rounded bg-background/60 p-2 font-mono text-xs">
      {Array.from(addr).map((ch, i) =>
        diff[i] ? (
          <mark key={i} className="rounded-sm bg-destructive/25 font-bold text-destructive">{ch}</mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </code>
  );
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function RecipientSafetyNotice({ safety }: { safety: RecipientSafety }) {
  const v = safety.verdict;
  if (v.kind === "empty" || v.kind === "known") return null;
  if (v.kind === "first-time" || v.kind === "unchecked") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {v.kind === "first-time"
          ? "Not one of your recent payments. Check the address with the receiver."
          : "Couldn't compare this address with your past payments right now. Check it with the receiver."}
      </p>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
      <p className="flex items-start gap-2 font-semibold text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {v.kind === "lookalike" ? "Stop — this address is a lookalike" : "Stop — this address came from a suspicious transfer"}
      </p>
      {v.kind === "lookalike" ? (
        <>
          <p>
            It looks like {short(v.match)}, which you've used before, but the middle is different. Scammers plant
            lookalike addresses in your history hoping you'll copy one. This is a common scam.
          </p>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">You're sending to</p>
            <Marked addr={safety.to} other={v.match} family={safety.family} />
            <p className="text-xs text-muted-foreground">Address you've used before</p>
            <Marked addr={v.match} other={safety.to} family={safety.family} />
          </div>
        </>
      ) : (
        <p>
          The only time this address shows up in your history is on a transfer the wallet flagged as suspicious
          (a fake token or a zero-value transfer). Scammers use those to plant addresses.
        </p>
      )}
      <label className="flex items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={safety.acknowledged}
          onCheckedChange={(c) => safety.setAcknowledged(c === true)}
          aria-label="I've checked this address with the receiver"
        />
        <span>I've checked this exact address with the receiver and still want to send.</span>
      </label>
    </div>
  );
}
