import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowUpRight, ArrowDownLeft, RefreshCw, ChartNoAxesCombined } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesktopData, type DesktopAsset } from "./DesktopData";
import { Activity } from "./Activity";
import { AssetIcon, assetChain } from "./Holdings";
import { formatFiat } from "@/lib/txc/units";
import { readCurrencyHistory, currencyHistoryKey, type CurrencyPoint } from "@/lib/desktop/currency-history";

const descriptions: Record<string, string> = {
  txc: "TEXITcoin is an independent blockchain with TXC as its native coin. TXC is used for payments and network fees, including transactions carrying TSD on the Omni layer.",
  btc: "Bitcoin is a decentralized digital currency secured by proof of work. BTC can be held and transferred without a custodian, with transactions recorded on the Bitcoin blockchain.",
  isk: "IskanderCoin is an independent blockchain. ISK is its native coin, used for transfers and network transaction fees.",
  zcu: "Zero Chill is an independent, EVM-compatible layer-1 blockchain. ZCU is its native coin, used for transfers and network fees.",
  ltc: "Litecoin is a proof-of-work blockchain designed for peer-to-peer payments. LTC is the native coin used for transfers and network fees.",
  doge: "Dogecoin is a proof-of-work cryptocurrency used for peer-to-peer payments. DOGE is its native coin and pays transaction fees on the Dogecoin network.",
  eth: "Ethereum is a smart-contract blockchain. ETH is its native asset and pays the network fees for transfers, tokens and applications.",
  base: "Base is an Ethereum layer-2 network. ETH pays its transaction fees; assets on Base are separate from assets on Ethereum mainnet.",
  bsc: "BNB Smart Chain is an EVM-compatible smart-contract network. BNB is its native asset and pays network transaction fees.",
  tron: "Tron is a smart-contract blockchain. TRX is its native coin; transactions use the network's bandwidth and energy resources.",
  solana: "Solana is a smart-contract blockchain. SOL is its native asset, used for transfers and transaction fees.",
  tsd: "Texas Stable Dollar is a token on TEXITcoin's Omni layer, redeemable 1:1 for USDC. TSD transfers require TXC for network fees. Redemption and issuer risks remain separate from self-custody.",
};
function description(asset: DesktopAsset) {
  if (descriptions[asset.key]) return descriptions[asset.key];
  return `${asset.symbol} is a dollar-linked token on ${asset.name.replace(`${asset.symbol} (`, "").replace(/\)$/, "")}. Its displayed value uses a $1 peg estimate, not a live market quote. Issuer, redemption and network risks apply.`;
}
function CurrencyChart({ asset }: { asset: DesktopAsset }) {
  const d = useDesktopData();
  const [points, setPoints] = useState<CurrencyPoint[]>([]);
  const [range, setRange] = useState("1M");
  const [metric, setMetric] = useState<"usd" | "price">("usd");
  const key = d.historyId ? currencyHistoryKey(d.activeProfileId, d.historyId, asset.key) : null;
  useEffect(() => {
    const read = () => setPoints(key ? readCurrencyHistory(key) : []);
    read(); window.addEventListener("hme:currency-history", read);
    return () => window.removeEventListener("hme:currency-history", read);
  }, [key]);
  const days = range === "1D" ? 1 : range === "1W" ? 7 : range === "1M" ? 30 : range === "1Y" ? 365 : Infinity;
  const visible = points.filter(p => p.at >= Date.now() - days * 86400000 && (metric !== "price" || p.price !== null));
  return <section className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1" role="group" aria-label="Chart value"><Button size="sm" variant={metric === "usd" ? "secondary" : "ghost"} aria-pressed={metric === "usd"} onClick={() => setMetric("usd")}>Your holding value</Button><Button size="sm" variant={metric === "price" ? "secondary" : "ghost"} aria-pressed={metric === "price"} onClick={() => setMetric("price")}>Coin price</Button></div>
      <div className="flex gap-1" role="group" aria-label="Chart period">{["1D", "1W", "1M", "1Y", "ALL"].map(r => <Button key={r} variant={range === r ? "secondary" : "ghost"} size="sm" className="px-2 text-xs" aria-pressed={range === r} onClick={() => setRange(r)}>{r}</Button>)}</div>
    </div>
    <div className="mt-6 h-72">
      {d.hidden ? <div className="flex h-full items-center justify-center text-muted-foreground">History hidden</div> : visible.length < 2 ? <div className="flex h-full flex-col items-center justify-center gap-3 border-y border-dashed border-border text-muted-foreground"><ChartNoAxesCombined className="h-9 w-9"/><p className="text-sm">{visible.length ? "First observation recorded" : "No observations yet"}</p></div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={visible}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4"/><XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={n => new Date(n).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}/><YAxis width={76} tickFormatter={n => formatFiat(n)} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}/><Tooltip labelFormatter={n => new Date(Number(n)).toLocaleString()} formatter={n => formatFiat(Number(n))} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}/><Area type="linear" dataKey={metric} name={metric === "usd" ? "Holding value" : "Coin price"} stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} strokeWidth={2}/></AreaChart></ResponsiveContainer>}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{asset.stable ? "Price uses a $1 peg estimate · " : ""}Device observations · no past values invented{!d.hidden && visible[0] ? ` · since ${new Date(visible[0].at).toLocaleDateString()}` : ""}</p>
    {!d.hidden && (asset.amount === null || (asset.amount > 0 && asset.usd === null)) && <p role="status" className="mt-2 text-xs text-muted-foreground">History paused · {asset.symbol} balance or price unavailable</p>}
  </section>;
}
export function CurrencyPage({ currency }: { currency: string }) {
  const d = useDesktopData();
  const asset = d.rows.find(r => r.key.toLowerCase() === currency.toLowerCase());
  if (!asset) return <><Button asChild variant="ghost"><Link to="/desktop"><ArrowLeft className="h-4 w-4"/>Portfolio</Link></Button><h1 className="mt-6 text-3xl font-semibold">Currency unavailable</h1><p className="mt-3 text-muted-foreground">This asset is not available for the selected wallet and desktop networks.</p><Button asChild variant="outline" className="mt-6"><Link to="/desktop/settings">Network settings</Link></Button></>;
  return <>
    <Button asChild variant="ghost" size="sm" className="mb-5"><Link to="/desktop"><ArrowLeft className="h-4 w-4"/>Portfolio</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><AssetIcon asset={asset}/><div><h1 className="text-3xl font-semibold">{asset.name}</h1><p className="mt-1 text-xs uppercase text-muted-foreground">{asset.symbol} · {assetChain(asset)}</p></div></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/desktop/receive" search={{ asset: asset.key }}><ArrowDownLeft className="h-4 w-4"/>Receive</Link></Button><Button asChild variant="outline"><Link to="/desktop/send" search={{ asset: asset.key }}><ArrowUpRight className="h-4 w-4"/>Send</Link></Button><Button variant="ghost" size="icon" title="Refresh balances and prices" aria-label="Refresh balances and prices" disabled={d.loading} onClick={() => void d.refresh()}><RefreshCw className={`h-4 w-4 ${d.loading ? "animate-spin" : ""}`}/></Button></div></div>
    <div className="my-8 grid gap-6 border-y border-border py-6 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Your holding value</p><p className="mt-2 text-3xl font-semibold tabular-nums">{d.hidden ? "$••••••" : asset.usd === null ? "Unavailable" : formatFiat(asset.usd)}</p></div><div><p className="text-xs text-muted-foreground">Your balance</p><p className="mt-2 text-xl font-semibold tabular-nums break-words">{d.hidden ? "••••" : asset.amount === null ? "Unavailable" : asset.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {asset.symbol}</p></div><div><p className="text-xs text-muted-foreground">{asset.stable ? "Peg estimate" : "Current coin price"}</p><p className="mt-2 text-xl font-semibold tabular-nums">{asset.price === null ? "Unavailable" : formatFiat(asset.price)}</p></div></div>
    <CurrencyChart key={`${d.activeProfileId}:${d.historyId}:${asset.key}`} asset={asset}/>
    <section className="mt-10 border-y border-border py-6"><h2 className="text-lg font-semibold">About {asset.name}</h2><p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description(asset)}</p></section>
    <section className="mt-6"><Activity key={`${d.activeProfileId}:${asset.key}`} chainFilter={assetChain(asset)} assetFilter={asset.key}/></section>
  </>;
}