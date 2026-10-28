import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { UtxoSwap } from "@/components/wallet/UtxoSwap";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { desktopSwapAvailable } from "@/lib/desktop/policy";
import { useFeature } from "@/lib/feature-prefs";
import { desktopHead } from "@/components/desktop/metadata";
import { ThorUsdcBtc } from "@/components/desktop/ThorUsdcBtc";
type SwapCoin = "ltc" | "doge" | "eth" | "base" | "bsc" | "usdc-eth" | "usdc-base";
export const Route = createFileRoute("/desktop/swap")({
  validateSearch: (s: Record<string, unknown>): { coin?: SwapCoin } => ({ coin: s.coin === "ltc" || s.coin === "doge" || s.coin === "eth" || s.coin === "base" || s.coin === "bsc" || s.coin === "usdc-eth" || s.coin === "usdc-base" ? s.coin : undefined }),
  head: () => desktopHead("Swap", "Compare LTC and DOGE stablecoin routes and preview direct THORChain USDC-to-Bitcoin quotes on Ethereum and Base."), component: Page,
});
function Page() {
  const { coin: chosenCoin } = Route.useSearch();
  const coin = chosenCoin ?? "doge";
  const d = useDesktopData();
  const navigate = useNavigate();
  const [utxoSwapOn] = useFeature("utxoSwap");
  const [evmSwapOn] = useFeature("evmSwap");
  const utxo = coin === "ltc" || coin === "doge";
  const thorNetwork = coin === "usdc-eth" ? "eth" : coin === "usdc-base" ? "base" : null;
  return <><h1 className="text-3xl font-semibold">Swap</h1><div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]"><aside><label className="mb-2 block text-xs text-muted-foreground">Pay with</label><Select value={coin} onValueChange={value => { if (value === "ltc" || value === "doge" || value === "eth" || value === "base" || value === "bsc" || value === "usdc-eth" || value === "usdc-base") void navigate({ to: "/desktop/swap", search: { coin: value } }); }}><SelectTrigger aria-label="Swap source network"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="usdc-eth">USDC · Ethereum → BTC</SelectItem><SelectItem value="usdc-base">USDC · Base → BTC</SelectItem><SelectItem value="doge">Dogecoin · DOGE</SelectItem><SelectItem value="ltc">Litecoin · LTC</SelectItem>{evmSwapOn && <><SelectItem value="eth">Ethereum · paused</SelectItem><SelectItem value="base">Base · paused</SelectItem><SelectItem value="bsc">BNB Chain · paused</SelectItem></>}</SelectContent></Select><p className="mt-4 text-xs text-muted-foreground">EVM aggregator swaps remain paused pending independent review.</p></aside><section className="desktop-payment min-w-0 border-t border-border lg:border-l lg:border-t-0 lg:pl-8">{d.isVault ? <div className="py-8"><h2 className="text-xl font-semibold">Cold Storage swaps are paused</h2><p className="mt-3 text-sm text-muted-foreground">The Vault device’s readable swap approval, transaction ordering and final safety checks need coordinated corrections before another swap can be signed.</p></div> : thorNetwork ? !d.enabled.includes(thorNetwork) ? <div className="py-8"><p className="text-sm text-muted-foreground">Enable {thorNetwork === "eth" ? "Ethereum" : "Base"} in desktop network settings.</p><SettingsLink/></div> : <ThorUsdcBtc key={`${d.activeProfileId}:${thorNetwork}`} network={thorNetwork}/> : !utxo ? <div className="py-8"><h2 className="text-xl font-semibold">EVM swaps are paused</h2><p className="mt-3 text-sm text-muted-foreground">Ethereum, Base and BNB Chain swaps require independent contract and transaction safety review before execution is enabled.</p></div> : !utxoSwapOn ? <div className="py-8"><p className="text-sm text-muted-foreground">LTC / DOGE swaps are turned off in this desktop wallet.</p><SettingsLink/></div> : !desktopSwapAvailable("seed", d.enabled.includes(coin)) ? <div className="py-8"><p className="text-sm text-muted-foreground">Enable {coin.toUpperCase()} in desktop network settings to swap.</p><SettingsLink/></div> : <UtxoSwap coin={coin} backTo="/desktop"/>}</section></div></>;
}
function SettingsLink() { return <Button asChild variant="outline" className="mt-4"><Link to="/desktop/settings">Desktop settings</Link></Button>; }
