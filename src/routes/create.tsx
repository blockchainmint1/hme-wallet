import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletForm } from "@/components/wallet/management/CreateWalletForm";
export const Route = createFileRoute("/create")({
  // ?add=true creates an ADDITIONAL wallet profile (vault) instead of
  // replacing the wallet on this device.
  validateSearch: (search: Record<string, unknown>): { add?: boolean } => ({
    add: search.add === true || search.add === "true" || search.add === "1" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Create wallet — HME Wallet" },
      { name: "description", content: "Generate a new wallet and back up the seed phrase." },
    ],
  }),
  component: Page,
});
function Page() { const { add } = Route.useSearch(); return <CreateWalletForm add={add}/>; }
