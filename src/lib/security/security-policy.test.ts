import { afterEach, describe, expect, it, vi } from "vitest";
import { assertFreeformMessage, validateSiwe } from "./signing-policy";
import { classifyLoginHost, isSpendingSite, setEcosystemSites, spendingGrant } from "../web-login-hosts";
import { forwardJson, readBoundedText } from "./json-proxy.server";

const SEEDS = { host: "seeds.honest.money", label: "Seeds", delegate: true, delegate_modes: ["approve", "access"], delegate_branches: [1106] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setEcosystemSites([], true); });
describe("spending registry", () => {
  it("never trusts an attacker-named Lovable app or an unlisted honest.money subdomain for spending", () => {
    expect(classifyLoginHost("honest-seeds.lovable.app").tier).toBe("unknown");
    expect(isSpendingSite("honest-seeds.lovable.app")).toBe(false);
    expect(isSpendingSite("unlisted.honest.money")).toBe(false);
  });
  it("offline labels cannot authorize spending", () => {
    setEcosystemSites([{ host: "seeds.honest.money", label: "Seeds" }]);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
  it("only exact fresh delegate:true entries authorize spending and an empty list revokes them", () => {
    setEcosystemSites([SEEDS], true);
    expect(isSpendingSite("seeds.honest.money")).toBe(true);
    expect(isSpendingSite("other.seeds.honest.money")).toBe(false);
    setEcosystemSites([], true);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
  it("a verified site without delegate: true is refused for spending but still labeled", () => {
    setEcosystemSites(
      [
        SEEDS,
        { host: "filefingerprint.com", label: "File Fingerprint" },
        { host: "bonfire.honest.money", label: "Bonfire", delegate: false },
      ],
      true,
    );
    expect(isSpendingSite("seeds.honest.money")).toBe(true);
    expect(isSpendingSite("filefingerprint.com")).toBe(false); // missing field
    expect(isSpendingSite("bonfire.honest.money")).toBe(false); // explicit false
    expect(classifyLoginHost("filefingerprint.com").name).toBe("File Fingerprint");
    expect(classifyLoginHost("bonfire.honest.money").name).toBe("Bonfire");
  });
  it("delegate: true without reserved branches or modes is refused", () => {
    setEcosystemSites(
      [
        { host: "a.honest.money", label: "A", delegate: true },
        { host: "b.honest.money", label: "B", delegate: true, delegate_modes: ["access"], delegate_branches: [] },
        { host: "c.honest.money", label: "C", delegate: true, delegate_modes: [], delegate_branches: [1108] },
      ],
      true,
    );
    expect(isSpendingSite("a.honest.money")).toBe(false);
    expect(isSpendingSite("b.honest.money")).toBe(false);
    expect(isSpendingSite("c.honest.money")).toBe(false);
  });
  it("keeps each site's own branches and modes from honest.money", () => {
    setEcosystemSites([SEEDS, { host: "chat.honest.money", label: "HME Chat", delegate: true, delegate_modes: ["approve"], delegate_branches: [1108] }], true);
    expect(spendingGrant("seeds.honest.money")).toEqual({ modes: ["approve", "access"], branches: [1106] });
    expect(spendingGrant("chat.honest.money")).toEqual({ modes: ["approve"], branches: [1108] });
  });
  it("never accepts the card branch 1107, account 0, or anything outside 1106-2105", () => {
    setEcosystemSites([{ host: "x.honest.money", label: "X", delegate: true, delegate_modes: ["access"], delegate_branches: [0, 1107, 1105, 2106, 1.5, "1108"] }], true);
    expect(isSpendingSite("x.honest.money")).toBe(false);
  });
  it("a branch honest.money lists for two sites is refused for both", () => {
    setEcosystemSites(
      [
        { host: "a.honest.money", label: "A", delegate: true, delegate_modes: ["access"], delegate_branches: [1108] },
        { host: "b.honest.money", label: "B", delegate: true, delegate_modes: ["access"], delegate_branches: [1108, 1109] },
      ],
      true,
    );
    expect(isSpendingSite("a.honest.money")).toBe(false);
    expect(spendingGrant("b.honest.money")?.branches).toEqual([1109]);
  });
  it("spending trust expires after five minutes", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setEcosystemSites([SEEDS], true);
    vi.spyOn(Date, "now").mockReturnValue(1_300_000);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
});
describe("signature policy", () => {
  for (const text of ["example.com wants you to sign in", "Honest Money - Link wallet", "Honest Money - Revoke link", "hm-card|pay|1|{}"])
    it(`blocks authorization template ${text.split(" ")[0]}`, () => expect(() => assertFreeformMessage(text)).toThrow());
  it("allows an ordinary proof-of-ownership message", () => expect(() => assertFreeformMessage("I control this address.")).not.toThrow());
  const address = "0x" + "ab".repeat(20);
  const time = Date.parse("2026-10-20T11:40:00Z");
  const siwe = `example.com wants you to sign in with your Ethereum account:\n${address}\n\nSign in.\n\nURI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: 2026-10-20T11:40:00Z`;
  it("allows a matching current SIWE message", () => expect(() => validateSiwe(siwe, "https://example.com", address, "0x1", time)).not.toThrow());
  it("rejects other domains", () => expect(() => validateSiwe(siwe, "https://evil.com", address, "0x1", time)).toThrow());
  it("rejects other networks", () => expect(() => validateSiwe(siwe, "https://example.com", address, "0x38", time)).toThrow());
  it("rejects opaque hex payloads", () => expect(() => validateSiwe("0x" + "aa".repeat(32), "https://example.com", address, "0x1", time)).toThrow());
});
describe("JSON forwarding", () => {
  it("rejects HTML and redirects", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("<script>evil()</script>", { headers: { "content-type": "text/html" } })).mockResolvedValueOnce(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetch);
    expect((await forwardJson("https://example.com", {})).status).toBe(502);
    expect((await forwardJson("https://example.com", {})).status).toBe(502);
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("manual");
  });
  it("rejects oversized streaming bodies", async () => {
    await expect(readBoundedText(new Response("x".repeat(32769)))).rejects.toThrow();
  });
  it("returns only parsed JSON with a fixed type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { "content-type": "application/problem+json" } })));
    const response = await forwardJson("https://example.com", {});
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });
});