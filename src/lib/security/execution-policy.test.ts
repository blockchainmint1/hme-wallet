import { expect, it } from "vitest";
import {
  REVIEWED_EVM_SWAP_SURFACES, REVIEWED_VAULT_BATCH_SURFACES, assertReviewedExecution, assertReviewedVaultBatchSurface, assertTsdMintEvmExecution,
} from "./execution-policy";
it("blocks LI.FI execution before token approvals", () => expect(() => assertReviewedExecution("lifi")).toThrow());
it("lists exactly the two reviewed EVM swap surfaces", () =>
  expect([...REVIEWED_EVM_SWAP_SURFACES]).toEqual(["thorchain-router-depositWithExpiry", "tsd-bridge-mint-erc20-transfer"]));
it("lists exactly the two reviewed Vault batch surfaces", () =>
  expect([...REVIEWED_VAULT_BATCH_SURFACES]).toEqual(["vault-sweep-batch-to-own-address-0", "vault-native-disperse-fee-topup"]));
it("refuses an unreviewed Vault batch kind", () => {
  expect(() => assertReviewedVaultBatchSurface("vault-native-disperse-anyone")).toThrow(/hasn't been reviewed/);
  expect(() => assertReviewedVaultBatchSurface("vault-native-disperse-fee-topup")).not.toThrow();
});
it("refuses a TSD purchase while EVM swaps are off", () => {
  expect(() => assertTsdMintEvmExecution(false)).toThrow(/turned off/);
  expect(() => assertTsdMintEvmExecution(true)).not.toThrow();
});
