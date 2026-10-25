import { createFileRoute } from "@tanstack/react-router";
import { SharedWalletsForm } from "@/components/wallet/management/SharedWalletsForm";
export const Route = createFileRoute("/wallet/shared")({
  head: () => ({
    meta: [
      { title: "Shared wallets — HME Wallet" },
      { name: "description", content: "Small wallets a partner can spend from, kept separate from your main wallet." },
    ],
  }),
  component: SharedWalletsForm,
});

