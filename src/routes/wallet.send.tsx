import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendPage } from "@/components/wallet/shared/txc-send";
const searchSchema = z.object({
  to: z.string().optional(),
  amount: z.string().optional(),
  /** Optional Omni property id to preselect the token picker. */
  token: z.string().optional(),
});

export const Route = createFileRoute("/wallet/send")({
  head: () => ({ meta: [{ title: "Send TXC — HME Wallet" }, { name: "description", content: "Send TXC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Send TXC — HME Wallet" }, { property: "og:description", content: "Send TXC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendPage search={search} />; }
