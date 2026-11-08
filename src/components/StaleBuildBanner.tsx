/**
 * "New version available" bar for browser tabs running old code.
 *
 * Two real incidents (large DOGE sends hitting 520s) came from tabs that were
 * opened before a fix was published and kept running the old code. This bar
 * compares the build stamp baked into this tab with the one the server is
 * shipping now, and offers a reload when they differ.
 *
 * - Web only: checkForWebUpdate returns "current" inside the phone app and the
 *   browser extension, which carry their own copy of the code.
 * - Never forces a reload: reloading locks the wallet and would drop any
 *   signing session in progress, so the user chooses when.
 * - Re-checks when the tab regains focus and every few minutes, throttled.
 */
import { useEffect, useRef, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyWebUpdate, checkForWebUpdateDetailed } from "@/lib/app-release";

const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;
const DISMISS_KEY = "hme.staleBannerDismissedFor";

export function StaleBuildBanner() {
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    try {
      setDismissedFor(window.sessionStorage.getItem(DISMISS_KEY));
    } catch {
      /* memory-only */
    }
    let alive = true;
    const run = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      try {
        const { verdict, serverBuild: sb } = await checkForWebUpdateDetailed();
        if (!alive) return;
        setServerBuild(verdict === "update" ? sb : null);
      } catch {
        /* offline or blocked — try again later */
      }
    };
    void run(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => void run(), CHECK_EVERY_MS);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!serverBuild || dismissedFor === serverBuild) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground"
    >
      <RotateCw className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">A new version is available.</span>{" "}
        <span className="text-muted-foreground">
          Reload before sending — finish any payment you&apos;re signing first. You&apos;ll unlock
          again; your wallet stays on this device.
        </span>
      </p>
      <Button
        size="sm"
        className="h-7 shrink-0 px-3 text-xs"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          void applyWebUpdate();
        }}
      >
        {reloading ? "Reloading…" : "Reload"}
      </Button>
      <button
        type="button"
        aria-label="Hide until the next version"
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDismissedFor(serverBuild);
          try {
            window.sessionStorage.setItem(DISMISS_KEY, serverBuild);
          } catch {
            /* memory-only */
          }
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
