import { createFileRoute, notFound } from "@tanstack/react-router";
import { EvmReceive } from "@/components/wallet/shared/evm-receive";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
export const Route = createFileRoute("/wallet/evm/$chain/receive")({
  head: () => ({ meta: [{ title: "Receive EVM coins and tokens — HME Wallet" }, { name: "description", content: "Receive coins and tokens at your HME Wallet or paired HME Vault address." }, { property: "og:title", content: "Receive EVM coins and tokens — HME Wallet" }, { property: "og:description", content: "Receive coins and tokens at your wallet address." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: MobileReceive,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});
function MobileReceive() { return <EvmReceive chain={Route.useParams().chain as EvmChainId} />; }
