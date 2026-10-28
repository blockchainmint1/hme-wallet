import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDesktopData } from "./DesktopData";
import { getThorUsdcBtcQuote } from "@/lib/thorchain/usdc-btc.functions";
import { THOR_USDC, validateThorBtcIntent, type ThorBtcQuote, type ThorUsdcNetwork } from "@/lib/thorchain/usdc-btc";

const btc = (sats: string) => { const n = BigInt(sats); return `${n / 100_000_000n}.${(n % 100_000_000n).toString().padStart(8, "0")}`; };
export function ThorUsdcBtc({ network }: { network: ThorUsdcNetwork }) {
  const d = useDesktopData();
  const fetchQuote = useServerFn(getThorUsdcBtcQuote);
  const [amount, setAmount] = useState(""); const [destination, setDestination] = useState("");
  const [quote, setQuote] = useState<ThorBtcQuote | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now()); const revision = useRef(0);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => () => { revision.current += 1; }, []);
  const config = THOR_USDC[network];
  const row = d.rows.find(row => row.chain === network && row.symbol === "USDC" && !row.custom);
  const ownAddress = d.accounts.btc.data?.nextReceiveAddress;
  const invalidate = () => { revision.current += 1; setQuote(null); setError(""); setBusy(false); };
  const expired = quote ? quote.expiry * 1000 <= now + 60_000 || now - quote.quotedAt > 60_000 : false;
  async function getQuote(event: React.FormEvent) {
    event.preventDefault(); const attempt = ++revision.current; setQuote(null); setError(""); setBusy(true);
    try {
      const intent = { network, amount, destination }; validateThorBtcIntent(intent);
      const result = await fetchQuote({ data: intent });
      if (attempt === revision.current) { setQuote(result); setNow(Date.now()); }
    } catch (err) { if (attempt === revision.current) setError(err instanceof Error ? err.message : "THORChain quote unavailable."); }
    finally { if (attempt === revision.current) setBusy(false); }
  }
  return <div className="max-w-2xl py-4">
    <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary"/><div><h2 className="text-xl font-semibold">USDC → Bitcoin</h2><p className="text-sm text-muted-foreground">THORChain · {config.label} → Bitcoin mainnet</p></div></div>
    <form onSubmit={getQuote} className="mt-8 space-y-6">
      <div><Label htmlFor="thor-usdc-amount">Pay with USDC on {config.label}</Label><Input id="thor-usdc-amount" className="mt-2" inputMode="decimal" placeholder="0.00" value={amount} onChange={event => { invalidate(); setAmount(event.target.value); }}/><p className="mt-2 text-xs text-muted-foreground">Available: {d.hidden ? "••••" : row?.amount == null ? "Unavailable" : row.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC</p></div>
      <ArrowDown className="h-5 w-5 text-muted-foreground"/>
      <div><Label htmlFor="thor-btc-destination">Receive BTC at</Label><Input id="thor-btc-destination" className="mt-2 font-mono text-sm" placeholder="Bitcoin mainnet address" value={destination} onChange={event => { invalidate(); setDestination(event.target.value); }}/>{ownAddress && <Button variant="link" type="button" className="mt-1 h-auto px-0" onClick={() => { invalidate(); setDestination(ownAddress); }}>Use this wallet’s Bitcoin address</Button>}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}/>{busy ? "Getting quote…" : "Get THORChain quote"}</Button>
    </form>
    {quote && <div className="mt-8 border-t border-border pt-6"><h3 className="font-semibold">{expired ? "Quote expired" : "THORChain quote"}</h3><dl className="mt-4 space-y-3 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estimated receive</dt><dd className="font-semibold">{btc(quote.expectedSats)} BTC</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Minimum receive · 1% protection</dt><dd>{btc(quote.minimumSats)} BTC</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Exchange + BTC payout fees, included</dt><dd>{btc(quote.feeSats)} BTC</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Honest Money fee</dt><dd>0 USDC</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estimated swap time</dt><dd>{quote.seconds === null ? "Unavailable" : `${Math.ceil(quote.seconds)} seconds`}</dd></div>
      <div><dt className="text-muted-foreground">BTC destination</dt><dd className="mt-1 break-all font-mono text-xs">{quote.intent.destination}</dd></div>
    </dl><p className="mt-4 text-xs text-muted-foreground">Ethereum / Base gas is additional and paid in ETH. The quote is not a gas estimate.</p>
    <Button className="mt-6" disabled>Swap unavailable — awaiting independent review</Button></div>}
    <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">Quote only. No USDC approval, order or payment is created. Direct THORChain spending is awaiting independent review and device testing.</p>
  </div>;
}