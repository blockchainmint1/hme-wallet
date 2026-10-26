import { isExtension, isNative } from "@/lib/native/platform";

const KEY = "hm.view.phone";
export const DESKTOP_MIN_WIDTH = 1024;

/** Remember an explicit "Phone view" choice on this device. */
export function setPreferPhone(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* noop */ }
}

/**
 * A wide window driven by a mouse/trackpad. Desktop-only layout choices ask
 * this instead of the routing preference below, and the APK and extension can
 * never answer yes.
 */
export function isDesktopViewport(): boolean {
  if (typeof window === "undefined" || isNative() || isExtension()) return false;
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? true;
  return finePointer && window.innerWidth >= DESKTOP_MIN_WIDTH;
}

/** Wide desktop browsers default to /desktop; APK, extension and phones never do. */
export function shouldDefaultToDesktop(): boolean {
  if (!isDesktopViewport()) return false;
  try { if (localStorage.getItem(KEY) === "1") return false; } catch { /* noop */ }
  return true;
}
