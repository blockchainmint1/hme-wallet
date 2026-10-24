import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendBtcPage } from "@/components/wallet/shared/btc-send";
const searchSchema = z.object({ to: z.string().optional(), amount: z.string().optional() });

export const Route = createFileRoute("/wallet/btc/send")({
  head: () => ({ meta: [{ title: "Send BTC — HME Wallet" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendBtcPage search={search} />; }
