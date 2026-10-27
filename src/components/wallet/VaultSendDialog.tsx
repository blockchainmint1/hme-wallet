/**
 * Vault send flow: build an unsigned transaction, show it to the HME Vault
 * device as a (possibly animated) QR, scan the signed transaction back,
 * verify it matches what was requested, then broadcast.
 *
 * Nothing is ever signed here — this dialog only prepares and broadcasts.
 */
import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { TxidCard } from "@/components/wallet/TxidCard";
import { useDesktopViewport } from "@/hooks/use-desktop-viewport";
import { cn } from "@/lib/utils";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { buildVaultPsbt, nextVaultChangeIndex, verifySignedAgainstPsbt, verifySignedTx } from "@/lib/vault-link/psbt-build";
import type { EvmIntent } from "@/lib/vault-link/evm-intent";
import { prepareVaultEvmSend, verifyVaultEvmSend } from "@/lib/vault-link/evm-send";
import { chainIo, type VaultChainScan } from "@/lib/vault-link/scan";
import { VAULT_CHAIN_META } from "@/lib/vault-link/derive";
import type { VaultPairing, VaultUtxoChain } from "@/lib/vault-link/pairing";
import { EVM_CHAINS, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { getFeeEstimates as txcFees } from "@/lib/txc/mempool";
import { getFeeEstimates as iskFees } from "@/lib/isk/mempool";
import { getFeeEstimates as btcFees } from "@/lib/btc/mempool";
import { getFeeEstimates as ltcFees } from "@/lib/ltc/mempool";
import { getFeeEstimates as dogeFees } from "@/lib/doge/mempool";
import { useServerFn } from "@tanstack/react-start";
import { getTxcTokenBalance, getTxcTokenProperties } from "@/lib/txc/tokens.functions";
import { getAddressUtxos, getOutspend } from "@/lib/txc/mempool";
import { buildVaultTsdPsbt, vaultTsdHolder, verifyVaultTsdSigned, type VaultTsdIntent } from "@/lib/vault-link/tsd-send";
import { loadPairing } from "@/lib/vault-link/pairing";
import { getActiveProfileId } from "@/lib/txc/storage";
import { loadSession } from "@/lib/txc/session-cache";

const FEE_FN: Record<VaultUtxoChain, () => Promise<{ halfHourFee: number }>> = {
  txc: txcFees,
  isk: iskFees,
  btc: btcFees,
  ltc: ltcFees,
  doge: dogeFees,
};

const SATS = 100_000_000;

type Step =
  | { name: "form" }
  | { name: "show"; payload: string; expected: { address: string; valueSats: number }[]; tsdIntent?: VaultTsdIntent }
  | { name: "done"; txid: string };

export function VaultSendDialog({
  pairing,
  chain,
  scans,
  onClose,
  tsd = false,
  initialTo = "",
  initialAmount = "",
}: {
  pairing: VaultPairing;
  /** UTXO chain id, or "evm" for the paired Ethereum-style account. */
  chain: VaultUtxoChain | "evm";
  scans: VaultChainScan[];
  onClose: () => void;
  tsd?: boolean;
  initialTo?: string;
  initialAmount?: string;
}) {
  const fetchBalance = useServerFn(getTxcTokenBalance);
  const fetchProperties = useServerFn(getTxcTokenProperties);
  const [profileId] = useState(getActiveProfileId);
  const [pairingIdentity] = useState(() => JSON.stringify(pairing));
  async function assertTsdSession() {
    const session = await loadSession();
    if (!session || session.mode !== "vault" || getActiveProfileId() !== profileId || JSON.stringify(loadPairing(profileId)) !== pairingIdentity) throw new Error("Wallet locked or changed. Reopen the TSD transfer from the intended Vault.");
  }
  const [step, setStep] = useState<Step>({ name: "form" });
  const [to, setTo] = useState(initialTo);
  const [amount, setAmount] = useState(initialAmount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evmChain, setEvmChain] = useState<EvmChainId>("eth");
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [scanProgress, setScanProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const desktop = useDesktopViewport();

  function resetScan() {
    collector.current = new PartCollector();
    setScanProgress(null);
    setScanComplete(false);
    setScanError(null);
    setError(null);
  }

  const isEvm = chain === "evm";
  const meta = !isEvm ? VAULT_CHAIN_META[chain] : null;
  const chainScans = useMemo(() => scans.filter((s) => s.chain === chain), [scans, chain]);
  const [purpose, setPurpose] = useState<44 | 49 | 84 | null>(null);
  const activePurpose: 44 | 49 | 84 | null = purpose ?? chainScans[0]?.purpose ?? null;
  const activeScan = chainScans.find((s) => s.purpose === activePurpose) ?? chainScans[0];

  async function buildUtxo() {
    if (!meta || !activeScan) return;
    const sats = Math.round(Number(amount) * SATS);
    if (!Number.isFinite(sats) || sats <= 0) throw new Error("Enter an amount.");
    if (!to.trim()) throw new Error("Enter the recipient address.");

    const fees = await FEE_FN[chain as VaultUtxoChain]();
    const feeRate = Math.max(1, Math.ceil(fees.halfHourFee));

    // Greedy largest-first coin selection within the chosen address type.
    const sorted = [...activeScan.utxos].sort((a, b) => b.value - a.value);
    const inVsize = activePurpose === 84 ? 68 : activePurpose === 49 ? 91 : 148;
    const picked: typeof sorted = [];
    let total = 0;
    let feeSats = 0;
    for (const u of sorted) {
      picked.push(u);
      total += u.value;
      const vsize = 10 + picked.length * inVsize + 2 * 34;
      feeSats = vsize * feeRate;
      if (total >= sats + feeSats) break;
    }
    if (total < sats + feeSats) throw new Error("Not enough confirmed funds for this payment plus the network fee.");

    // Legacy inputs need the full previous transaction.
    const prevTxHex: Record<string, string> = {};
    if (activePurpose === 44) {
      const io = chainIo(chain as VaultUtxoChain);
      for (const u of picked) {
        prevTxHex[`${u.txid}:${u.vout}`] = await io.txHex(u.txid);
      }
    }

    const built = buildVaultPsbt({
      pairing,
      chain: chain as VaultUtxoChain,
      inputs: picked,
      prevTxHex,
      outputs: [{ address: to.trim(), valueSats: sats }],
      feeSats,
      changePurpose: activePurpose ?? 44,
      changeIndex: nextVaultChangeIndex(activeScan),
    });
    setStep({ name: "show", payload: built.psbtBase64, expected: [{ address: to.trim(), valueSats: sats }] });
  }

  async function buildEvm() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) throw new Error("Enter a valid 0x recipient address.");
    const json = await prepareVaultEvmSend(pairing, evmChain, to.trim() as `0x${string}`, amount);
    setStep({ name: "show", payload: json, expected: [] });
  }

  async function buildTsd() {
    if (chain !== "txc") throw new Error("TSD is only supported on TXC.");
    await assertTsdSession();
    const holder = vaultTsdHolder(pairing);
    const [balance, properties, fees, coins] = await Promise.all([
      fetchBalance({ data: { address: holder.address, propertyId: 39 } }),
      fetchProperties({ data: { propertyIds: [39] } }), txcFees(), getAddressUtxos(holder.address),
    ]);
    if (properties[39]?.divisible !== true) throw new Error("Could not verify TSD property #39. Try again when TXC is available.");
    const inputs = coins.filter(u => u.status.confirmed).map(u => ({ ...holder, txid: u.txid, vout: u.vout, value: u.value }));
    const previous: Record<string, string> = {};
    for (const u of inputs) previous[`${u.txid}:${u.vout}`] = await chainIo("txc").txHex(u.txid);
    const built = buildVaultTsdPsbt({ pairing, recipient: to, amount, balance: balance.balance, feeRate: Math.ceil(fees.halfHourFee), inputs, prevTxHex: previous });
    await assertTsdSession();
    setStep({ name: "show", payload: built.psbtBase64, expected: [{ address: built.intent.recipient, valueSats: 10_000 }], tsdIntent: built.intent });
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      if (tsd) await buildTsd();
      else if (isEvm) await buildEvm();
      else await buildUtxo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onScanned(code: string) {
    if (processing.current || step.name !== "show") return;
    try {
      const full = collector.current.add(code);
      setScanError(null);
      setScanProgress({ ...collector.current.progress, received: collector.current.receivedParts });
      if (!full) return; // waiting for more frames
      collector.current = new PartCollector();
      processing.current = true;
      setScanComplete(true);
      setBusy(true);
      setError(null);
      try {
        if (isEvm) {
          const hex = full.trim();
          if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error("That QR code didn't contain a signed transaction.");
          await verifyVaultEvmSend(hex as `0x${string}`, JSON.parse(step.payload) as EvmIntent);
          const pub = evmClient(evmChain);
          const hash = await pub.sendRawTransaction({ serializedTransaction: hex as `0x${string}` });
          setStep({ name: "done", txid: hash });
        } else {
          const txid = step.tsdIntent ? verifyVaultTsdSigned(full, step.payload) : verifySignedAgainstPsbt(full, step.payload);
          verifySignedTx(full, chain as VaultUtxoChain, step.expected);
          const io = chainIo(chain as VaultUtxoChain);
          if (step.tsdIntent) {
            await assertTsdSession();
            const { Psbt } = await import("bitcoinjs-lib");
            const psbt = Psbt.fromBase64(step.payload);
            const checks = await Promise.all(psbt.txInputs.map(input => {
              const txid = Array.from(input.hash).reverse().map(b => b.toString(16).padStart(2, "0")).join("");
              return getOutspend(txid, input.index);
            }));
            if (checks.some(c => c.spent)) throw new Error("TXC inputs were already spent. Prepare a new TSD transfer.");
            const bal = await fetchBalance({ data: { address: step.tsdIntent.sender, propertyId: 39 } });
            const { tsdBalanceUnits } = await import("@/lib/vault-link/tsd-send");
            if (tsdBalanceUnits(bal.balance) < tsdBalanceUnits(step.tsdIntent.amount)) throw new Error("The TSD balance changed. Prepare a new transfer.");
            await assertTsdSession();
          }
          const realTxid = await io.broadcast(full.trim());
          setStep({ name: "done", txid: realTxid || txid });
        }
      } catch (e) {
        processing.current = false;
        setError((e as Error).message);
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

  const unit = tsd ? "TSD" : isEvm ? EVM_CHAINS[evmChain].nativeSymbol : meta?.unit ?? "";
  const vaultNetworkName = isEvm ? "EVM" : (chain as string).toUpperCase();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90dvh] overflow-y-auto",
          // The desktop code is drawn about twice as large, so the panel
          // widens to keep all of it on screen.
          desktop ? "max-w-[680px]" : "max-w-md",
        )}
      >
        <DialogHeader>
          <DialogTitle>Send {tsd ? "TSD on TXC" : isEvm ? "EVM" : meta?.name} via Vault</DialogTitle>
          <DialogDescription>
            The transaction is prepared here and signed on your Vault device by QR.
          </DialogDescription>
        </DialogHeader>

        {step.name === "form" && (
          <div className="space-y-3">
            {isEvm && (
              <div className="space-y-1">
                <Label>Network</Label>
                <Select value={evmChain} onValueChange={(v) => setEvmChain(v as EvmChainId)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(EVM_CHAINS).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isEvm && !tsd && chainScans.length > 1 && (
              <div className="space-y-1">
                <Label>Address type</Label>
                <Select value={String(activePurpose)} onValueChange={(v) => setPurpose(Number(v) as 44 | 49 | 84)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {chainScans.map((s) => (
                      <SelectItem key={s.purpose} value={String(s.purpose)}>
                        {s.purpose === 84 ? "Native segwit" : s.purpose === 49 ? "Wrapped segwit" : "Legacy"} ·{" "}
                        {(s.balanceSats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isEvm && !tsd && activeScan && (
              <p className="text-xs text-muted-foreground">
                Available: {(activeScan.balanceSats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {unit}
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="vault-send-to">To</Label>
              <div className="flex gap-2">
                <Input id="vault-send-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={isEvm ? "0x…" : "Address"} className="font-mono text-xs" />
                <QrScanButton onScan={(t) => setTo(t.replace(/^[a-z]+:/i, "").split("?")[0])} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vault-send-amount">Amount ({unit})</Label>
              <Input id="vault-send-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button onClick={build} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Prepare for Vault signing"}
            </Button>
          </div>
        )}

        {step.name === "show" && (
          <div className="space-y-3">
            {step.tsdIntent && <dl className="space-y-2 border-b border-border pb-3 text-sm">
              <div><dt className="text-muted-foreground">TSD · TXC Omni #39</dt><dd className="font-semibold">{step.tsdIntent.amount} TSD</dd></div>
              <div><dt className="text-muted-foreground">Recipient</dt><dd className="break-all font-mono text-xs">{step.tsdIntent.recipient}</dd></div>
              <div><dt className="text-muted-foreground">From · TXC address #0</dt><dd className="break-all font-mono text-xs">{step.tsdIntent.sender}</dd></div>
              <div><dt className="text-muted-foreground">TXC network fee</dt><dd>{step.tsdIntent.feeSats / SATS} TXC</dd></div>
              <div><dt className="text-muted-foreground">TXC accompanying payment</dt><dd>0.0001 TXC</dd></div>
              <div><dt className="text-muted-foreground">Change to address #0</dt><dd>{step.tsdIntent.changeSats / SATS} TXC</dd></div>
            </dl>}
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>On your Vault device, choose <span className="font-medium text-foreground">{vaultNetworkName}</span> and tap Scan.</li>
              <li>Point it at this code and review the payment on the Vault screen.</li>
              <li>After signing, scan the Vault's signed-transaction QR below.</li>
            </ol>
            <VaultAnimatedQr text={step.payload} />
            <div className="flex items-center gap-2">
              {!busy && <QrScanButton continuous onScan={(t) => void onScanned(t)} progress={scanProgress} complete={scanComplete} scanError={scanError} onScanStart={resetScan} />}
              <span className="text-xs text-muted-foreground">
                {busy ? "Checking and broadcasting…" : scanProgress && scanProgress.total > 0 && !scanComplete ? `Reading signed transaction: ${scanProgress.have} of ${scanProgress.total} parts` : "Scan the signed transaction from Vault"}
              </span>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { resetScan(); processing.current = false; setStep({ name: "form" }); }}>
              Back
            </Button>
          </div>
        )}

        {step.name === "done" && (
          <div className="space-y-3">
            <p className="text-sm">Broadcast to the network.</p>
            <TxidCard txid={step.txid} />
            <Button className="w-full" onClick={() => { toast.success("Sent"); onClose(); }}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
