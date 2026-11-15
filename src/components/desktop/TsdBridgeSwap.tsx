/**
 * Desktop Swap routes through TSD Bridge (tsd.honest.money):
 *  - Buy TSD: pay USDC/USDT/PYUSD on Ethereum or USDC/USDT on Base, receive
 *    TSD at a legacy T… address. The member's own TSD Swap key opens a mint
 *    order; the reply is verified on the server and again here, re-polled
 *    right before signing, and the signed bytes must be exactly one ERC-20
 *    transfer of the reviewed amount to the order's deposit address.
 *  - Sell TSD: TSD → USDC on Ethereum stays on the audited cash-out in Send.
 * Vault and watch-only wallets never reach this panel (ThorSwap gates them).
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createWalletClient, erc20Abi, http } from "viem";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { getOmniDepositAddress } from "@/lib/txc/tokens";
import { EVM_CHAINS, deriveEvmAccount, evmClient } from "@/lib/chains/evm";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { confirmWithBiometric } from "@/lib/native/biometric";
import { hapticError, hapticSuccess } from "@/lib/native/ui";
import { friendlyBroadcastError } from "@/lib/broadcast-error";
import { TsdCashoutKeyCard } from "@/components/wallet/TsdCashoutKeyCard";
import {
  bindCashoutKey, cashoutBindingHolds, cashoutKeyFingerprint, useCashoutApiKey,
} from "@/lib/cashout/api-key";
import { isLegacyTxcP2pkh } from "@/lib/cashout/one-time";
import {
  MINT_SOURCES, assertMintTransferRequest, availableMintSources, buildMintTransfer,
  estimateTsdOut, formatUnitsPlain, mintAmountInLimits, mintSource, mintStatusLabel,
  parseMintAmount, recheckMintOrder, type MintSourceId, type TsdBridgeTerms, type VerifiedMintOrder,
} from "@/lib/cashout/mint";
import { createTsdMintOrder, getTsdBridgeTerms, getTsdMintOrder } from "@/lib/cashout/tsd.functions";
import { isTerminalCashoutStatus } from "@/lib/cashout/tsd";
import { recordMintOrder, useMintHistory, type MintRecord } from "@/lib/cashout/mint-history";
import type { CashoutKeyBinding } from "@/lib/cashout/api-key";

const OTHER = "__other";
const TSD = "tsd";

export function TsdBridgeSwap({
  direction, evmSwapOn, onDirection, onLeave,
}: {
  direction: "mint" | "redeem";
  evmSwapOn: boolean;
  onDirection: (d: "mint" | "redeem") => void;
  onLeave: () => void;
}) {
  const [apiKey] = useCashoutApiKey();
  const fetchTerms = useServerFn(getTsdBridgeTerms);
  const terms = useQuery({ queryKey: ["tsd-bridge-terms"], queryFn: () => fetchTerms(), staleTime: 60_000, retry: 1 });

  const [sourceId, setSourceId] = useState<MintSourceId>("usdc-eth");
  const sources = availableMintSources(terms.data);
  const source = mintSource(sourceId) ?? MINT_SOURCES[0];

  const payValue = direction === "mint" ? sourceId : TSD;
  const receiveValue = direction === "mint" ? TSD : "usdc-eth-out";

  function pickPay(v: string) {
    if (v === OTHER) return onLeave();
    if (v === TSD) return onDirection("redeem");
    setSourceId(v as MintSourceId);
    if (direction !== "mint") onDirection("mint");
  }
  function pickReceive(v: string) {
    if (v === OTHER) return onLeave();
    if (v === TSD) return onDirection("mint");
    if (direction !== "redeem") onDirection("redeem");
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="tsd-from">Pay with</Label>
            <Select value={payValue} onValueChange={pickPay}>
              <SelectTrigger id="tsd-from" aria-label="Pay with"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(sources.length ? sources : MINT_SOURCES).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
                <SelectItem value={TSD}>TSD on TEXITcoin</SelectItem>
                <SelectItem value={OTHER}>Other coins (THORChain)…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tsd-to">Receive</Label>
            <Select value={receiveValue} onValueChange={pickReceive}>
              <SelectTrigger id="tsd-to" aria-label="Receive"><SelectValue /></SelectTrigger>
              <SelectContent>
                {direction === "mint"
                  ? <SelectItem value={TSD}>TSD on TEXITcoin</SelectItem>
                  : <SelectItem value="usdc-eth-out">USDC on Ethereum</SelectItem>}
                <SelectItem value={direction === "mint" ? "usdc-eth-out" : TSD}>
                  {direction === "mint" ? "USDC on Ethereum (sell TSD)" : "TSD on TEXITcoin (buy TSD)"}
                </SelectItem>
                <SelectItem value={OTHER}>Other coins (THORChain)…</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!apiKey ? (
          <div className="mt-6 max-w-xl">
            <p className="text-sm text-muted-foreground">
              TSD routes use your own TSD Swap account. Create one at tsd.honest.money, make an API key on your
              account page, and paste it below — it is saved for this wallet only.
            </p>
            <TsdCashoutKeyCard />
          </div>
        ) : direction === "redeem" ? (
          <RedeemRoute redeemFeeBps={terms.data?.redeemFeeBps ?? null} />
        ) : !evmSwapOn ? (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">Paying with stablecoins needs EVM swaps turned on in desktop settings.</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/desktop/settings">Desktop settings</Link></Button>
          </div>
        ) : terms.isError ? (
          <p className="mt-6 text-sm text-destructive">{terms.error instanceof Error ? terms.error.message : "TSD Bridge is unavailable."}</p>
        ) : terms.data && !terms.data.live ? (
          <p className="mt-6 text-sm text-muted-foreground">TSD Bridge has paused new TSD purchases. Try again later.</p>
        ) : terms.data && !sources.some((s) => s.id === source.id) ? (
          <p className="mt-6 text-sm text-muted-foreground">TSD Bridge isn't accepting {source.label} right now — pick another stablecoin.</p>
        ) : terms.data ? (
          <MintRoute key={`${source.id}:${apiKey.slice(-6)}`} apiKey={apiKey} sourceId={source.id} terms={terms.data} />
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Loading TSD Bridge terms…</p>
        )}
      </section>

      <aside className="min-w-0 border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
        <h3 className="text-sm font-medium">TSD Bridge</h3>
        {terms.data && (
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Rate</dt><dd>1 stablecoin = 1 TSD</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Buy fee</dt><dd>{terms.data.mintFeeBps / 100}%</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Sell fee</dt><dd>{terms.data.redeemFeeBps / 100}% standard</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Limits</dt><dd>{terms.data.minAmount.toLocaleString()}–{terms.data.maxAmount.toLocaleString()}</dd></div>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          TSD is a dollar token on TEXITcoin, backed 1:1 by stablecoins TSD Bridge holds in reserve. Unlike THORChain
          swaps, TSD Bridge holds the stablecoins you pay in. Honest Money adds no fee.
        </p>
        {apiKey && <RecentMints apiKey={apiKey} />}
      </aside>
    </div>
  );
}

function RedeemRoute({ redeemFeeBps }: { redeemFeeBps: number | null }) {
  return (
    <div className="mt-6 max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Selling TSD for USDC on Ethereum uses the TSD cash-out on the Send page: enter the amount, choose where the
        USDC goes, and review the order before anything is signed.
        {redeemFeeBps != null && ` Your account's fee is shown there (standard fee ${redeemFeeBps / 100}%).`}
      </p>
      <Button asChild size="lg"><Link to="/desktop/send" search={{ asset: "tsd" }}>Cash out TSD</Link></Button>
    </div>
  );
}

function MintRoute({ apiKey, sourceId, terms }: {
  apiKey: string;
  sourceId: MintSourceId;
  terms: TsdBridgeTerms;
}) {
  const { root, unlocked, activeProfileId } = useWallet();
  const qc = useQueryClient();
  const createOrder = useServerFn(createTsdMintOrder);
  const fetchOrder = useServerFn(getTsdMintOrder);
  const source = mintSource(sourceId)!;
  const isLocalSigner = !!root && unlocked?.mode !== "vault" && unlocked?.mode !== "keyonly";
  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  const ownTsd = useMemo(() => (root ? getOmniDepositAddress(root).address : null), [root]);

  const [amount, setAmount] = useState("");
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const [order, setOrder] = useState<{ locked: VerifiedMintOrder; binding: CashoutKeyBinding } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ hash: string; locked: VerifiedMintOrder } | null>(null);

  const recipient = (recipientOverride ?? ownTsd ?? "").trim();
  const recipientValid = isLegacyTxcP2pkh(recipient);
  const units = parseMintAmount(amount, source);
  const inLimits = units !== null && mintAmountInLimits(units, source, terms);

  const balance = useQuery({
    queryKey: ["tsd-mint-balance", source.id, evmAddress],
    enabled: isLocalSigner && !!evmAddress,
    queryFn: async () => {
      const pub = evmClient(source.chain);
      const [token, native] = await Promise.all([
        pub.readContract({ address: source.contract, abi: erc20Abi, functionName: "balanceOf", args: [evmAddress!] }) as Promise<bigint>,
        pub.getBalance({ address: evmAddress! }),
      ]);
      return { token, native };
    },
    staleTime: 20_000,
  });
  const enough = units !== null && !!balance.data && balance.data.token >= units && balance.data.native > 0n;
  const outUnits = units ? estimateTsdOut(units, source, terms.mintFeeBps) : 0n;

  async function review() {
    if (!units || !recipientValid || !evmAddress || busy) return;
    setBusy(true);
    setError(null);
    try {
      const binding = bindCashoutKey(apiKey);
      if (!binding) throw new Error("Wallet changed — start again.");
      const locked = await createOrder({
        data: { apiKey, sourceId: source.id, amount: amount.trim(), recipient, ownEvmAddresses: [evmAddress] },
      });
      setOrder({ locked, binding });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open a TSD Bridge order.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!order || !root || !isLocalSigner || busy) return;
    const { locked, binding } = order;
    setBusy(true);
    setError(null);
    try {
      if (!cashoutBindingHolds(binding)) throw new Error("Wallet or TSD Swap key changed. Nothing was sent — start again.");
      if (amount.trim() !== locked.amount || recipient !== locked.recipient) {
        throw new Error("The amount or TSD address changed. Nothing was sent — start again.");
      }
      // Re-poll right before signing: still open, same deposit, same amount, ≥1h left.
      const fresh = await fetchOrder({ data: { apiKey, id: locked.id } });
      recheckMintOrder(locked, fresh);
      const ok = await confirmWithBiometric(`Confirm paying ${locked.amount} ${source.symbol} for TSD`);
      if (!ok) throw new Error("Confirmation was cancelled. Nothing was sent.");
      const account = deriveEvmAccount(root);
      if (account.address.toLowerCase() === locked.depositAddress.toLowerCase()) {
        throw new Error("The deposit address belongs to this wallet. Nothing was sent.");
      }
      const pub = evmClient(source.chain);
      const bal = (await pub.readContract({
        address: source.contract, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
      })) as bigint;
      if (bal < BigInt(locked.units)) throw new Error(`Not enough ${source.symbol}. Nothing was sent.`);
      const walletClient = createWalletClient({
        account, chain: EVM_CHAINS[source.chain].viemChain, transport: http(`/api/evm/${source.chain}`),
      });
      const hash = await sendEvmTransaction(source.chain, walletClient, buildMintTransfer(locked), (req) =>
        assertMintTransferRequest(locked, req),
      );
      recordMintOrder(activeProfileId, {
        orderId: locked.id, txHash: hash, sourceId: source.id, amount: locked.amount,
        recipient: locked.recipient, depositAddress: locked.depositAddress,
        keyFp: cashoutKeyFingerprint(apiKey), createdAt: Date.now(),
      });
      hapticSuccess();
      setSent({ hash, locked });
      setOrder(null);
      void qc.invalidateQueries({ queryKey: ["tsd-mint-balance"] });
    } catch (e) {
      hapticError();
      setOrder(null);
      setError(friendlyBroadcastError(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6">
        <h2 className="text-xl font-semibold">Stablecoins sent to TSD Bridge</h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          {sent.locked.amount} {source.symbol} is on its way. TSD Bridge sends about{" "}
          {formatUnitsPlain(estimateTsdOut(BigInt(sent.locked.units), source, sent.locked.feeBps), 8)} TSD to{" "}
          <span className="font-mono text-xs">{sent.locked.recipient}</span> once{" "}
          {source.chain === "eth" ? "Ethereum" : "Base"} confirms it — usually 5–15 minutes, longer for large amounts.
        </p>
        <MintTracker apiKey={apiKey} orderId={sent.locked.id} />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href={EVM_CHAINS[source.chain].explorerTx(sent.hash)} target="_blank" rel="noreferrer">
              View payment <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="ghost" onClick={() => { setSent(null); setAmount(""); }}>Buy more TSD</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5">
        <Label htmlFor="tsd-amount">Amount ({source.symbol})</Label>
        <Input id="tsd-amount" inputMode="decimal" placeholder="0.0" value={amount}
          onChange={(e) => { setAmount(e.target.value); setOrder(null); setError(null); }} className="mt-1.5 text-lg" />
        {balance.data && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Available: {formatUnitsPlain(balance.data.token, source.decimals)} {source.symbol}
          </p>
        )}
        {amount && units === null && <p className="mt-1.5 text-xs text-destructive">Enter an amount with up to {source.decimals} decimals.</p>}
        {units !== null && !inLimits && (
          <p className="mt-1.5 text-xs text-destructive">TSD Bridge accepts {terms.minAmount.toLocaleString()}–{terms.maxAmount.toLocaleString()} {source.symbol} per order.</p>
        )}
      </div>

      <div className="mt-5">
        <Label htmlFor="tsd-recipient">TSD goes to (TEXITcoin)</Label>
        <Input id="tsd-recipient" value={recipient}
          onChange={(e) => { setRecipientOverride(e.target.value); setOrder(null); }}
          placeholder="T…" className="mt-1.5 font-mono text-xs" />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {recipientOverride == null
            ? "Auto-filled with this wallet's TSD address. Paste a different legacy T… address to send the TSD elsewhere."
            : "Custom TSD address — double-check it, purchases can't be undone."}
        </p>
        {recipient && !recipientValid && <p className="mt-1.5 text-xs text-destructive">TSD can only go to a legacy T… TEXITcoin address.</p>}
      </div>

      {error && <p className="mt-4 break-words text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || !inLimits || !recipientValid || !enough} onClick={() => void review()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Review purchase
        </Button>
        {units !== null && balance.data && !enough && (
          <span className="text-xs text-destructive">Not enough {source.symbol}, or no {source.chain === "eth" ? "ETH" : "Base ETH"} for the network fee.</span>
        )}
      </div>

      <AlertDialog open={!!order} onOpenChange={(o) => { if (!o && !busy) setOrder(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm TSD purchase</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {order && (
                  <>
                    <p>You send <strong>{order.locked.amount} {source.symbol}</strong> ({source.label}) to TSD Bridge's deposit address for this order:</p>
                    <p className="break-all font-mono text-xs">{order.locked.depositAddress}</p>
                    <p>You receive about <strong>{formatUnitsPlain(estimateTsdOut(BigInt(order.locked.units), source, order.locked.feeBps), 8)} TSD</strong> (fee {order.locked.feeBps / 100}%) at:</p>
                    <p className="break-all font-mono text-xs">{order.locked.recipient}</p>
                    <p className="text-xs">Order {order.locked.id} · open until {new Date(order.locked.expiresAt).toLocaleString()}. The wallet checks the order again right before signing and only signs this exact transfer.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void send(); }}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm and send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {units !== null && inLimits && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estimated: {formatUnitsPlain(outUnits, 8)} TSD. TSD Bridge mints for exactly what arrives.
        </p>
      )}
    </>
  );
}

function MintTracker({ apiKey, orderId }: { apiKey: string; orderId: string }) {
  const fetchOrder = useServerFn(getTsdMintOrder);
  const order = useQuery({
    queryKey: ["tsd-mint-order", orderId],
    queryFn: () => fetchOrder({ data: { apiKey, id: orderId } }),
    refetchInterval: (q) => (q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 15_000),
    retry: 2,
  });
  const status = order.data?.status;
  const done = status ? isTerminalCashoutStatus(status) : false;
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm">
      {!done && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span className="text-muted-foreground">Order status:</span>
      <span className="font-medium">{status ? mintStatusLabel(status) : order.isError ? "Couldn't check" : "Checking…"}</span>
    </p>
  );
}

function RecentMints({ apiKey }: { apiKey: string }) {
  const { activeProfileId } = useWallet();
  const fp = cashoutKeyFingerprint(apiKey);
  const list = useMintHistory(activeProfileId).filter((r) => r.keyFp === fp);
  if (!list.length) return null;
  return (
    <div className="mt-8">
      <h3 className="text-sm font-medium">Recent TSD purchases</h3>
      <ul className="mt-3 space-y-2">
        {list.slice(0, 5).map((r) => <MintRow key={r.orderId} rec={r} apiKey={apiKey} />)}
      </ul>
    </div>
  );
}

function MintRow({ rec, apiKey }: { rec: MintRecord; apiKey: string }) {
  const fetchOrder = useServerFn(getTsdMintOrder);
  const source = mintSource(rec.sourceId);
  const order = useQuery({
    queryKey: ["tsd-mint-order", rec.orderId],
    queryFn: () => fetchOrder({ data: { apiKey, id: rec.orderId } }),
    refetchInterval: (q) => (q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 60_000),
    retry: 1,
  });
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <span className="min-w-0 truncate">{rec.amount} {source?.symbol ?? ""} → TSD</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {order.data ? mintStatusLabel(order.data.status) : order.isError ? "Couldn't check" : "Checking…"}
      </span>
    </li>
  );
}
