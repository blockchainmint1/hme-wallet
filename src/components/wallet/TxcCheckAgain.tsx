import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  finishTxcBroadcast,
  malformedTxcBroadcastKeys,
  pendingTxcBroadcasts,
  type TxcPendingBroadcast,
} from "@/lib/txc/broadcast-journal";
import { recheckTxcAttempt } from "@/lib/txc/broadcast-recheck";

export function CheckAgainButton({
  checking,
  onCheck,
}: {
  checking: boolean;
  onCheck: () => void | Promise<void>;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-3"
      disabled={checking}
      onClick={() => void onCheck()}
    >
      <RefreshCw className={checking ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
      {checking ? "Checking…" : "Check again"}
    </Button>
  );
}

/** Lists unconfirmed TXC payments held in this browser and lets the member re-check them. */
export function TxcPendingPayments() {
  const [items, setItems] = useState<TxcPendingBroadcast[]>([]);
  const [bad, setBad] = useState(0);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    try {
      setItems(pendingTxcBroadcasts());
      setBad(malformedTxcBroadcastKeys().length);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(load, [load]);
  if (items.length === 0 && bad === 0) return null;
  async function check() {
    setChecking(true);
    let unknown = 0;
    try {
      for (const it of items) {
        const r = await recheckTxcAttempt(it.txid, it.inputs, it.attemptedAt);
        if (r === "unknown") unknown++;
        else finishTxcBroadcast(it.txid);
      }
      setNote(
        unknown
          ? "Still can't tell whether some payments went out. Try again in a few minutes."
          : "All checked. Those coins are free to use again.",
      );
    } finally {
      setChecking(false);
      load();
    }
  }
  return (
    <div role="status" className="rounded-md border border-destructive/40 p-3 text-sm">
      {items.length > 0 && (
        <p>
          {items.length} TXC payment{items.length === 1 ? " was" : "s were"} not confirmed. Its
          coins stay locked until a check shows whether it was sent.
        </p>
      )}
      {bad > 0 && (
        <p className="text-muted-foreground">
          {bad} unreadable payment record{bad === 1 ? " was" : "s were"} skipped.
        </p>
      )}
      {note && <p className="text-muted-foreground">{note}</p>}
      {items.length > 0 && <CheckAgainButton checking={checking} onCheck={check} />}
    </div>
  );
}
