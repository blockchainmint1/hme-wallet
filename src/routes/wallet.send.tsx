import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SendPage } from "@/components/wallet/shared/txc-send";
import { useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { loadPairing } from "@/lib/vault-link/pairing";
import { VaultBottomActions } from "@/components/wallet/VaultBottomActions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const searchSchema = z.object({
  to: z.string().optional(),
  amount: z.string().optional(),
  /** Optional Omni property id to preselect the token picker. */
  token: z.string().optional(),
});

export const Route = createFileRoute("/wallet/send")({
  head: () => ({ meta: [{ title: "Send TXC — HME Wallet" }, { name: "description", content: "Send TXC using your self-custodial Honest Money wallet." }, { property: "og:title", content: "Send TXC — HME Wallet" }, { property: "og:description", content: "Send TXC using your self-custodial Honest Money wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (raw) => searchSchema.parse(raw),
  component: MobileSend,
});
function MobileSend() {
  const search = Route.useSearch();
  const { unlocked, activeProfileId } = useWallet();
  const [asset, setAsset] = useState(search.token === "39" ? "tsd" : "txc");
  if (unlocked?.mode !== "vault") return <SendPage search={search} />;
  const pairing = loadPairing(activeProfileId);
  return <section className="p-4 space-y-6"><h1 className="text-2xl font-semibold">Send via Vault</h1>
    <Select value={asset} onValueChange={setAsset}><SelectTrigger aria-label="Vault send asset"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="txc">TEXITcoin · TXC</SelectItem><SelectItem value="tsd">Texas Stable Dollar · TSD</SelectItem></SelectContent></Select>
    {pairing ? <VaultBottomActions key={`${activeProfileId}:${asset}`} pairing={pairing} chain="txc" receiveAddress={null} action="send" tsd={asset === "tsd"} /> : <p className="text-muted-foreground">Pair TXC with your Vault first.</p>}
  </section>;
}
