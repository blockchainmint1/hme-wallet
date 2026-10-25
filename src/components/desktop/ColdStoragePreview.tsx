import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { Eye, ShieldCheck, RefreshCw, ChevronDown, ChevronUp, Plus, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/txc/wallet-context";
import { useHideBalances } from "@/lib/hide-balances";
import { watchChangedEvent } from "@/lib/watch-only";
import { WATCH_CHAIN_META, watchApi } from "@/lib/watch/chain-io";
import { EVM_CHAINS, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { readErc20Balance, tokenAmountFromRaw } from "@/lib/chains/erc20";
import { getEnabledTokens } from "@/lib/token-prefs";
import { VAULT_UTXO_CHAINS } from "@/lib/vault-link/pairing";
import { vaultHasChain } from "@/lib/vault-link/snapshot";
import { addressBalance, coldStorageEntries, previewVaultBalance } from "@/lib/desktop/cold-storage";

type Entries = ReturnType<typeof coldStorageEntries>;
function Balance({ value, symbol, error, pending, stale }: { value?: string; symbol: string; error: boolean; pending: boolean; stale: boolean }) {
  const [hidden] = useHideBalances();
  return <div className="text-right"><p className="break-all font-mono text-sm">{hidden ? "••••" : value !== undefined ? `${value} ${symbol}` : pending ? "Loading…" : "Unavailable"}</p>{(error || stale) && <p className="mt-1 text-xs text-muted-foreground">{value !== undefined ? "Last known · update unavailable" : "Could not load balance"}</p>}</div>;
}
function WatchPreview({ entry }: { entry: Entries["watches"][number] }) {
  const { wallet, profile } = entry;
  const meta = WATCH_CHAIN_META[wallet.chain];
  const q = useQuery({ queryKey: ["cold-storage-watch", profile.id, wallet.chain, wallet.address], queryFn: async () => addressBalance(await watchApi(wallet.chain).getAddressStats(wallet.address)), staleTime: 300_000, retry: 1 });
  return <article className="rounded-lg border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><Eye className="h-5 w-5 shrink-0 text-primary"/><div className="min-w-0"><h3 className="break-words font-semibold">{wallet.label}</h3><p className="mt-1 text-xs text-muted-foreground">Watch-only · {meta.label}</p></div></div><Button variant="ghost" size="icon" title="Refresh address balance" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`}/></Button></div><div className="mt-5 border-t border-border pt-4"><Balance value={q.data === undefined ? undefined : meta.formatCompact(q.data)} symbol={meta.ticker} error={q.isError} pending={q.isPending} stale={q.isRefetchError}/></div><a href={("explorerAddressUrl" in meta.api ? meta.api.explorerAddressUrl(wallet.address) : EVM_CHAINS.zcu.explorerAddress(wallet.address))} target="_blank" rel="noreferrer" className="mt-4 block break-all font-mono text-xs text-muted-foreground hover:text-primary">{wallet.address}</a><p className="mt-3 text-xs text-muted-foreground">Linked to {profile.label}</p></article>;
}
function VaultPreview({ entry }: { entry: Entries["vaults"][number] }) {
  const { profile, pairing } = entry;
  const [expanded, setExpanded] = useState(false);
  const [, setRevision] = useState(0);
  useEffect(() => { const h = () => setRevision(v => v + 1); window.addEventListener("hme:tokens-changed", h); return () => window.removeEventListener("hme:tokens-changed", h); }, []);
  const utxo = pairing ? VAULT_UTXO_CHAINS.filter(chain => vaultHasChain(pairing, chain)) : [];
  const evm = pairing?.evm;
  const networks = evm ? Object.keys(EVM_CHAINS) as EvmChainId[] : [];
  const rows = [
    ...utxo.map(chain => ({ id: chain, label: WATCH_CHAIN_META[chain].label, symbol: WATCH_CHAIN_META[chain].ticker, read: async () => { if (!pairing) throw new Error("Not paired"); return WATCH_CHAIN_META[chain].formatCompact(await previewVaultBalance(pairing, chain)); } })),
    ...networks.flatMap(chain => [
      { id: `${chain}-native`, label: EVM_CHAINS[chain].name, symbol: EVM_CHAINS[chain].nativeSymbol, read: async () => { if (!evm) throw new Error("Not paired"); return formatEther(await evmClient(chain).getBalance({ address: evm.address as `0x${string}` })); } },
      ...getEnabledTokens(chain).map(token => ({ id: `${chain}-${token.address.toLowerCase()}`, label: `${token.symbol} · ${EVM_CHAINS[chain].name}`, symbol: token.symbol, read: async () => { if (!evm) throw new Error("Not paired"); return tokenAmountFromRaw(await readErc20Balance(chain, token, evm.address as `0x${string}`), token.decimals); } })),
    ]),
  ];
  const queries = useQueries({ queries: rows.map(row => ({ queryKey: ["cold-storage-vault", profile.id, pairing?.fp, JSON.stringify(pairing), row.id], queryFn: row.read, enabled: expanded && !!pairing, staleTime: 300_000, retry: 1 })) });
  return <article className="rounded-lg border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-primary"/><div className="min-w-0"><h3 className="break-words font-semibold">{profile.label}</h3><p className="mt-1 text-xs text-muted-foreground">HME Vault · Offline QR signing{profile.isActive ? " · Selected" : ""}</p></div></div>{expanded && <Button variant="ghost" size="icon" title="Refresh Vault balances" disabled={queries.some(q => q.isFetching)} onClick={() => queries.forEach(q => void q.refetch())}><RefreshCw className="h-4 w-4"/></Button>}</div>{pairing ? <><div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><span>Fingerprint <span className="font-mono text-foreground">{pairing.fp}</span></span><span>Paired {new Date(pairing.pairedAt).toLocaleDateString()}</span></div><p className="mt-3 text-sm text-muted-foreground">{[...utxo.map(c => WATCH_CHAIN_META[c].ticker), ...networks.map(c => EVM_CHAINS[c].name)].join(" · ")}</p>{evm && <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{evm.address}</p>}<Button variant="outline" className="mt-5 w-full justify-between" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "Hide balances" : "View balances"}{expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</Button>{expanded && <div className="mt-4 divide-y divide-border">{rows.map((row, i) => { const q = queries[i]; return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm">{row.label}</span><Balance value={q?.data} symbol={row.symbol} pending={q?.isPending ?? true} error={q?.isError ?? false} stale={q?.isRefetchError ?? false}/></div>; })}</div>}</> : <p className="mt-5 text-sm text-muted-foreground">Pairing data unavailable.</p>}</article>;
}
export function ColdStoragePreview() {
  const { profiles } = useWallet();
  const [entries, setEntries] = useState<Entries>({ watches: [], vaults: [] });
  useEffect(() => { const refresh = () => setEntries(coldStorageEntries(profiles)); refresh(); window.addEventListener(watchChangedEvent(), refresh); window.addEventListener("storage", refresh); return () => { window.removeEventListener(watchChangedEvent(), refresh); window.removeEventListener("storage", refresh); }; }, [profiles]);
  const empty = !entries.watches.length && !entries.vaults.length;
  return <><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-chart-2"/><h1 className="text-3xl font-semibold">Cold Storage</h1></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/desktop/watch-add"><Plus className="h-4 w-4"/>Track a coin or address</Link></Button><Button asChild><Link to="/desktop/vault-add"><QrCode className="h-4 w-4"/>Pair HME Vault</Link></Button></div></div>{empty ? <section className="mt-10 border-y border-border py-12"><h2 className="text-xl font-semibold">No cold storage linked yet</h2><p className="mt-3 text-sm text-muted-foreground">Cold Storage Coins, watch-only addresses and paired HME Vaults will appear here.</p></section> : <>{entries.watches.length > 0 && <section className="mt-10"><h2 className="mb-5 text-lg font-semibold">Coins & watch-only addresses</h2><div className="grid items-start gap-4 xl:grid-cols-2">{entries.watches.map(entry => <WatchPreview key={`${entry.profile.id}:${entry.wallet.id}`} entry={entry}/>)}</div></section>}{entries.vaults.length > 0 && <section className="mt-10"><h2 className="mb-5 text-lg font-semibold">Paired HME Vaults</h2><div className="grid items-start gap-4 xl:grid-cols-2">{entries.vaults.map(entry => <VaultPreview key={entry.profile.id} entry={entry}/>)}</div></section>}</>}</>;
}