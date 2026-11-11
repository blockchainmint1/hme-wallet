/**
 * Live status of a one-time TSD cash-out order on the "Sent" screen. Polls
 * TSD Swap every 10 seconds until the order finishes, then shows the USDC
 * payout transaction.
 */
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { getCashoutOrder } from "@/lib/cashout/tsd.functions";
import { cashoutStatusLabel, isTerminalCashoutStatus } from "@/lib/cashout/tsd";

export function CashoutOrderTracker({ apiKey, orderId }: { apiKey: string; orderId: string }) {
  const fetchOrder = useServerFn(getCashoutOrder);
  const order = useQuery({
    queryKey: ["tsd-cashout-order", orderId],
    queryFn: () => fetchOrder({ data: { apiKey, id: orderId } }),
    refetchInterval: (q) =>
      q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 10_000,
    retry: 2,
  });
  const status = order.data?.status;
  const done = status ? isTerminalCashoutStatus(status) : false;
  const hash = order.data?.releaseTxHash;

  return (
    <div className="mt-3 space-y-1 border-t border-primary/20 pt-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Order status</span>
        <span className="flex items-center gap-1.5 font-medium">
          {!done && <Loader2 className="h-3 w-3 animate-spin" />}
          {status ? cashoutStatusLabel(status) : order.isError ? "Couldn't check" : "Checking…"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Order</span>
        <span className="break-all font-mono">{orderId}</span>
      </div>
      {hash && /^0x[0-9a-fA-F]{64}$/.test(hash) && (
        <a
          href={`https://etherscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          View USDC payout <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
