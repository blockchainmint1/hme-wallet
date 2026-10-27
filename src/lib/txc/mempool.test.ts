import { afterEach, describe, expect, it, vi } from "vitest";
import { getOutspend } from "./mempool";
import { MEMPOOL_API } from "./network";

const txid = "ab".repeat(32);
afterEach(() => vi.unstubAllGlobals());

describe("TXC fresh spent-output checks", () => {
  it("uses the supported transaction-wide endpoint and exact output index", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ spent: true }, { spent: false }]));
    vi.stubGlobal("fetch", fetcher);
    expect(await getOutspend(txid, 1)).toEqual({ spent: false });
    expect(fetcher).toHaveBeenCalledWith(`${MEMPOOL_API}/tx/${txid}/outspends`, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    expect(await getOutspend(txid, 0)).toEqual({ spent: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[], {}, [{ spent: "false" }], [null], [{ txid }]])("refuses missing or malformed output data %j", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(getOutspend(txid, 0)).rejects.toThrow("invalid spent-input check");
  });
  it.each([new Response("Unavailable", { status: 503 }), new Response("<html>website</html>")])("refuses non-data responses", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getOutspend(txid, 0)).rejects.toThrow("Nothing was submitted");
  });
  it("reports a failed connection without allowing a send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getOutspend(txid, 0)).rejects.toThrow("Nothing was submitted");
  });
  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid index %s before requesting", async vout => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getOutspend(txid, vout)).rejects.toThrow("Invalid TXC output reference");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed transaction IDs before requesting", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getOutspend("../tx", 0)).rejects.toThrow("Invalid TXC output reference");
    expect(fetcher).not.toHaveBeenCalled();
  });
});