import { createFileRoute } from "@tanstack/react-router";
import { DesktopAddWallet } from "@/components/desktop/WalletManagement";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/wallet-add")({head:()=>desktopHead("Add wallet","Create, import or pair a wallet in Honest Money Desktop without replacing existing wallets."),component:DesktopAddWallet});
