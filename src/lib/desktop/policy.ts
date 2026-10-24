/** Presentation-level gate only. Shared server/signing safeguards remain authoritative. */
export function desktopSwapAvailable(mode: string | undefined, chainEnabled: boolean): boolean { return mode !== "vault" && chainEnabled; }
export const DESKTOP_EARN_EXECUTION_ENABLED = false;
