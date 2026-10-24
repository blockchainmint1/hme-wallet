import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveLtcPage } from "@/components/wallet/shared/ltc-receive";
export const Route = createFileRoute("/wallet/ltc/receive")({
  head: () => ({ meta: [{ title: "Receive LTC — HME Wallet" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveLtcPage  />; }
