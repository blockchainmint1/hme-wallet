import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceivePage } from "@/components/wallet/shared/txc-receive";
import { z } from "zod";
const searchSchema = z.object({ asset: z.enum(["txc", "tsd"]).optional() });
export const Route = createFileRoute("/wallet/receive")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Receive — HME Wallet" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceivePage asset={Route.useSearch().asset} />; }
