import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveLtcPage } from "@/components/wallet/shared/ltc-receive";
export const Route = createFileRoute("/wallet/ltc/receive")({
  head: () => ({ meta: [{ title: "Receive LTC — HME Wallet" }, { name: "description", content: "Receive LTC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Receive LTC — HME Wallet" }, { property: "og:description", content: "Receive LTC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveLtcPage  />; }
