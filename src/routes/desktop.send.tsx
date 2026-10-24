import { createFileRoute,useNavigate } from "@tanstack/react-router";
import { AssetFlow } from "@/components/desktop/AssetFlow";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/send")({validateSearch:(s:Record<string,unknown>): { asset?: string } =>({asset:typeof s.asset==="string"?s.asset:undefined}),head:()=>desktopHead("Send","Review and send assets with the shared Honest Money signing safeguards."),component:Page});
function Page(){const {asset}=Route.useSearch();const navigate=useNavigate();return <AssetFlow mode="send" asset={asset} onAsset={asset=>void navigate({to:"/desktop/send",search:{asset}})}/>;}
