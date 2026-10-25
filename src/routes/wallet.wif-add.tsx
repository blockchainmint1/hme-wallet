import { createFileRoute } from "@tanstack/react-router";
import { PrivateKeyForm } from "@/components/wallet/management/PrivateKeyForm";
export const Route = createFileRoute("/wallet/wif-add")({
  head: () => ({ meta: [{ title: "Import private key — Honest Money" }, { name: "description", content: "Add an encrypted private-key address to Honest Money." }, { property: "og:title", content: "Import private key — Honest Money" }, { property: "og:description", content: "Add an encrypted private-key address to Honest Money." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PrivateKeyForm,
});

