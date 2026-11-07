import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKBOOK_GET_MAX_HEX,
  blockbookBroadcast,
  blockbookSendTxRequest,
  isAlreadyKnownBroadcastError,
  setLookupRetryMsForTests,
  signedTxid,
} from "./blockbook-broadcast";

// A real, public, confirmed Dogecoin mainnet transaction (one input, two outputs).
const REAL_HEX =
  "0100000001615a707f63c215b7bb474ba08df0fe8b828f1571a15bb9608c3531b3052331be720000006b483045022100c4f1ebf422193ede80c60bef1342f32862f2d7986151ef0f9a80d5e16fddaf3b022020d736c5d645420f77ee54123974bdabbb3b4fea0b0245be92039531cc07b2a80121027af95cdd6c4be5ba0db8d0618b73f5269ffc62b6c840163646ac0b08c05c9be8ffffffff025ae4ae05000000001976a914830a7420e63d76244ff7cbd1c248e94c1446325988ac4bece705000000001976a914e8ff15ed1b37d01e4fc6e4c768e7dafe0cd5bc8a88ac00000000";
const REAL_TXID = "1b51a116ba75cc0dd9e13b86bd570629427a5d7d009d80706f4ba16137f5eee8";
const API = "/api/utxo/doge";

type Reply = { status: number; body: string } | Error;
function mockFetch(replies: Record<"send" | "lookup", Reply[]>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    const kind = url.includes("/sendtx/") ? "send" : "lookup";
    calls.push(kind);
    const next = replies[kind].shift();
    if (!next) throw new Error(`unexpected ${kind} call`);
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
const notFound = { status: 400, body: JSON.stringify({ error: `Transaction '${REAL_TXID}' not found` }) };
const found = { status: 200, body: JSON.stringify({ txid: REAL_TXID }) };

beforeEach(() => setLookupRetryMsForTests(0));
afterEach(() => vi.unstubAllGlobals());

describe("blockbookSendTxRequest", () => {
  it("keeps small transactions on the GET URL form", () => {
    const hex = "ab".repeat(3000); // 6,000 hex chars
    const { url, init } = blockbookSendTxRequest(API, hex);
    expect(url).toBe(`${API}/sendtx/${hex}`);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("POSTs large transactions with the exact signed bytes as the body", () => {
    const hex = "ab".repeat(BLOCKBOOK_GET_MAX_HEX / 2 + 1);
    const { url, init } = blockbookSendTxRequest(API, hex);
    expect(url).toBe(`${API}/sendtx/`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(hex);
  });

  it("refuses non-hex or odd-length payloads", () => {
    expect(() => blockbookSendTxRequest("/api/utxo/btc", "abc")).toThrow();
    expect(() => blockbookSendTxRequest("/api/utxo/btc", "zz")).toThrow();
  });
});

describe("blockbookBroadcast outcome handling", () => {
  it("computes the txid locally from the signed bytes", () => {
    expect(signedTxid(REAL_HEX)).toBe(REAL_TXID);
  });

  it("recognises the node's 'already known' wordings", () => {
    expect(isAlreadyKnownBroadcastError("doge broadcast rejected: -27: transaction already in block chain")).toBe(true);
    expect(isAlreadyKnownBroadcastError("btc broadcast rejected: -26: txn-already-in-mempool")).toBe(true);
    expect(isAlreadyKnownBroadcastError("btc broadcast rejected: txn-mempool-conflict")).toBe(false);
  });

  it("treats a failover backend's 'already in block chain' as success with the local txid", async () => {
    const calls = mockFetch({ send: [{ status: 400, body: '{"error":"-27: transaction already in block chain"}' }], lookup: [] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).resolves.toBe(REAL_TXID);
    expect(calls).toEqual(["send"]);
  });

  it("after a 520, reports success when the txid lookup finds the transaction", async () => {
    mockFetch({ send: [{ status: 520, body: "error code: 520" }], lookup: [found] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).resolves.toBe(REAL_TXID);
  });

  it("after a 520, looks twice before saying the transaction was not found", async () => {
    const calls = mockFetch({ send: [{ status: 520, body: "error code: 520" }], lookup: [notFound, notFound] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).rejects.toThrow(/was not found on the network/);
    expect(calls).toEqual(["send", "lookup", "lookup"]);
  });

  it("only says coins did not move when the node rejected it and the lookup confirms absence", async () => {
    mockFetch({ send: [{ status: 400, body: '{"error":"-26: min relay fee not met"}' }], lookup: [notFound] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).rejects.toThrow(/min relay fee not met.*your coins did not move/);
  });

  it("never claims safety when the lookup itself fails", async () => {
    mockFetch({ send: [{ status: 520, body: "error code: 520" }], lookup: [new Error("offline"), { status: 502, body: "upstream unavailable" }] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).rejects.toThrow(/could not confirm whether/);
  });

  it("refuses a success answer naming a different txid", async () => {
    mockFetch({ send: [{ status: 200, body: JSON.stringify({ result: "ff".repeat(32) }) }], lookup: [] });
    await expect(blockbookBroadcast(API, REAL_HEX, "doge")).rejects.toThrow(/unexpected transaction id/);
  });
});
