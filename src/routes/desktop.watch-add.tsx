import { createFileRoute } from "@tanstack/react-router";
import { WatchAddressForm } from "@/components/wallet/management/WatchAddressForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/watch-add")({ head: () => desktopHead("Add watch-only address", "Add watch-only address in the Honest Money desktop workspace, preserving existing wallets."), component: Page });
function Page() { return <WatchAddressForm desktop add/>; }
