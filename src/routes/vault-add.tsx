/**
 * Add a Vault wallet: pair with an HME Vault device by scanning its
 * watch-only pairing QR. We store only account xpubs + fingerprint — this
 * profile can see balances and build transactions, but every signature
 * happens on the Vault device.
 */
import { createFileRoute } from "@tanstack/react-router";
import { VaultPairingForm } from "@/components/wallet/VaultPairingForm";

export const Route = createFileRoute("/vault-add")({
  head: () => ({
    meta: [
      { title: "Add a Vault wallet — HME Wallet" },
      { name: "description", content: "Pair an HME Vault offline signer by QR code." },
      { property: "og:title", content: "Add a Vault wallet — HME Wallet" },
      { property: "og:description", content: "Pair an HME Vault offline signer by QR code." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultAddPage,
});

function VaultAddPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <VaultPairingForm doneTo="/wallet" backTo="/wallet" />
    </div>
  );
}
