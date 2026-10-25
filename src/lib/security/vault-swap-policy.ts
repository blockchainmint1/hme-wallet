/** Shared containment pending independent Vault swap acceptance. */
export function vaultSwapExecutionAllowed(mode: string | undefined): boolean {
  return mode !== "vault";
}