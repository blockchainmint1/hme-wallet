import { createFileRoute } from "@tanstack/react-router";
import { WatchAddressForm } from "@/components/wallet/management/WatchAddressForm";
export const Route = createFileRoute("/wallet/watch-add")({
  head: () => ({ meta: [{ title: "Track an address — Honest Money" }, { name: "description", content: "Track a public address without importing keys in Honest Money." }, { property: "og:title", content: "Track an address — Honest Money" }, { property: "og:description", content: "Track a public address without importing keys in Honest Money." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: WatchAddressForm,
});

