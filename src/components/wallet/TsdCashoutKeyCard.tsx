/**
 * Settings card for the TSD Swap API key.
 *
 * Pasting a key from tsd.honest.money turns on "Cash out to USDC" on the TSD
 * send screen; removing it turns the feature back off. The key also carries
 * the account's fee tier, so there are no coupon codes in the wallet.
 *
 * Available on all supported platforms when a cash-out key is configured.
 */
import { useEffect, useState } from "react";
import { ArrowDownUp, Check, Info, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import {
  TSD_API_KEY_RE,
  cashoutKeyConflictNoticePending,
  dismissCashoutKeyConflictNotice,
  maskKey,
  useCashoutApiKey,
} from "@/lib/cashout/api-key";
import { DEFAULT_PROFILE_ID, activeProfileId } from "@/lib/profiles";

export function TsdCashoutKeyCard({ compact }: { compact?: boolean }) {
  const allowed = useExchangeFeaturesAllowed();
  const [key, setKey] = useCashoutApiKey();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One-time notice, shown on the first wallet (whose slot held the old key).
  const [conflictNotice, setConflictNotice] = useState(false);
  useEffect(() => {
    setConflictNotice(activeProfileId() === DEFAULT_PROFILE_ID && cashoutKeyConflictNoticePending());
  }, [key]);

  if (!allowed) return null;

  function save() {
    const v = input.trim();
    if (!TSD_API_KEY_RE.test(v)) {
      setError("That doesn't look like a TSD Swap API key. Copy it again from your account page.");
      return;
    }
    setError(null);
    setKey(v);
    setInput("");
  }

  return (
    <Card
      className={compact ? "rounded-none border-0 bg-transparent shadow-none" : "mt-5"}
    >
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5" /> TSD cash-out
          </CardTitle>
          <CardDescription>
            Turn TSD into USDC on Ethereum from the send screen. Create an account at
            tsd.honest.money, mint an API key on your account page, and paste it here. Your account
            decides the redemption fee — no codes needed.
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className={compact ? "p-0" : undefined}>
        {conflictNotice && (
          <div className="mb-3 flex gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <p>
                An older version of the app kept one cash-out key for every wallet on this device. We
                couldn't tell which wallet it belonged to, so we removed it from this wallet. If this
                wallet should cash out, paste its key again. Removing it here doesn't revoke it at TSD
                Swap.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  dismissCashoutKeyConflictNotice();
                  setConflictNotice(false);
                }}
              >
                Got it
              </Button>
            </div>
          </div>
        )}
        {key ? (
          <>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <Check className="h-4 w-4" /> Connected
            </span>
            <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
              {maskKey(key)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setKey(null)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Saved for this wallet only. Removing it here doesn't revoke it at TSD Swap.
          </p>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="tsd_live_…"
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="button" onClick={save} disabled={!input.trim()}>
                Save
              </Button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              Saved for this wallet only, on this device. It can create redemption orders that pay out to an address
              you type here — it can't move funds on its own.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
