import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TronSend } from "@/components/wallet/shared/tron-send";
export const Route = createFileRoute("/wallet/tron/send")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
      { title: "Send TRX & USDT — honest.money" },
      {
        name: "description",
        content: "Send TRX or USDT-TRC20 from your self-custodial honest.money wallet.",
      },
      { property: "og:title", content: "Send TRX & USDT — honest.money" },
      {
        property: "og:description",
        content: "Send TRX or USDT-TRC20 from your self-custodial honest.money wallet.",
      },
    ],
  }),
  component: MobileSend,
});
function MobileSend() { return <TronSend />; }
