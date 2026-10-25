import { createFileRoute } from "@tanstack/react-router";
import { PrivateKeyForm } from "@/components/wallet/management/PrivateKeyForm";
export const Route = createFileRoute("/wallet/wif-add")({
  head: () => ({ meta: [{ title: "Import Private Key — HME Wallet" }] }),
  component: PrivateKeyForm,
});

