import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveIskPage } from "@/components/wallet/shared/isk-receive";
export const Route = createFileRoute("/wallet/isk/receive")({
  head: () => ({ meta: [{ title: "Receive ISK — HME Wallet" }, { name: "description", content: "Receive ISK using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Receive ISK — HME Wallet" }, { property: "og:description", content: "Receive ISK using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveIskPage  />; }
