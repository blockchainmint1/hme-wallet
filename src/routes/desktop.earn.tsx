import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Address } from "viem";
import { useWallet } from "@/lib/txc/wallet-context";
import { EarnAsset } from "@/components/desktop/EarnAsset";
import { desktopHead } from "@/components/desktop/metadata";
import { loadPairing } from "@/lib/vault-link/pairing";
export const Route=createFileRoute("/desktop/earn")({head:()=>desktopHead("Earn","Non-custodial yield assets, starting with sUSDS, with transparent risks and review-gated execution."),component:Page});
function Page(){
  const { seed, unlocked, activeProfileId } = useWallet();
  const address = useMemo(() => {
    if (unlocked?.mode === "vault") return (loadPairing(activeProfileId)?.evm?.address as Address | undefined) ?? null;
    return null;
  }, [unlocked?.mode, activeProfileId]);
  return <><h1 className="text-3xl font-semibold">Earn</h1><p className="mt-3 max-w-2xl text-sm text-muted-foreground">Sky savings and Aave lending · Ethereum. Variable returns; smart-contract, stablecoin and liquidity risks apply.</p><EarnPageAssets seed={seed} vaultAddress={address}/></>;
}
