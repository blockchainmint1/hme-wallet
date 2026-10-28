import { createFileRoute } from "@tanstack/react-router";
import { ChainsCard } from "@/components/wallet/ChainsCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useFeature, type FeatureId } from "@/lib/feature-prefs";
import { useWallet } from "@/lib/txc/wallet-context";
import { desktopHead } from "@/components/desktop/metadata";
import { TokensCard } from "@/components/wallet/TokensCard";
import { TxcTokensCard } from "@/components/wallet/TxcTokensCard";

export const Route = createFileRoute("/desktop/settings")({
  head: () => desktopHead("Settings", "Desktop network and wallet feature choices for Honest Money, independent of phone settings."),
  component: DesktopSettings,
});
const features: { id: FeatureId; label: string }[] = [
  { id: "utxoSwap", label: "BTC / LTC / DOGE swaps" },
  { id: "evmSwap", label: "EVM swaps · THORChain router only (LI.FI paused)" },
  { id: "sharedWallets", label: "Shared wallet visibility" },
  { id: "confirmLast4", label: "Confirm last 4 of recipient address" },
  { id: "hideSpamTokens", label: "Hide spam tokens" },
  { id: "tsdConsolidateNudge", label: "TSD consolidation reminders" },
];
function FeatureChoice({ id, label }: { id: FeatureId; label: string }) {
  const [on, setOn] = useFeature(id);
  return <div className="flex items-center justify-between gap-4 border-b border-border py-4"><Label htmlFor={`desktop-${id}`}>{label}</Label><Switch id={`desktop-${id}`} checked={on} onCheckedChange={setOn}/></div>;
}
function DesktopSettings() {
  const { unlocked } = useWallet();
  return <><h1 className="text-3xl font-semibold">Desktop settings</h1><p className="mt-3 text-sm text-muted-foreground">Desktop network and feature choices are separate from Phone view. Site connections still require your approval.</p><div className="mt-10 grid gap-10 lg:grid-cols-2"><section><h2 className="mb-6 text-xl font-semibold">This desktop · networks</h2><ChainsCard compact/></section><section><h2 className="mb-2 text-xl font-semibold">This desktop wallet · {unlocked?.label || "My wallet"}</h2>{features.map(f => <FeatureChoice key={f.id} {...f}/>)}</section></div><div className="mt-12 grid gap-10 border-t border-border pt-8 lg:grid-cols-2"><section aria-labelledby="desktop-txc-tokens"><p className="text-xs text-muted-foreground">This device · shared with Phone view</p><h2 id="desktop-txc-tokens" className="mb-6 mt-2 text-xl font-semibold">TXC Omni tokens</h2><TxcTokensCard compact/></section><section aria-labelledby="desktop-evm-tokens"><p className="text-xs text-muted-foreground">This device · shared with Phone view</p><h2 id="desktop-evm-tokens" className="mb-6 mt-2 text-xl font-semibold">EVM & Base tokens</h2><TokensCard compact showSpamToggle={false}/></section></div></>;
}