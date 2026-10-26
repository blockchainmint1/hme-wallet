import { useDesktopData } from "./DesktopData";
import { assetChain, AssetIcon } from "./Holdings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SendPage } from "@/components/wallet/shared/txc-send";
import { SendBtcPage } from "@/components/wallet/shared/btc-send";
import { SendLtcPage } from "@/components/wallet/shared/ltc-send";
import { SendDogePage } from "@/components/wallet/shared/doge-send";
import { SendIskPage } from "@/components/wallet/shared/isk-send";
import { EvmSend } from "@/components/wallet/shared/evm-send";
import { TronSend } from "@/components/wallet/shared/tron-send";
import { SolanaSend } from "@/components/wallet/shared/solana-send";
import { ReceivePage } from "@/components/wallet/shared/txc-receive";
import { ReceiveBtcPage } from "@/components/wallet/shared/btc-receive";
import { ReceiveLtcPage } from "@/components/wallet/shared/ltc-receive";
import { ReceiveDogePage } from "@/components/wallet/shared/doge-receive";
import { ReceiveIskPage } from "@/components/wallet/shared/isk-receive";
import { EvmReceive } from "@/components/wallet/shared/evm-receive";
import { TronReceive } from "@/components/wallet/shared/tron-receive";
import { SolanaReceive } from "@/components/wallet/shared/solana-receive";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { VaultBottomActions } from "@/components/wallet/VaultBottomActions";
import { QrCode } from "@/components/wallet/QrCode";
import type { VaultUtxoChain } from "@/lib/vault-link/pairing";
import { pairedPurposes } from "@/lib/vault-link/snapshot";
import { deriveVaultAddress } from "@/lib/vault-link/derive";
import { formatFiat } from "@/lib/txc/units";
export function AssetFlow({mode,asset,onAsset}:{mode:"send"|"receive";asset?:string;onAsset:(asset:string)=>void}){
 const d=useDesktopData(); const row=d.rows.find(r=>r.key===(asset??"txc")); const chain=row?assetChain(row):null;
 let content:React.ReactNode=<p className="py-10 text-sm text-muted-foreground">Select an available asset.</p>;
 if(row&&chain){
 const search={asset:row.symbol,token:row.key==="tsd"?"39":undefined};
 if(d.isVault&&!(chain in EVM_CHAINS)){
  const account=d.accounts[chain as VaultUtxoChain];const address=account?.data?.nextReceiveAddress??null;
  content=d.pairing&&d.pairing.chains[chain as VaultUtxoChain]&&row.key!=="tsd"?<div className="py-8"><h2 className="text-xl font-semibold">{mode==="send"?"Send":"Receive"} {row.symbol} · Cold Storage</h2><p className="mt-3 text-sm text-muted-foreground">Signing stays on your offline Vault device.</p>{mode==="receive"&&address&&<div className="mt-8 flex flex-col items-center gap-4"><QrCode value={address} copyValue={address} size={260}/><code className="break-all text-center text-xs">{address}</code></div>}{mode==="send"&&<div className="mt-6 flex gap-3"><VaultBottomActions pairing={d.pairing} chain={chain} receiveAddress={address} action={mode}/></div>}</div>:<p className="py-10 text-sm text-muted-foreground">{row.key==="tsd"?"Cold Storage TSD transfers need token-aware offline signing and are not available here.":"This network is not paired with your Vault."}</p>;
 }else if(chain in EVM_CHAINS){content=mode==="send"?(row.custom?<p className="py-10 text-sm text-muted-foreground">Custom-token sending is available in Phone view. Confirm the contract address before approving.</p>:<EvmSend chain={chain as EvmChainId} search={search} backTo="/desktop"/>):<EvmReceive chain={chain as EvmChainId} backTo="/desktop"/>;}
 else if(mode==="send")switch(chain){case "txc":content=<SendPage search={search} backTo="/desktop"/>;break;case "btc":content=<SendBtcPage search={search} backTo="/desktop"/>;break;case "ltc":content=<SendLtcPage search={search} backTo="/desktop"/>;break;case "doge":content=<SendDogePage search={search} backTo="/desktop"/>;break;case "isk":content=<SendIskPage search={search} backTo="/desktop"/>;break;case "tron":content=<TronSend search={search} backTo="/desktop"/>;break;case "solana":content=<SolanaSend backTo="/desktop"/>;break;}
 else switch(chain){case "txc":content=<ReceivePage asset={row.key==="tsd"?"tsd":"txc"} backTo="/desktop"/>;break;case "btc":content=<ReceiveBtcPage backTo="/desktop"/>;break;case "ltc":content=<ReceiveLtcPage backTo="/desktop"/>;break;case "doge":content=<ReceiveDogePage backTo="/desktop"/>;break;case "isk":content=<ReceiveIskPage backTo="/desktop"/>;break;case "tron":content=<TronReceive backTo="/desktop"/>;break;case "solana":content=<SolanaReceive backTo="/desktop"/>;break;}
 }
 return <><h1 className="text-3xl font-semibold">{mode==="send"?"Send":"Receive"}</h1><div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]"><aside><label className="mb-2 block text-xs text-muted-foreground">Asset & network</label><Select value={row?.key??""} onValueChange={onAsset}><SelectTrigger aria-label="Asset and network"><SelectValue placeholder="Select asset"/></SelectTrigger><SelectContent>{d.rows.map(r=><SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}</SelectContent></Select>{row&&<div className="mt-8 space-y-4 border-t border-border pt-6"><AssetIcon asset={row}/><div><p className="font-medium">{row.name}</p><p className="mt-1 text-xs uppercase text-muted-foreground">{chain}</p></div><div><p className="text-xs text-muted-foreground">Available balance</p><p className="mt-1 font-semibold">{d.hidden?"••••":row.amount===null?"Unavailable":row.amount.toLocaleString(undefined,{maximumFractionDigits:8})} {row.symbol}</p><p className="text-xs text-muted-foreground">{d.hidden?"••••":row.usd===null?"Value unavailable":formatFiat(row.usd)}</p></div><p className="text-xs text-muted-foreground">{mode==="send"?"Transfers are irreversible. Check the recipient and network before approving.":"Only receive assets on the network selected above."}</p></div>}</aside><section key={`${d.activeProfileId}:${row?.key}:${mode}`} className="desktop-payment min-w-0 border-t border-border lg:border-l lg:border-t-0 lg:pl-8">{content}</section></div></>;
}
