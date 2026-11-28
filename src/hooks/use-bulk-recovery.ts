import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { findBroadcastTx } from "@/lib/txc/mempool";
import { finishTxcBroadcast } from "@/lib/txc/broadcast-journal";
import { recheckTxcAttempt } from "@/lib/txc/broadcast-recheck";
import { recoverBulkSteps, releaseNotSentSteps, type BulkSavedStep } from "@/lib/txc/bulk-send";

/** Recovery only reads the network. Unknown/missing IDs keep the run blocked. */
export function useBulkRecovery(
  key: string | null,
  asset: string,
  steps: BulkSavedStep[],
  setSteps: Dispatch<SetStateAction<BulkSavedStep[]>>,
  setError: Dispatch<SetStateAction<string>>,
) {
  const ids = useMemo(
    () => steps.flatMap((s) => (s.status === "uncertain" && s.txid ? [s.txid] : [])),
    [steps],
  );
  const query = useQuery({
    queryKey: ["bulk-tx-recovery", key, ids.join(",")],
    enabled: !!key && ids.length > 0,
    queryFn: async () =>
      (
        await Promise.all(
          ids.map(async (id) => {
            try {
              return (await findBroadcastTx(id)) ? id : null;
            } catch {
              return null;
            }
          }),
        )
      ).filter((id): id is string => id !== null),
    refetchInterval: 15_000,
  });
  useEffect(() => {
    if (query.data?.length) {
      setSteps((prev) => recoverBulkSteps(prev, query.data ?? [], asset));
      if (ids.every((id) => query.data?.includes(id))) {
        setError((prev) => (prev.startsWith("Sending was not confirmed.") ? "" : prev));
      }
    }
  }, [query.data, setSteps, setError, asset, ids]);
  const [checking, setChecking] = useState(false);
  /** User-triggered: frees a step only on txid 404 AND every reserved input unspent. */
  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      const targets = steps.filter((s) => s.status === "uncertain" && s.txid);
      const sent: string[] = [];
      const notSent: string[] = [];
      for (const s of targets) {
        const r = await recheckTxcAttempt(s.txid!, s.spent ?? []);
        if (r === "sent") sent.push(s.txid!);
        if (r === "not-sent") {
          notSent.push(s.txid!);
          try {
            finishTxcBroadcast(s.txid!);
          } catch {
            /* journal unavailable */
          }
        }
      }
      setSteps((prev) => releaseNotSentSteps(recoverBulkSteps(prev, sent, asset), notSent));
      if (sent.length + notSent.length === targets.length)
        setError((prev) => (prev.startsWith("Sending was not confirmed.") ? "" : prev));
      else
        setError(
          "Sending was not confirmed. Still can't tell whether this payment went out; try Check again later.",
        );
    } finally {
      setChecking(false);
    }
  }, [steps, setSteps, setError, asset]);
  return { checkAgain, checking, hasUncertain: ids.length > 0 };
}
