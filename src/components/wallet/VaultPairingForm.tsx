/**
 * Vault pairing form, shared by the phone route (/vault-add) and the desktop
 * route (/desktop/vault-add). Scan (or paste) the HME Vault watch-only pairing
 * QR, confirm the derived addresses, then save as a new profile. We store only
 * account xpubs + fingerprint — every signature happens on the Vault device.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/lib/txc/wallet-context";
import { createVaultWallet, saveWalletToNewProfile } from "@/lib/txc/storage";
import { getSessionPassword } from "@/lib/txc/session-cache";
import { parsePairing, savePairing, type VaultPairing } from "@/lib/vault-link/pairing";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { setActiveProfileId } from "@/lib/profiles";
import { pairingPreviewAddresses, VAULT_CHAIN_META } from "@/lib/vault-link/derive";

export function VaultPairingForm({ doneTo = "/wallet", backTo, backLabel = "Back to wallet" }: {
  /** Where to navigate after the wallet is saved. */
  doneTo?: string;
  /** Optional back button target; omit to hide the button. */
  backTo?: string;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  const { loadFromMemory, refreshProfiles, unlocked: currentWallet, activeProfileId } = useWallet();
  const [raw, setRaw] = useState("");
  const [pairing, setPairing] = useState<VaultPairing | null>(null);
  const [label, setLabel] = useState("Vault");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ have: number; total: number; received?: number[] } | null>(null);
  const collectorRef = useRef<PartCollector | null>(null);

  function tryParse(text: string) {
    setError(null);
    try {
      setPairing(parsePairing(text));
    } catch (e) {
      setPairing(null);
      setError((e as Error).message);
    }
  }

  // Vault shows the pairing payload as an animated QR when it's long: each
  // frame is one HMQR2 chunk. Collect frames until the transfer completes,
  // then parse the reassembled payload. Single-frame codes parse directly.
  function onScanned(text: string) {
    if (pairing) return;
    if (!text.startsWith("HMQR")) {
      setRaw(text);
      tryParse(text);
      return;
    }
    try {
      const collector = (collectorRef.current ??= new PartCollector());
      const done = collector.add(text);
      setScanProgress({ ...collector.progress, received: collector.receivedParts });
      if (done) {
        collectorRef.current = null;
        setScanProgress(null);
        setRaw(done);
        tryParse(done);
      }
    } catch (e) {
      collectorRef.current = null;
      setScanProgress(null);
      setError((e as Error).message);
    }
  }

  async function create() {
    if (!pairing) return;
    const password = getSessionPassword();
    if (!password) {
      setError("Your session has locked. Go back, unlock your wallet, and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const unlocked = await createVaultWallet(label.trim() || "Vault");
      const profileId = await saveWalletToNewProfile(unlocked, password);
      savePairing(profileId, pairing);
      // Adding a wallet must not hijack the screen: switch back to the wallet
      // the user was on, so their coins stay exactly where they were. The new
      // Vault wallet waits in the selector.
      if (currentWallet && activeProfileId !== profileId) {
        setActiveProfileId(activeProfileId);
        await loadFromMemory(currentWallet);
      } else {
        await loadFromMemory(unlocked);
      }
      refreshProfiles();
      toast.success("Vault wallet added — find it in the wallet selector");
      void navigate({ to: doneTo });
    } catch (e) {
      setError((e as Error).message || "Couldn't create the Vault wallet.");
    } finally {
      setBusy(false);
    }
  }

  const preview = pairing ? pairingPreviewAddresses(pairing) : [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Add a Vault wallet
          </CardTitle>
          <CardDescription>
            Pair with HME Vault, the offline signing app. This wallet can see balances and prepare
            payments, but every signature happens on the Vault device — no seed or private key is
            ever stored here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pairing && (
            <>
              <p className="text-sm text-muted-foreground">
                On your Vault device, open the wallet and choose{" "}
                <span className="font-medium text-foreground">Share watch-only keys</span>, then
                scan the QR it shows.
              </p>
              <div className="flex items-center gap-2">
                <QrScanButton continuous onScan={onScanned} progress={scanProgress} complete={Boolean(pairing)} onScanStart={() => {
                  collectorRef.current = null;
                  setScanProgress(null);
                  setError(null);
                }} />
                <span className="text-xs text-muted-foreground">
                  {scanProgress && scanProgress.total > 1
                    ? `Reading animated QR… part ${scanProgress.have} of ${scanProgress.total} — keep pointing`
                    : "Scan the Vault pairing QR"}
                </span>
              </div>
              {scanProgress && <Progress value={100 * scanProgress.have / scanProgress.total} aria-label="Pairing progress" />}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">…or paste the pairing code:</p>
                <Textarea
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    if (e.target.value.trim()) tryParse(e.target.value);
                    else {
                      setPairing(null);
                      setError(null);
                    }
                  }}
                  placeholder='{"hmvault":1,…}'
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            </>
          )}

          {pairing && (
            <>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
                <p className="text-sm">
                  Wallet fingerprint: <span className="font-mono font-medium">{pairing.fp}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Check this matches what your Vault device shows. If it doesn't, cancel — you may
                  be pairing with the wrong device.
                </p>
                <div className="space-y-1 pt-1">
                  {preview.map((p) => (
                    <div key={`${p.chain}-${p.purpose}`} className="text-xs">
                      <span className="text-muted-foreground">
                        {VAULT_CHAIN_META[p.chain].unit} ·{" "}
                        {p.purpose === 84 ? "segwit" : p.purpose === 49 ? "wrapped" : "legacy"}:
                      </span>{" "}
                      <span className="font-mono break-all">{p.address}</span>
                    </div>
                  ))}
                  {pairing.evm && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">ETH/EVM:</span>{" "}
                      <span className="font-mono break-all">{pairing.evm.address}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confirm the first address of each chain matches the address shown on your Vault
                  device.
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Name for this wallet</p>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
              </div>

              <div className="flex gap-2">
                <Button onClick={create} disabled={busy} className="flex-1">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4 mr-2" />}
                  {busy ? "Adding…" : "Add Vault wallet"}
                </Button>
                <Button variant="ghost" onClick={() => { setPairing(null); setRaw(""); setError(null); collectorRef.current = null; setScanProgress(null); }}>
                  Start over
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {backTo && (
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: backTo })}>
          {backLabel}
        </Button>
      )}
    </>
  );
}
