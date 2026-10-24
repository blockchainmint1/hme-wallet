import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendLtcPage } from "@/components/wallet/shared/ltc-send";
const searchSchema = z.object({ to: z.string().optional(), amount: z.string().optional() });

export const Route = createFileRoute("/wallet/ltc/send")({
  head: () => ({ meta: [{ title: "Send LTC — HME Wallet" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendLtcPage search={search} />; }
