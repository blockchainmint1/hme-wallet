import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendLtcPage } from "@/components/wallet/shared/ltc-send";
const searchSchema = z.object({ to: z.string().optional(), amount: z.string().optional() });

export const Route = createFileRoute("/wallet/ltc/send")({
  head: () => ({ meta: [{ title: "Send LTC — HME Wallet" }, { name: "description", content: "Send LTC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Send LTC — HME Wallet" }, { property: "og:description", content: "Send LTC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendLtcPage search={search} />; }
