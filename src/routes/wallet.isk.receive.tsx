import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceiveIskPage } from "@/components/wallet/shared/isk-receive";
export const Route = createFileRoute("/wallet/isk/receive")({
  head: () => ({ meta: [{ title: "Receive ISK — HME Wallet" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceiveIskPage  />; }
