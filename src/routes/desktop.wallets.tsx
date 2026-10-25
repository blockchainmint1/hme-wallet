import { createFileRoute } from "@tanstack/react-router";
import { DesktopWalletManagement } from "@/components/desktop/WalletManagement";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/wallets")({head:()=>desktopHead("Your wallets","Manage independent wallets, names and cold storage in Honest Money Desktop."),component:DesktopWalletManagement});
