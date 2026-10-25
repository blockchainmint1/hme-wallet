import { createFileRoute } from "@tanstack/react-router";
import { WatchAddressForm } from "@/components/wallet/management/WatchAddressForm";
export const Route = createFileRoute("/wallet/watch-add")({
  head: () => ({ meta: [{ title: "Add watch-only wallet — HME Wallet" }] }),
  component: WatchAddressForm,
});

