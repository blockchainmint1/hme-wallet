import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readLifiQuote } from "./lifi-response";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/lifi-quote-base.json", import.meta.url), "utf8"));
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
describe("bounded LI.FI quote response", () => {
  it("accepts the existing Base fixture and strips unrelated fields", async () => {
    const q = await readLifiQuote(response(fixture));
    expect(q.estimate.fromAmount).toBe("10000000000000000");
    expect(q.transactionRequest.chainId).toBe(8453);
    expect(q).not.toHaveProperty("action");
  });
  it("rejects invalid numeric estimates before rendering", async () => {
    await expect(readLifiQuote(response({ ...fixture, estimate: { ...fixture.estimate, toAmount: "NaN" } }))).rejects.toThrow("unsupported");
  });
  it("rejects unsupported transaction networks", async () => {
    await expect(readLifiQuote(response({ ...fixture, transactionRequest: { ...fixture.transactionRequest, chainId: 999 } }))).rejects.toThrow("unsupported");
  });
  it("rejects HTML without exposing its contents", async () => {
    await expect(readLifiQuote(new Response("private gateway details", { headers: { "content-type": "text/html" } }))).rejects.toThrow("unavailable");
  });
  it("bounds streamed response to 512 KiB", async () => {
    await expect(readLifiQuote(new Response("a".repeat(512 * 1024 + 1), { headers: { "content-type": "application/json" } }))).rejects.toThrow("size");
  });
});