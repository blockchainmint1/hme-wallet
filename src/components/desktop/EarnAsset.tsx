import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createWalletClient, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useWallet } from "@/lib/txc/wallet-context";
import { deriveEvmAccount, evmClient } from "@/lib/chains/evm";
import { useHideBalances } from "@/lib/hide-balances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EARN, type EarnAction, type EarnProtocol } from "@/lib/earn/protocols";
import { executeEarn, previewEarn, type EarnIntent, readEarnPosition } from "@/lib/earn/direct";
import { DESKTOP_EARN_EXECUTION_ENABLED } from "@/lib/desktop/policy";

const display = (n: bigint, decimals: number) => {
  const [whole, fraction = ""] = formatUnits(n, decimals).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
};

export function EarnAsset({ protocol, address }: { protocol: EarnProtocol; address: Address | null }) {
  const p = EARN[protocol];
  const { root, unlocked, activeProfileId } = useWallet();
  const session = useRef({ root, activeProfileId });
  session.current = { root, activeProfileId };
  useEffect(() => () => { session.current = { root: null, activeProfileId: "" }; }, []);
  const [hidden] = useHideBalances();
  const [action, setAction] = useState<EarnAction>("deposit");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<EarnIntent | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [hashes, setHashes] = useState<{ hash: Hex; step: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const pub = useMemo(() => evmClient("eth"), []);
  const position = useQuery({ queryKey: ["earn-position", "eth", protocol, address, activeProfileId], queryFn: () => {
    if (!address) throw new Error("No Ethereum address");
    return readEarnPosition(pub, protocol, address);
  }, enabled: !!address, staleTime: 30_000, retry: 1 });
  let raw = 0n;
  try {
    if (/^\d+(\.\d*)?$/.test(amount) && (amount.split(".")[1]?.length ?? 0) <= p.decimals) raw = parseUnits(amount, p.decimals);
  } catch { /* Invalid amount has no executable intent. */ }
  const intent: EarnIntent | null = address && raw > 0n ? { protocol, action, user: address, amount: raw, minimum: 1n } : null;
  const quote = useQuery({ queryKey: ["earn-preview", protocol, action, address, raw.toString(), activeProfileId], queryFn: () => {
    if (!intent) throw new Error("Enter an amount");
    return previewEarn(pub, intent);
  }, enabled: !!intent && !!position.data, staleTime: 10_000, retry: false });
  const isSeed = unlocked?.mode === "seed" || (unlocked && !unlocked.mode);
  const available = action === "deposit" ? position.data?.available : position.data?.shares;
  const outputSymbol = action === "deposit" ? p.name : p.asset;
  const choose = (next: EarnAction) => { setAction(next); setAmount(""); setReview(null); setError(""); };
  useEffect(() => { setAmount(""); setReview(null); setHashes([]); setError(""); setStage(""); }, [address, activeProfileId]);

  async function submit() {
    if (!review || !root || !isSeed) return;
    const consent = review;
    const capturedRoot = root;
    const capturedProfile = activeProfileId;
    setBusy(true); setError("");
    try {
      const account = deriveEvmAccount(capturedRoot);
      const walletClient = createWalletClient({ account, chain: mainnet, transport: http("/api/evm/eth") });
      await executeEarn({ intent: consent, walletClient, publicClient: pub, stage: setStage,
        assertSession: () => {
          if (session.current.root !== capturedRoot || session.current.activeProfileId !== capturedProfile) throw new Error("Wallet locked or changed");
        }, onBroadcast: (hash, step) => setHashes(old => [...old, { hash, step }]),
      });
      setStage("Confirmed"); await position.refetch();
    } catch { setError("Earn did not complete. Check any listed transactions before trying again; a confirmed approval may remain active."); }
    finally { setBusy(false); }
  }

  return <section className="grid gap-8 border-b border-border py-8 lg:grid-cols-2">
    <div>
      <h2 className="text-2xl font-semibold">{p.name}</h2><p className="mt-1 text-sm text-muted-foreground">{p.protocol} · Ethereum</p>
      <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">{protocol === "sky" ? "USDS savings shares. Interest increases the USDS value of each share." : "USDC supplied to Aave. Your receipt-token balance increases with interest."} Rates vary; smart-contract and stablecoin risks apply.</p>
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between gap-4"><dt>Supplied value</dt><dd>{hidden ? "••••" : position.data ? `${display(position.data.assets, p.decimals)} ${p.asset}` : "Unavailable"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Receipt tokens</dt><dd>{hidden ? "••••" : position.data ? `${display(position.data.shares, p.decimals)} ${p.name}` : "Unavailable"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Current variable APY</dt><dd>{position.data?.apy != null ? `${position.data.apy.toFixed(2)}%` : "Unavailable"}</dd></div>
      </dl>
      <div className="mt-5 flex gap-2"><Button asChild variant="outline"><a href={p.url} target="_blank" rel="noopener noreferrer">{p.protocol}<ExternalLink className="h-4 w-4"/></a></Button><Button variant="ghost" size="icon" aria-label={`Refresh ${p.name}`} onClick={() => { if (address) void position.refetch(); if (intent) void quote.refetch(); }}><RefreshCw className="h-4 w-4"/></Button></div>
    </div>
    <div>
      <div className="mb-5 flex gap-2"><Button variant={action === "deposit" ? "default" : "outline"} onClick={() => choose("deposit")}><ArrowDownToLine className="h-4 w-4"/>Deposit</Button><Button variant={action === "withdraw" ? "default" : "outline"} onClick={() => choose("withdraw")}><ArrowUpFromLine className="h-4 w-4"/>Withdraw</Button></div>
      <Label htmlFor={`earn-${protocol}`}>{action === "deposit" ? p.asset : p.name} amount</Label>
      <Input id={`earn-${protocol}`} className="mt-2" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setReview(null); }} placeholder="0.00" disabled={!address || busy}/>
      <p className="mt-2 text-xs text-muted-foreground">Available: {hidden ? "••••" : available != null ? display(available, p.decimals) : "Unavailable"} {action === "deposit" ? p.asset : p.name}</p>
      <dl className="my-5 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt>Estimated received</dt><dd>{quote.data != null ? `${display(quote.data, p.decimals)} ${outputSymbol}` : "—"}</dd></div><div className="flex justify-between gap-4"><dt>Network fees</dt><dd>Not yet quoted · paid in ETH</dd></div></dl>
      {(position.isError || quote.isError) && <p className="mb-4 text-sm text-destructive">{quote.isError ? "Amount or route unavailable. Check balance and protocol limits." : "Live protocol data unavailable. No payment can be prepared."}</p>}
      {!isSeed && <p className="mb-4 text-sm text-muted-foreground">Viewing only. Earn signing is not available for this wallet type.</p>}
      <Button className="w-full" disabled={!intent || !quote.data || quote.isFetching || position.isError || !isSeed} onClick={() => { if (intent && quote.data) setReview({ ...intent, minimum: quote.data }); }}>Preview {action}</Button>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4"/>Execution awaiting independent review</p>
      {protocol === "sky" && <p className="mt-3 text-xs text-muted-foreground">USDC → USDS conversion is not available here yet.</p>}
      <Dialog open={!!review} onOpenChange={open => { if (!open && !busy) setReview(null); }}><DialogContent><DialogHeader><DialogTitle>Review {p.protocol} {review?.action}</DialogTitle></DialogHeader>
        <p className="break-all text-sm">Wallet: {review?.user}</p>
        <p className="text-sm">Amount: {review ? display(review.amount, p.decimals) : "—"} {review?.action === "deposit" ? p.asset : p.name}</p>
        <p className="text-sm">Estimated received: {review ? display(review.minimum, p.decimals) : "—"} {review?.action === "deposit" ? p.name : p.asset}</p>
        <p className="break-all text-xs text-muted-foreground">{review?.action === "deposit" ? "Exact-amount approval to" : "Withdrawal from"}: {p.target}</p>
        <p className="text-sm text-muted-foreground">{protocol === "sky" ? "Sky’s basic savings calls do not enforce a minimum received. Additional protection is required before execution opens." : "Deposits and withdrawals remain unavailable until independent acceptance. Withdrawal also depends on liquidity and any existing borrowing position."}</p>
        {protocol === "aave" && <p className="text-sm text-muted-foreground">Aave may automatically mark a new deposit as collateral. Accounts with existing Aave debt are excluded from this preview.</p>}
        <p className="text-xs text-muted-foreground">A deposit may need an approval reset, approval and deposit. Each transaction costs ETH; an approval can remain if the deposit fails.</p>
        {stage && <p className="text-sm">{stage}</p>}{error && <p className="text-sm text-destructive">{error}</p>}
        {hashes.map(({ hash, step }) => <a key={hash} className="break-all text-xs underline" href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer">{step}: {hash}</a>)}
        <Button disabled={!DESKTOP_EARN_EXECUTION_ENABLED || busy} onClick={() => void submit()}>Awaiting review · no funds move</Button>
      </DialogContent></Dialog>
    </div>
  </section>;
}