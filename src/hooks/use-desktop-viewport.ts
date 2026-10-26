/**
 * True only in a wide window with a mouse/trackpad — never in the APK or the
 * extension — so desktop-only layout choices cannot change phone screens.
 */
import * as React from "react";
import { DESKTOP_MIN_WIDTH, isDesktopViewport } from "@/lib/desktop-pref";

export function useDesktopViewport(): boolean {
  const [desktop, setDesktop] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia?.(
      `(pointer: fine) and (min-width: ${DESKTOP_MIN_WIDTH}px)`,
    );
    const sync = () => setDesktop(isDesktopViewport());
    sync();
    mq?.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq?.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  return desktop;
}
