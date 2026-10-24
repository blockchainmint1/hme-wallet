import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveBtcPage } from "@/components/wallet/shared/btc-receive";
export const Route = createFileRoute("/wallet/btc/receive")({
  head: () => ({ meta: [{ title: "Receive BTC — HME Wallet" }, { name: "description", content: "Receive BTC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Receive BTC — HME Wallet" }, { property: "og:description", content: "Receive BTC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveBtcPage  />; }
