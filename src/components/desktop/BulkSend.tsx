import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { payments } from "bitcoinjs-lib";
import { ExternalLink, Upload } from "lucide-react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount, type AccountUtxo } from "@/lib/txc/scan";
import { buildAndSignTx, type UtxoInput } from "@/lib/txc/wallet";
import { DERIVATION_PATHS, TXC_NETWORK, MEMPOOL_API, scriptKindOf, type DerivationKind } from "@/lib/txc/network";
import { broadcastTx, explorerTxUrl, getFeeEstimates, getTxHex } from "@/lib/txc/mempool";
import { reserveOutpoints } from "@/lib/txc/spent-outpoints";
import { formatTxc } from "@/lib/txc/units";
import { rootFingerprintHex } from "@/lib/txc/fingerprint";
import { useEnabledTxcTokens, formatTokenAmount } from "@/lib/txc/tokens";
import { useTxcTokenProps } from "@/lib/txc/token-props";
import { getTxcTokenBalancesPerAddress } from "@/lib/txc/tokens.functions";
import { friendlyBroadcastError } from "@/lib/broadcast-error";
import { confirmWithBiometric } from "@/lib/native/biometric";
import {
  BULK_DUST_SATS, STM_ACTIVATION_HEIGHT, STM_BATCH_SIZE, buildSendToManyPayload, chunk, estimateVsize, parseBulkCsv,
} from "@/lib/txc/bulk-send";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Step = { label: string; status: "pending" | "ok" | "failed" | "waiting"; txid?: string; error?: string };
const VB: Record<string, number> = { bip84: 68, bip49: 91, bip44: 148 };

function kindFromPath(path: string): DerivationKind | null {
  for (const [kind, prefix] of Object.entries(DERIVATION_PATHS)) if (path.startsWith(prefix + "/")) return kind as DerivationKind;
  return null;
}
function scriptHexFor(pubkey: Uint8Array, kind: DerivationKind): string | undefined {
  const s = scriptKindOf(kind);
  if (s === "bip44") return undefined;
  const inner = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
  const out = s === "bip84" ? inner.output : payments.p2sh({ redeem: inner, network: TXC_NETWORK }).output;
  return out ? Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("") : undefined;
}

export function BulkSend() {
  const { root, unlocked } = useWallet();
  const qc = useQueryClient();
  const regular = !!root && !!unlocked && unlocked.mode !== "vault" && unlocked.mode !== "watch";
  const localTokens = useEnabledTxcTokens();
  const { resolved: tokens } = useTxcTokenProps(localTokens);
  const [asset, setAsset] = useState<string>("txc");
  const token = asset === "txc" ? null : tokens.find((t) => String(t.id) === asset) ?? null;
  const [text, setText] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const account = useQuery({
    queryKey: ["account", unlocked?.kind, root ? rootFingerprintHex(root) : null],
    enabled: regular,
    queryFn: () => scanAccount(root!, unlocked!.kind),
    staleTime: 30_000,
  });
  const fees = useQuery({ queryKey: ["fees"], queryFn: getFeeEstimates, staleTime: 60_000 });
  const feeRate = Math.max(fees.data?.halfHourFee ?? 10, fees.data?.minimumFee ?? 10, 10);

  const addrs = useMemo(() => [...(account.data?.external ?? []), ...(account.data?.internal ?? [])]
    .map((d) => ({ ...d, kind: kindFromPath(d.path) }))
    .filter((d): d is typeof d & { kind: DerivationKind } => d.kind !== null), [account.data]);
  const fetchPerAddr = useServerFn(getTxcTokenBalancesPerAddress);
  const perAddr = useQuery({
    queryKey: ["txc-token-balances-per-addr", addrs.map((a) => a.address).join(","), token?.id],
    enabled: !!token && addrs.length > 0,
    queryFn: () => fetchPerAddr({ data: { addresses: addrs.slice(0, 200).map((a) => a.address), propertyIds: [token!.id] } }),
    staleTime: 30_000,
  });

  const parsed = useMemo(() => parseBulkCsv(text, token ? { type: "omni", divisible: token.divisible } : { type: "txc" }), [text, token]);
  const holder = useMemo(() => {
    if (!token || !perAddr.data) return null;
    const ranked = addrs.map((a) => ({ a, units: BigInt(perAddr.data[a.address]?.[token.id] ?? "0") })).sort((x, y) => (y.units > x.units ? 1 : -1));
    return ranked[0] && ranked[0].units > 0n ? ranked[0] : null;
  }, [addrs, perAddr.data, token]);
  const utxos = account.data?.utxos ?? [];
  const txcBalance = utxos.reduce((s, u) => s + u.value, 0);
  const batches = token ? chunk(parsed.rows, STM_BATCH_SIZE) : parsed.rows.length ? [parsed.rows] : [];
  const estFee = token
    ? batches.reduce((s, b) => s + Math.ceil(estimateVsize(2, b.length + 1, 13 + 9 * b.length) * feeRate), 0)
    : Math.ceil(estimateVsize(Math.min(utxos.length, 20) || 1, parsed.rows.length + 1) * feeRate);
  const txcNeeded = (token ? BULK_DUST_SATS * parsed.rows.length : Number(parsed.total)) + estFee;

  const problems: string[] = [...parsed.errors];
  if (token && holder && holder.units < parsed.total) problems.push(`Your ${token.symbol} address holds ${formatTokenAmount(holder.units, token.divisible)} ${token.symbol}, less than the ${formatTokenAmount(parsed.total, token.divisible)} total. Use Consolidate in Phone view if it's spread across addresses.`);
  if (token && perAddr.data && !holder) problems.push(`No ${token.symbol} found in this wallet.`);
  const fundingUtxos = token && holder ? utxos.filter((u) => u.address === holder.a.address) : utxos;
  const fundingSats = fundingUtxos.reduce((s, u) => s + u.value, 0);
  if (parsed.rows.length && account.data && fundingSats < txcNeeded) problems.push(token ? `The ${token.symbol} address needs about ${formatTxc(txcNeeded)} TXC for network fees and markers, but has ${formatTxc(fundingSats)}. Send some TXC to ${holder?.a.address} first.` : `Not enough TXC. Need about ${formatTxc(txcNeeded)}, have ${formatTxc(txcBalance)}.`);
  const ready = regular && parsed.rows.length > 0 && problems.length === 0 && !busy && !!account.data;

  function setStep(log: Step[], i: number, p: Partial<Step>) { log[i] = { ...log[i], ...p }; setSteps([...log]); }

  async function withHex(u: AccountUtxo): Promise<UtxoInput> {
    return scriptKindOf(u.kind ?? unlocked!.kind) === "bip44" && !u.nonWitnessUtxoHex ? { ...u, nonWitnessUtxoHex: await getTxHex(u.txid) } : u;
  }

  async function run() {
    if (!ready || !root || !unlocked || !account.data) return;
    const label = token ? `${formatTokenAmount(parsed.total, token.divisible)} ${token.symbol}` : `${formatTxc(Number(parsed.total))} TXC`;
    if (!window.confirm(`Send ${label} to ${parsed.rows.length} recipients in ${batches.length} transaction${batches.length > 1 ? "s" : ""}? This can't be undone.`)) return;
    if (!(await confirmWithBiometric(`Send to many: ${label}`))) return;
    setBusy(true); setError("");
    const log: Step[] = batches.map((b, i) => ({ label: `Transaction ${i + 1} · ${b.length} recipient${b.length > 1 ? "s" : ""}`, status: "waiting" }));
    setSteps([...log]);
    try {
      if (!token) {
        const outputs = parsed.rows.map((r) => ({ address: r.address, valueSats: Number(r.units) }));
        const target = outputs.reduce((s, o) => s + o.valueSats, 0);
        const sorted = [...utxos].sort((a, b) => b.value - a.value);
        const picked: AccountUtxo[] = []; let acc = 0; let fee = 0;
        for (const u of sorted) {
          picked.push(u); acc += u.value;
          fee = Math.ceil((10 + picked.reduce((s, p) => s + VB[scriptKindOf(p.kind ?? unlocked.kind)], 0) + 34 * (outputs.length + 1)) * feeRate);
          if (acc >= target + fee) break;
        }
        if (acc < target + fee) throw new Error("Not enough TXC for these payments and the network fee.");
        setStep(log, 0, { status: "pending" });
        const inputs = await Promise.all(picked.map(withHex));
        const built = buildAndSignTx({ root, kind: unlocked.kind, inputs, outputs, changeAddress: account.data.nextChangeAddress, changeIndex: account.data.nextChangeIndex, feeSats: fee });
        const txid = await broadcastTx(built.hex);
        reserveOutpoints(picked.map((u) => ({ txid: u.txid, vout: u.vout })));
        setStep(log, 0, { status: "ok", txid });
      } else {
        const tip = Number(await (await fetch(`${MEMPOOL_API}/blocks/tip/height`)).text());
        if (!(tip >= STM_ACTIVATION_HEIGHT)) throw new Error("TEXITcoin's send-to-many feature isn't active yet, so nothing was sent.");
        const h = holder!.a;
        const script = scriptHexFor(h.pubkey, h.kind);
        let pool: UtxoInput[] = await Promise.all([...fundingUtxos].sort((a, b) => b.value - a.value).map(withHex));
        for (let i = 0; i < batches.length; i++) {
          const b = batches[i];
          setStep(log, i, { status: "pending" });
          try {
            const outputs = b.map((r) => ({ address: r.address, valueSats: BULK_DUST_SATS }));
            const payload = buildSendToManyPayload(token.id, b.map((r, j) => ({ vout: j + 1, units: r.units })));
            const need = BULK_DUST_SATS * b.length;
            const picked: UtxoInput[] = []; let acc = 0; let fee = 0;
            for (const u of pool) {
              picked.push(u); acc += u.value;
              fee = Math.ceil(estimateVsize(picked.length, b.length + 1, payload.length, VB[scriptKindOf(h.kind)]) * feeRate);
              if (acc >= need + fee) break;
            }
            if (acc < need + fee) throw new Error(`Not enough TXC on the ${token.symbol} address for this batch's fee.`);
            const built = buildAndSignTx({ root, kind: unlocked.kind, inputs: picked, outputs, changeAddress: h.address, changeIndex: h.index, feeSats: fee, opReturnData: payload });
            const txid = await broadcastTx(built.hex);
            reserveOutpoints(picked.map((u) => ({ txid: u.txid, vout: u.vout })));
            const used = new Set(picked.map((u) => `${u.txid}:${u.vout}`));
            pool = pool.filter((u) => !used.has(`${u.txid}:${u.vout}`));
            // OP_RETURN is vout 0, recipients 1..n, change n+1.
            if (built.changeSats > 0) pool.unshift({ txid, vout: b.length + 1, value: built.changeSats, change: h.change, index: h.index, kind: h.kind, witnessScriptHex: script, nonWitnessUtxoHex: scriptKindOf(h.kind) === "bip44" ? built.hex : undefined });
            setStep(log, i, { status: "ok", txid });
          } catch (e) {
            setStep(log, i, { status: "failed", error: friendlyBroadcastError(e) });
            throw new Error(i > 0 ? `Stopped at transaction ${i + 1}. The ${i} earlier transaction${i > 1 ? "s were" : " was"} already sent; the rest were not.` : "Nothing was sent.");
          }
        }
      }
    } catch (e) {
      setError(friendlyBroadcastError(e));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["account"] });
      void qc.invalidateQueries({ queryKey: ["txc-token-balances"] });
      void qc.invalidateQueries({ queryKey: ["txc-token-balances-per-addr"] });
    }
  }

  async function onFile(f: File | undefined) { if (f) setText(await f.text()); }

  if (!regular) return <><h1 className="text-3xl font-semibold">Send to many</h1><p className="mt-4 text-sm text-muted-foreground">Bulk sending is available for regular wallets. Cold Storage and watch-only wallets aren't supported yet.</p></>;

  const fmt = (u: bigint) => token ? `${formatTokenAmount(u, token.divisible)} ${token.symbol}` : `${formatTxc(Number(u))} TXC`;
  return <>
    <h1 className="text-3xl font-semibold">Send to many</h1>
    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Pay up to 100 people at once on TEXITcoin. Paste or upload a list with one <code>address,amount</code> per line.</p>
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)]">
      <section className="space-y-4">
        <label className="block text-sm font-medium">Coin
          <select className="mt-2 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={asset} onChange={(e) => { setAsset(e.target.value); setSteps([]); setError(""); }} disabled={busy}>
            <option value="txc">TXC</option>
            {tokens.map((t) => <option key={t.id} value={String(t.id)}>{t.symbol} (Omni #{t.id})</option>)}
          </select>
        </label>
        <Textarea rows={12} className="font-mono text-xs" placeholder={"address,amount\nTst3dVnJbFrnx5ChmK6qj9F3M8YNsHWR44,0.8"} value={text} onChange={(e) => { setText(e.target.value); setSteps([]); }} disabled={busy} />
        <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="h-4 w-4" />Upload CSV<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} /></label></Button>
      </section>
      <section className="rounded-lg border border-border bg-card p-5 text-sm">
        <h2 className="font-semibold">Review</h2>
        <dl className="mt-4 space-y-2">
          <div className="flex justify-between"><dt className="text-muted-foreground">Recipients</dt><dd>{parsed.rows.length}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{fmt(parsed.total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Transactions</dt><dd>{batches.length}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Est. network cost</dt><dd className="tabular-nums">~{formatTxc(token ? BULK_DUST_SATS * parsed.rows.length + estFee : estFee)} TXC</dd></div>
          {token && holder && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Sending from</dt><dd className="truncate font-mono text-xs">{holder.a.address}</dd></div>}
        </dl>
        {token && <p className="mt-4 text-xs text-muted-foreground">Tokens go out in batches of {STM_BATCH_SIZE}, one transaction each, and each recipient also gets {formatTxc(BULK_DUST_SATS)} TXC as a required marker. If a batch fails, earlier batches have already been sent and the rest stop.</p>}
        {parsed.duplicates.length > 0 && <p className="mt-3 text-xs text-destructive">Listed more than once: {parsed.duplicates.join(", ")}</p>}
        {problems.length > 0 && <ul className="mt-3 space-y-1 text-xs text-destructive">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button className="mt-5 w-full" disabled={!ready} onClick={() => void run()}>{busy ? "Sending…" : `Send to ${parsed.rows.length || ""} recipients`}</Button>
        {error && <p role="alert" className="mt-3 break-words text-xs text-destructive">{error}</p>}
        {steps.length > 0 && <ol className="mt-5 space-y-2">{steps.map((s, i) => <li key={i} className="flex items-center justify-between gap-2 text-xs"><span>{s.label} · {s.status === "ok" ? "Sent" : s.status === "pending" ? "Sending…" : s.status === "failed" ? "Failed" : "Not sent"}</span>{s.txid && <a className="inline-flex items-center gap-1 underline" href={explorerTxUrl(s.txid)} target="_blank" rel="noreferrer">View<ExternalLink className="h-3 w-3" /></a>}{s.error && <span className="text-destructive">{s.error}</span>}</li>)}</ol>}
      </section>
    </div>
    {parsed.rows.length > 0 && <table className="mt-8 w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Line</th><th>Address</th><th className="text-right">Amount</th></tr></thead><tbody>{parsed.rows.map((r) => <tr key={r.line} className="border-t border-border"><td className="py-2">{r.line}</td><td className="font-mono text-xs">{r.address}</td><td className="text-right tabular-nums">{fmt(r.units)}</td></tr>)}</tbody></table>}
  </>;
}
