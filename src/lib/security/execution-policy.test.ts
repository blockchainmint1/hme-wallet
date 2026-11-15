import { expect, it } from "vitest";
import { REVIEWED_EVM_SWAP_SURFACES, assertReviewedExecution, assertTsdMintEvmExecution } from "./execution-policy";
it("blocks LI.FI execution before token approvals", () => expect(() => assertReviewedExecution("lifi")).toThrow());
it("lists exactly the two reviewed EVM swap surfaces", () =>
  expect([...REVIEWED_EVM_SWAP_SURFACES]).toEqual(["thorchain-router-depositWithExpiry", "tsd-bridge-mint-erc20-transfer"]));
it("refuses a TSD purchase while EVM swaps are off", () => {
  expect(() => assertTsdMintEvmExecution(false)).toThrow(/turned off/);
  expect(() => assertTsdMintEvmExecution(true)).not.toThrow();
});
