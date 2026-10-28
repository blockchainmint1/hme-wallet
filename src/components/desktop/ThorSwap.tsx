/**
 * Desktop THORChain swap: any supported coin to any supported coin, quoted
 * live from THORChain and signed on this device.
 *
 * - Routes come from the server-side catalog (live pools + halt flags).
 * - The payout address auto-fills from this wallet's own receive address for
 *   the destination chain; it can be overridden by pasting another address.
 * - Every send is bound to a frozen quote: UTXO deposits carry the memo in an
 *   OP_RETURN, EVM deposits go through a pre-signing guard that rebuilds the
 *   exact calldata from the quote and refuses anything different.
 * - Cold Storage (Vault) profiles stay blocked here; offline swap signing
 *   needs the coordinated Vault corrections first.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createWalletClient, http, isAddress } from "viem";
import { ArrowDown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { rootFingerprintHex } from "@/lib/txc/fingerprint";
import { EVM_CHAINS, deriveEvmAccount, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { scanBtcAccount } from "@/lib/btc/scan";
import { scanLtcAccount } from "@/lib/ltc/scan";
import { scanDogeAccount } from "@/lib/doge/scan";
import { BTC_DEFAULT_KIND } from "@/lib/btc/network";
import { LTC_DEFAULT_KIND } from "@/lib/ltc/network";
import { DOGE_DEFAULT_KIND } from "@/lib/doge/network";
import { confirmWithBiometric } from "@/lib/native/biometric";
import { hapticError, hapticSuccess } from "@/lib/native/ui";
import { friendlyBroadcastError } from "@/lib/broadcast-error";
import { recordSwap, useSwapHistory, canTrackSwap, updateSwap } from "@/lib/swap-history";
import {
  THOR_CATALOG,
  assertQuoteFresh,
  parseAssetAmount,
  thorUnitsToNumber,
  validateThorDestination,
  type ThorAssetId,
  type ThorCatalogQuote,
} from "@/lib/thorchain/catalog";
import { getThorCatalogQuote, getThorCatalogRoutes } from "@/lib/thorchain/catalog.functions";
import { getThorTxStatus } from "@/lib/thorchain/swap.functions";
import {
  THOR_UTXO_COINS,
  executeEvmThorSwap,
  executeUtxoThorSwap,
  planUtxoThorSwap,
  type UtxoAccountLike,
} from "@/lib/thorchain/execute";
import type { ThorUtxoCoin } from "@/lib/thorchain/catalog";

const UTXO_SCANS: Record<ThorUtxoCoin, (root: never) => Promise<UtxoAccountLike & { nextReceiveAddress: string }>> = {
  btc: (root) => scanBtcAccount(root, BTC_DEFAULT_KIND) as never,
  ltc: (root) => scanLtcAccount(root, LTC_DEFAULT_KIND) as never,
  doge: (root) => scanDogeAccount(root, DOGE_DEFAULT_KIND) as never,
};

function fmtUnits(units: string, maxFrac = 6): string {
  return thorUnitsToNumber(units).toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function fmtSeconds(s: number | null): string {
  if (s == null) return "a few minutes";
  if (s < 90) return `~${Math.max(1, Math.round(s))} seconds`;
  return `~${Math.round(s / 60)} min`;
}

export function ThorSwap() {
  const { root, unlocked, activeProfileId } = useWallet();
  const qc = useQueryClient();
  const fetchRoutes = useServerFn(getThorCatalogRoutes);
  const fetchQuote = useServerFn(getThorCatalogQuote);

  const fingerprint = root ? rootFingerprintHex(root) : null;
  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);

  const routes = useQuery({ queryKey: ["thor-catalog-routes"], queryFn: () => fetchRoutes(), staleTime: 5 * 60_000 });
  const available = routes.data ?? [];

  const [from, setFrom] = useState<ThorAssetId>("usdc-eth");
  const [to, setTo] = useState<ThorAssetId>("btc");
  const [amount, setAmount] = useState("");
  const [debounced, setDebounced] = useState("");
  const [destOverride, setDestOverride] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ txid: string; quote: ThorCatalogQuote } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount), 500);
    return () => clearTimeout(t);
  }, [amount]);

  const fromMeta = THOR_CATALOG[from];
  const toMeta = THOR_CATALOG[to];

  // Source account: UTXO chains scan their account; EVM chains read balances.
  const utxoSource = fromMeta.kind === "utxo" ? (fromMeta.chain as ThorUtxoCoin) : null;
  const sourceAccount = useQuery({
    queryKey: ["thor-src-account", utxoSource, fingerprint],
    enabled: !!root && !!utxoSource,
    queryFn: () => UTXO_SCANS[utxoSource!](root as never),
    staleTime: 30_000,
  });
  const sourceFees = useQuery({
    queryKey: ["thor-src-fees", utxoSource],
    enabled: !!utxoSource,
    queryFn: () => THOR_UTXO_COINS[utxoSource!].getFeeEstimates(),
    staleTime: 60_000,
  });
  const evmSourceBalance = useQuery({
    queryKey: ["thor-src-evm", from, evmAddress],
    enabled: !!evmAddress && fromMeta.kind !== "utxo",
    queryFn: async () => {
      const pub = evmClient(fromMeta.chain as EvmChainId);
      const native = await pub.getBalance({ address: evmAddress! });
      if (fromMeta.kind === "evm-native") return { raw: native, native };
      const { erc20Abi } = await import("viem");
      const token = (await pub.readContract({
        address: fromMeta.contract!, abi: erc20Abi, functionName: "balanceOf", args: [evmAddress!],
      })) as bigint;
      return { raw: token, native };
    },
    staleTime: 20_000,
  });

  // Destination address: auto-fill from this wallet, editable override.
  const utxoDest = toMeta.kind === "utxo" ? (toMeta.chain as ThorUtxoCoin) : null;
  const destScan = useQuery({
    queryKey: ["thor-dest-addr", utxoDest, fingerprint],
    enabled: !!root && !!utxoDest,
    queryFn: () => UTXO_SCANS[utxoDest!](root as never),
    staleTime: 60_000,
  });
  const autoDestination = toMeta.kind === "utxo" ? destScan.data?.nextReceiveAddress ?? null : evmAddress;
  const destination = destOverride ?? autoDestination ?? "";

  const rawIn = useMemo(() => {
    try {
      return debounced ? parseAssetAmount(debounced, fromMeta.decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [debounced, fromMeta]);

  const destinationValid = useMemo(() => {
    try {
      validateThorDestination(toMeta, destination);
      return true;
    } catch {
      return false;
    }
  }, [toMeta, destination]);

  const quote = useQuery({
    queryKey: ["thor-catalog-quote", from, to, debounced, destination],
    enabled: available.includes(from) && available.includes(to) && rawIn > 0n && destinationValid,
    queryFn: () => fetchQuote({ data: { from, to, amount: debounced, destination } }),
    staleTime: 30_000,
    retry: 0,
  });

  const feeRate = sourceFees.data?.halfHourFee ?? (utxoSource ? THOR_UTXO_COINS[utxoSource].fallbackFeeRate : 0);
  const utxoPlan = useMemo(() => {
    if (!utxoSource || !sourceAccount.data || rawIn <= 0n) return null;
    return planUtxoThorSwap(utxoSource, sourceAccount.data.utxos, Number(rawIn), feeRate);
  }, [utxoSource, sourceAccount.data, rawIn, feeRate]);

  const sufficient = useMemo(() => {
    if (rawIn <= 0n) return false;
    if (utxoSource) return utxoPlan != null;
    const bal = evmSourceBalance.data;
    if (!bal) return false;
    return bal.raw >= rawIn && bal.native > 0n;
  }, [rawIn, utxoSource, utxoPlan, evmSourceBalance.data]);

  function pickFrom(id: ThorAssetId) {
    setFrom(id);
    if (id === to) setTo(id === "btc" ? "usdc-eth" : "btc");
    setSent(null);
    setError(null);
  }
  function pickTo(id: ThorAssetId) {
    setTo(id);
    if (id === from) setFrom(id === "btc" ? "usdc-eth" : "btc");
    setDestOverride(null);
    setSent(null);
    setError(null);
  }

  async function send() {
    const q = quote.data;
    if (!q || !root || !unlocked || busy) return;
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      assertQuoteFresh(q);
      const ok = await confirmWithBiometric(`Confirm swapping ${fromMeta.symbol}`);
      if (!ok) throw new Error("Confirmation was cancelled. Nothing was sent.");
      let txid: string;
      if (utxoSource) {
        if (!sourceAccount.data) throw new Error("Source account is still loading.");
        const result = await executeUtxoThorSwap({
          coin: utxoSource, root, account: sourceAccount.data, quote: q, feeRate,
        });
        txid = result.txid;
      } else {
        const account = deriveEvmAccount(root);
        const chain = fromMeta.chain as EvmChainId;
        const walletClient = createWalletClient({
          account, chain: EVM_CHAINS[chain].viemChain, transport: http(`/api/evm/${chain}`),
        });
        const result = await executeEvmThorSwap({ quote: q, walletClient });
        txid = result.hash;
      }
      hapticSuccess();
      recordSwap({
        txid,
        coin: q.from,
        provider: "thorchain",
        orderId: null,
        token: null,
        amountSats: Number(q.amountIn),
        amountOut: thorUnitsToNumber(q.expectedOut),
        dest: { asset: toMeta.thorAsset, symbol: toMeta.symbol, chain: toMeta.chain, label: toMeta.label },
        destination: q.destination,
        profileId: activeProfileId,
      });
      void qc.invalidateQueries({ queryKey: ["thor-src-account"] });
      void qc.invalidateQueries({ queryKey: ["thor-src-evm"] });
      setSent({ txid, quote: q });
    } catch (err) {
      hapticError();
      setError(friendlyBroadcastError(err));
    } finally {
      setBusy(false);
    }
  }

  if (unlocked?.mode === "vault") {
    return (
      <div className="py-8">
        <h2 className="text-xl font-semibold">Cold Storage swaps are paused</h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          The Vault device's readable swap approval, transaction ordering and final safety checks need
          coordinated corrections before another swap can be signed. Switch to a hot wallet profile to swap.
        </p>
      </div>
    );
  }
  if (unlocked?.mode === "keyonly") {
    return (
      <div className="py-8">
        <p className="text-sm text-muted-foreground">Watch-only wallets can't swap — there's no key on this device to sign with.</p>
      </div>
    );
  }

  if (sent) {
    const explorer = sent.quote.from && THOR_CATALOG[sent.quote.from].kind === "utxo"
      ? THOR_UTXO_COINS[sent.quote.from as ThorUtxoCoin].explorerTxUrl(sent.txid)
      : EVM_CHAINS[THOR_CATALOG[sent.quote.from].chain as EvmChainId].explorerTx(sent.txid);
    return (
      <div className="py-8">
        <h2 className="text-xl font-semibold">Swap sent</h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          {fmtUnits(sent.quote.amountIn)} {THOR_CATALOG[sent.quote.from].symbol} is on its way to THORChain.
          Expected payout: about {fmtUnits(sent.quote.expectedOut)} {THOR_CATALOG[sent.quote.to].symbol} to{" "}
          <span className="font-mono text-xs">{sent.quote.destination}</span>, usually within{" "}
          {fmtSeconds(sent.quote.seconds)}. Progress is tracked below and in your swap history.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href={explorer} target="_blank" rel="noreferrer">
              View deposit transaction <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="ghost" onClick={() => { setSent(null); setAmount(""); }}>Start another swap</Button>
        </div>
        <RecentThorSwaps profileId={activeProfileId} destination={evmAddress} />
      </div>
    );
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="thor-from">Pay with</Label>
            <Select value={from} onValueChange={(v) => pickFrom(v as ThorAssetId)}>
              <SelectTrigger id="thor-from" aria-label="Pay with"><SelectValue /></SelectTrigger>
              <SelectContent>
                {available.map((id) => (
                  <SelectItem key={id} value={id}>{THOR_CATALOG[id].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="thor-to">Receive</Label>
            <Select value={to} onValueChange={(v) => pickTo(v as ThorAssetId)}>
              <SelectTrigger id="thor-to" aria-label="Receive"><SelectValue /></SelectTrigger>
              <SelectContent>
                {available.map((id) => (
                  <SelectItem key={id} value={id}>{THOR_CATALOG[id].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5">
          <Label htmlFor="thor-amount">Amount ({fromMeta.symbol})</Label>
          <Input
            id="thor-amount"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1.5 text-lg"
          />
          {utxoSource && sourceAccount.data && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Available: {thorUnitsToNumber(String(sourceAccount.data.utxos.reduce((s, u) => s + u.value, 0))).toLocaleString(undefined, { maximumFractionDigits: 8 })} {fromMeta.symbol}
            </p>
          )}
          {fromMeta.kind !== "utxo" && evmSourceBalance.data && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Available: {(Number(evmSourceBalance.data.raw) / 10 ** fromMeta.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} {fromMeta.symbol}
            </p>
          )}
        </div>

        <div className="mt-5">
          <Label htmlFor="thor-dest">Payout address ({toMeta.label})</Label>
          <Input
            id="thor-dest"
            value={destination}
            onChange={(e) => setDestOverride(e.target.value)}
            placeholder={toMeta.kind === "utxo" ? "Your address…" : "0x…"}
            className="mt-1.5 font-mono text-xs"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {destOverride == null
              ? "Auto-filled with this wallet's own receive address. Paste a different address to pay out elsewhere."
              : "Custom payout address — double-check it, swaps can't be undone."}
            {utxoDest && destScan.isLoading && " Loading your address…"}
          </p>
          {destination && !destinationValid && (
            <p className="mt-1.5 text-xs text-destructive">That doesn't look like a valid {toMeta.label} address.</p>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <Button
            size="lg"
            disabled={!quote.data || busy || !sufficient || quote.isFetching || amount !== debounced}
            onClick={() => setConfirmOpen(true)}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Review swap
          </Button>
          {quote.isFetching && <span className="text-xs text-muted-foreground">Getting quote…</span>}
          {rawIn > 0n && !sufficient && !quote.isFetching && (
            <span className="text-xs text-destructive">Not enough {fromMeta.symbol} for this swap plus fees.</span>
          )}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm THORChain swap</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  {quote.data && (
                    <>
                      <p>You send <strong>{debounced} {fromMeta.symbol}</strong> ({fromMeta.label}).</p>
                      <p>You receive at least <strong>{fmtUnits(quote.data.minimumOut)} {toMeta.symbol}</strong> (expected {fmtUnits(quote.data.expectedOut)} {toMeta.symbol}) to:</p>
                      <p className="break-all font-mono text-xs">{quote.data.destination}</p>
                      <p>Network and swap fees: about {fmtUnits(quote.data.feeOut)} {toMeta.symbol}. Estimated time: {fmtSeconds(quote.data.seconds)}.</p>
                      <p className="text-xs">The signed transaction is bound to this exact quote — destination, minimum payout and deposit address cannot change. If anything differs, signing refuses.</p>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); void send(); }}>Confirm and send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <aside className="min-w-0 border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
        <h3 className="text-sm font-medium">Quote</h3>
        {quote.isError && <p className="mt-3 text-sm text-destructive">{quote.error instanceof Error ? quote.error.message : "Quote unavailable."}</p>}
        {!quote.data && !quote.isError && (
          <p className="mt-3 text-sm text-muted-foreground">
            {routes.isLoading ? "Loading available routes…" : "Enter an amount to see a live THORChain quote."}
          </p>
        )}
        {quote.data && (
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">You receive</dt><dd className="font-medium">{fmtUnits(quote.data.expectedOut)} {toMeta.symbol}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Minimum received</dt><dd>{fmtUnits(quote.data.minimumOut)} {toMeta.symbol}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Fees</dt><dd>{fmtUnits(quote.data.feeOut)} {toMeta.symbol}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estimated time</dt><dd>{fmtSeconds(quote.data.seconds)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Price protection</dt><dd>{quote.data.toleranceBps / 100}% after fees</dd></div>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Native THORChain swaps — no wrapping, no custodian, no wallet fee. Quotes refresh as you edit and expire quickly.
        </p>
        <RecentThorSwaps profileId={activeProfileId} destination={evmAddress} />
      </aside>
    </div>
  );
}

/** Recent THORChain swaps with live status polling. */
function RecentThorSwaps({ profileId, destination }: { profileId: string; destination: string | null }) {
  const swaps = useSwapHistory(profileId, destination).filter((s) => s.provider === "thorchain" && s.txid);
  if (!swaps.length) return null;
  return (
    <div className="mt-8">
      <h3 className="text-sm font-medium">Recent swaps</h3>
      <ul className="mt-3 space-y-2">
        {swaps.slice(0, 5).map((s) => (
          <ThorSwapRow key={s.txid} swap={s} />
        ))}
      </ul>
    </div>
  );
}

function ThorSwapRow({ swap }: { swap: ReturnType<typeof useSwapHistory>[number] }) {
  const fetchStatus = useServerFn(getThorTxStatus);
  const status = useQuery({
    queryKey: ["thor-swap-status", swap.txid],
    enabled: canTrackSwap(swap) && !swap.done && !swap.failed,
    queryFn: () => fetchStatus({ data: { txid: swap.txid } }),
    refetchInterval: 60_000,
    retry: 1,
  });
  useEffect(() => {
    const st = status.data;
    if (!st) return;
    if (st.outboundSent && st.outboundTxid && !swap.done) {
      updateSwap(swap.txid, { done: true, outboundTxid: st.outboundTxid, checkedAt: Date.now() });
    }
  }, [status.data, swap]);
  const label = swap.done
    ? "Paid out"
    : status.data?.observed
      ? "Swapping…"
      : "Waiting for deposit…";
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <span className="min-w-0 truncate">
        {thorUnitsToNumber(swap.amountSats).toLocaleString(undefined, { maximumFractionDigits: 8 })} {swap.coin.toUpperCase()} → {swap.dest.symbol}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
    </li>
  );
}
