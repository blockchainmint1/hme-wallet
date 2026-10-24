import { createFileRoute } from "@tanstack/react-router";
import { Holdings } from "@/components/desktop/Holdings";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { formatFiat } from "@/lib/txc/units";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/stablecoins")({head:()=>desktopHead("Stablecoins","TSD, USDC, USDT and PYUSD balances separated by network."),component:Page});
function Page(){const d=useDesktopData();const total=d.rows.filter(r=>r.stable).reduce((s,r)=>s+(r.usd??0),0);return <><h1 className="text-3xl font-semibold">Stablecoins</h1><p className="mt-6 text-xs text-muted-foreground">Dollar-peg estimate</p><p className="mt-2 text-4xl font-semibold">{d.hidden?"$••••":formatFiat(total)}</p><p className="mt-3 max-w-xl text-sm text-muted-foreground">Dollar pegs are estimates, not guaranteed market prices. Balances and receiving networks are separate.</p><div className="mt-8"><Holdings stableOnly/></div></>;}
