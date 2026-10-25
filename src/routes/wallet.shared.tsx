import { createFileRoute } from "@tanstack/react-router";
import { SharedWalletsForm } from "@/components/wallet/management/SharedWalletsForm";
export const Route = createFileRoute("/wallet/shared")({
  head: () => ({ meta: [{ title: "Shared wallets — Honest Money" }, { name: "description", content: "Manage isolated trading pockets and NectarPay tap cards in Honest Money." }, { property: "og:title", content: "Shared wallets — Honest Money" }, { property: "og:description", content: "Manage isolated trading pockets and NectarPay tap cards in Honest Money." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SharedWalletsForm,
});

