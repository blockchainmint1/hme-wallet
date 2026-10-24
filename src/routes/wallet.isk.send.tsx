import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendIskPage } from "@/components/wallet/shared/isk-send";
const searchSchema = z.object({
  to: z.string().optional(),
  amount: z.string().optional(),
});

export const Route = createFileRoute("/wallet/isk/send")({
  head: () => ({ meta: [{ title: "Send ISK — HME Wallet" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() { const search = Route.useSearch(); return <SendIskPage search={search} />; }
