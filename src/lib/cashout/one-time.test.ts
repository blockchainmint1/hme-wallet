import { describe, expect, it } from "vitest";
import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  chooseCashoutPath,
  isLegacyTxcP2pkh,
  oneTimeOrderStillOpen,
  verifyOneTimeOrder,
} from "./one-time";

function txcAddr(version: number, fill: number): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.fill(fill, 1);
  const check = sha256(sha256(payload)).slice(0, 4);
  const out = new Uint8Array(25);
  out.set(payload);
  out.set(check, 21);
  return base58.encode(out);
}

const INBOX = txcAddr(0x42, 1);
const ONE_TIME = txcAddr(0x42, 2);
const REFUND = txcAddr(0x42, 3);
const SAVED = "0x7d59000000000000000000000000000000aaf07a";
const OTHER = "0x1A15000000000000000000000000000000016F8b";
const NOW = Date.parse("2026-11-11T18:00:00Z");

const req = { amount: 4000, payoutAddress: OTHER, refundAddress: REFUND };
const good = {
  id: "0b6a8f1e-1111-4222-8333-944445555666",
  status: "awaiting_deposit",
  depositAddress: ONE_TIME,
  sendTo: ONE_TIME,
  amountExpected: 4000,
  payoutAddress: OTHER.toLowerCase(),
  refundAddress: REFUND,
  payoutAmount: 3980,
  feeBps: 50,
  chain: "ethereum",
  expiresAt: "2026-11-12T18:00:00Z",
  accountTxcDepositAddress: INBOX,
};

describe("which cash-out path", () => {
  it("uses the permanent inbox only for the exact saved address", () => {
    expect(chooseCashoutPath(SAVED, SAVED.toUpperCase().replace("0X", "0x"))).toBe("account-inbox");
  });
  it("a different address is a one-time order, never a saved-address change", () => {
    expect(chooseCashoutPath(SAVED, OTHER)).toBe("one-time-order");
  });
  it("no saved address is a one-time order", () => {
    expect(chooseCashoutPath(null, OTHER)).toBe("one-time-order");
  });
});

describe("one-time order checks", () => {
  it("accepts the order and sends to its own deposit address", () => {
    const v = verifyOneTimeOrder(req, good, INBOX, NOW);
    expect(v.depositAddress).toBe(ONE_TIME);
    expect(v.depositAddress).not.toBe(INBOX);
    expect(v.payoutAddress).toBe(OTHER);
    expect(v.amount).toBe(4000);
  });
  it("refuses an order whose deposit address is the permanent inbox", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: INBOX, sendTo: INBOX }, INBOX, NOW),
    ).toThrow(/permanent inbox/);
  });
  it("refuses when the payout address came back different", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, payoutAddress: SAVED }, INBOX, NOW)).toThrow(
      /payout address/,
    );
  });
  it("refuses a different amount", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, amountExpected: 400 }, INBOX, NOW)).toThrow(
      /amount/,
    );
  });
  it("refuses a segwit or script-hash deposit address", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: "txc1qexample", sendTo: "" }, INBOX, NOW),
    ).toThrow(/legacy/);
    const p2sh = txcAddr(0x32, 2);
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: p2sh, sendTo: p2sh }, INBOX, NOW),
    ).toThrow(/legacy/);
  });
  it("refuses an order that expires within two minutes", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, expiresAt: "2026-11-11T18:01:00Z" }, INBOX, NOW),
    ).toThrow(/expired/);
  });
  it("refuses a non-Ethereum payout network", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, chain: "base" }, INBOX, NOW)).toThrow(
      /Ethereum/,
    );
  });
  it("stops paying an order two minutes before it expires", () => {
    expect(oneTimeOrderStillOpen("2026-11-11T18:03:00Z", NOW)).toBe(true);
    expect(oneTimeOrderStillOpen("2026-11-11T18:02:00Z", NOW)).toBe(false);
  });
  it("only checksum-valid T… addresses pass", () => {
    expect(isLegacyTxcP2pkh(ONE_TIME)).toBe(true);
    expect(isLegacyTxcP2pkh(ONE_TIME.slice(0, -1) + (ONE_TIME.endsWith("2") ? "3" : "2"))).toBe(false);
  });
});

describe("one-time order request", () => {
  it("posts to /cashout/orders labelled HME Wallet on Ethereum, never /payout-address", async () => {
    const { createCashout } = await import("./tsd.server");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify(good), { status: 201 });
    }) as typeof fetch;
    try {
      await createCashout({ apiKey: "k".repeat(20), ...req });
    } finally {
      globalThis.fetch = orig;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://tsd.honest.money/api/public/v1/cashout/orders");
    expect(calls[0].body).toMatchObject({
      amount: 4000,
      payoutAddress: OTHER,
      refundAddress: REFUND,
      chain: "ethereum",
      source: "HME Wallet",
    });
  });
});
