import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletForm } from "@/components/wallet/management/CreateWalletForm";
export const Route = createFileRoute("/create")({
  // ?add=true creates an ADDITIONAL wallet profile (vault) instead of
  // replacing the wallet on this device.
  validateSearch: (search: Record<string, unknown>): { add?: boolean } => ({
    add: search.add === true || search.add === "true" || search.add === "1" ? true : undefined,
  }),
  head: () => ({ meta: [{ title: "Create wallet — Honest Money" }, { name: "description", content: "Create and back up an Honest Money seed wallet." }, { property: "og:title", content: "Create wallet — Honest Money" }, { property: "og:description", content: "Create and back up an Honest Money seed wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Page,
});
function Page() { const { add } = Route.useSearch(); return <CreateWalletForm add={add}/>; }
