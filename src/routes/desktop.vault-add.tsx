import { createFileRoute } from "@tanstack/react-router";
import { VaultPairingForm } from "@/components/wallet/VaultPairingForm";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/vault-add")({head:()=>desktopHead("Pair Cold Storage","Pair an HME Vault offline signer by QR code to add a cold storage wallet."),component:Page});
function Page(){return <div className="max-w-2xl"><VaultPairingForm doneTo="/desktop/vault" backTo="/desktop/vault" backLabel="Back to Cold Storage"/></div>;}
