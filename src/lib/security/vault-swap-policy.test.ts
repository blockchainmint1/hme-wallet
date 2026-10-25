import { expect, it } from "vitest";
import { vaultSwapExecutionAllowed } from "./vault-swap-policy";
it("Vault swaps stay unavailable independently of presentation", () => {
  expect(vaultSwapExecutionAllowed("vault")).toBe(false);
});
it("the Vault hold does not pause regular seed-wallet swaps", () => {
  expect(vaultSwapExecutionAllowed("seed")).toBe(true);
});