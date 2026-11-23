/**
 * Desktop Cold Storage: move TSD from Vault TXC receive addresses #1+ to #0.
 * One Vault signature per address: holder coin first, #0 pays the fee.
 * Prepares unsigned requests only; HME Vault signs by QR.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Psbt } from "bitcoinjs-lib";
import { Button } from "@/components/ui/button";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { TxidCard } from "@/components/wallet/TxidCard";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { chainIo } from "@/lib/vault-link/scan";
import { loadPairing, type VaultPairing } from "@/lib/vault-link/pairing";
import { getActiveProfileId } from "@/lib/txc/storage";
import { loadSession } from "@/lib/txc/session-cache";
import { getAddressStats, getAddressUtxos, getFeeEstimates, getOutspend } from "@/lib/txc/mempool";
import { getTxcTokenBalance, getTxcTokenProperties } from "@/lib/txc/tokens.functions";
import { tsdBalanceUnits, vaultTsdHolder } from "@/lib/vault-link/tsd-send";
import {
  buildTsdGatherPsbt, selectTsdGatherFeeInputs, verifyTsdGatherSigned,
  vaultTsdReceiveHolder, TSD_GATHER_GAP, TSD_GATHER_MAX_INDEX, type TsdGatherIntent,
} from "@/lib/vault-link/tsd-gather";

const SATS = 100_000_000;
const fmt = (sats: number) => (sats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 });
interface Row { index: number; address: string; tsd: string; confirmedSats: number; pendingSats: number }
type Signing = { payload: string; intent: TsdGatherIntent } | { txid: string; intent: TsdGatherIntent };

export function VaultTsdGather({ pairing }: { pairing: VaultPairing }) {
  const fetchBalance = useServerFn(getTxcTokenBalance);
  const fetchProperties = useServerFn(getTxcTokenProperties);
  const [profileId] = useState(getActiveProfileId);
  const [identity] = useState(() => JSON.stringify(pairing));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checked, setChecked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<Signing | null>(null);
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [scanProgress, setScanProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  async function assertSession() {
    const s = await loadSession();
    if (!s || s.mode !== "vault" || getActiveProfileId() !== profileId || JSON.stringify(loadPairing(profileId)) !== identity) throw new Error("Wallet locked or changed. Reopen this page from the intended Vault.");
  }
  async function liveFeeRate() {
    const r = Math.max(1, Math.ceil((await getFeeEstimates()).halfHourFee));
    setFeeRate(r); return r;
  }

  const scan = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      await liveFeeRate();
      const out: Row[] = [];
      // Walk receive addresses until TSD_GATHER_GAP never-used ones in a row (store sale addresses can run far past #30).
      let empty = 0;
      let last = 0;
      for (let start = 1; start <= TSD_GATHER_MAX_INDEX && empty < TSD_GATHER_GAP; start += 10) {
        const batch = Array.from({ length: Math.min(10, TSD_GATHER_MAX_INDEX - start + 1) }, (_, i) => vaultTsdReceiveHolder(pairing, start + i));
        const res = await Promise.all(batch.map(async a => {
          const [bal, stats] = await Promise.all([fetchBalance({ data: { address: a.address, propertyId: 39 } }), getAddressStats(a.address)]);
          const used = stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0;
          if (tsdBalanceUnits(bal.balance) === 0n) return { used, row: null };
          const coins = await getAddressUtxos(a.address);
          return { used: true, row: { index: a.index, address: a.address, tsd: bal.balance,
            confirmedSats: coins.filter(c => c.status.confirmed).reduce((s, c) => s + c.value, 0),
            pendingSats: coins.filter(c => !c.status.confirmed).reduce((s, c) => s + c.value, 0) } };
        }));
        for (const r of res) { empty = r.used ? 0 : empty + 1; if (r.row) out.push(r.row); }
        last = start + batch.length - 1;
      }
      setChecked(last);
      setRows(out);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [pairing, fetchBalance]);
  useEffect(() => { void scan(); }, [scan]);

  async function confirmedInputs(index: number) {
    const a = index === 0 ? vaultTsdHolder(pairing) : vaultTsdReceiveHolder(pairing, index);
    const coins = (await getAddressUtxos(a.address)).filter(c => c.status.confirmed);
    return coins.map(c => ({ ...a, txid: c.txid, vout: c.vout, value: c.value }));
  }
  async function prevHex(inputs: { txid: string; vout: number }[]) {
    const out: Record<string, string> = {};
    for (const u of inputs) out[`${u.txid}:${u.vout}`] = await chainIo("txc").txHex(u.txid);
    return out;
  }
  function start(payload: string, intent: TsdGatherIntent) {
    collector.current = new PartCollector(); processing.current = false;
    setScanProgress(null); setScanComplete(false); setScanError(null);
    setSigning({ payload, intent });
  }

  async function prepareGather(row: Row) {
    setBusy(true); setError(null);
    try {
      await assertSession();
      const props = await fetchProperties({ data: { propertyIds: [39] } });
      if (props[39]?.divisible !== true) throw new Error("Could not verify TSD property #39. Try again when TXC is available.");
      const rate = await liveFeeRate();
      const a = vaultTsdReceiveHolder(pairing, row.index);
      const bal = await fetchBalance({ data: { address: a.address, propertyId: 39 } });
      const holderInputs = await confirmedInputs(row.index);
      if (!holderInputs.length) throw new Error(`Address #${row.index} has no confirmed TXC coin yet. Wait for a confirmation.`);
      const feeInputs = selectTsdGatherFeeInputs(pairing, holderInputs, await confirmedInputs(0), rate);
      const built = buildTsdGatherPsbt({ pairing, index: row.index, balance: bal.balance, feeRate: rate, holderInputs, feeInputs, prevTxHex: await prevHex([...holderInputs, ...feeInputs]) });
      await assertSession();
      start(built.psbtBase64, built.intent);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function onScanned(code: string) {
    if (processing.current || !signing || !("payload" in signing)) return;
    try {
      const full = collector.current.add(code);
      setScanError(null);
      setScanProgress({ ...collector.current.progress, received: collector.current.receivedParts });
      if (!full) return;
      collector.current = new PartCollector();
      processing.current = true; setScanComplete(true); setBusy(true); setError(null);
      try {
        const txid = verifyTsdGatherSigned(full, signing.payload);
        await assertSession();
        const psbt = Psbt.fromBase64(signing.payload);
        const spent = await Promise.all(psbt.txInputs.map(i => getOutspend(Array.from(i.hash).reverse().map(b => b.toString(16).padStart(2, "0")).join(""), i.index)));
        if (spent.some(s => s.spent)) throw new Error("Those TXC coins were already spent. Prepare this step again.");
        {
          const bal = await fetchBalance({ data: { address: signing.intent.from, propertyId: 39 } });
          if (tsdBalanceUnits(bal.balance) !== tsdBalanceUnits(signing.intent.amount)) throw new Error("The TSD balance on that address changed. Prepare this step again.");
        }
        await assertSession();
        const real = await chainIo("txc").broadcast(full.trim());
        setSigning({ txid: real || txid, intent: signing.intent });
      } catch (e) { processing.current = false; setError((e as Error).message); } finally { setBusy(false); }
    } catch (e) {
      collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false);
      setScanError(e instanceof Error ? e.message : "Could not read that QR frame.");
    }
  }


  if (signing) {
    const i = signing.intent;
    return (
      <section className="mt-10 rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold">{`Gather TSD from address #${i.fromIndex}`}</h3>
        <dl className="mt-4 space-y-2 text-sm">
            <div><dt className="text-muted-foreground">TSD · TXC Omni #39</dt><dd className="font-semibold">{i.amount} TSD (whole balance)</dd></div>
            <div><dt className="text-muted-foreground">From · address #{i.fromIndex}</dt><dd className="break-all font-mono text-xs">{i.from}</dd></div>
            <div><dt className="text-muted-foreground">To · your TXC address #0</dt><dd className="break-all font-mono text-xs">{i.to}</dd></div>
            <div><dt className="text-muted-foreground">TXC moved to #0 with it</dt><dd>{fmt(i.txcSats)} TXC</dd></div>
            <div><dt className="text-muted-foreground">Network fee</dt><dd>{fmt(i.feeSats)} TXC{i.feeInputs > 0 && ` · paid with ${fmt(i.feeInputSats)} TXC from address #0 (rest returns to #0)`}</dd></div>
            <p className="text-xs text-muted-foreground">On the Vault, the TSD sender must be address #{i.fromIndex} (first input).</p>
        </dl>
        {"payload" in signing ? <div className="mt-5 space-y-3">
          <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
            <li>On your Vault, choose <span className="font-medium text-foreground">TXC</span> and tap Scan.</li>
            <li>Check the addresses and amounts on the Vault screen match the ones above.</li>
            <li>After signing, scan the Vault's signed QR below.</li>
          </ol>
          <VaultAnimatedQr text={signing.payload} />
          <div className="flex items-center gap-2">
            {!busy && <QrScanButton continuous onScan={t => void onScanned(t)} progress={scanProgress} complete={scanComplete} scanError={scanError} onScanStart={() => { collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false); setScanError(null); setError(null); }} />}
            <span className="text-xs text-muted-foreground">{busy ? "Checking and broadcasting…" : "Scan the signed transaction from Vault"}</span>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setSigning(null); setError(null); }}>Back</Button>
        </div> : <div className="mt-5 space-y-3">
          <p className="text-sm">Sent. The TSD will show on address #0 after it confirms.</p>
          <TxidCard txid={signing.txid} />
          <Button onClick={() => { setSigning(null); void scan(); }}>Done</Button>
        </div>}
      </section>
    );
  }

  return (
    <section className="mt-10 rounded-lg border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Gather TSD to address #0</h3>
          <p className="mt-1 text-sm text-muted-foreground">TSD can only be sent from your TXC address #0. This finds TSD on your other receive addresses (#1 onward, until {TSD_GATHER_GAP} unused in a row{checked ? `; checked up to #${checked}` : ""}) and moves it there with one Vault signature per address. Address #0 pays the fee.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void scan()} disabled={loading || busy}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
      </div>
      {loading && !rows && <p className="mt-4 text-sm text-muted-foreground">Checking addresses…</p>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No TSD found on other addresses. Everything is already on #0.</p>}
      {rows && rows.length > 0 && <>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Address</th><th>TSD</th><th>TXC on address</th><th /></tr></thead>
          <tbody>{rows.map(r => {
            const ready = r.confirmedSats > 0;
            return <tr key={r.index} className="border-t border-border">
              <td className="py-2"><span className="font-medium">#{r.index}</span> <span className="font-mono text-xs text-muted-foreground">{r.address.slice(0, 8)}…{r.address.slice(-6)}</span></td>
              <td>{r.tsd}</td>
              <td>{fmt(r.confirmedSats)}{r.pendingSats > 0 && <span className="text-xs text-muted-foreground"> (+{fmt(r.pendingSats)} confirming)</span>}</td>
              <td className="text-right">{ready
                ? <Button size="sm" disabled={busy} onClick={() => void prepareGather(r)}>Gather to #0</Button>
                : <span className="text-xs text-muted-foreground">Waiting for confirmation</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </>}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}
