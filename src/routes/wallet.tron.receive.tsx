import { createFileRoute, notFound } from "@tanstack/react-router";
import { TronReceive } from "@/components/wallet/shared/tron-receive";
export const Route = createFileRoute("/wallet/tron/receive")({
  head: () => ({
    meta: [
      { title: "Receive TRX & USDT — honest.money" },
      {
        name: "description",
        content: "Show your Tron address to receive TRX or USDT-TRC20 into your wallet.",
      },
      { property: "og:title", content: "Receive TRX & USDT — honest.money" },
      {
        property: "og:description",
        content: "Show your Tron address to receive TRX or USDT-TRC20 into your wallet.",
      },
    ],
  }),
  component: MobileReceive,
});
function MobileReceive() { return <TronReceive  />; }
