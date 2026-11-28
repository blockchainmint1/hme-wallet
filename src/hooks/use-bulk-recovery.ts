import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { findBroadcastTx } from "@/lib/txc/mempool";
import { recoverBulkSteps, type BulkSavedStep } from "@/lib/txc/bulk-send";

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
}
