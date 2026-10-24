import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Portfolio } from "@/components/desktop/Portfolio";
import { desktopHead } from "@/components/desktop/metadata";
export const Route=createFileRoute("/desktop/")({validateSearch:(s:Record<string,unknown>): { range?: string } =>({range:typeof s.range==="string"&&["1D","1W","1M","1Y","ALL"].includes(s.range)?s.range:undefined}),head:()=>desktopHead("Portfolio","Your real balances, device balance history and asset allocation in Honest Money."),component:Page});
function Page(){const {range}=Route.useSearch();const navigate=useNavigate();return <Portfolio range={range} onRange={range=>void navigate({to:"/desktop",search:{range}})}/>;}
