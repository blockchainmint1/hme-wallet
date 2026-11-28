import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "bitcoinjs-lib";
import { broadcastTx } from "./mempool";
import { findBroadcastTx, submitTxcHex, TxcBroadcastUncertainError } from "./broadcast-submit";
import { pendingTxcBroadcasts, reserveTxcBroadcast } from "./broadcast-journal";
import { recheckTxcAttempt } from "./broadcast-recheck";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
const tx = new Transaction();
tx.addInput(new Uint8Array(32).fill(9), 0);
tx.addOutput(new Uint8Array([0x51]), 1000n);
const hex = tx.toHex();
const id = tx.getId();
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe("TXC uncertain broadcast protection, shared by web/APK/extension", () => {
  it("saves the txid and input before submitting, and accepts only the local txid", async () => {
    const fetcher = vi.fn(async () => {
      expect(pendingTxcBroadcasts(storage)).toEqual([
        { txid: id, inputs: [`${"09".repeat(32)}:0`] },
      ]);
      return new Response(id);
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await broadcastTx(hex)).toBe(id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(pendingTxcBroadcasts(storage)).toEqual([]);
  });
  it("recovers an HTTP refusal when a fresh lookup returns the exact transaction", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("relay unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response(hex));
    vi.stubGlobal("fetch", fetcher);
    expect(await broadcastTx(hex)).toBe(id);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toEqual({ cache: "no-store" });
    expect(pendingTxcBroadcasts(storage)).toEqual([]);
  });
  it("a timeout and 404 remain uncertain; retry/reload never sends a second POST", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(broadcastTx(hex)).rejects.toMatchObject({
      txid: id,
      name: "TxcBroadcastUncertainError",
    });
    const restartedStorage = new MemoryStorage();
    restartedStorage.data = new Map(storage.data);
    vi.stubGlobal("window", { localStorage: restartedStorage });
    await expect(broadcastTx(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(pendingTxcBroadcasts(restartedStorage)[0]?.txid).toBe(id);
  });
  it("refuses a changed payment spending a previously uncertain input", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(broadcastTx(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    const replacement = Transaction.fromHex(hex);
    replacement.locktime = 1;
    await expect(broadcastTx(replacement.toHex())).rejects.toMatchObject({ txid: id });
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
  it("a matching readback resolves a repeated identical attempt without resubmitting", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(hex));
    vi.stubGlobal("fetch", fetcher);
    await expect(broadcastTx(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    expect(await broadcastTx(hex)).toBe(id);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
  it("a successful HTTP reply with the wrong ID does not prove success", async () => {
    const different = Transaction.fromHex(hex);
    different.locktime = 1;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(different.getId()))
        .mockResolvedValueOnce(new Response(different.toHex())),
    );
    await expect(broadcastTx(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    expect(pendingTxcBroadcasts(storage)[0]?.txid).toBe(id);
  });
  it("storage failure prevents any submission", async () => {
    storage.setItem = () => {
      throw new Error("storage disabled");
    };
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(broadcastTx(hex)).rejects.toThrow("storage disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("TXC server/card transport", () => {
  it("keeps an unknown card broadcast uncertain instead of reporting failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
        .mockResolvedValueOnce(new Response("Missing", { status: 404 })),
    );
    await expect(submitTxcHex(hex)).rejects.toMatchObject({
      txid: id,
      name: "TxcBroadcastUncertainError",
    });
  });
  it("does not mistake HTML or another transaction for a positive lookup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Unavailable</html>")));
    await expect(findBroadcastTx(id)).rejects.toThrow("different transaction");
  });
});

describe("TXC definite rejections and Check again (audit 88d4dec)", () => {
  it("a node 4xx rejection plus an exact 404 is a failure with the reason, and frees the coins", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("sendrawtransaction RPC error: min relay fee not met", { status: 400 }),
      )
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(broadcastTx(hex)).rejects.toMatchObject({
      name: "TxcBroadcastRejectedError",
      message: expect.stringContaining("min relay fee not met"),
    });
    expect(pendingTxcBroadcasts(storage)).toEqual([]);
  });
  it("a 4xx rejection whose lookup fails stays uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("bad-txns-inputs-missingorspent", { status: 400 }))
        .mockResolvedValueOnce(new Response("down", { status: 503 })),
    );
    await expect(broadcastTx(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    expect(pendingTxcBroadcasts(storage)[0]?.txid).toBe(id);
  });
  it("timeouts (408), rate limits (429) and 5xx stay uncertain", async () => {
    for (const status of [408, 429, 500]) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(new Response("try later", { status }))
          .mockResolvedValueOnce(new Response("Not found", { status: 404 })),
      );
      await expect(submitTxcHex(hex)).rejects.toBeInstanceOf(TxcBroadcastUncertainError);
    }
  });
  it("one malformed journal entry is skipped and does not block a valid send", async () => {
    storage.setItem("hme.txc.broadcast-pending.garbage", "{not json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(id)),
    );
    expect(await broadcastTx(hex)).toBe(id);
  });
  it("Check again says not-sent only when the tx is 404 and every input is unspent", async () => {
    const input = `${"09".repeat(32)}:0`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/outspends")
          ? Response.json([{ spent: false }])
          : new Response("Not found", { status: 404 }),
      ),
    );
    expect(await recheckTxcAttempt(id, [input])).toBe("not-sent");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/outspends")
          ? Response.json([{ spent: true, txid: "b".repeat(64) }])
          : new Response("Not found", { status: 404 }),
      ),
    );
    expect(await recheckTxcAttempt(id, [input])).toBe("unknown");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/outspends")
          ? new Response("down", { status: 503 })
          : new Response("Not found", { status: 404 }),
      ),
    );
    expect(await recheckTxcAttempt(id, [input])).toBe("unknown");
    expect(await recheckTxcAttempt(id, [])).toBe("unknown");
    reserveTxcBroadcast({ txid: id, inputs: [input] }, storage);
  });
});
