import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendDogePage } from "@/components/wallet/shared/doge-send";
const searchSchema = z.object({ to: z.string().optional(), amount: z.string().optional() });

export const Route = createFileRoute("/wallet/doge/send")({
  head: () => ({ meta: [{ title: "Send DOGE — HME Wallet" }, { name: "description", content: "Send DOGE using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Send DOGE — HME Wallet" }, { property: "og:description", content: "Send DOGE using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendDogePage search={search} />; }
