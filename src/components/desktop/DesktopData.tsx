import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { deriveSolanaAddress, lamportsToSol } from "@/lib/solana/network";
import { useSolanaData } from "@/components/wallet/SolanaTile";
import { deriveTronAddress } from "@/lib/tron/address";
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
import { useHideBalances } from "@/lib/hide-balances";


import { rootFingerprintHex } from "@/lib/txc/fingerprint";
import { isPortfolioRefreshKey } from "@/lib/desktop/display-policy";
export type DesktopAsset = {
  key: string;
  name: string;
  symbol: string;
  accent: string;
  chain?: ChainId;
  stable?: boolean;
  address?: string;
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

function useDesktopBalances() {
  const { unlocked, root, seed, activeProfileId } = useWallet();
  const [hidden] = useHideBalances();
  const qc = useQueryClient();
  const isVault = unlocked?.mode === "vault";
  const pairing = useMemo(
    () => (isVault ? loadPairing(activeProfileId) : null),
    [isVault, activeProfileId],
  );
  const vaultKey = pairing ? `vault:${pairing.fp}` : null;
  const rootKey = root ? rootFingerprintHex(root) : null;

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
    if (isVault) {
      if (!pairing) throw new Error("Vault pairing unavailable");
      return vaultAccountSnapshot(pairing, chain);
    }
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
    queryKey: [chain === "txc" ? "account" : `${chain}-account`, chain === "txc" ? unlocked?.kind : chain === "isk" ? ISK_DEFAULT_KIND : chain === "btc" ? BTC_DEFAULT_KIND : chain === "ltc" ? LTC_DEFAULT_KIND : DOGE_DEFAULT_KIND, vaultKey ?? rootKey],
    enabled: !!unlocked && on && (isVault ? !!pairing?.chains[chain] : !!root),
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
    () => (isVault ? ((pairing?.evm?.address as `0x${string}` | undefined) ?? null) : root ? deriveEvmAccount(root).address : null),
    [root, pairing, isVault],
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
      queryKey: ["erc20-balance", chain, token.address, evmAddress],
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
    () => (root && !isVault ? deriveTronAddress(root) : null),
    [root, isVault],
  );
  const tron = useTronData(tronAddress, !!unlocked && tronEnabled);
  const solanaEnabled = enabled.includes("solana") && !isVault;
  const solanaAddress = useMemo(() => (seed && !isVault ? deriveSolanaAddress(seed) : null), [seed, isVault]);
  const solana = useSolanaData(solanaAddress, !!unlocked && solanaEnabled);

  // ---- Assemble rows ----
  const rows: DesktopAsset[] = useMemo(() => {
    const out: DesktopAsset[] = [];
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
      key: "tsd", chain: "txc", stable: true,
      name: "TSD Stablecoin",
      symbol: "TSD",
      accent: "stable",
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
        symbol: meta.nativeSymbol,
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
      
      out.push({
        key: `${chain}-${token.symbol}`, chain, stable: true,
        name: `${token.symbol} (${EVM_CHAINS[chain].name})`,
        symbol: token.symbol,
        accent: "stable",
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
        
        out.push({
          key: `tron-${t.symbol}`, chain: "tron", stable: true,
          name: `${t.symbol} (Tron)`,
          symbol: t.symbol,
          accent: "stable",
          amount: amt,
          price: 1,
          usd: amt,
          send: { to: "/wallet/tron/send" },
          receive: { to: "/wallet/tron/receive" },
        });
      });
    }
    if (solanaEnabled && solanaAddress) {
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
    solanaEnabled, solanaAddress, solana.balance.data, enabled,
  ]);

  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const valued = rows.filter((r) => (r.usd ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const accounts = { txc: txcAccount, isk: iskAccount, btc: btcAccount, ltc: ltcAccount, doge: dogeAccount };
  const queries = [txcAccount, ...(enabled.includes("isk") ? [iskAccount] : []), ...(enabled.includes("btc") ? [btcAccount] : []), ...(enabled.includes("ltc") ? [ltcAccount] : []), ...(enabled.includes("doge") ? [dogeAccount] : []), ...evmBalances, ...stableBalances, tsdBalance, ...(tronEnabled ? [tron.balance, ...tron.tokens] : []), ...(solanaEnabled ? [solana.balance] : [])];
  const complete = rows.every(r => r.amount !== null && (r.amount === 0 || r.price !== null)) && queries.every(q => !q.isError && !q.isFetching);
  return { rows, total, valued, accounts, enabled, complete, loading: queries.some(q => q.isFetching), unavailable: queries.some(q => q.isError), evmAddress, tronAddress, solanaAddress, pairing, isVault, activeProfileId, historyId: isVault ? vaultKey : rootKey, hidden, refresh: () => qc.invalidateQueries({ predicate: q => isPortfolioRefreshKey(q.queryKey) }) };
}
type DesktopData = ReturnType<typeof useDesktopBalances>;
const DesktopContext = createContext<DesktopData | null>(null);
export function DesktopDataProvider({ children }: { children: React.ReactNode }) {
  const value = useDesktopBalances();
  return <DesktopContext.Provider value={value}>{children}</DesktopContext.Provider>;
}
export function useDesktopData() {
  const value = useContext(DesktopContext);
  if (!value) throw new Error("Desktop data unavailable");
  return value;
}
