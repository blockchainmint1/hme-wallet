/**
 * Every swap this wallet profile has made, newest first, under the desktop
 * Swap page: THORChain swaps, SideShift/FixedFloat swaps from the phone swap
 * screen, TSD purchases through TSD Bridge and TSD → USDC cash-outs.
 *
 * Read-only. Each list comes from its own on-device record (no key material);
 * status checks only use public txids, and TSD orders are only polled with the
 * cash-out key whose fingerprint they were recorded under.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/txc/wallet-context";
import { deriveEvmAccount, EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { canTrackSwap, openedSwapState, savedSwapId, updateSwap, useSwapHistory, type SavedSwap } from "@/lib/swap-history";
import { THOR_CATALOG, thorUnitsToNumber, type ThorAssetId, type ThorUtxoCoin } from "@/lib/thorchain/catalog";
import { THOR_UTXO_COINS } from "@/lib/thorchain/execute";
import { getThorTxStatus } from "@/lib/thorchain/swap.functions";
import { useMintHistory, recordState, type MintRecord } from "@/lib/cashout/mint-history";
import { mintSource, mintStatusLabel } from "@/lib/cashout/mint";
import { useCashoutHistory, type CashoutRecord } from "@/lib/cashout/cashout-history";
import { cashoutKeyFingerprint, useCashoutApiKey } from "@/lib/cashout/api-key";
import { getCashoutOrder, getTsdMintOrder } from "@/lib/cashout/tsd.functions";
import { cashoutStatusLabel, formatUsd, isTerminalCashoutStatus } from "@/lib/cashout/tsd";
import { explorerTxUrl as txcExplorerTxUrl } from "@/lib/txc/mempool";

type Entry =
  | { type: "swap"; id: string; at: number; swap: SavedSwap }
  | { type: "buy"; id: string; at: number; rec: MintRecord }
  | { type: "sell"; id: string; at: number; rec: CashoutRecord };

const PAGE = 20;

const PROVIDER_LABEL: Record<SavedSwap["provider"], string> = {
  thorchain: "THORChain",
  sideshift: "SideShift",
  fixedfloat: "FixedFloat",
};

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function assetMeta(id: string) {
  return (THOR_CATALOG as Record<string, (typeof THOR_CATALOG)[ThorAssetId] | undefined>)[id] ?? null;
}

function swapExplorer(s: SavedSwap): string | null {
  if (!s.txid) return null;
  const meta = assetMeta(s.coin);
  if (!meta) return null;
  if (meta.kind === "utxo") {
    const cfg = (THOR_UTXO_COINS as Record<string, (typeof THOR_UTXO_COINS)[ThorUtxoCoin] | undefined>)[meta.id];
    return cfg ? cfg.explorerTxUrl(s.txid) : null;
  }
  const chain = (EVM_CHAINS as Record<string, (typeof EVM_CHAINS)[EvmChainId] | undefined>)[meta.chain];
  return chain ? chain.explorerTx(s.txid) : null;
}

export function SwapHistory() {
  const { root, activeProfileId } = useWallet();
  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  const swaps = useSwapHistory(activeProfileId, evmAddress);
  const buys = useMintHistory(activeProfileId);
  const sells = useCashoutHistory(activeProfileId);
  const [apiKey] = useCashoutApiKey();
  const keyFp = apiKey ? cashoutKeyFingerprint(apiKey) : null;
  const [shown, setShown] = useState(PAGE);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...swaps.map((s) => ({ type: "swap" as const, id: `swap:${savedSwapId(s)}`, at: s.createdAt, swap: s })),
      // Opened-but-never-paid and superseded purchase orders are not history.
      ...buys
        .filter((r) => { const st = recordState(r); return st !== "reviewed" && st !== "abandoned"; })
        .map((r) => ({ type: "buy" as const, id: `buy:${r.orderId}`, at: r.createdAt, rec: r })),
      ...sells.map((r) => ({ type: "sell" as const, id: `sell:${r.txid}`, at: r.createdAt, rec: r })),
    ];
    return list.sort((a, b) => b.at - a.at);
  }, [swaps, buys, sells]);

  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="swap-history-title">
      <h2 id="swap-history-title" className="text-xl font-semibold">Swap history</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every swap, TSD purchase and TSD cash-out made from this wallet on this device.
      </p>
      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No swaps yet.</p>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
            {entries.slice(0, shown).map((e) =>
              e.type === "swap" ? <SwapRow key={e.id} swap={e.swap} />
              : e.type === "buy" ? <BuyRow key={e.id} rec={e.rec} apiKey={apiKey && e.rec.keyFp === keyFp ? apiKey : null} />
              : <SellRow key={e.id} rec={e.rec} apiKey={apiKey && e.rec.keyFp === keyFp ? apiKey : null} />,
            )}
          </ul>
          {entries.length > shown && (
            <Button variant="outline" className="mt-4" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({entries.length - shown} older)
            </Button>
          )}
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        TSD cash-outs appear here from this update on; earlier ones are still in Activity.
      </p>
    </section>
  );
}

function Row({ title, detail, status, href }: { title: string; detail: string; status: string; href: string | null }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-muted-foreground">{status}</span>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="View transaction">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </li>
  );
}

function SwapRow({ swap }: { swap: SavedSwap }) {
  const isThor = swap.provider === "thorchain";
  const fetchStatus = useServerFn(getThorTxStatus);
  const status = useQuery({
    queryKey: ["thor-swap-status", swap.txid],
    enabled: isThor && canTrackSwap(swap) && !swap.done && !swap.failed,
    queryFn: () => fetchStatus({ data: { txid: swap.txid } }),
    refetchInterval: 60_000,
    retry: 1,
  });
  useEffect(() => {
    const st = status.data;
    if (st?.outboundSent && st.outboundTxid && !swap.done) {
      updateSwap(swap.txid, { done: true, outboundTxid: st.outboundTxid, checkedAt: Date.now() });
    }
  }, [status.data, swap]);

  const from = assetMeta(swap.coin);
  const amount = thorUnitsToNumber(swap.amountSats).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const opened = openedSwapState(swap);
  const label = swap.failed ? "Failed or refunded"
    : swap.done ? "Paid out"
    : opened === "expired" ? "Expired — never sent"
    : opened === "opened" ? "Order opened — not sent"
    : isThor ? (status.data?.observed ? "Swapping…" : "Waiting for deposit…")
    : "In progress";
  return (
    <Row
      title={`${amount} ${from?.symbol ?? swap.coin.toUpperCase()} → ${swap.dest.symbol}`}
      detail={`${PROVIDER_LABEL[swap.provider]} · ${from?.label ?? swap.coin.toUpperCase()} to ${swap.dest.label ?? swap.dest.symbol} · ${fmtWhen(swap.createdAt)}`}
      status={label}
      href={swapExplorer(swap)}
    />
  );
}

function BuyRow({ rec, apiKey }: { rec: MintRecord; apiKey: string | null }) {
  const fetchOrder = useServerFn(getTsdMintOrder);
  const source = mintSource(rec.sourceId);
  const st = recordState(rec);
  const order = useQuery({
    queryKey: ["tsd-mint-order", rec.orderId],
    enabled: !!apiKey && st !== "failed",
    queryFn: () => fetchOrder({ data: { apiKey: apiKey!, id: rec.orderId } }),
    refetchInterval: (q) => (q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 60_000),
    retry: 1,
  });
  const label = st === "failed" ? "Payment failed"
    : order.data ? mintStatusLabel(order.data.status)
    : !apiKey ? "Sent to TSD Bridge"
    : order.isError ? "Couldn't check" : "Checking…";
  const href = rec.txHash && source ? EVM_CHAINS[source.chain].explorerTx(rec.txHash) : null;
  return (
    <Row
      title={`${rec.amount} ${source?.symbol ?? ""} → TSD`}
      detail={`TSD Bridge · buy TSD with ${source?.label ?? "stablecoins"} · ${fmtWhen(rec.createdAt)}`}
      status={label}
      href={href}
    />
  );
}

function SellRow({ rec, apiKey }: { rec: CashoutRecord; apiKey: string | null }) {
  const fetchOrder = useServerFn(getCashoutOrder);
  const canPoll = !!apiKey && rec.kind === "one-time-order" && !!rec.orderId;
  const order = useQuery({
    queryKey: ["tsd-cashout-order", rec.orderId],
    enabled: canPoll,
    queryFn: () => fetchOrder({ data: { apiKey: apiKey!, id: rec.orderId! } }),
    refetchInterval: (q) => (q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 60_000),
    retry: 1,
  });
  const label = order.data ? cashoutStatusLabel(order.data.status)
    : !canPoll ? "Sent to TSD Swap"
    : order.isError ? "Couldn't check" : "Checking…";
  const short = `${rec.payoutAddress.slice(0, 6)}…${rec.payoutAddress.slice(-4)}`;
  return (
    <Row
      title={`${Number(rec.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} TSD → ${formatUsd(rec.payoutAmount)} USDC`}
      detail={`TSD Swap cash-out · to ${short}${rec.kind === "one-time-order" ? " (one-time)" : " (saved address)"} · ${fmtWhen(rec.createdAt)}`}
      status={label}
      href={txcExplorerTxUrl(rec.txid)}
    />
  );
}
