import { createFileRoute } from "@tanstack/react-router";
import { BulkSend } from "@/components/desktop/BulkSend";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop/bulk-send")({
  head: () => desktopHead("Send to many", "Send TXC or TXC Omni tokens such as TSD to many recipients from a CSV list."),
  component: BulkSend,
});
