import { describe, expect, it } from "vitest";
import { BLOCKBOOK_GET_MAX_HEX, blockbookSendTxRequest } from "./blockbook-broadcast";

describe("blockbookSendTxRequest", () => {
  it("keeps small transactions on the GET URL form", () => {
    const hex = "ab".repeat(3000); // 6,000 hex chars
    const { url, init } = blockbookSendTxRequest("/api/utxo/doge", hex);
    expect(url).toBe(`/api/utxo/doge/sendtx/${hex}`);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("POSTs large transactions with the exact signed bytes as the body", () => {
    const hex = "ab".repeat(BLOCKBOOK_GET_MAX_HEX / 2 + 1);
    const { url, init } = blockbookSendTxRequest("/api/utxo/doge", hex);
    expect(url).toBe("/api/utxo/doge/sendtx/");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(hex);
  });

  it("refuses non-hex or odd-length payloads", () => {
    expect(() => blockbookSendTxRequest("/api/utxo/btc", "abc")).toThrow();
    expect(() => blockbookSendTxRequest("/api/utxo/btc", "zz")).toThrow();
  });
});
