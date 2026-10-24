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
  head: () => ({ meta: [{ title: "Send — HME Wallet" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendPage search={search} />; }
