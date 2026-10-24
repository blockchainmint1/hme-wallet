import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Address } from "viem";
import { useWallet } from "@/lib/txc/wallet-context";
import { EarnAsset } from "@/components/desktop/EarnAsset";
import { desktopHead } from "@/components/desktop/metadata";
import { loadPairing } from "@/lib/vault-link/pairing";
import { earnAddress } from "@/lib/earn/address";
export const Route=createFileRoute("/desktop/earn")({head:()=>desktopHead("Earn","View Sky sUSDS savings and Aave USDC lending, live estimates and review-gated deposits and withdrawals."),component:Page});
function Page(){
  const { root, unlocked, activeProfileId } = useWallet();
  const address = useMemo(() => {
    if (unlocked?.mode === "vault") return (loadPairing(activeProfileId)?.evm?.address as Address | undefined) ?? null;
    if (!root || unlocked?.mode === "keyonly") return null;
    return earnAddress(root);
  }, [root, unlocked?.mode, activeProfileId]);
  return <><h1 className="text-3xl font-semibold">Earn</h1><p className="mt-3 max-w-2xl text-sm text-muted-foreground">Sky savings and Aave lending · Ethereum. Variable returns; smart-contract, stablecoin and liquidity risks apply.</p><EarnAsset key={`sky:${activeProfileId}`} protocol="sky" address={address}/><EarnAsset key={`aave:${activeProfileId}`} protocol="aave" address={address}/></>;
}
