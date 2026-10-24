import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveDogePage } from "@/components/wallet/shared/doge-receive";
export const Route = createFileRoute("/wallet/doge/receive")({
  head: () => ({ meta: [{ title: "Receive DOGE — HME Wallet" }, { name: "description", content: "Receive DOGE using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Receive DOGE — HME Wallet" }, { property: "og:description", content: "Receive DOGE using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveDogePage  />; }
