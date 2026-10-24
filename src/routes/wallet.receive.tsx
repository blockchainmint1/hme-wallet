import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReceivePage } from "@/components/wallet/shared/txc-receive";
import { z } from "zod";
const searchSchema = z.object({ asset: z.enum(["txc", "tsd"]).optional() });
export const Route = createFileRoute("/wallet/receive")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Receive TXC — HME Wallet" }, { name: "description", content: "Receive TXC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Receive TXC — HME Wallet" }, { property: "og:description", content: "Receive TXC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MobileReceive,
});
function MobileReceive() { return <ReceivePage asset={Route.useSearch().asset} />; }
