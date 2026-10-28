import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TxidCard } from "@/components/wallet/TxidCard";
import { useDesktopData } from "./DesktopData";
import { fetchMergedAddressTxs } from "@/lib/address-txs";
import { getAddressTxs, explorerTxUrl, type MempoolTx } from "@/lib/txc/mempool";
import { getAddressTxs as btcTxs, explorerTxUrl as btcUrl } from "@/lib/btc/mempool";
import { getAddressTxs as ltcTxs, explorerTxUrl as ltcUrl } from "@/lib/ltc/mempool";
import { getAddressTxs as dogeTxs, explorerTxUrl as dogeUrl } from "@/lib/doge/mempool";
import { getAddressTxs as iskTxs, explorerTxUrl as iskUrl } from "@/lib/isk/mempool";
import { getEvmHistory } from "@/lib/chains/history.functions";
import { EVM_CHAINS } from "@/lib/chains/evm";
import { useHideSuspiciousActivity } from "@/lib/activity-prefs";
import { suspiciousActivityReason, formatActivityAmount } from "@/lib/suspicious-activity";
import { getTronHistory } from "@/lib/tron/api";
import { explorerTxUrl as tronUrl } from "@/lib/tron/network";
import { getSolanaHistory } from "@/lib/solana/api";
import { getKnownTokens } from "@/lib/token-prefs";
import { desktopTokenIdentity } from "@/lib/desktop/token-assets";
import { matchesCurrency } from "@/lib/desktop/currency-history";
import { decodeOmniSend, omniAmountFor } from "@/lib/txc/omni-decode";
import { getOmniTxValidity } from "@/lib/txc/tokens.functions";
import { formatTokenAmount } from "@/lib/txc/tokens";
import { maskAmount } from "@/lib/hide-balances";
import type { VaultUtxoChain } from "@/lib/vault-link/pairing";
import type { EvmChainId } from "@/lib/chains/evm";
export interface ActivityRow { currencyKey?: string | null; verificationPending?:boolean; id:string; hash:string; chain:string; symbol:string; value:string; incoming:boolean; at:number|null; confirmed:boolean; explorer:string; reason?:string|null }
const apis = {txc:getAddressTxs, btc:btcTxs, ltc:ltcTxs, doge:dogeTxs, isk:iskTxs};
const urls = {txc:explorerTxUrl, btc:btcUrl, ltc:ltcUrl, doge:dogeUrl, isk:iskUrl};
export function Activity({ preview=false, chainFilter="all", direction="all", assetFilter }: { preview?:boolean; chainFilter?:string; direction?:string; assetFilter?:string }) {
  const d=useDesktopData(); const [hide]=useHideSuspiciousActivity(); const [reveal,setReveal]=useState(false); const [detail,setDetail]=useState<ActivityRow|null>(null);
  const entries=(Object.keys(d.accounts) as VaultUtxoChain[]).filter(c=>(c==="txc"||d.enabled.includes(c))&&(!assetFilter||c===chainFilter)).map(chain=>({chain,addresses:[...(d.accounts[chain].data?.external??[]),...(d.accounts[chain].data?.internal??[])].map(a=>a.address)}));
  const utxo=useQueries({queries:entries.map(({chain,addresses})=>({queryKey:["desktop-txs",d.activeProfileId,chain,addresses.join(",")],enabled:addresses.length>0,queryFn:()=>fetchMergedAddressTxs<MempoolTx>(addresses,apis[chain]),staleTime:60_000,refetchInterval:60_000}))});
  const fetchEvm=useServerFn(getEvmHistory); const chains=d.enabled.filter(c=>c in EVM_CHAINS&&(!assetFilter||c===chainFilter)) as EvmChainId[];
  const evm=useQueries({queries:chains.map(chain=>({queryKey:["evm-history",chain,d.evmAddress,d.activeProfileId],enabled:!!d.evmAddress,queryFn:async()=>{if(!d.evmAddress)throw new Error("Address unavailable");const result=await fetchEvm({data:{chain,address:d.evmAddress}});if(result.unavailable)throw new Error("History unavailable");return result;},staleTime:300_000}))});
  const tron=useQuery({queryKey:["tron-history",d.tronAddress,d.activeProfileId],enabled:!!d.tronAddress&&d.enabled.includes("tron")&&(!assetFilter||chainFilter==="tron"),queryFn:()=>{if(!d.tronAddress)throw new Error("Address unavailable");return getTronHistory(d.tronAddress);},staleTime:300_000});
  const sol=useQuery({queryKey:["solana-history",d.solanaAddress,d.activeProfileId],enabled:!!d.solanaAddress&&d.enabled.includes("solana")&&(!assetFilter||chainFilter==="solana"),queryFn:()=>{if(!d.solanaAddress)throw new Error("Address unavailable");return getSolanaHistory(d.solanaAddress);},staleTime:300_000});
  const tsdTxids = assetFilter === "tsd" ? (utxo[entries.findIndex(e=>e.chain==="txc")]?.data ?? []).filter(tx=>decodeOmniSend(tx)?.propertyId===39).map(tx=>tx.txid).slice(0,50) : [];
  const fetchValidity=useServerFn(getOmniTxValidity);
  const validity=useQuery({queryKey:["desktop-tsd-validity",d.activeProfileId,tsdTxids.join(",")],enabled:tsdTxids.length>0,queryFn:()=>fetchValidity({data:{txids:tsdTxids}}),staleTime:300_000});
  const rows:ActivityRow[]=[];
  entries.forEach(({chain,addresses},i)=>{const own=new Set(addresses);for(const tx of utxo[i]?.data??[]){
    if(assetFilter==="tsd"){
      const omni=decodeOmniSend(tx); if(!omni||omni.propertyId!==39)continue;
      const verdict=validity.data?.[tx.txid];
      if(verdict?.valid===false)continue;
      const incoming=!(omni.sender&&own.has(omni.sender));
      if(incoming&&!omni.references.some(address=>own.has(address)))continue;
      rows.push({id:`tsd:${tx.txid}`,currencyKey:"tsd",hash:tx.txid,chain:"txc",symbol:"TSD",value:formatTokenAmount(omniAmountFor(omni,own,incoming),true),incoming,at:tx.status.block_time?tx.status.block_time*1000:null,confirmed:tx.status.confirmed&&verdict?.valid===true,explorer:urls.txc(tx.txid),verificationPending:verdict?.valid!==true});continue;
    }
    const input=tx.vin.reduce((s,v)=>s+(v.prevout?.scriptpubkey_address&&own.has(v.prevout.scriptpubkey_address)?v.prevout.value:0),0);const output=tx.vout.reduce((s,v)=>s+(v.scriptpubkey_address&&own.has(v.scriptpubkey_address)?v.value:0),0);rows.push({currencyKey:chain,id:`${chain}:${tx.txid}`,hash:tx.txid,chain,symbol:chain.toUpperCase(),value:String(Math.abs(output-input)/1e8),incoming:input===0,at:tx.status.block_time?tx.status.block_time*1000:null,confirmed:tx.status.confirmed,explorer:urls[chain](tx.txid)});}});
  chains.forEach((chain,i)=>{const list=evm[i]?.data?.transfers??[];list.forEach(t=>{const token=getKnownTokens(chain).find(token=>token.address.toLowerCase()===t.contractAddress?.toLowerCase());rows.push({currencyKey:t.category==="erc20"?(token?desktopTokenIdentity(chain,token).key:null):chain,id:`${chain}:${t.eventId??t.hash+":"+t.category+":"+t.contractAddress+":"+t.value}`,hash:t.hash,chain,symbol:t.asset,value:t.value,incoming:!t.outgoing,at:t.timestamp?Date.parse(t.timestamp):null,confirmed:true,explorer:EVM_CHAINS[chain].explorerTx(t.hash),reason:suspiciousActivityReason(t,list)});});});
  for(const t of tron.data??[])rows.push({currencyKey:t.kind==="trx"?"tron":`tron-${t.symbol}`,id:`tron:${t.txid}:${t.symbol}`,hash:t.txid,chain:"tron",symbol:t.symbol,value:String(Number(t.value)/10**t.decimals),incoming:t.to===d.tronAddress,at:t.timestamp,confirmed:t.confirmed,explorer:tronUrl(t.txid)});
  for(const t of sol.data??[])rows.push({currencyKey:"solana",id:`solana:${t.signature}`,hash:t.signature,chain:"solana",symbol:"SOL",value:String(t.lamports/1e9),incoming:t.incoming,at:t.blockTime?t.blockTime*1000:null,confirmed:t.confirmed,explorer:`https://solscan.io/tx/${encodeURIComponent(t.signature)}`});
  const selected=rows.filter(r=>(!assetFilter||matchesCurrency(r,assetFilter))&&(chainFilter==="all"||r.chain===chainFilter));
  const suspicious=selected.filter(r=>r.reason).length;
  const addressUnavailable=!!assetFilter && (chainFilter in apis ? !entries.some(e=>e.addresses.length>0) : chainFilter in EVM_CHAINS ? !d.evmAddress : chainFilter==="tron" ? !d.tronAddress : chainFilter==="solana" ? !d.solanaAddress : false);
  const visible=selected.filter(r=>(!hide||reveal||!r.reason)&&(chainFilter==="all"||r.chain===chainFilter)&&(direction==="all"||(direction==="incoming"?r.incoming:!r.incoming))).sort((a,b)=>(b.at??Number.MAX_SAFE_INTEGER)-(a.at??Number.MAX_SAFE_INTEGER));
  const queries=[...utxo,...evm,...(d.tronAddress&&d.enabled.includes("tron")&&(!assetFilter||chainFilter==="tron")?[tron]:[]),...(d.solanaAddress&&d.enabled.includes("solana")&&(!assetFilter||chainFilter==="solana")?[sol]:[]),...(assetFilter==="tsd"&&tsdTxids.length?[validity]:[])];
  return <><div className="flex items-center justify-between py-4"><h2 className="text-lg font-semibold">{preview?"Recent transactions":"Transaction history"}</h2><span className="text-xs text-muted-foreground">{queries.some(q=>q.isFetching)?"Synchronizing…":`${visible.length} transactions`}</span></div>{(addressUnavailable||queries.some(q=>q.isError))&&<p role="status" className="mb-3 text-sm text-destructive">Some networks are unavailable. Last-known transactions are retained.</p>}{suspicious>0&&hide&&<div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{suspicious} suspicious transfers · advisory only</span><Button variant="ghost" size="sm" onClick={()=>setReveal(v=>!v)}>{reveal?"Hide again":"Show hidden"}</Button></div>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="py-3">Transaction</th><th>Network</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th/></tr></thead><tbody>{(preview?visible.slice(0,5):visible).map(r=><tr key={r.id} className="border-b border-border/60"><td className="py-4"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${r.incoming?"bg-chart-2/10 text-chart-2":"bg-muted text-muted-foreground"}`}>{r.incoming?<ArrowDownLeft className="h-4 w-4"/>:<ArrowUpRight className="h-4 w-4"/>}</span><div><p className="font-medium">{r.incoming?"Received":"Sent"} {r.symbol}</p><p className="text-xs text-muted-foreground">{r.reason??`${r.hash.slice(0,8)}…${r.hash.slice(-6)}`}</p></div></div></td><td className="uppercase text-xs">{r.chain}</td><td className="text-muted-foreground">{r.at?new Date(r.at).toLocaleDateString():"Not indexed"}</td><td className="text-xs">{r.verificationPending?"Unverified":r.confirmed?"Confirmed":"Pending"}</td><td className="text-right tabular-nums">{d.hidden?maskAmount(r.value):`${r.incoming?"+":"−"}${formatActivityAmount(r.value)}`} {r.symbol}</td><td><Button variant="ghost" size="icon" title="Transaction details" onClick={()=>setDetail(r)}><ExternalLink className="h-4 w-4"/></Button></td></tr>)}</tbody></table>{visible.length===0&&<div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground"><History className="h-7 w-7"/><p className="text-sm">{queries.some(q=>q.isFetching)?"Loading transactions…":addressUnavailable||queries.some(q=>q.isError)?"Transaction history unavailable":"No transactions found for this selection"}</p></div>}</div><Dialog open={!!detail} onOpenChange={o=>!o&&setDetail(null)}><DialogContent><DialogHeader><DialogTitle>Transaction details</DialogTitle></DialogHeader>{detail&&<div className="space-y-4"><p>{detail.incoming?"Received":"Sent"} {d.hidden?maskAmount(detail.value):formatActivityAmount(detail.value)} {detail.symbol}</p><p className="text-sm text-muted-foreground">{detail.chain.toUpperCase()} · {detail.verificationPending?"Token validity unverified":detail.confirmed?"Confirmed":"Pending"}</p><TxidCard txid={detail.hash} explorerUrl={detail.explorer}/>{detail.reason&&<p className="text-sm text-destructive">{detail.reason}</p>}</div>}</DialogContent></Dialog></>;
}
