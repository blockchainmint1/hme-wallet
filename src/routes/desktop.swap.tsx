import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { useFeature } from "@/lib/feature-prefs";
import { desktopHead } from "@/components/desktop/metadata";
import { ThorSwap } from "@/components/desktop/ThorSwap";
import { TsdBridgeSwap } from "@/components/desktop/TsdBridgeSwap";
import { useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";

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
    </>
  );
}
