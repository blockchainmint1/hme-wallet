import { describe, it, expect } from "vitest";
import { thorStatusInput } from "./schemas";
const h = "ab".repeat(32);
describe("thorStatusInput", () => {
  it("accepts EVM 0x hashes and strips the prefix", () => {
    expect(thorStatusInput.parse({ txid: "0x" + h }).txid).toBe(h.toUpperCase());
  });
  it("accepts bare UTXO txids", () => {
    expect(thorStatusInput.parse({ txid: h }).txid).toBe(h.toUpperCase());
  });
  it("rejects malformed ids", () => {
    expect(() => thorStatusInput.parse({ txid: "0x123" })).toThrow();
  });
});
