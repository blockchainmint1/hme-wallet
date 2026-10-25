import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletForm } from "@/components/wallet/management/CreateWalletForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/create")({ head: () => desktopHead("Create wallet", "Create wallet in the Honest Money desktop workspace, preserving existing wallets."), component: Page });
function Page() { return <CreateWalletForm desktop add/>; }
