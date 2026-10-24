import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendIskPage } from "@/components/wallet/shared/isk-send";
const searchSchema = z.object({
  to: z.string().optional(),
  amount: z.string().optional(),
});

export const Route = createFileRoute("/wallet/isk/send")({
  head: () => ({ meta: [{ title: "Send ISK — HME Wallet" }, { name: "description", content: "Send ISK using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Send ISK — HME Wallet" }, { property: "og:description", content: "Send ISK using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendIskPage search={search} />; }
