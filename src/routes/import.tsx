import { createFileRoute } from "@tanstack/react-router";
import { ImportWalletForm } from "@/components/wallet/management/ImportWalletForm";
export const Route = createFileRoute("/import")({
  // ?add=true imports into an ADDITIONAL wallet profile (vault) instead of
  // replacing the wallet on this device.
  validateSearch: (search: Record<string, unknown>): { add?: boolean } => ({
    add: search.add === true || search.add === "true" || search.add === "1" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Import wallet — HME Wallet" },
      {
        name: "description",
        content: "Import your existing TEXITcoin seed phrase from the old TXC Wallet app.",
      },
    ],
  }),
  component: Page,
});
function Page() { const { add } = Route.useSearch(); return <ImportWalletForm add={add}/>; }
