import { createFileRoute } from "@tanstack/react-router";
import { CurrencyPage } from "@/components/desktop/CurrencyPage";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/currency/$currency")({
  head: ({ params }) => desktopHead(`${params.currency.toUpperCase()} currency`, `View ${params.currency.toUpperCase()} holdings, observed value and transaction history in Honest Money.`),
  component: Page,
});
function Page() { const { currency } = Route.useParams(); return <CurrencyPage currency={currency}/>; }