/**
 * honest.money's site list is checked fresh before every trading link. When it
 * can't be reached, the wallet must say so plainly (not "hasn't approved"),
 * must not read the link or share anything, and the server must retry a stall.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const reg = vi.hoisted(() => ({ answer: { sites: [] as unknown[], verified: false } as { sites: unknown[]; verified: boolean } }));
vi.mock("@/lib/ecosystem-sites.functions", () => ({ getEcosystemSites: async () => reg.answer }));

const SEEDS = { host: "seeds.honest.money", label: "SEEDS", delegate: true, delegate_modes: ["approve", "access"], delegate_branches: [1106] };
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const { fetchDelegateManifest, REGISTRY_UNREACHABLE } = await import("./delegate");
const { setEcosystemSites, spendingGrant } = await import("@/lib/web-login-hosts");

describe("trading link when honest.money can't be reached", () => {
  it("says it couldn't reach honest.money, never 'hasn't approved', and reads nothing", async () => {
    reg.answer = { sites: [], verified: false };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchDelegateManifest("https://seeds.honest.money/api/public/hme-link/manifest/abc")).rejects.toThrow(REGISTRY_UNREACHABLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an outage doesn't wipe a grant the last good list gave", async () => {
    setEcosystemSites([SEEDS], true);
    reg.answer = { sites: [], verified: false };
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchDelegateManifest("https://seeds.honest.money/api/public/hme-link/manifest/abc")).rejects.toThrow(REGISTRY_UNREACHABLE);
    expect(spendingGrant("seeds.honest.money")?.branches).toEqual([1106]);
  });

  it("a list without the verified flag (older server answer) is refused too", async () => {
    reg.answer = { sites: [SEEDS] } as never;
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchDelegateManifest("https://seeds.honest.money/api/public/hme-link/manifest/abc")).rejects.toThrow(REGISTRY_UNREACHABLE);
  });
});

describe("server registry fetch", () => {
  it("retries once after a stall and accepts the signed answer", async () => {
    vi.stubEnv("HME_ECOSYSTEM", "test-secret");
    const body = JSON.stringify({ sites: [SEEDS] });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", "test-secret").update(`${ts}.${body}`).digest("hex");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(new Response(body, { status: 200, headers: { "x-hme-timestamp": ts, "x-hme-signature": sig } }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadEcosystemSites } = await import("@/lib/ecosystem-sites.server");
    const sites = await loadEcosystemSites();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sites.find((s) => s.host === "seeds.honest.money")?.delegate_branches).toEqual([1106]);
  });

  it("does not retry a refusal (401)", async () => {
    vi.resetModules();
    vi.stubEnv("HME_ECOSYSTEM", "test-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadEcosystemSites } = await import("@/lib/ecosystem-sites.server");
    await expect(loadEcosystemSites()).rejects.toThrow("registry 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
