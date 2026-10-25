import { createFileRoute } from "@tanstack/react-router";
import { ImportWalletForm } from "@/components/wallet/management/ImportWalletForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/import")({ head: () => desktopHead("Import wallet", "Import wallet in the Honest Money desktop workspace, preserving existing wallets."), component: Page });
function Page() { return <ImportWalletForm desktop add/>; }
