import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SolanaSend } from "@/components/wallet/shared/solana-send";
export const Route = createFileRoute("/wallet/solana/send")({
  head: () => ({ meta: [
    { title: "Send SOL — HME Wallet" },
    { name: "description", content: "Send native SOL from your self-custodial honest.money wallet." },
    { property: "og:title", content: "Send SOL — HME Wallet" },
    { property: "og:description", content: "Send native SOL from your self-custodial honest.money wallet." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MobileSend,
});
function MobileSend() { return <SolanaSend />; }
