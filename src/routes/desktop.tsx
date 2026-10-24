import { setPreferPhone } from "@/lib/desktop-pref";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookUser,
  LayoutDashboard,
  Link2,
  RefreshCw,
  Settings as Cog,
  Shield,
  Smartphone,
  Users,
} from "lucide-react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { scanIskAccount } from "@/lib/isk/scan";
import { ISK_DEFAULT_KIND } from "@/lib/isk/network";
import { satsToIsk } from "@/lib/isk/units";
import { getIskPriceUsd } from "@/lib/isk/price.functions";
import { scanBtcAccount } from "@/lib/btc/scan";
import { BTC_DEFAULT_KIND } from "@/lib/btc/network";
import { satsToBtc } from "@/lib/btc/units";
import { getBtcPriceUsd } from "@/lib/btc/price.functions";
import { scanLtcAccount } from "@/lib/ltc/scan";
import { LTC_DEFAULT_KIND } from "@/lib/ltc/network";
import { satsToLtc } from "@/lib/ltc/units";
import { getLtcPriceUsd } from "@/lib/ltc/price.functions";
import { scanDogeAccount } from "@/lib/doge/scan";
import { DOGE_DEFAULT_KIND } from "@/lib/doge/network";
import { satsToDoge } from "@/lib/doge/units";
import { getDogePriceUsd } from "@/lib/doge/price.functions";
import { satsToTxc, formatFiat } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { EVM_CHAINS, deriveEvmAccount, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { BUILTIN_TOKENS_BY_CHAIN, readErc20Balance, tokenAmountFromRaw } from "@/lib/chains/erc20";
import { deriveSolanaAccount, lamportsToSol } from "@/lib/solana/network";
import { useSolanaData } from "@/components/wallet/SolanaTile";
import { deriveTronAccount } from "@/lib/tron/address";
import { TRC20_TOKENS } from "@/lib/tron/network";
import { sunToTrx } from "@/lib/tron/units";
import { useTronData } from "@/components/wallet/TronTile";
import { getTxcTokenBalancesForAddresses } from "@/lib/txc/tokens.functions";
import { formatTokenAmount } from "@/lib/txc/tokens";
import { TSD_PROPERTY_ID } from "@/lib/cashout/tsd";
import { getEnabledChains, CHAIN_META, type ChainId } from "@/lib/chain-prefs";
import { loadPairing } from "@/lib/vault-link/pairing";
import { vaultAccountSnapshot } from "@/lib/vault-link/snapshot";
import type { VaultUtxoChain } from "@/lib/vault-link/pairing";
import { ProfileSwitcher } from "@/components/wallet/ProfileSwitcher";
import { useHideBalances, maskAmount } from "@/lib/hide-balances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/desktop")({
  head: () => ({
    meta: [
      { title: "Desktop Workspace — HME Wallet" },
      { name: "description", content: "A wide-screen workspace for your Honest Money wallets: portfolio, holdings and quick actions." },
      { property: "og:title", content: "Desktop Workspace — HME Wallet" },
      { property: "og:description", content: "A wide-screen workspace for your Honest Money wallets: portfolio, holdings and quick actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DesktopWorkspace,
});

type Row = {
  key: string;
  name: string;
  symbol: string;
  accent: string;
  amount: number | null;
  price: number | null;
  usd: number | null;
  send?: { to: string; params?: Record<string, string> };
  receive?: { to: string; params?: Record<string, string> };
};

function fmtAmount(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.000001) return "<0.000001";
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function DesktopWorkspace() {
  const { unlocked, root, seed, activeProfileId, unlock } = useWallet();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden] = useHideBalances();
  const qc = useQueryClient();
  const isVault = unlocked?.mode === "vault";
  const pairing = useMemo(
    () => (isVault ? loadPairing(activeProfileId) : null),
    [isVault, activeProfileId],
  );
  const vaultKey = pairing ? `vault:${pairing.fp}` : null;
  const rootKey = root?.neutered().toBase58().slice(0, 24) ?? null;

  // Reactive enabled-chain list — same device-wide setting the phone uses.
  const [enabled, setEnabled] = useState<ChainId[]>(() => getEnabledChains());
  useEffect(() => {
    const h = () => setEnabled(getEnabledChains());
    window.addEventListener("hme:chains-changed", h);
    return () => window.removeEventListener("hme:chains-changed", h);
  }, []);

  // ---- Prices (same query keys as the phone wallet so both share cache) ----
  const fetchTxcPrice = useServerFn(getTxcPriceUsd);
  const txcPrice = useQuery({
    queryKey: ["txc-price"],
    queryFn: () => fetchTxcPrice(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked,
  });
  const fetchAllPrices = useServerFn(getAllPricesUsd);
  const allPrices = useQuery({
    queryKey: ["all-prices"],
    queryFn: () => fetchAllPrices(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked,
  });
  const fetchIskPrice = useServerFn(getIskPriceUsd);
  const iskPrice = useQuery({
    queryKey: ["isk-price"],
    queryFn: () => fetchIskPrice(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked && enabled.includes("isk"),
  });
  const fetchBtcPrice = useServerFn(getBtcPriceUsd);
  const btcPrice = useQuery({
    queryKey: ["btc-price"],
    queryFn: () => fetchBtcPrice(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked && enabled.includes("btc"),
  });
  const fetchLtcPrice = useServerFn(getLtcPriceUsd);
  const ltcPrice = useQuery({
    queryKey: ["ltc-price"],
    queryFn: () => fetchLtcPrice(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked && enabled.includes("ltc"),
  });
  const fetchDogePrice = useServerFn(getDogePriceUsd);
  const dogePrice = useQuery({
    queryKey: ["doge-price"],
    queryFn: () => fetchDogePrice(),
    staleTime: 10 * 60_000,
    enabled: !!unlocked && enabled.includes("doge"),
  });

  // ---- UTXO accounts ----
  const utxoScan = (chain: VaultUtxoChain) => {
    if (pairing) return vaultAccountSnapshot(pairing, chain);
    if (!root || !unlocked) throw new Error("Wallet locked.");
    switch (chain) {
      case "txc": return scanAccount(root, unlocked.kind);
      case "isk": return scanIskAccount(root, ISK_DEFAULT_KIND);
      case "btc": return scanBtcAccount(root, BTC_DEFAULT_KIND);
      case "ltc": return scanLtcAccount(root, LTC_DEFAULT_KIND);
      case "doge": return scanDogeAccount(root, DOGE_DEFAULT_KIND);
    }
  };
  const utxoQuery = (chain: VaultUtxoChain, on: boolean) => ({
    queryKey: [chain === "txc" ? "account" : `${chain}-account`, unlocked?.kind, vaultKey ?? rootKey],
    enabled: !!unlocked && on && (!!root || !!pairing),
    queryFn: () => utxoScan(chain),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const txcAccount = useQuery(utxoQuery("txc", true));
  const iskAccount = useQuery(utxoQuery("isk", enabled.includes("isk")));
  const btcAccount = useQuery(utxoQuery("btc", enabled.includes("btc")));
  const ltcAccount = useQuery(utxoQuery("ltc", enabled.includes("ltc")));
  const dogeAccount = useQuery(utxoQuery("doge", enabled.includes("doge")));

  // TSD rides on the TXC chain and is dollar-pegged — always shown.
  const txcAddresses = useMemo(
    () => [...(txcAccount.data?.external ?? []), ...(txcAccount.data?.internal ?? [])].map((a) => a.address),
    [txcAccount.data],
  );
  const fetchTokenBalances = useServerFn(getTxcTokenBalancesForAddresses);
  const tsdBalance = useQuery({
    queryKey: ["tsd-balance-usd", txcAddresses.slice().sort().join(",")],
    enabled: txcAddresses.length > 0,
    queryFn: () => fetchTokenBalances({ data: { addresses: txcAddresses, propertyIds: [TSD_PROPERTY_ID] } }),
    staleTime: 30_000,
  });
  const tsdAmount = useMemo(() => {
    if (tsdBalance.data == null) return null;
    return Number(formatTokenAmount(BigInt(tsdBalance.data[TSD_PROPERTY_ID] ?? "0"), true));
  }, [tsdBalance.data]);

  // ---- EVM ----
  const evmEnabled = enabled.filter((c) => c in EVM_CHAINS) as EvmChainId[];
  const evmAddress = useMemo(
    () => (pairing ? ((pairing.evm?.address as `0x${string}` | undefined) ?? null) : root ? deriveEvmAccount(root).address : null),
    [root, pairing],
  );
  const evmBalances = useQueries({
    queries: evmEnabled.map((id) => ({
      queryKey: ["evm-balance", id, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => {
        if (!evmAddress) throw new Error("Wallet address unavailable");
        return evmClient(id).getBalance({ address: evmAddress });
      },
      staleTime: 60_000,
    })),
  });
  // Built-in stablecoins (USDC/USDT/PYUSD) per enabled EVM chain — $1 peg.
  const stableQueries = useMemo(
    () =>
      evmEnabled.flatMap((id) =>
        BUILTIN_TOKENS_BY_CHAIN[id].map((token) => ({ chain: id, token })),
      ),
    [evmEnabled],
  );
  const stableBalances = useQueries({
    queries: stableQueries.map(({ chain, token }) => ({
      queryKey: ["evm-token-balance", chain, token.address, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => {
        if (!evmAddress) throw new Error("Wallet address unavailable");
        return readErc20Balance(chain, token, evmAddress);
      },
      staleTime: 60_000,
    })),
  });

  // ---- Tron + Solana (not available for Vault-paired profiles) ----
  const tronEnabled = enabled.includes("tron") && !isVault;
  const tronAddress = useMemo(
    () => (root && !isVault ? deriveTronAccount(root).address : null),
    [root, isVault],
  );
  const tron = useTronData(tronAddress, !!unlocked && tronEnabled);
  const solanaEnabled = enabled.includes("solana") && !isVault;
  const solanaAccount = useMemo(() => (seed && !isVault ? deriveSolanaAccount(seed) : null), [seed, isVault]);
  const solana = useSolanaData(solanaAccount?.address ?? null, !!unlocked && solanaEnabled);

  // ---- Assemble rows ----
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const txcAmt = txcAccount.data ? satsToTxc(txcAccount.data.balanceSats) : null;
    out.push({
      key: "txc",
      name: CHAIN_META.txc.name,
      symbol: "TXC",
      accent: CHAIN_META.txc.accent,
      amount: txcAmt,
      price: txcPrice.data?.usd ?? null,
      usd: txcAmt != null && txcPrice.data?.usd ? txcAmt * txcPrice.data.usd : null,
      send: { to: "/wallet/send" },
      receive: { to: "/wallet/receive" },
    });
    // TSD is always visible, even at zero.
    out.push({
      key: "tsd",
      name: "TSD Stablecoin",
      symbol: "TSD",
      accent: "#0F766E",
      amount: tsdAmount,
      price: 1,
      usd: tsdAmount,
      send: { to: "/wallet/send" },
      receive: { to: "/wallet/receive" },
    });
    const utxoRows: Array<{
      id: "isk" | "btc" | "ltc" | "doge";
      account: typeof iskAccount;
      price: number | null | undefined;
      toUnit: (sats: number) => number;
    }> = [
      { id: "isk", account: iskAccount, price: iskPrice.data?.usd, toUnit: satsToIsk },
      { id: "btc", account: btcAccount, price: btcPrice.data?.usd, toUnit: satsToBtc },
      { id: "ltc", account: ltcAccount, price: ltcPrice.data?.usd, toUnit: satsToLtc },
      { id: "doge", account: dogeAccount, price: dogePrice.data?.usd, toUnit: satsToDoge },
    ];
    for (const u of utxoRows) {
      if (!enabled.includes(u.id)) continue;
      const amt = u.account.data ? u.toUnit(u.account.data.balanceSats) : null;
      const p = u.price ?? null;
      out.push({
        key: u.id,
        name: CHAIN_META[u.id].name,
        symbol: CHAIN_META[u.id].shortName,
        accent: CHAIN_META[u.id].accent,
        amount: amt,
        price: p,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: `/wallet/${u.id}/send` },
        receive: { to: `/wallet/${u.id}/receive` },
      });
    }
    evmEnabled.forEach((id, i) => {
      const meta = EVM_CHAINS[id];
      const bal = evmBalances[i]?.data;
      const amt = bal != null ? Number(bal) / 1e18 : null;
      const p = allPrices.data?.prices?.[meta.priceSymbol] ?? null;
      out.push({
        key: id,
        name: meta.name,
        symbol: meta.shortName,
        accent: meta.accent,
        amount: amt,
        price: p,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: "/wallet/evm/$chain/send", params: { chain: id } },
        receive: { to: "/wallet/evm/$chain/receive", params: { chain: id } },
      });
    });
    stableQueries.forEach(({ chain, token }, i) => {
      const raw = stableBalances[i]?.data;
      const amt = raw != null ? Number(tokenAmountFromRaw(raw, token.decimals)) : null;
      if (amt != null && amt === 0) return; // hide empty stablecoin rows
      out.push({
        key: `${chain}-${token.symbol}`,
        name: `${token.symbol} (${EVM_CHAINS[chain].name})`,
        symbol: token.symbol,
        accent: "#2775CA",
        amount: amt,
        price: 1,
        usd: amt,
        send: { to: "/wallet/evm/$chain/send", params: { chain } },
        receive: { to: "/wallet/evm/$chain/receive", params: { chain } },
      });
    });
    if (tronEnabled && tronAddress) {
      const amt = tron.balance.data != null ? sunToTrx(tron.balance.data) : null;
      const p = tron.price.data?.usd ?? null;
      out.push({
        key: "tron",
        name: CHAIN_META.tron.name,
        symbol: "TRX",
        accent: CHAIN_META.tron.accent,
        amount: amt,
        price: p,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: "/wallet/tron/send" },
        receive: { to: "/wallet/tron/receive" },
      });
      TRC20_TOKENS.forEach((t, i) => {
        const raw = tron.tokens[i]?.data;
        const amt = raw != null ? Number(raw) / 10 ** t.decimals : null;
        if (amt != null && amt === 0) return;
        out.push({
          key: `tron-${t.symbol}`,
          name: `${t.symbol} (Tron)`,
          symbol: t.symbol,
          accent: "#2775CA",
          amount: amt,
          price: 1,
          usd: amt,
          send: { to: "/wallet/tron/send" },
          receive: { to: "/wallet/tron/receive" },
        });
      });
    }
    if (solanaEnabled && solanaAccount) {
      const amt = solana.balance.data != null ? lamportsToSol(solana.balance.data) : null;
      const p = allPrices.data?.prices?.SOL ?? null;
      out.push({
        key: "solana",
        name: CHAIN_META.solana.name,
        symbol: "SOL",
        accent: CHAIN_META.solana.accent,
        amount: amt,
        price: p,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: "/wallet/solana/send" },
        receive: { to: "/wallet/solana/receive" },
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    txcAccount.data, txcPrice.data, tsdAmount,
    iskAccount.data, iskPrice.data, btcAccount.data, btcPrice.data,
    ltcAccount.data, ltcPrice.data, dogeAccount.data, dogePrice.data,
    evmEnabled, evmBalances, stableQueries, stableBalances, allPrices.data,
    tronEnabled, tronAddress, tron.balance.data, tron.price.data, tron.tokens,
    solanaEnabled, solanaAccount, solana.balance.data, enabled,
  ]);

  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const valued = rows.filter((r) => (r.usd ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const loadingAny =
    txcAccount.isPending ||
    (enabled.includes("isk") && iskAccount.isPending) ||
    (enabled.includes("btc") && btcAccount.isPending) ||
    (enabled.includes("ltc") && ltcAccount.isPending) ||
    (enabled.includes("doge") && dogeAccount.isPending);

  if (!unlocked) return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Desktop Workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">Unlock your wallet</p>
        <form className="mt-6 space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (!await unlock(password)) setError("Wrong password, or no wallet saved in this browser.");
            else setPassword("");
          } catch {
            setError("Could not unlock your wallet. Please try again.");
          } finally {
            setBusy(false);
          }
        }}>
          <Input type="password" aria-label="Wallet password" placeholder="Wallet password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</Button>
        </form>
        <div className="mt-4 flex justify-between gap-3">
          <Button asChild variant="outline"><Link to="/import">Import wallet</Link></Button>
          <Button asChild variant="ghost"><Link to="/" onClick={() => setPreferPhone(true)}>Phone view</Link></Button>
        </div>
      </div>
    </main>
  );

  const nav = [
    { to: "/wallet/shared", label: "Shared wallets", icon: Users },
    { to: "/wallet/contacts", label: "Address book", icon: BookUser },
    { to: "/wallet/signin", label: "Website sign-in", icon: Link2 },
    { to: "/wallet/backup", label: "Backup", icon: Shield },
    { to: "/wallet/settings", label: "Settings", icon: Cog },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="border-b border-border px-5 py-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Honest Money</div>
          <div className="text-lg font-semibold">Desktop Workspace</div>
        </div>
        <div className="border-b border-border px-4 py-3">
          <ProfileSwitcher />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium">
            <LayoutDashboard className="h-4 w-4" /> Portfolio
          </div>
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border p-4">
          <Link
            to="/wallet"
            onClick={() => setPreferPhone(true)}
            className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Smartphone className="h-4 w-4" /> Phone view
          </Link>
          <div className="space-x-3 px-1 text-xs text-muted-foreground">
            <a href="https://honest.money" className="hover:text-foreground">honest.money</a>
            <Link to="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Total portfolio</div>
              <div className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
                {hidden ? maskAmount(formatFiat(total)) : formatFiat(total)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {rows.length} asset{rows.length === 1 ? "" : "s"} across {enabled.length} chain{enabled.length === 1 ? "" : "s"}
                {isVault ? " — Vault wallet: sending signs by QR with HME Vault." : ""}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingAny}
              onClick={() => void qc.invalidateQueries()}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingAny ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {valued.length > 0 && total > 0 && (
            <div className="mt-6">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                {valued.map((r) => (
                  <div
                    key={r.key}
                    style={{ width: `${((r.usd ?? 0) / total) * 100}%`, backgroundColor: r.accent }}
                    title={`${r.name} ${(((r.usd ?? 0) / total) * 100).toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {valued.slice(0, 6).map((r) => (
                  <span key={r.key} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.accent }} />
                    {r.symbol} {(((r.usd ?? 0) / total) * 100).toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Share</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ backgroundColor: r.accent }}
                        >
                          {r.symbol.slice(0, 4)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {r.price == null ? "—" : formatFiat(r.price)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.amount == null ? "…" : hidden ? maskAmount(fmtAmount(r.amount)) : fmtAmount(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.usd == null ? "—" : hidden ? maskAmount(formatFiat(r.usd)) : formatFiat(r.usd)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {r.usd && total ? `${((r.usd / total) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {r.receive && (
                          <Button asChild size="sm" variant="outline">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <Link to={r.receive.to as any} params={r.receive.params as any}>
                              <ArrowDownLeft className="mr-1 h-4 w-4" /> Receive
                            </Link>
                          </Button>
                        )}
                        {r.send && (
                          <Button asChild size="sm">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <Link to={r.send.to as any} params={r.send.params as any}>
                              <ArrowUpRight className="mr-1 h-4 w-4" /> Send
                            </Link>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Only chains you've turned on in Settings appear here. Send and receive open the standard
            screens with the same safety checks as the phone app.
          </p>
        </div>
      </main>
    </div>
  );
}
