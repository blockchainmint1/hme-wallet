import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { loadPairing } from "@/lib/vault-link/pairing";
import { scanVaultChainAll } from "@/lib/vault-link/snapshot";
import { vaultThorAddress, vaultThorAvailable, prepareVaultThorSwap, verifyVaultThorResult, type VaultThorPrepared } from "@/lib/vault-link/thor-swap";
import { THOR_CATALOG, parseAssetAmount, thorUnitsToNumber, validateThorDestination, type ThorAssetId, type ThorUtxoCoin } from "@/lib/thorchain/catalog";
import { getThorCatalogQuote, getThorCatalogRoutes } from "@/lib/thorchain/catalog.functions";
import { THOR_UTXO_COINS } from "@/lib/thorchain/execute";
import { getActiveProfileId } from "@/lib/txc/storage";
import { formatUnits } from "viem";

/** Trim trailing zeros from a raw-unit balance for display. */
function formatAvailable(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
import { loadSession } from "@/lib/txc/session-cache";

/** Auditable preparation only: no broadcast dependency or execution switch. */
export function VaultThorSwap({ profileId }: { profileId: string }) {
  const [pairing, setPairing] = useState<ReturnType<typeof loadPairing>>(null);
  useEffect(() => setPairing(loadPairing(profileId)), [profileId]);
  const fetchRoutes = useServerFn(getThorCatalogRoutes), fetchQuote = useServerFn(getThorCatalogQuote);
  const routes = useQuery({ queryKey: ["thor-catalog-routes"], queryFn: () => fetchRoutes(), staleTime: 300_000 });
  const [from, setFrom] = useState<ThorAssetId>("usdc-eth"), [to, setTo] = useState<ThorAssetId>("btc");
  const [amount, setAmount] = useState(""), [debounced, setDebounced] = useState("");
  const [override, setOverride] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<VaultThorPrepared | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [progress, setProgress] = useState<{ have: number; total: number; received: number[] } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => setDebounced(amount), 500); return () => clearTimeout(timer); }, [amount]);
  const destination = override ?? (pairing ? vaultThorAddress(pairing, to) : null) ?? "";
  let valid = false;
  try { validateThorDestination(THOR_CATALOG[to], destination); valid = from !== to && parseAssetAmount(debounced, THOR_CATALOG[from].decimals) > 0n; } catch { /* input not ready */ }
  const quote = useQuery({
    queryKey: ["vault-thor-review-quote", profileId, from, to, debounced, destination],
    enabled: !!pairing && valid && (routes.data ?? []).includes(from) && (routes.data ?? []).includes(to),
    queryFn: () => fetchQuote({ data: { from, to, amount: debounced, destination } }), staleTime: 30_000, retry: 0,
  });
  async function assertSession(identity: string) {
    const session = await loadSession();
    if (!session || session.mode !== "vault" || getActiveProfileId() !== profileId || JSON.stringify(loadPairing(profileId)) !== identity) throw new Error("Wallet locked or pairing changed. Reopen the swap from the intended Cold Storage wallet.");
  }
  async function prepare() {
    if (!pairing || !quote.data || busy) return;
    setBusy(true); setError(null);
    try {
      const identity = JSON.stringify(pairing);
      await assertSession(identity);
      const q = { ...quote.data }, meta = THOR_CATALOG[q.from];
      let coins: Parameters<typeof prepareVaultThorSwap>[2] = [], rate = 0;
      if (meta.kind === "utxo") {
        const coin = meta.chain as ThorUtxoCoin;
        if (!pairing.chains[coin]) throw new Error("Pair this source coin with your Vault first.");
        const scans = await scanVaultChainAll(pairing, coin);
        if (!scans.length || scans.some(scan => scan.scanned < 40)) throw new Error("Paired coin scan was incomplete. Try again.");
        coins = [...new Map(scans.flatMap(s => s.utxos).map(u => [`${u.txid}:${u.vout}`, u])).values()];
        const fees = await THOR_UTXO_COINS[coin].getFeeEstimates();
        rate = Math.ceil(fees.halfHourFee);
      }
      const result = await prepareVaultThorSwap(pairing, q, coins, rate);
      await assertSession(identity);
      setPrepared(result); setVerified(false); resetScan();
    } catch (e) { setError(e instanceof Error ? e.message : "Cannot prepare this swap."); }
    finally { setBusy(false); }
  }
  function resetScan() { collector.current = new PartCollector(); setProgress(null); setScanError(null); processing.current = false; }
  async function scanned(text: string) {
    if (!prepared || processing.current || verified) return;
    let signed: string | null;
    try {
      signed = collector.current.add(text);
      setProgress({ ...collector.current.progress, received: collector.current.receivedParts });
    } catch (e) { resetScan(); setScanError(e instanceof Error ? e.message : "Damaged QR transfer. Start again."); return; }
    if (!signed) return;
    processing.current = true; setBusy(true);
    try {
      await assertSession(prepared.pairingIdentity);
      await verifyVaultThorResult(signed, prepared);
      await assertSession(prepared.pairingIdentity);
      setVerified(true);
    } catch (e) { resetScan(); setError(e instanceof Error ? e.message : "Signature refused."); }
    finally { setBusy(false); }
  }
  const available = (routes.data ?? []).filter(id => pairing && vaultThorAddress(pairing, id));
  const balance = useQuery({
    queryKey: ["vault-thor-available", profileId, from],
    enabled: !!pairing && !!vaultThorAddress(pairing, from),
    queryFn: () => vaultThorAvailable(pairing!, from),
    staleTime: 30_000, retry: 0,
  });
  if (!pairing) return <p className="py-8 text-muted-foreground">Pair a Cold Storage wallet to preview THORChain swaps.</p>;
  return <section className="min-w-0 space-y-6">
    <div className="border-b border-border pb-4">
      <h2 className="text-xl font-semibold">Cold Storage · THORChain</h2>
      <p className="mt-2 text-sm text-muted-foreground">Review pending · Nothing can be broadcast. The current HME Vault release does not sign THORChain swaps.</p>
    </div>
    {prepared ? <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Pay with</dt><dd>{thorUnitsToNumber(prepared.quote.amountIn)} {THOR_CATALOG[prepared.quote.from].label}</dd></div>
        <div><dt className="text-muted-foreground">Minimum payout</dt><dd>{thorUnitsToNumber(prepared.quote.minimumOut)} {THOR_CATALOG[prepared.quote.to].label}</dd></div>
        <div><dt className="text-muted-foreground">Payout address</dt><dd className="break-all font-mono text-xs">{prepared.quote.destination}</dd></div>
        <div><dt className="text-muted-foreground">Refund address</dt><dd className="break-all font-mono text-xs">{prepared.refundAddress}</dd></div>
        <div><dt className="text-muted-foreground">Transaction</dt><dd>{prepared.action}</dd></div>
        <div><dt className="text-muted-foreground">Maximum network fee · raw units</dt><dd>{prepared.feeRaw}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">Unsigned review request · Awaiting coordinated HME Vault support.</p>
      <VaultAnimatedQr text={prepared.payload} />
      <div className="flex items-center gap-3">
        {!verified && !busy && <QrScanButton continuous onScan={text => void scanned(text)} progress={progress} complete={verified} scanError={scanError} onScanStart={resetScan} />}
        <span className="text-sm text-muted-foreground">{verified ? "Signature verified · Not sent. Release approval required." : "Check a signed transaction · No broadcast"}</span>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      <Button variant="outline" disabled={busy} onClick={() => { setPrepared(null); resetScan(); setError(null); }}>Back to quote</Button>
    </> : <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><Label htmlFor="vault-thor-from">Pay with</Label><Select value={from} onValueChange={v => setFrom(v as ThorAssetId)}><SelectTrigger id="vault-thor-from"><SelectValue /></SelectTrigger><SelectContent>{available.filter(id => id !== to).map(id => <SelectItem key={id} value={id}>{THOR_CATALOG[id].label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="vault-thor-to">Receive</Label><Select value={to} onValueChange={v => { setTo(v as ThorAssetId); setOverride(null); }}><SelectTrigger id="vault-thor-to"><SelectValue /></SelectTrigger><SelectContent>{available.filter(id => id !== from).map(id => <SelectItem key={id} value={id}>{THOR_CATALOG[id].label}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="vault-thor-amount">Amount ({THOR_CATALOG[from].symbol})</Label>
          <span className="text-xs text-muted-foreground">
            {balance.isFetching ? "Checking balance…"
              : balance.data != null ? `Available: ${formatAvailable(balance.data, THOR_CATALOG[from].decimals)} ${THOR_CATALOG[from].symbol}`
              : balance.isError ? "Couldn't check the balance"
              : null}
          </span>
        </div>
        <Input id="vault-thor-amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
      </div>
      <div><Label htmlFor="vault-thor-payout">Payout address ({THOR_CATALOG[to].label})</Label><Input id="vault-thor-payout" value={destination} onChange={e => setOverride(e.target.value)} className="font-mono text-xs" /></div>
      {quote.data && <dl className="space-y-2 text-sm"><div>Expected payout: {thorUnitsToNumber(quote.data.expectedOut)} {THOR_CATALOG[to].symbol}</div><div>Minimum payout: {thorUnitsToNumber(quote.data.minimumOut)} {THOR_CATALOG[to].symbol}</div></dl>}
      {quote.error && <p className="text-sm text-destructive">{quote.error instanceof Error ? quote.error.message : "Quote unavailable."}</p>}
      <Button disabled={busy || !quote.data || !valid || quote.isFetching || amount !== debounced} onClick={() => void prepare()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Prepare unsigned review</Button>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}