import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { useFeature } from "@/lib/feature-prefs";
import { desktopHead } from "@/components/desktop/metadata";
import { ThorSwap } from "@/components/desktop/ThorSwap";

export const Route = createFileRoute("/desktop/swap")({
  head: () =>
    desktopHead(
      "Swap",
      "Swap between Bitcoin, Dogecoin, Litecoin, Ethereum, Base, BNB Chain and stablecoins with live native THORChain quotes, signed on this device.",
    ),
  component: Page,
});

function Page() {
  const d = useDesktopData();
  const [utxoSwapOn] = useFeature("utxoSwap");
  const [evmSwapOn] = useFeature("evmSwap");
  const anyEnabled = utxoSwapOn || evmSwapOn;
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
          <ThorSwap key={d.activeProfileId} />
        )}
      </div>
    </>
  );
}
