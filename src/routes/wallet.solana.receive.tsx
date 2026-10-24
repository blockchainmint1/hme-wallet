import { createFileRoute, notFound } from "@tanstack/react-router";
import { SolanaReceive } from "@/components/wallet/shared/solana-receive";
export const Route = createFileRoute("/wallet/solana/receive")({
  head: () => ({ meta: [
    { title: "Receive SOL — HME Wallet" },
    { name: "description", content: "Receive native SOL into your self-custodial honest.money wallet." },
    { property: "og:title", content: "Receive SOL — HME Wallet" },
    { property: "og:description", content: "Receive native SOL into your self-custodial honest.money wallet." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MobileReceive,
});
function MobileReceive() { return <SolanaReceive  />; }
