import { describe, expect, it } from "vitest";
import { shouldTryNextUpstream, solanaUpstreams } from "./rpc-upstreams";

describe("Solana upstream failover", () => {
  it("moves on when Solana's public endpoint blocks our hosting provider", () => {
    const blocked = '{"jsonrpc":"2.0","error":{"code": 403,"message":"Your IP or provider is blocked from this endpoint"}, "id": 1 }';
    expect(shouldTryNextUpstream(403, blocked)).toBe(true);
    expect(shouldTryNextUpstream(200, blocked)).toBe(true);
  });

  it("moves on for rate limits, outages and HTML pages", () => {
    expect(shouldTryNextUpstream(429, "{}")).toBe(true);
    expect(shouldTryNextUpstream(502, "bad gateway")).toBe(true);
    expect(shouldTryNextUpstream(200, "<html>error</html>")).toBe(true);
  });

  it("returns ordinary answers and normal RPC errors to the wallet", () => {
    expect(shouldTryNextUpstream(200, '{"jsonrpc":"2.0","id":1,"result":[]}')).toBe(false);
    expect(
      shouldTryNextUpstream(200, '{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"Transaction simulation failed"}}'),
    ).toBe(false);
  });

  it("puts the keyed provider first and never lists Solana's blocked endpoint first", () => {
    expect(solanaUpstreams("abc").map((u) => u.name)).toEqual(["alchemy", "publicnode", "solana"]);
    expect(solanaUpstreams(undefined).map((u) => u.name)).toEqual(["publicnode", "solana"]);
  });
});
