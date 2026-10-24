import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveBtcPage } from "@/components/wallet/shared/btc-receive";
export const Route = createFileRoute("/wallet/btc/receive")({
  head: () => ({ meta: [{ title: "Receive BTC — HME Wallet" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveBtcPage  />; }
