import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { EvmSend } from "@/components/wallet/shared/evm-send";
const searchSchema = z.object({
  asset: z.string().optional(),
  to: z.string().optional(),
  amount: z.string().optional(),
});

export const Route = createFileRoute("/wallet/evm/$chain/send")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw),
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
    return {};
  },
  head: ({ params }) => {
    const name = EVM_CHAINS[params.chain as EvmChainId]?.name ?? "Ethereum";
    const title = `Send on ${name} — HME Wallet`;
    const description = `Send ${name} coins and tokens with HME Wallet, including offline signing through HME Vault.`;
    return { meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] };
  },
  component: MobileEvmSend,
});
function MobileEvmSend() { const { chain } = Route.useParams(); return <EvmSend chain={chain as EvmChainId} search={Route.useSearch()} />; }
