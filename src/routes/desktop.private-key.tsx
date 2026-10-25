import { createFileRoute } from "@tanstack/react-router";
import { PrivateKeyForm } from "@/components/wallet/management/PrivateKeyForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/private-key")({ head: () => desktopHead("Import private key", "Import private key in the Honest Money desktop workspace, preserving existing wallets."), component: Page });
function Page() { return <PrivateKeyForm desktop add/>; }
