import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveDogePage } from "@/components/wallet/shared/doge-receive";
export const Route = createFileRoute("/wallet/doge/receive")({
  head: () => ({ meta: [{ title: "Receive DOGE — HME Wallet" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveDogePage  />; }
