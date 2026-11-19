import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatEther } from "viem";
import { Check, Copy, ExternalLink, Loader2, ShieldAlert, Sprout } from "lucide-react";
import { desktopHead } from "@/components/desktop/metadata";
import { useDesktopData } from "@/components/desktop/DesktopData";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import type { DelegateLinkRecord } from "@/lib/xpub-link/delegate";
import { useSeedsPocket } from "@/components/desktop/useSeedsPocket";
import { EXTRA_CHAIN_LABEL } from "@/lib/xpub-link/delegate-keys";
import {
  evmPocketAccount, evmPocketBalances, mainReceiveAddress, pocketAddresses, pocketXpub, sweepPocket,
  utxoPocketAddressBalances, POCKET_CHAINS, type PocketChain, type UtxoChain,
} from "@/lib/seeds/pocket";
import { evmExplorerUrl, moveBackBlockReason, utxoExplorerUrl } from "@/lib/seeds/pocket-view";
import { getTxcTokenBalancesForAddresses } from "@/lib/txc/tokens.functions";
import { TSD_PROPERTY_ID } from "@/lib/cashout/tsd";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { RevokeLinkControl, describe } from "@/components/wallet/TradingPocketCard";

export const Route = createFileRoute("/desktop/seeds")({
  head: () => desktopHead("Seeds Pocket", "See what's really in your Seeds trading pocket, straight from the blockchain, and move it back."),
  component: Page,
});

function fmt8(v: bigint): string {
  const w = v / 100_000_000n, f = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${w.toLocaleString()}${f ? "." + f : ""}`;
}

interface ChainView {
  chain: PocketChain;
  xpub: string;
  main: string;
  addresses: { address: string; path: string; sats: bigint | null }[];
  evm?: { address: string; balances: Partial<Record<EvmChainId, bigint>> };
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={label} title={label}
    onClick={() => { void navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
    {ok ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>;
}

function Page() {
  const d = useDesktopData();
  const { unlocked } = useWallet();
  const { links, found } = useSeedsPocket();
  const pockets: Pocket[] = [
    ...links.map((l) => ({ account: l.account, chains: l.chains, record: l })),
    ...found.map((a) => ({ account: a, chains: POCKET_CHAINS, record: null })),
  ];

  return <>
    <h1 className="flex items-center gap-3 text-3xl font-semibold"><Sprout className="h-7 w-7 text-primary" />Seeds Pocket</h1>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Read straight from the blockchain by your wallet — not from Seeds. Compare these with your Seeds balance, or open any address on a public explorer.</p>
    {d.isVault || !unlocked?.mnemonic
      ? <p className="mt-8 text-sm text-muted-foreground">Cold Storage wallets don't link to Seeds.</p>
      : pockets.length === 0
        ? <p className="mt-8 text-sm text-muted-foreground">This wallet isn't linked to Seeds. Link it from Apps &amp; links.</p>
        : pockets.map((p) => <PocketView key={p.record?.linkId ?? `found-${p.account}`} pocket={p} />)}
  </>;
}

/** A recorded link, or a pocket found on the blockchain at Seeds' reserved branch (record = null). */
interface Pocket { account: number; chains: PocketChain[]; record: DelegateLinkRecord | null }

function PocketView({ pocket }: { pocket: Pocket }) {
  const link = pocket.record;
  const { unlocked } = useWallet();
  const fetchTokens = useServerFn(getTxcTokenBalancesForAddresses);
  const [views, setViews] = useState<ChainView[] | null>(null);
  const [tsd, setTsd] = useState<bigint | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PocketChain[] | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      setViews(null); setTsd(undefined);
      const seed = await seedFromMnemonic(unlocked!.mnemonic!, unlocked!.passphrase ?? "");
      try {
        const base: ChainView[] = pocket.chains.map((c) => ({
          chain: c, xpub: pocketXpub(seed, c, pocket.account), main: mainReceiveAddress(seed, c),
          addresses: c === "EVM" ? [] : pocketAddresses(seed, c, pocket.account).map((a) => ({ address: a.address, path: a.path, sats: null })),
          evm: c === "EVM" ? { address: evmPocketAccount(seed, pocket.account).address, balances: {} } : undefined,
        }));
        if (live) setViews(base);
        const filled = await Promise.all(base.map(async (v) => v.chain === "EVM"
          ? { ...v, evm: { address: v.evm!.address, balances: await evmPocketBalances(seed, pocket.account) } }
          : { ...v, addresses: await utxoPocketAddressBalances(seed, v.chain as UtxoChain, pocket.account) }));
        if (live) setViews(filled);
        const txc = base.find((v) => v.chain === "TXC");
        if (txc) {
          try {
            const r = await fetchTokens({ data: { addresses: txc.addresses.map((a) => a.address), propertyIds: [TSD_PROPERTY_ID] } });
            if (live) setTsd(BigInt(r[TSD_PROPERTY_ID] ?? "0"));
          } catch { if (live) setTsd(null); }
        } else if (live) setTsd(0n);
      } finally { seed.fill(0); }
    })();
    return () => { live = false; };
  }, [pocket.account, pocket.chains, unlocked, tick, fetchTokens]);

  const extras = (link?.extraChains ?? []).map((c) => EXTRA_CHAIN_LABEL[c] ?? c);
  const tsdKnown = tsd === undefined ? null : tsd;
  const movable = pocket.chains.filter((c) => !moveBackBlockReason(c, tsdKnown));

  async function moveBack(chains: PocketChain[]) {
    setConfirm(null); setBusy(chains.join(",")); setResult(null);
    const seed = await seedFromMnemonic(unlocked!.mnemonic!, unlocked!.passphrase ?? "");
    try {
      const msg = describe(await sweepPocket(seed, pocket.account, chains).catch(() => []));
      setResult(msg); toast.success(msg, { duration: 12000 });
    } finally { seed.fill(0); setBusy(null); setTick((t) => t + 1); }
  }

  return <section className="mt-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
      <div>
        <p className="text-lg font-semibold">Pocket #{pocket.account}</p>
        {link
          ? <p className="text-sm text-muted-foreground">Linked {new Date(link.linkedAt).toLocaleDateString()} · {link.mode === "access" ? "Seeds can trade instantly (it holds spending keys)" : "You approve each trade"}</p>
          : <p className="max-w-xl text-sm text-muted-foreground">Found on the blockchain — this is the pocket honest.money reserves for Seeds, and it has activity. This wallet was linked on another device, so this computer can't revoke it. To manage the link here, link again from <Link to="/desktop/apps" className="text-primary underline">Apps &amp; links</Link> (same pocket, nothing moves), or revoke on the device that linked it.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setTick((t) => t + 1)} disabled={!!busy}>Refresh</Button>
        <Button variant="outline" disabled={!!busy || movable.length === 0} onClick={() => setConfirm(movable)}>
          {busy && busy.includes(",") && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Move everything back</Button>
        {link && <RevokeLinkControl link={link} disabled={!!busy} />}
      </div>
    </div>
    {result && <p className="text-sm text-muted-foreground">{result}</p>}

    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {(views ?? []).map((v) => {
        const block = moveBackBlockReason(v.chain, tsdKnown);
        const total = v.chain === "EVM" ? null : v.addresses.reduce<bigint | null>((s, a) => (s === null || a.sats === null ? null : s + a.sats), 0n);
        const loading = v.chain === "EVM" ? Object.keys(v.evm!.balances).length === 0 && !views : v.addresses.every((a) => a.sats === null);
        return <div key={v.chain} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{v.chain === "EVM" ? "Ethereum, Base, BNB Chain, Zero Chill" : v.chain}</p>
              {v.chain !== "EVM" && <p className="text-sm tabular-nums">{loading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : total === null ? "Some addresses couldn't be checked" : `${fmt8(total)} ${v.chain}`}</p>}
              {v.chain === "TXC" && <p className="text-sm tabular-nums">{tsd === undefined ? "Checking TSD…" : tsd === null ? "TSD: couldn't check" : `${fmt8(tsd)} TSD`}</p>}
            </div>
            <Button size="sm" variant="outline" disabled={!!busy || !!block} title={block ?? undefined} onClick={() => setConfirm([v.chain])}>
              {busy === v.chain && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Move back</Button>
          </div>
          {block && <p className="text-xs text-muted-foreground">{block}</p>}
          <div className="flex items-center gap-2 text-xs"><span className="w-20 shrink-0 text-muted-foreground">Public key</span><span className="min-w-0 flex-1 truncate font-mono">{v.xpub}</span><CopyBtn text={v.xpub} label={`Copy ${v.chain} public key`} /></div>
          {v.evm ? <>
            <div className="flex items-center gap-2 text-xs"><span className="w-20 shrink-0 text-muted-foreground">Address</span><span className="min-w-0 flex-1 truncate font-mono">{v.evm.address}</span><CopyBtn text={v.evm.address} label="Copy pocket address" /></div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {(["eth", "base", "bsc", "zcu"] as EvmChainId[]).map((id) => { const b = v.evm!.balances[id]; const url = evmExplorerUrl(id, v.evm!.address);
                return <li key={id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>{EVM_CHAINS[id].name}</span>
                  <span className="flex items-center gap-2 tabular-nums">{b === undefined ? "—" : `${formatEther(b).slice(0, 12)} ${EVM_CHAINS[id].nativeSymbol ?? ""}`}
                    {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`View on ${EVM_CHAINS[id].name} explorer`} className="text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}</span>
                </li>; })}
            </ul>
            <p className="text-xs text-muted-foreground">Tokens like USDC show on the explorer. Move back moves the network coins only.</p>
          </> : <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">All {v.addresses.length} pocket addresses</summary>
            <ul className="mt-2 divide-y divide-border">
              {v.addresses.map((a) => <li key={a.address} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono">{a.address}</span>
                <span className="tabular-nums">{a.sats === null ? "—" : fmt8(a.sats)}</span>
                <CopyBtn text={a.address} label="Copy address" />
                <a href={utxoExplorerUrl(v.chain as UtxoChain, a.address)} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" className="text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>
              </li>)}
            </ul>
          </details>}
        </div>;
      })}
      {!views && <p className="p-5 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Reading the pocket…</p>}
    </div>

    {!link && <p className="text-sm text-muted-foreground">Seeds may also hold keys for other coins in this pocket. Honest Money doesn't read or move those — check or withdraw them on Seeds.</p>}
    {extras.length > 0 && <p className="text-sm text-muted-foreground">Also shared with Seeds: {extras.join(", ")}. Honest Money doesn't read or move these — check or withdraw them on Seeds.</p>}

    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move {confirm?.join(", ")} back to your main wallet?</AlertDialogTitle>
          <AlertDialogDescription>Everything on these coins goes to your own address #0, minus the network fee.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />Cancel any open orders on Seeds first — moving coins out can make those trades fail.</div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); if (confirm) void moveBack(confirm); }}>Move back</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
