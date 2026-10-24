import { createFileRoute } from "@tanstack/react-router";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { desktopHead } from "@/components/desktop/metadata";
export const Route = createFileRoute("/desktop")({ head:()=>desktopHead("Workspace", "Your self-custodial Honest Money desktop wallet."), component:DesktopShell });
