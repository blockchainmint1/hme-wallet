import { createFileRoute } from "@tanstack/react-router";
import { ImportWalletForm } from "@/components/wallet/management/ImportWalletForm";
export const Route = createFileRoute("/import")({
  // ?add=true imports into an ADDITIONAL wallet profile (vault) instead of
  // replacing the wallet on this device.
  validateSearch: (search: Record<string, unknown>): { add?: boolean } => ({
    add: search.add === true || search.add === "true" || search.add === "1" ? true : undefined,
  }),
  head: () => ({ meta: [{ title: "Import wallet — Honest Money" }, { name: "description", content: "Import an existing seed into Honest Money." }, { property: "og:title", content: "Import wallet — Honest Money" }, { property: "og:description", content: "Import an existing seed into Honest Money." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Page,
});
function Page() { const { add } = Route.useSearch(); return <ImportWalletForm add={add}/>; }
