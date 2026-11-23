import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { useFeature } from "@/lib/feature-prefs";
import { desktopHead } from "@/components/desktop/metadata";
import { ThorSwap } from "@/components/desktop/ThorSwap";
import { TsdBridgeSwap } from "@/components/desktop/TsdBridgeSwap";
import { SwapHistory } from "@/components/desktop/SwapHistory";
import { useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import { VaultRoundUp } from "@/components/desktop/VaultRoundUp";
import type { MintSourceId } from "@/lib/cashout/mint";

export const Route = createFileRoute("/desktop/swap")({
  head: () =>
    desktopHead(
      "Swap",
      "Swap between Bitcoin, Dogecoin, Litecoin, Ethereum, Base, BNB Chain and stablecoins with live THORChain quotes, or buy and sell TSD through TSD Bridge — signed on this device.",
    ),
  component: Page,
});

function Page() {
  const d = useDesktopData();
  const [utxoSwapOn] = useFeature("utxoSwap");
  const [evmSwapOn] = useFeature("evmSwap");
  const anyEnabled = utxoSwapOn || evmSwapOn;
  const { unlocked } = useWallet();
  const exchangeAllowed = useExchangeFeaturesAllowed();
  const [tsd, setTsd] = useState<"mint" | "redeem" | null>(null);
  // TSD Bridge routes sign on this device only; Vault and watch-only stay on ThorSwap's own gates.
  const tsdAllowed = exchangeAllowed && !d.isVault && unlocked?.mode !== "vault" && unlocked?.mode !== "keyonly";
  // Vault: Buy TSD only, from Ethereum/Base address #0, signed on HME Vault.
  const vaultTsd = exchangeAllowed && d.isVault && unlocked?.mode === "vault";
  const [vaultBuy, setVaultBuy] = useState<{ sourceId: MintSourceId; amount: string } | null>(null);
  if (vaultTsd) {
    return (
      <>
        <h1 className="text-3xl font-semibold">Swap</h1>
        <div className="mt-8">
          {vaultBuy ? (
            <>
            <Button variant="ghost" size="sm" className="mb-4 px-0" onClick={() => setVaultBuy(null)}>← Back to round-up</Button>
            <TsdBridgeSwap
              key={`${d.activeProfileId}:${vaultBuy.sourceId}:${vaultBuy.amount}`}
              vaultMode
              direction="mint"
              evmSwapOn={evmSwapOn}
              initialSourceId={vaultBuy.sourceId}
              initialAmount={vaultBuy.amount}
              onDirection={() => undefined}
              onLeave={() => setVaultBuy(null)}
            />
            </>
          ) : (
            <>
              <VaultRoundUp key={d.activeProfileId} profileId={d.activeProfileId} onBuy={(sourceId, amount) => setVaultBuy({ sourceId, amount })} />
              {anyEnabled && <ThorSwap key={d.activeProfileId} utxoSwapOn={utxoSwapOn} evmSwapOn={evmSwapOn} />}
            </>
          )}
        </div>
        <SwapHistory key={d.activeProfileId} />
      </>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Swap</h1>
      <div className="mt-8">
        {!anyEnabled && !d.isVault ? (
          <div className="py-8">
            <p className="text-sm text-muted-foreground">Swaps are turned off in this desktop wallet.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/desktop/settings">Desktop settings</Link>
            </Button>
          </div>
        ) : (
          tsd && tsdAllowed ? (
            <TsdBridgeSwap
              key={d.activeProfileId}
              direction={tsd}
              evmSwapOn={evmSwapOn}
              onDirection={setTsd}
              onLeave={() => setTsd(null)}
            />
          ) : (
            <ThorSwap
              key={d.activeProfileId}
              utxoSwapOn={utxoSwapOn}
              evmSwapOn={evmSwapOn}
              onTsd={tsdAllowed ? setTsd : undefined}
            />
          )
        )}
      </div>
      <SwapHistory key={d.activeProfileId} />
    </>
  );
}
