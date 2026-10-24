import { createFileRoute } from "@tanstack/react-router";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { desktopHead } from "@/components/desktop/metadata";
import { PreferenceScopeContext } from "@/lib/preference-scope";
export const Route = createFileRoute("/desktop")({ head:()=>desktopHead("Workspace", "Your self-custodial Honest Money desktop wallet."), component:DesktopLayout });
function DesktopLayout() { return <PreferenceScopeContext.Provider value="desktop"><DesktopShell/></PreferenceScopeContext.Provider>; }
