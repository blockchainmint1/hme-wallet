/**
 * Desktop Cold Storage: find every TSD-Bridge stablecoin and ETH on the Vault
 * seed's Ethereum/Base addresses (NectarPay sale addresses included), top up
 * fee money where needed, bring it all to address #0 with HME Vault batch
 * signing, then Buy TSD from #0. The wallet only prepares requests and checks
 * signatures; every key stays on the Vault.
 */
import { useRef, useState, type ReactNode } from "react";
import { formatUnits, keccak256, type Address, type Hex } from "viem";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { loadPairing, mergeRefreshedPairing, parsePairing, savePairing, vaultCan, type VaultPairing } from "@/lib/vault-link/pairing";
import { vaultEvmAccount } from "@/lib/vault-link/evm-accounts";
import {
  ROUNDUP_CHAINS, ROUNDUP_CHAIN_NAME, ROUNDUP_GAP, assertDisperseCode, buildDisperseIntent, buildSweepBatchRequest,
  estimateDisperseGas, estimateTokenGas, planRoundup, planTopUp, readAddress, readFees, roundupTokens, scanVaultEvm,
  topUpAmount, verifySweepBatchReply, verifyVaultDisperse, TOKEN_GAS_MAX,
  type Fees, type RoundupChain, type RoundupItem, type RoundupPlan, type ScannedAddress, type TopUpPlan,
} from "@/lib/vault-link/evm-roundup";
import { formatUnitsPlain, type MintSourceId } from "@/lib/cashout/mint";
import { EVM_CHAINS, evmClient } from "@/lib/chains/evm";
import { loadSession } from "@/lib/txc/session-cache";
import { getActiveProfileId } from "@/lib/txc/storage";

const eth = (wei: bigint) => formatUnitsPlain(wei, 18);
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

type Signing =
  | { kind: "topup"; payload: string; plan: TopUpPlan; fees: Fees }
  | { kind: "batch"; payload: string; items: RoundupItem[]; batch: number; of: number };
interface Broadcast { label: string; hash: Hex | null; error?: string }

export function VaultRoundUp({ profileId, onBuy }: { profileId: string; onBuy?: (sourceId: MintSourceId, amount: string) => void }) {
  const [pairing, setPairing] = useState<VaultPairing | null>(() => loadPairing(profileId));
  const [chain, setChain] = useState<RoundupChain>("eth");
  const [rows, setRows] = useState<ScannedAddress[] | null>(null);
  const [checked, setChecked] = useState(0);
  const [plan, setPlan] = useState<{ plan: RoundupPlan; fees: Fees } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<Signing | null>(null);
  const [sent, setSent] = useState<{ title: string; txs: Broadcast[]; waiting: boolean } | null>(null);
  const tokens = roundupTokens(chain);

  if (!pairing?.evm) {
    return <Panel><p className="text-sm text-muted-foreground">This Vault pairing has no Ethereum address. Pair Ethereum on your Vault first.</p></Panel>;
  }
  if (!pairing.evm.xpub || !vaultCan(pairing, "sweep-batch") || !vaultCan(pairing, "native-disperse")) {
    return <Panel><RefreshPairing profileId={profileId} pairing={pairing} onUpdated={(p) => { setPairing(p); setRows(null); setPlan(null); }} /></Panel>;
  }
  const p = pairing;
  const identity = JSON.stringify(p);

  async function assertSession() {
    const s = await loadSession();
    if (!s || s.mode !== "vault" || getActiveProfileId() !== profileId || JSON.stringify(loadPairing(profileId)) !== identity) {
      throw new Error("Wallet locked or changed. Nothing was sent — reopen this page from the intended Vault.");
    }
  }

  async function scan(c: RoundupChain = chain) {
    setBusy("scan"); setError(null); setPlan(null); setChecked(0);
    try {
      const { used, checked: n } = await scanVaultEvm(p, c, { onProgress: setChecked });
      setRows(used); setChecked(n);
      await makePlan(c, used);
    } catch (e) {
      setRows(null);
      setError(`Couldn't finish checking ${ROUNDUP_CHAIN_NAME[c]} addresses: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  async function makePlan(c: RoundupChain, used: ScannedAddress[]) {
    const fees = await readFees(c);
    const dest = vaultEvmAccount(p, 0).address;
    const gas = new Map<string, bigint>();
    await Promise.all(used.filter((a) => a.index !== 0).flatMap((a) => roundupTokens(c)
      .filter((t) => (a.tokens[t.contract] ?? 0n) > 0n)
      .map(async (t) => {
        try { gas.set(`${a.address}:${t.contract}`, await estimateTokenGas(c, a.address, t.contract, a.tokens[t.contract]!, dest)); }
        catch { gas.set(`${a.address}:${t.contract}`, TOKEN_GAS_MAX + 1n); }
      })));
    setPlan({ plan: planRoundup({ chain: c, destination: dest, addresses: used, fees, tokenGas: (f, t) => gas.get(`${f}:${t}`) ?? TOKEN_GAS_MAX + 1n }), fees });
  }

  async function prepareTopUp() {
    if (!plan || !rows) return;
    setBusy("prepare"); setError(null);
    try {
      await assertSession();
      await assertDisperseCode(chain);
      const fees = await readFees(chain);
      const draft = planTopUp({ chain, addresses: rows, needs: plan.plan.needsGas, fees });
      const gas = await estimateDisperseGas(chain, draft.funder.address, draft.recipients, draft.values);
      const fresh = await readAddress(p, chain, draft.funder.index);
      const final = planTopUp({ chain, addresses: rows.map((r) => (r.index === fresh.index ? fresh : r)), needs: plan.plan.needsGas, fees, gas });
      const payload = buildDisperseIntent(p, chain, final, fees);
      await assertSession();
      setSigning({ kind: "topup", payload, plan: final, fees });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function prepareBatch(k: number) {
    if (!plan) return;
    setBusy("prepare"); setError(null);
    try {
      await assertSession();
      const items = plan.plan.batches[k]!;
      // Fresh nonces and balances: anything that moved since the scan means scan again.
      const fromIdx = [...new Set(items.map((i) => i.index))];
      const fresh = await Promise.all(fromIdx.map((i) => readAddress(p, chain, i)));
      for (const f of fresh) {
        const mine = items.filter((i) => i.index === f.index);
        if (mine[0]!.nonce !== f.nonce) throw new Error(`Address #${f.index} sent something since the check. Check again.`);
        for (const i of mine) if (i.kind === "erc20-transfer" && (f.tokens[i.token] ?? 0n) !== i.amount) throw new Error(`A balance on address #${f.index} changed. Check again.`);
        if (f.native !== rows?.find((r) => r.index === f.index)?.native) throw new Error(`The ETH on address #${f.index} changed. Check again.`);
      }
      const payload = buildSweepBatchRequest(p, chain, plan.plan.destination, items, plan.fees);
      await assertSession();
      setSigning({ kind: "batch", payload, items, batch: k + 1, of: plan.plan.batches.length });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function broadcast(signed: Hex[], labels: string[], senders: number[]) {
    const pub = evmClient(chain);
    const out: Broadcast[] = [];
    const failed = new Set<number>();
    for (let i = 0; i < signed.length; i++) {
      // A failed payment leaves a nonce gap: hold the rest from that address.
      if (failed.has(senders[i]!)) { out.push({ label: labels[i]!, hash: null, error: "held — an earlier payment from this address failed" }); continue; }
      const local = keccak256(signed[i]!);
      try {
        const h = await pub.sendRawTransaction({ serializedTransaction: signed[i]! });
        out.push({ label: labels[i]!, hash: h });
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (/already known|known transaction|nonce too low.*already/i.test(msg)) out.push({ label: labels[i]!, hash: local });
        else { failed.add(senders[i]!); out.push({ label: labels[i]!, hash: null, error: msg.split("\n")[0]?.slice(0, 160) || "broadcast failed" }); }
      }
    }
    return out;
  }

  async function onSigned(full: string) {
    if (!signing) return;
    if (signing.kind === "topup") {
      const raw = full.trim() as Hex;
      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(raw)) throw new Error("That QR doesn't contain a signed Ethereum transaction.");
      await verifyVaultDisperse(raw, signing.payload);
      await assertSession();
      const f = await readAddress(p, chain, signing.plan.funder.index);
      if (f.nonce !== signing.plan.funder.nonce) throw new Error("The paying address sent something since. Nothing was broadcast — prepare again.");
      const txs = await broadcast([raw], [`Fee money to ${signing.plan.recipients.length} addresses from #${signing.plan.funder.index}`], [signing.plan.funder.index]);
      finish("Fee money sent", txs);
      return;
    }
    const signed = await verifySweepBatchReply(full, signing.payload);
    await assertSession();
    const senders = [...new Set(signing.items.map((i) => i.index))];
    const fresh = await Promise.all(senders.map((i) => readAddress(p, chain, i)));
    for (const f of fresh) {
      if (signing.items.find((i) => i.index === f.index)!.nonce !== f.nonce) throw new Error(`Address #${f.index} sent something since. Nothing was broadcast — prepare again.`);
    }
    const labels = signing.items.map((i) => `#${i.index} → #0 · ${i.kind === "native-transfer" ? `${eth(i.value)} ${EVM_CHAINS[chain].nativeSymbol}` : tokenLabel(i.token, i.amount)}`);
    const txs = await broadcast(signed, labels, signing.items.map((i) => i.index));
    finish(`Batch ${signing.batch} of ${signing.of} sent`, txs);
  }

  function tokenLabel(contract: Address, amount: bigint) {
    const t = tokens.find((x) => x.contract === contract);
    return t ? `${formatUnitsPlain(amount, t.decimals)} ${t.symbol}` : `${amount} raw units`;
  }

  function finish(title: string, txs: Broadcast[]) {
    setSigning(null);
    setSent({ title, txs, waiting: true });
    const pub = evmClient(chain);
    void Promise.all(txs.filter((t) => t.hash).map((t) => pub.waitForTransactionReceipt({ hash: t.hash!, timeout: 300_000 }).catch(() => null)))
      .then(() => { setSent((s) => (s ? { ...s, waiting: false } : s)); void scan(); });
  }

  if (signing) {
    return (
      <Panel>
        <h3 className="text-lg font-semibold">
          {signing.kind === "topup" ? "Send fee money" : `Bring payments to address #0 — batch ${signing.batch} of ${signing.of}`}
        </h3>
        {signing.kind === "topup" ? (
          <div className="mt-3 space-y-1 text-sm">
            <p>From address #{signing.plan.funder.index} <span className="font-mono text-xs">{short(signing.plan.funder.address)}</span>, through the bulk-payment contract HME Vault pinned:</p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {signing.plan.recipients.map((r, i) => <li key={r}>{short(r)} · {eth(signing.plan.values[i]!)} {EVM_CHAINS[chain].nativeSymbol}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">Total {eth(signing.plan.total)} {EVM_CHAINS[chain].nativeSymbol}, enough for each address to pay its own transfer fees (with 50% headroom).</p>
          </div>
        ) : (
          <div className="mt-3 text-sm">
            <p>{signing.items.length} payments, all to your own address #0 <span className="font-mono text-xs">{short(plan?.plan.destination ?? "")}</span>:</p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {signing.items.map((i) => <li key={`${i.index}:${i.nonce}`}>#{i.index} · {i.kind === "native-transfer" ? `${eth(i.value)} ${EVM_CHAINS[chain].nativeSymbol} (the rest after fees)` : tokenLabel(i.token, i.amount)}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">On the Vault, check it says "your own address #0". Unknown tokens (such as PYUSD) show as a contract and raw units.</p>
          </div>
        )}
        <SignAndScan payload={signing.payload} onSigned={onSigned} onBack={() => setSigning(null)} />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Round up stablecoins to TSD</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Finds USDC, USDT, PYUSD and ETH on every address of this Vault (including store sale addresses), brings it to
            address #0 in batches your Vault signs at once, then buys TSD from #0. Checks until {ROUNDUP_GAP} unused addresses in a row.
          </p>
        </div>
        <div className="flex gap-2">
          {ROUNDUP_CHAINS.map((c) => (
            <Button key={c} size="sm" variant={c === chain ? "default" : "outline"} disabled={!!busy}
              onClick={() => { setChain(c); setRows(null); setPlan(null); setSent(null); void scan(c); }}>{ROUNDUP_CHAIN_NAME[c]}</Button>
          ))}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void scan()} aria-label="Check again">
            <RefreshCw className={busy === "scan" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {!rows && busy !== "scan" && !error && <Button className="mt-4" onClick={() => void scan()}>Check {ROUNDUP_CHAIN_NAME[chain]} addresses</Button>}
      {busy === "scan" && <p className="mt-4 text-sm text-muted-foreground">Checking {ROUNDUP_CHAIN_NAME[chain]} addresses… {checked} checked</p>}
      {error && <p className="mt-4 break-words text-sm text-destructive">{error}</p>}

      {sent && (
        <div className="mt-5 rounded-md border border-border p-4">
          <p className="flex items-center gap-2 font-medium">{sent.waiting && <Loader2 className="h-4 w-4 animate-spin" />}{sent.title}{sent.waiting ? " — waiting for confirmations" : " — confirmed or timed out; checked again"}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {sent.txs.map((t, i) => (
              <li key={i}>{t.label}: {t.hash
                ? <a className="inline-flex items-center gap-1 underline" href={EVM_CHAINS[chain].explorerTx(t.hash)} target="_blank" rel="noreferrer">{short(t.hash)}<ExternalLink className="h-3 w-3" /></a>
                : <span className="text-destructive">{t.error}</span>}</li>
            ))}
          </ul>
        </div>
      )}

      {rows && (
        <>
          <table className="mt-5 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-2">Address</th><th>{EVM_CHAINS[chain].nativeSymbol}</th>{tokens.map((t) => <th key={t.contract}>{t.symbol}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index} className="border-t border-border">
                  <td className="py-2"><span className="font-medium">#{r.index}</span> <span className="font-mono text-xs text-muted-foreground">{short(r.address)}</span></td>
                  <td>{eth(r.native)}</td>
                  {tokens.map((t) => <td key={t.contract}>{formatUnitsPlain(r.tokens[t.contract] ?? 0n, t.decimals)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">{checked} addresses checked; only addresses ever used are listed.</p>

          {plan && (
            <div className="mt-6 space-y-4">
              {plan.plan.needsGas.length > 0 && (
                <Step n={1} title={`Fee money for ${plan.plan.needsGas.length} address${plan.plan.needsGas.length > 1 ? "es" : ""}`}>
                  <p className="text-sm text-muted-foreground">
                    These hold stablecoins but not enough {EVM_CHAINS[chain].nativeSymbol} to pay their own transfer fee:{" "}
                    {plan.plan.needsGas.map((n) => `#${n.index} (needs ${eth(topUpAmount(n))})`).join(", ")}. One Vault signature sends it from your address with the most {EVM_CHAINS[chain].nativeSymbol}.
                  </p>
                  <Button className="mt-3" disabled={!!busy} onClick={() => void prepareTopUp()}>{busy === "prepare" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Prepare fee money</Button>
                </Step>
              )}
              {plan.plan.batches.length > 0 ? (
                <Step n={plan.plan.needsGas.length ? 2 : 1} title="Bring everything to address #0">
                  <p className="text-sm text-muted-foreground">
                    {plan.plan.batches.reduce((s, b) => s + b.length, 0)} payments in {plan.plan.batches.length} Vault batch{plan.plan.batches.length > 1 ? "es" : ""} (up to 25 each). Leftover {EVM_CHAINS[chain].nativeSymbol} on each address comes along after its tokens.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plan.plan.batches.map((b, k) => (
                      <Button key={k} disabled={!!busy} onClick={() => void prepareBatch(k)}>
                        {busy === "prepare" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign batch {k + 1} ({b.length})
                      </Button>
                    ))}
                  </div>
                </Step>
              ) : plan.plan.needsGas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing left to bring to #0 on {ROUNDUP_CHAIN_NAME[chain]}.</p>
              ) : null}
              {plan.plan.skipped.length > 0 && (
                <p className="text-xs text-muted-foreground">Left out: {plan.plan.skipped.map((s) => `#${s.index} ${s.reason}`).join("; ")}.</p>
              )}
              <BuyStep chain={chain} n={(plan.plan.needsGas.length ? 1 : 0) + (plan.plan.batches.length ? 1 : 0) + 1}
                zero={rows.find((r) => r.index === 0)} onBuy={onBuy} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function BuyStep({ chain, n, zero, onBuy }: { chain: RoundupChain; n: number; zero: ScannedAddress | undefined; onBuy?: ((sourceId: MintSourceId, amount: string) => void) | undefined }) {
  const held = roundupTokens(chain).filter((t) => (zero?.tokens[t.contract] ?? 0n) > 0n);
  return (
    <Step n={n} title="Buy TSD from address #0">
      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stablecoins on address #0 yet. After the batches confirm, they show here.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {held.map((t) => {
            const raw = zero!.tokens[t.contract]!;
            return <Button key={t.contract} disabled={!onBuy} onClick={() => onBuy?.(t.sourceId, formatUnits(raw, t.decimals))}>Buy TSD with {formatUnitsPlain(raw, t.decimals)} {t.symbol}</Button>;
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Each order is one payment from #0 that your Vault signs. Keep a little {EVM_CHAINS[chain].nativeSymbol} on #0 for those fees.</p>
    </Step>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="font-medium">{n}. {title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="mb-10 rounded-lg border border-border p-5">{children}</section>;
}

/** Show a request as an animated QR and read Vault's (possibly multi-part) reply. */
function SignAndScan({ payload, onSigned, onBack }: { payload: string; onSigned: (full: string) => Promise<void>; onBack: () => void }) {
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [progress, setProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const [complete, setComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function scan(frame: string) {
    if (processing.current) return;
    let full: string | null;
    if (!frame.startsWith("HMQR")) full = frame;
    else {
      try {
        full = collector.current.add(frame);
        setProgress({ ...collector.current.progress, received: collector.current.receivedParts });
        setScanError(null);
      } catch (e) {
        collector.current = new PartCollector(); setProgress(null); setComplete(false);
        setScanError(e instanceof Error ? e.message : "Could not read that QR frame.");
        return;
      }
    }
    if (!full) return;
    collector.current = new PartCollector();
    processing.current = true; setComplete(true); setBusy(true); setError(null);
    try { await onSigned(full); }
    catch (e) { setError((e as Error).message); processing.current = false; setProgress(null); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-5 space-y-3">
      <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
        <li>On your Vault, tap Scan and read this code.</li>
        <li>Check every address and amount on the Vault screen, then sign.</li>
        <li>Scan the Vault's signed code here. The wallet checks every transaction before sending.</li>
      </ol>
      <VaultAnimatedQr text={payload} />
      <div className="flex items-center gap-2">
        {!busy && <QrScanButton continuous onScan={(t) => void scan(t)} progress={progress} complete={complete} scanError={scanError}
          onScanStart={() => { collector.current = new PartCollector(); setProgress(null); setComplete(false); setScanError(null); setError(null); }} />}
        <span className="text-xs text-muted-foreground">{busy ? "Checking and broadcasting…" : progress && progress.total > 0 && !complete ? `Reading: ${progress.have} of ${progress.total} parts` : "Scan the signed code from Vault"}</span>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={onBack}>Back</Button>
    </div>
  );
}

/** Re-scan the same Vault's pairing QR to add the Ethereum account key and batch signing. */
function RefreshPairing({ profileId, pairing, onUpdated }: { profileId: string; pairing: VaultPairing; onUpdated: (p: VaultPairing) => void }) {
  const collectorRef = useRef<PartCollector | null>(null);
  const [progress, setProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  function apply(text: string) {
    setError(null);
    try {
      const merged = mergeRefreshedPairing(pairing, parsePairing(text));
      if (!merged.evm?.xpub) throw new Error("That pairing code has no Ethereum account key. Update HME Vault to 1.0.1 or newer and show its full pairing QR.");
      if (!vaultCan(merged, "sweep-batch") || !vaultCan(merged, "native-disperse")) throw new Error("This Vault build can't sign batches yet. Update HME Vault to 1.0.1 or newer.");
      if (getActiveProfileId() !== profileId) throw new Error("Wallet changed. Reopen this page from the intended Vault.");
      savePairing(profileId, merged);
      onUpdated(merged);
    } catch (e) { setError((e as Error).message); }
  }
  function onScan(text: string) {
    if (!text.startsWith("HMQR")) { setRaw(text); apply(text); return; }
    try {
      const c = (collectorRef.current ??= new PartCollector());
      const done = c.add(text);
      setProgress({ ...c.progress, received: c.receivedParts });
      if (done) { collectorRef.current = null; setProgress(null); setRaw(done); apply(done); }
    } catch (e) { collectorRef.current = null; setProgress(null); setError((e as Error).message); }
  }
  return (
    <div>
      <h3 className="text-lg font-semibold">Round up stablecoins to TSD</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        To find money on all of this Vault's Ethereum addresses (not just #0) and sign it in batches, scan your Vault's
        pairing QR once more. It needs HME Vault 1.0.1 or newer. This only adds public keys. It must be the same Vault
        (fingerprint {pairing.fp}), and nothing already paired can change.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <QrScanButton continuous onScan={onScan} progress={progress} complete={false} onScanStart={() => { collectorRef.current = null; setProgress(null); setError(null); }} />
        <span className="text-xs text-muted-foreground">{progress && progress.total > 1 ? `Reading pairing QR… part ${progress.have} of ${progress.total}` : "Scan the Vault pairing QR"}</span>
      </div>
      <Textarea className="mt-3 font-mono text-xs" rows={3} placeholder='…or paste the pairing code {"hmvault":1,…}' value={raw}
        onChange={(e) => { setRaw(e.target.value); if (e.target.value.trim()) apply(e.target.value); }} />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
