import { createFileRoute } from "@tanstack/react-router";
import { SharedWalletsForm } from "@/components/wallet/management/SharedWalletsForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/shared")({ head: () => desktopHead("Shared wallets", "Shared wallets in the Honest Money desktop workspace, preserving existing wallets."), component: Page });
function Page() { return <SharedWalletsForm desktop add/>; }
