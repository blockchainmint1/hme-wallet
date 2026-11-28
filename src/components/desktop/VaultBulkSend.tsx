/**
 * Send to many for Cold Storage (HME Vault) wallets: TSD only. Each batch of up
 * to 7 recipients is one unsigned type-7 TSD payment shown as a QR; Vault signs
 * it, the signed QR is scanned back, checked byte-for-byte and broadcast, then
 * the next batch is prepared from the previous batch's change.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Transaction } from "bitcoinjs-lib";
import { Check, ExternalLink, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { RecipientListSafetyNotice, useRecipientListSafety } from "@/components/wallet/RecipientSafety";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { loadPairing } from "@/lib/vault-link/pairing";
import { chainIo } from "@/lib/vault-link/scan";
import { verifySignedTx } from "@/lib/vault-link/psbt-build";
import { tsdBalanceUnits, vaultTsdReceiveAddress, vaultTsdHolder, verifyVaultTsdSigned, TSD_REFERENCE_SATS } from "@/lib/vault-link/tsd-send";
import { buildVaultTsdManyPsbt, VAULT_FEE_CAP, type VaultTsdManyIntent } from "@/lib/vault-link/tsd-many";
import { STM_ACTIVATION_HEIGHT, STM_BATCH_SIZE, bulkProgressKey, bulkRunSettled, chunk, estimateVsize, parseBulkCsv, parseSavedRun, type BulkSavedStep } from "@/lib/txc/bulk-send";
import { MEMPOOL_API } from "@/lib/txc/network";
import { explorerTxUrl, getAddressUtxos, getFeeEstimates, getOutspend } from "@/lib/txc/mempool";
import { formatTokenAmount } from "@/lib/txc/tokens";
import { formatTxc } from "@/lib/txc/units";
import { getTxcTokenBalance, getOmniTxValidity } from "@/lib/txc/tokens.functions";
import { getActiveProfileId } from "@/lib/txc/storage";
import { loadSession } from "@/lib/txc/session-cache";
import { friendlyBroadcastError } from "@/lib/broadcast-error";

type Shown = { batch: number; payload: string; intent: VaultTsdManyIntent };
type Chained = { txid: string; vout: number; value: number; hex: string; spent: string[] };
const tsd = (u: bigint) => `${formatTokenAmount(u, true)} TSD`;
const hexId = (h: Uint8Array) => Array.from(h).reverse().map(b => b.toString(16).padStart(2, "0")).join("");

export function VaultBulkSend() {
  const qc = useQueryClient();
  const [profileId] = useState(getActiveProfileId);
  const pairing = useMemo(() => loadPairing(profileId), [profileId]);
  const [pairingIdentity] = useState(() => JSON.stringify(pairing));
  const holderAddr = vaultTsdReceiveAddress(pairing);
  const fetchBalance = useServerFn(getTxcTokenBalance);
  const fetchValidity = useServerFn(getOmniTxValidity);
  const [text, setText] = useState("");
  const [steps, setSteps] = useState<BulkSavedStep[]>([]);
  const [plan, setPlan] = useState<{ address: string; units: bigint }[][] | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startBalance = useRef(0n);
  const sent = useRef(0n);
  const chained = useRef<Chained | null>(null);
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [scanProgress, setScanProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const progressKey = bulkProgressKey(`vault.${profileId}`);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = parseSavedRun(window.localStorage.getItem(progressKey));
    if (saved?.steps.length) { setSteps(saved.steps); setError(saved.error ?? ""); }
    setRestored(true);
  }, [progressKey]);
  useEffect(() => {
    if (!restored) return;
    if (steps.length) window.localStorage.setItem(progressKey, JSON.stringify({ asset: "39", steps, error: error || undefined, savedAt: Date.now() }));
    else window.localStorage.removeItem(progressKey);
  }, [restored, steps, error, progressKey]);

  const checking = steps.filter(s => s.status === "ok" && s.delivery === "checking" && s.txid).map(s => s.txid!);
  const validity = useQuery({ queryKey: ["bulk-omni-validity", checking.join(",")], enabled: checking.length > 0, queryFn: () => fetchValidity({ data: { txids: checking } }), refetchInterval: 30_000 });
  useEffect(() => {
    const v = validity.data; if (!v) return;
    setSteps(prev => prev.map(s => { const r = s.txid && s.delivery === "checking" ? v[s.txid] : undefined; return r ? { ...s, delivery: r.valid ? "delivered" : "rejected", reason: r.reason } : s; }));
  }, [validity.data]);

  const balance = useQuery({ queryKey: ["vault-tsd-balance", holderAddr], enabled: !!holderAddr, queryFn: () => fetchBalance({ data: { address: holderAddr!, propertyId: 39 } }), staleTime: 30_000 });
  const fees = useQuery({ queryKey: ["fees"], queryFn: getFeeEstimates, staleTime: 60_000 });
  const feeRate = Math.ceil(fees.data?.halfHourFee ?? 0);
  const parsed = useMemo(() => parseBulkCsv(text, { type: "omni", divisible: true }), [text]);
  const batches = chunk(parsed.rows, STM_BATCH_SIZE);
  const estFee = batches.reduce((s, b) => s + estimateVsize(1, b.length + 1, 13 + 9 * b.length) * feeRate, 0);
  const listSafety = useRecipientListSafety({ family: "utxo", coin: "txc" }, parsed.rows.map(r => r.address));
  const units = balance.data ? tsdBalanceUnits(balance.data.balance) : null;

  const problems = [...parsed.errors];
  if (parsed.rows.some(r => r.address === holderAddr)) problems.push("The list includes this Vault's own TSD address.");
  if (units !== null && units < parsed.total) problems.push(`The Vault's TSD address holds ${tsd(units)}, less than the ${tsd(parsed.total)} total.`);
  if (balance.isError) problems.push("Couldn't check the Vault's TSD balance. Try again in a moment.");
  if (feeRate >= VAULT_FEE_CAP) problems.push("The TXC network fee is above Vault's safety limit right now. Try again later.");
  if (steps.length && !bulkRunSettled({ asset: "39", steps, savedAt: 0 })) problems.push("Wait until the previous run's transactions are confirmed.");
  const ready = !plan && !busy && parsed.rows.length > 0 && problems.length === 0 && !listSafety.blocked && units !== null && feeRate > 0;

  async function assertSession() {
    const s = await loadSession();
    if (!s || s.mode !== "vault" || getActiveProfileId() !== profileId || JSON.stringify(loadPairing(profileId)) !== pairingIdentity) throw new Error("Wallet locked or changed. Nothing more was prepared.");
  }

  async function prepare(batch: number, all: { address: string; units: bigint }[][]) {
    if (!pairing) return;
    setBusy(true); setError("");
    try {
      await assertSession();
      const holder = vaultTsdHolder(pairing);
      const [bal, fee, coins] = await Promise.all([fetchBalance({ data: { address: holder.address, propertyId: 39 } }), getFeeEstimates(), getAddressUtxos(holder.address)]);
      const rate = Math.ceil(fee.halfHourFee);
      const prev = chained.current;
      const pool = coins.filter(u => u.status.confirmed && !prev?.spent.includes(`${u.txid}:${u.vout}`)).map(u => ({ ...holder, txid: u.txid, vout: u.vout, value: u.value }));
      const prevTxHex: Record<string, string> = {};
      if (prev) { pool.unshift({ ...holder, txid: prev.txid, vout: prev.vout, value: prev.value }); prevTxHex[`${prev.txid}:${prev.vout}`] = prev.hex; }
      for (const u of pool) if (!prevTxHex[`${u.txid}:${u.vout}`]) prevTxHex[`${u.txid}:${u.vout}`] = await chainIo("txc").txHex(u.txid);
      const fetched = tsdBalanceUnits(bal.balance);
      const left = startBalance.current - sent.current;
      const built = buildVaultTsdManyPsbt({ pairing, recipients: all[batch], balanceUnits: fetched < left ? fetched : left, feeRate: rate, inputs: pool, prevTxHex });
      await assertSession();
      collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false); setScanError(null); processing.current = false;
      setShown({ batch, payload: built.psbtBase64, intent: built.intent });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function start() {
    if (!ready || units === null) return;
    setError("");
    try {
      const tip = Number(await (await fetch(`${MEMPOOL_API}/blocks/tip/height`)).text());
      if (!(tip >= STM_ACTIVATION_HEIGHT)) throw new Error("TEXITcoin's send-to-many feature isn't active yet.");
    } catch (e) { setError((e as Error).message); return; }
    const all = batches.map(b => b.map(r => ({ address: r.address, units: r.units })));
    startBalance.current = units; sent.current = 0n; chained.current = null;
    setPlan(all);
    setSteps(all.map((b, i) => ({ label: `Transaction ${i + 1} · ${b.length} recipient${b.length > 1 ? "s" : ""}`, status: "waiting" })));
    await prepare(0, all);
  }

  function stopRun(i: number, msg: string) {
    setSteps(prev => prev.map((s, j) => (j === i ? { ...s, status: "failed", error: msg } : s)));
    setError(i > 0 ? `Stopped at transaction ${i + 1}. The ${i} earlier transaction${i > 1 ? "s were" : " was"} already sent; the rest were not.` : msg);
    setPlan(null); setShown(null);
  }

  async function onScanned(code: string) {
    if (processing.current || !shown || !plan) return;
    let full: string | null;
    try {
      full = collector.current.add(code);
      setScanError(null); setScanProgress({ ...collector.current.progress, received: collector.current.receivedParts });
    } catch (e) {
      collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false);
      setScanError(e instanceof Error ? e.message : "Could not read that QR frame."); return;
    }
    if (!full) return;
    processing.current = true; setScanComplete(true); setBusy(true); setError("");
    const { batch, payload, intent } = shown;
    try {
      const txid = verifyVaultTsdSigned(full, payload);
      verifySignedTx(full, "txc", intent.recipients.map(r => ({ address: r.address, valueSats: TSD_REFERENCE_SATS })));
      await assertSession();
      const tx = Transaction.fromHex(full.trim());
      const spent = tx.ins.map(i => `${hexId(i.hash)}:${i.index}`);
      const outs = await Promise.all(tx.ins.filter(i => hexId(i.hash) !== chained.current?.txid).map(i => getOutspend(hexId(i.hash), i.index)));
      if (outs.some(o => o.spent)) throw new Error("TXC inputs were already spent. Nothing was broadcast.");
      setSteps(prev => prev.map((s, j) => (j === batch ? { ...s, status: "pending" } : s)));
      const real = await chainIo("txc").broadcast(full.trim());
      const id = real || txid;
      sent.current += intent.totalUnits;
      chained.current = intent.changeSats ? { txid: id, vout: intent.recipients.length + 1, value: intent.changeSats, hex: full.trim(), spent: [...(chained.current?.spent ?? []), ...spent] } : null;
      setSteps(prev => prev.map((s, j) => (j === batch ? { ...s, status: "ok", txid: id, delivery: "checking" } : s)));
      setBusy(false);
      if (batch + 1 < plan.length) {
        if (!chained.current) { stopRun(batch + 1, "No TXC change was left to fund the next batch. Add TXC to the Vault's TSD address and send the rest as a new list."); return; }
        await prepare(batch + 1, plan);
      } else { setPlan(null); setShown(null); }
    } catch (e) {
      setBusy(false);
      processing.current = false;
      const msg = friendlyBroadcastError(e);
      if (/Nothing was broadcast|didn't match|does not match|signature/i.test(msg)) { setError(msg); collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false); }
      else stopRun(batch, msg);
    } finally {
      void qc.invalidateQueries({ queryKey: ["vault-tsd-balance"] });
    }
  }

  if (!pairing || !holderAddr) return <><h1 className="text-3xl font-semibold">Send to many</h1><p className="mt-4 text-sm text-muted-foreground">Pair this Vault's legacy TXC account to send TSD to many people.</p></>;

  return <>
    <h1 className="text-3xl font-semibold">Send to many · Cold Storage</h1>
    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Pay TSD to many people from your Vault. Paste or upload one <code>address,amount</code> per line. Every {STM_BATCH_SIZE} people make one payment that you sign on Vault by QR.</p>
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)]">
      <section className="space-y-4">
        {!shown ? <>
          <Textarea rows={12} className="font-mono text-xs" placeholder={"address,amount\nTst3dVnJbFrnx5ChmK6qj9F3M8YNsHWR44,0.8"} value={text} onChange={e => setText(e.target.value)} disabled={!!plan || busy} />
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="h-4 w-4" />Upload CSV<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label></Button>
        </> : <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">Transaction {shown.batch + 1} of {plan?.length}</h2>
          <ul className="space-y-1 text-xs">{shown.intent.recipients.map(r => <li key={r.address} className="flex justify-between gap-3"><span className="truncate font-mono">{r.address}</span><span className="shrink-0 tabular-nums">{tsd(r.units)}</span></li>)}</ul>
          <p className="text-xs text-muted-foreground">Network fee {formatTxc(shown.intent.feeSats)} · change {formatTxc(shown.intent.changeSats)} back to {shown.intent.sender}</p>
          <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
            <li>On your Vault, choose <span className="font-medium text-foreground">TXC</span> and tap Scan.</li>
            <li>Check every address and TSD amount on the Vault screen, then sign.</li>
            <li>Scan the Vault's signed QR below. It's checked, then sent.</li>
          </ol>
          <VaultAnimatedQr text={shown.payload} />
          <div className="flex items-center gap-2">
            {!busy && <QrScanButton continuous onScan={t => void onScanned(t)} progress={scanProgress} complete={scanComplete} scanError={scanError} onScanStart={() => { collector.current = new PartCollector(); setScanProgress(null); setScanComplete(false); setScanError(null); }} />}
            <span className="text-xs text-muted-foreground">{busy ? "Checking and sending…" : scanProgress && scanProgress.total > 0 && !scanComplete ? `Reading signed payment: ${scanProgress.have} of ${scanProgress.total} parts` : "Scan the signed payment from Vault"}</span>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {!busy && <Button variant="ghost" size="sm" onClick={() => stopRun(shown.batch, "Stopped before signing.")}>Stop here</Button>}
        </div>}
      </section>
      <section className="rounded-lg border border-border bg-card p-5 text-sm">
        <h2 className="font-semibold">Review</h2>
        <dl className="mt-4 space-y-2">
          <div className="flex justify-between"><dt className="text-muted-foreground">Recipients</dt><dd>{parsed.rows.length}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{tsd(parsed.total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Vault signings</dt><dd>{batches.length}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Est. network cost</dt><dd className="tabular-nums">~{formatTxc(TSD_REFERENCE_SATS * parsed.rows.length + estFee)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">TSD available</dt><dd className="tabular-nums">{units === null ? "…" : tsd(units)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Sending from</dt><dd className="truncate font-mono text-xs">{holderAddr}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Each recipient also gets {formatTxc(TSD_REFERENCE_SATS)} as a required marker. Fees come from TXC on the same address. If a payment fails, earlier ones are already sent and the rest stop.</p>
        {parsed.duplicates.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Listed more than once, amounts combined: {parsed.duplicates.join(", ")}</p>}
        {problems.length > 0 && <ul className="mt-3 space-y-1 text-xs text-destructive">{problems.slice(0, 8).map(p => <li key={p}>{p}</li>)}</ul>}
        <RecipientListSafetyNotice safety={listSafety} linesFor={a => parsed.rows.filter(r => r.address.trim() === a).map(r => r.line)} />
        {!plan && <Button className="mt-5 w-full" disabled={!ready} onClick={() => void start()}>{busy ? "Preparing…" : `Prepare ${batches.length || ""} Vault payment${batches.length === 1 ? "" : "s"}`}</Button>}
        {error && <p role="alert" className="mt-3 break-words text-xs text-destructive">{error}</p>}
        {steps.length > 0 && <ul className="mt-4 space-y-2 text-xs">{steps.map((s, i) => <li key={i} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">{s.status === "ok" && <Check className="h-3 w-3" />}{s.label}</span>
          <span className="text-muted-foreground">{s.status === "ok" ? (s.delivery === "delivered" ? "Tokens delivered" : s.delivery === "rejected" ? `Tokens rejected${s.reason ? `: ${s.reason}` : ""}` : "Sent · checking tokens") : s.status === "failed" ? (s.error ?? "Failed") : s.status === "pending" ? "Sending…" : "Waiting"}
            {s.txid && <a className="ml-1 inline-flex" href={explorerTxUrl(s.txid)} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>}</span>
        </li>)}</ul>}
        {steps.length > 0 && !plan && bulkRunSettled({ asset: "39", steps, savedAt: 0 }) && <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSteps([]); setError(""); }}>Clear results</Button>}
      </section>
    </div>
  </>;
}
