import { useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ChartNoAxesCombined, CircleDollarSign, Globe2, History, Landmark, LockKeyhole, Menu, PanelLeftClose, ShieldCheck, Smartphone, Settings, Eye, EyeOff } from "lucide-react";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileSwitcher } from "@/components/wallet/ProfileSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { setPreferPhone } from "@/lib/desktop-pref";
import { useHideBalances } from "@/lib/hide-balances";
import { useFeature } from "@/lib/feature-prefs";
import { DesktopDataProvider } from "./DesktopData";
import mark from "@/assets/brand/dollar-mark-dark.png";
const pages = [
  {to:"/desktop", label:"Portfolio", icon:ChartNoAxesCombined},
  {to:"/desktop/activity", label:"Transactions", icon:History},
  {to:"/desktop/send", label:"Send", icon:ArrowUpRight},
  {to:"/desktop/receive", label:"Receive", icon:ArrowDownLeft},
  {to:"/desktop/swap", label:"Swap", icon:ArrowLeftRight},
  {to:"/desktop/stablecoins", label:"Stablecoins", icon:CircleDollarSign},
  {to:"/desktop/earn", label:"Earn", icon:Landmark},
  {to:"/desktop/vault", label:"Cold Storage", icon:ShieldCheck},
  {to:"/desktop/apps", label:"Apps & links", icon:Globe2},
] as const;
export function DesktopShell() {
  const { unlocked, unlock, lock, activeProfileId } = useWallet();
  const [password,setPassword]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [collapsed,setCollapsed]=useState(false);
  const [hidden,setHidden]=useHideBalances();
  const [utxoSwapOn]=useFeature("utxoSwap");
  if (!unlocked) return <main className="flex flex-1 items-center justify-center px-6 py-12"><div className="w-full max-w-sm"><img src={mark} alt="Honest Money" className="mb-6 h-14 w-14 object-contain"/><h1 className="text-3xl font-semibold">Honest Money</h1><p className="mt-2 text-muted-foreground">Unlock your desktop wallet</p><form className="mt-8 space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try {if (!await unlock(password))setError("Wrong password, or no wallet saved in this browser.");else setPassword("");}catch{setError("Could not unlock your wallet.");}finally{setBusy(false);}}}><Input aria-label="Wallet password" type="password" autoComplete="current-password" placeholder="Wallet password" value={password} onChange={e=>setPassword(e.target.value)}/>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={busy||!password}>{busy?"Unlocking…":"Unlock"}</Button></form><div className="mt-4 flex justify-between"><Button asChild variant="outline"><Link to="/import">Import wallet</Link></Button><Button asChild variant="ghost"><Link to="/" onClick={()=>setPreferPhone(true)}>Phone view</Link></Button></div></div></main>;
  return <div className="desktop-workspace flex min-h-0 flex-1 bg-background"><aside className={`flex shrink-0 flex-col border-r border-border bg-sidebar ${collapsed?"w-16":"w-60"}`}><div className="flex h-20 items-center gap-3 px-4"><img src={mark} alt="" className="h-8 w-8 object-contain"/>{!collapsed&&<div><p className="font-semibold">Honest Money</p><p className="text-xs text-muted-foreground">Your money. Your keys.</p></div>}</div>{!collapsed&&<div className="border-y border-border px-4 py-4"><ProfileSwitcher/></div>}<nav aria-label="Desktop navigation" className="flex-1 space-y-1 overflow-y-auto px-2 py-4">{pages.filter(p=>p.to!=="/desktop/swap"||utxoSwapOn).map(({to,label,icon:Icon})=><Button key={to} asChild variant="ghost" className={`h-11 w-full ${collapsed?"justify-center px-0":"justify-start px-3"}`} title={label}><Link to={to} activeOptions={{exact:true}} activeProps={{className:"bg-accent text-accent-foreground font-semibold"}}><Icon className="h-4 w-4 shrink-0"/>{!collapsed&&<span>{label}</span>}</Link></Button>)}</nav><div className="space-y-1 border-t border-border px-2 py-3"><Button asChild variant="ghost" className="w-full justify-start" title="Settings"><Link to="/desktop/settings"><Settings className="h-4 w-4"/>{!collapsed&&"Settings"}</Link></Button><Button asChild variant="ghost" className="w-full justify-start" title="Phone view"><Link to="/wallet" onClick={()=>setPreferPhone(true)}><Smartphone className="h-4 w-4"/>{!collapsed&&"Phone view"}</Link></Button></div></aside><div className="flex min-w-0 flex-1 flex-col"><header className="flex h-20 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-8"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" title={collapsed?"Expand menu":"Collapse menu"} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<Menu className="h-4 w-4"/>:<PanelLeftClose className="h-4 w-4"/>}</Button><span className="text-sm text-muted-foreground truncate">{unlocked.label||"My wallet"}</span></div><div className="flex items-center gap-1"><span className="mr-3 hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><ShieldCheck className="h-4 w-4 text-chart-2"/>{unlocked.mode==="vault"?"Offline signing":"Self-custodial"}</span><Button variant="ghost" size="icon" title={hidden?"Show balances":"Hide balances"} onClick={()=>setHidden(!hidden)}>{hidden?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</Button><ThemeToggle/><Button variant="ghost" size="icon" title="Lock wallet" onClick={lock}><LockKeyhole className="h-4 w-4"/></Button></div></header><div className="min-h-0 flex-1 overflow-y-auto"><DesktopDataProvider key={activeProfileId}><div className="mx-auto max-w-7xl p-4 sm:p-8 lg:p-10"><Outlet/></div></DesktopDataProvider><footer className="flex flex-wrap gap-4 px-8 py-6 text-xs text-muted-foreground"><span>Honest Money</span><Link to="/legal/privacy">Privacy</Link><Link to="/legal/terms">Terms</Link></footer></div></div></div>;
}
