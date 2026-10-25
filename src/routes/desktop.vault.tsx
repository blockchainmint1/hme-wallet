import { createFileRoute } from "@tanstack/react-router";
import { ColdStoragePreview } from "@/components/desktop/ColdStoragePreview";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/vault")({ head: () => desktopHead("Cold Storage", "Preview linked Cold Storage Coins, watch-only addresses and paired HME Vault balances in Honest Money."), component: ColdStoragePreview });
