/**
 * Desktop Cold Storage: move TSD from Vault TXC receive addresses #1+ to #0.
 * One Vault signature per address: holder coin first, #0 pays the fee.
 * Prepares unsigned requests only; HME Vault signs by QR.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Loader2, RefreshCw, Square } from "lucide-react";
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
import {
  explorerTxUrl,
  getAddressStats,
  getAddressUtxos,
  getFeeEstimates,
  getOutspend,
} from "@/lib/txc/mempool";
import { getTxcTokenBalance, getTxcTokenProperties } from "@/lib/txc/tokens.functions";
import { tsdBalanceUnits, vaultTsdHolder } from "@/lib/vault-link/tsd-send";
import {
  buildTsdGatherPsbt,
  selectTsdGatherFeeInputs,
  verifyTsdGatherSigned,
  vaultTsdReceiveHolder,
  TSD_GATHER_GAP,
  TSD_GATHER_MAX_INDEX,
  type TsdGatherIntent,
} from "@/lib/vault-link/tsd-gather";
import {
  advanceGatherQueue,
  createGatherQueue,
  partitionGatherHolders,
  stopGatherQueue,
  unspentGatherInputs,
  type GatherQueue,
} from "@/lib/vault-link/tsd-gather-queue";
import { txcFeeRate } from "@/lib/txc/fees";

const SATS = 100_000_000;
const fmt = (sats: number) => (sats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 });
interface Row {
  index: number;
  address: string;
  tsd: string;
  confirmedSats: number;
  pendingSats: number;
}
type Signing =
  | { payload: string; intent: TsdGatherIntent }
  | { txid: string; intent: TsdGatherIntent };

export function VaultTsdGather({
  pairing,
  onBusyChange,
  onBroadcast,
}: {
  pairing: VaultPairing;
  onBusyChange?: (busy: boolean) => void;
  onBroadcast?: () => void;
}) {
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
  const [scanProgress, setScanProgress] = useState<{
    have: number;
    total: number;
    received?: number[];
  } | null>(null);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [queue, setQueue] = useState<GatherQueue | null>(null);
  const queueRef = useRef<GatherQueue | null>(null);
  const spentInputs = useRef(new Set<string>());
  const sentIndexes = useRef(new Set<number>());
  const [uncertainTxid, setUncertainTxid] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<{ index: number; txid: string }[]>([]);

  useEffect(() => {
    onBusyChange?.(busy || !!queue?.active || !!uncertainTxid);
  }, [busy, queue?.active, uncertainTxid, onBusyChange]);

  function updateQueue(next: GatherQueue) {
    queueRef.current = next;
    setQueue(next);
  }
  function stopAll(message: string) {
    const current = queueRef.current;
    if (current?.active) updateQueue(stopGatherQueue(current));
    setSigning(null);
    setError(message);
  }

  async function assertSession() {
    const s = await loadSession();
    if (
      !s ||
      s.mode !== "vault" ||
      getActiveProfileId() !== profileId ||
      JSON.stringify(loadPairing(profileId)) !== identity
    )
      throw new Error("Wallet locked or changed. Reopen this page from the intended Vault.");
  }
  async function liveFeeRate() {
    const r = txcFeeRate(await getFeeEstimates().catch(() => null));
    setFeeRate(r);
    return r;
  }

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await liveFeeRate();
      const out: Row[] = [];
      // Walk receive addresses until TSD_GATHER_GAP never-used ones in a row (store sale addresses can run far past #30).
      let empty = 0;
      let last = 0;
      for (let start = 1; start <= TSD_GATHER_MAX_INDEX && empty < TSD_GATHER_GAP; start += 10) {
        const batch = Array.from(
          { length: Math.min(10, TSD_GATHER_MAX_INDEX - start + 1) },
          (_, i) => vaultTsdReceiveHolder(pairing, start + i),
        );
        const res = await Promise.all(
          batch.map(async (a) => {
            const [bal, stats] = await Promise.all([
              fetchBalance({ data: { address: a.address, propertyId: 39 } }),
              getAddressStats(a.address),
            ]);
            const used = stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0;
            if (tsdBalanceUnits(bal.balance) === 0n || sentIndexes.current.has(a.index))
              return { used, row: null };
            const coins = await getAddressUtxos(a.address);
            return {
              used: true,
              row: {
                index: a.index,
                address: a.address,
                tsd: bal.balance,
                confirmedSats: coins
                  .filter((c) => c.status.confirmed)
                  .reduce((s, c) => s + c.value, 0),
                pendingSats: coins
                  .filter((c) => !c.status.confirmed)
                  .reduce((s, c) => s + c.value, 0),
              },
            };
          }),
        );
        for (const r of res) {
          empty = r.used ? 0 : empty + 1;
          if (r.row) out.push(r.row);
        }
        last = start + batch.length - 1;
      }
      setChecked(last);
      setRows(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pairing, fetchBalance]);
  useEffect(() => {
    void scan();
  }, [scan]);

  async function confirmedInputs(index: number) {
    const a = index === 0 ? vaultTsdHolder(pairing) : vaultTsdReceiveHolder(pairing, index);
    const coins = (await getAddressUtxos(a.address)).filter((c) => c.status.confirmed);
    return unspentGatherInputs(
      coins.map((c) => ({ ...a, txid: c.txid, vout: c.vout, value: c.value })),
      spentInputs.current,
    );
  }
  async function prevHex(inputs: { txid: string; vout: number }[]) {
    const out: Record<string, string> = {};
    for (const u of inputs) out[`${u.txid}:${u.vout}`] = await chainIo("txc").txHex(u.txid);
    return out;
  }
  function start(payload: string, intent: TsdGatherIntent) {
    collector.current = new PartCollector();
    processing.current = false;
    setScanProgress(null);
    setScanComplete(false);
    setScanError(null);
    setSigning({ payload, intent });
  }

  async function prepareGather(row: Row) {
    if (uncertainTxid) return;
    setBusy(true);
    setError(null);
    try {
      await assertSession();
      const props = await fetchProperties({ data: { propertyIds: [39] } });
      if (props[39]?.divisible !== true)
        throw new Error("Could not verify TSD property #39. Try again when TXC is available.");
      const rate = await liveFeeRate();
      const a = vaultTsdReceiveHolder(pairing, row.index);
      const bal = await fetchBalance({ data: { address: a.address, propertyId: 39 } });
      const holderInputs = await confirmedInputs(row.index);
      if (!holderInputs.length)
        throw new Error(
          `Address #${row.index} has no confirmed TXC coin yet. Wait for a confirmation.`,
        );
      const feeInputs = selectTsdGatherFeeInputs(
        pairing,
        holderInputs,
        await confirmedInputs(0),
        rate,
      );
      const built = buildTsdGatherPsbt({
        pairing,
        index: row.index,
        balance: bal.balance,
        feeRate: rate,
        holderInputs,
        feeInputs,
        prevTxHex: await prevHex([...holderInputs, ...feeInputs]),
      });
      await assertSession();
      start(built.psbtBase64, built.intent);
    } catch (e) {
      const message = (e as Error).message;
      if (queueRef.current?.active) stopAll(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function consolidateAll() {
    if (!rows?.length || loading || busy || queueRef.current?.active || uncertainTxid) return;
    const { ready } = partitionGatherHolders(rows);
    if (!ready.length) return;
    const next = createGatherQueue(ready.map((r) => r.index));
    updateQueue(next);
    const first = ready[0];
    if (first) await prepareGather(first);
  }

  async function onScanned(code: string) {
    if (processing.current || !signing || !("payload" in signing)) return;
    try {
      const full = collector.current.add(code);
      setScanError(null);
      setScanProgress({ ...collector.current.progress, received: collector.current.receivedParts });
      if (!full) return;
      collector.current = new PartCollector();
      processing.current = true;
      setScanComplete(true);
      setBusy(true);
      setError(null);
      try {
        const txid = verifyTsdGatherSigned(full, signing.payload);
        await assertSession();
        const psbt = Psbt.fromBase64(signing.payload);
        const spent = await Promise.all(
          psbt.txInputs.map((i) =>
            getOutspend(
              Array.from(i.hash)
                .reverse()
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(""),
              i.index,
            ),
          ),
        );
        if (spent.some((s) => s.spent))
          throw new Error("Those TXC coins were already spent. Prepare this step again.");
        {
          const bal = await fetchBalance({
            data: { address: signing.intent.from, propertyId: 39 },
          });
          if (tsdBalanceUnits(bal.balance) !== tsdBalanceUnits(signing.intent.amount))
            throw new Error("The TSD balance on that address changed. Prepare this step again.");
        }
        await assertSession();
        // Reserve locally before sending: an uncertain response must not allow reuse.
        for (const i of psbt.txInputs)
          spentInputs.current.add(
            `${Array.from(i.hash)
              .reverse()
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")}:${i.index}`,
          );
        setUncertainTxid(txid);
        const real = await chainIo("txc").broadcast(full.trim());
        if (real !== txid) throw new Error("The sending reply did not match this payment.");
        setUncertainTxid(null);
        sentIndexes.current.add(signing.intent.fromIndex);
        setReceipts((prev) => [...prev, { index: signing.intent.fromIndex, txid: real || txid }]);
        setRows((prev) => prev?.filter((r) => r.index !== signing.intent.fromIndex) ?? null);
        setSigning({ txid: real || txid, intent: signing.intent });
        onBroadcast?.();
        const current = queueRef.current;
        if (current?.active) {
          const next = advanceGatherQueue(current, signing.intent.fromIndex, real || txid);
          updateQueue(next);
          const index = next.indexes[next.cursor];
          const row = rows?.find((r) => r.index === index);
          if (next.active && row) {
            setSigning(null);
            await prepareGather(row);
          } else if (next.active)
            stopAll("The next address could not be found. Earlier payments were already sent.");
        }
      } catch (e) {
        processing.current = false;
        if (queueRef.current?.active) stopAll((e as Error).message);
        else setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    } catch (e) {
      collector.current = new PartCollector();
      setScanProgress(null);
      setScanComplete(false);
      setScanError(e instanceof Error ? e.message : "Could not read that QR frame.");
    }
  }

  const holders = partitionGatherHolders(rows ?? []);
  const skipped = holders.skipped.length > 0 && (
    <p className="mt-3 text-sm text-muted-foreground" role="status">
      Skipped: {holders.skipped.map((r) => `#${r.index}`).join(", ")} — no confirmed TXC coin on
      these addresses. Their TSD has not moved.
    </p>
  );
  const progress = queue && (
    <div className="mt-4 space-y-2 text-sm" aria-live="polite">
      <p className="font-medium">
        {queue.active
          ? `Address ${queue.cursor + 1} of ${queue.indexes.length}`
          : queue.cursor === queue.indexes.length
            ? "All payments sent · awaiting confirmation"
            : "Consolidation stopped"}{" "}
        · {queue.sent.length} of {queue.indexes.length} sent
      </p>
      {receipts.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {receipts.map((s) => (
            <li key={s.txid}>
              Address #{s.index} · sent{" "}
              <a
                className="underline"
                href={explorerTxUrl(s.txid)}
                target="_blank"
                rel="noreferrer"
              >
                {s.txid.slice(0, 12)}…
              </a>
            </li>
          ))}
        </ul>
      )}
      {!queue.active && queue.cursor < queue.indexes.length && (
        <p className="text-xs text-muted-foreground">
          Earlier payments cannot be undone. {queue.indexes.length - queue.cursor} address
          {queue.indexes.length - queue.cursor === 1 ? " remains" : "es remain"} unfinished; if the
          last attempt had a sending error, check it on the explorer before trying again.
        </p>
      )}
    </div>
  );

  if (signing) {
    const i = signing.intent;
    return (
      <section className="mt-10 rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold">{`Gather TSD from address #${i.fromIndex}`}</h3>
        {progress}
        {skipped}
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">TSD · TXC Omni #39</dt>
            <dd className="font-semibold">{i.amount} TSD (whole balance)</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">From · address #{i.fromIndex}</dt>
            <dd className="break-all font-mono text-xs">{i.from}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">To · your TXC address #0</dt>
            <dd className="break-all font-mono text-xs">{i.to}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">TXC moved to #0 with it</dt>
            <dd>{fmt(i.txcSats)} TXC</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Network fee</dt>
            <dd>
              {fmt(i.feeSats)} TXC
              {i.feeInputs > 0 &&
                ` · paid with ${fmt(i.feeInputSats)} TXC from address #0 (rest returns to #0)`}
            </dd>
          </div>
          <p className="text-xs text-muted-foreground">
            On the Vault, the TSD sender must be address #{i.fromIndex} (first input).
          </p>
        </dl>
        {"payload" in signing ? (
          <div className="mt-5 space-y-3">
            <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
              <li>
                On your Vault, choose <span className="font-medium text-foreground">TXC</span> and
                tap Scan.
              </li>
              <li>Check the addresses and amounts on the Vault screen match the ones above.</li>
              <li>After signing, scan the Vault's signed QR below.</li>
            </ol>
            <VaultAnimatedQr text={signing.payload} />
            <div className="flex items-center gap-2">
              {!busy && !uncertainTxid && (
                <QrScanButton
                  continuous
                  onScan={(t) => void onScanned(t)}
                  progress={scanProgress}
                  complete={scanComplete}
                  scanError={scanError}
                  onScanStart={() => {
                    collector.current = new PartCollector();
                    setScanProgress(null);
                    setScanComplete(false);
                    setScanError(null);
                    setError(null);
                  }}
                />
              )}
              <span className="text-xs text-muted-foreground">
                {busy ? "Checking and broadcasting…" : "Scan the signed transaction from Vault"}
              </span>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (queueRef.current?.active)
                  stopAll("Stopped before signing this address. Earlier payments remain sent.");
                else {
                  setSigning(null);
                  setError(null);
                }
              }}
            >
              {queue?.active ? (
                <>
                  <Square className="h-4 w-4" />
                  Stop here
                </>
              ) : (
                "Back"
              )}
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm">Sent. The TSD will show on address #0 after it confirms.</p>
            <TxidCard txid={signing.txid} />
            <Button
              onClick={() => {
                setSigning(null);
                void scan();
              }}
            >
              Done
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="mt-10 rounded-lg border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Gather TSD to address #0</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            TSD can only be sent from your TXC address #0. This finds TSD on your other receive
            addresses (#1 onward, until {TSD_GATHER_GAP} unused in a row
            {checked ? `; checked up to #${checked}` : ""}) and moves it there with one Vault
            signature per address. Address #0 pays the fee.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void scan()} disabled={loading || busy}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>
      {progress}
      {skipped}
      {uncertainTxid && (
        <div className="mt-4 space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Sending was not confirmed. Check this transaction before trying again.
          </p>
          <TxidCard txid={uncertainTxid} />
        </div>
      )}
      {loading && !rows && (
        <p className="mt-4 text-sm text-muted-foreground">Checking addresses…</p>
      )}
      {rows && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {sentIndexes.current.size
            ? "No remaining addresses to consolidate. Sent TSD appears on #0 after confirmation."
            : "No TSD found on other addresses. Everything is already on #0."}
        </p>
      )}
      {rows && rows.length > 0 && (
        <>
          <Button
            type="button"
            className="mt-4"
            disabled={
              loading || busy || !!queue?.active || !!uncertainTxid || holders.ready.length === 0
            }
            onClick={() => void consolidateAll()}
          >
            <Layers className="h-4 w-4" />
            Consolidate all · {holders.ready.length} address{holders.ready.length === 1 ? "" : "es"}
          </Button>
          <div className="overflow-x-auto">
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2">Address</th>
                  <th>TSD</th>
                  <th>TXC on address</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ready = r.confirmedSats > 0;
                  return (
                    <tr key={r.index} className="border-t border-border">
                      <td className="py-2">
                        <span className="font-medium">#{r.index}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.address.slice(0, 8)}…{r.address.slice(-6)}
                        </span>
                      </td>
                      <td>{r.tsd}</td>
                      <td>
                        {fmt(r.confirmedSats)}
                        {r.pendingSats > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            (+{fmt(r.pendingSats)} confirming)
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        {ready ? (
                          <Button
                            size="sm"
                            disabled={busy || loading || !!queue?.active || !!uncertainTxid}
                            onClick={() => void prepareGather(r)}
                          >
                            Gather to #0
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Waiting for confirmation
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}
