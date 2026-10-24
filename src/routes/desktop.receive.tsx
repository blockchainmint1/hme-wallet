import { createFileRoute,useNavigate } from "@tanstack/react-router";
import { AssetFlow } from "@/components/desktop/AssetFlow";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/receive")({validateSearch:(s:Record<string,unknown>)=>({asset:typeof s.asset==="string"?s.asset:undefined}),head:()=>desktopHead("Receive","Receive funds at your real wallet addresses with network-specific QR codes."),component:Page});
function Page(){const {asset}=Route.useSearch();const navigate=useNavigate();return <AssetFlow mode="receive" asset={asset} onAsset={asset=>void navigate({to:"/desktop/receive",search:{asset}})}/>;}
