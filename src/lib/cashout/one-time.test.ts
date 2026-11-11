import { describe, expect, it } from "vitest";
import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  chooseCashoutPath,
  isLegacyTxcP2pkh,
  oneTimeOrderStillOpen,
  recheckOneTimeOrder,
  recheckSavedInbox,
  tsdUnits,
  verifyOneTimeOrder,
} from "./one-time";
import { pickOmniSender } from "../txc/omni-sender";

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

const OWN = txcAddr(0x42, 4);
const req = { amount: 4000, payoutAddress: OTHER, refundAddress: REFUND };
const ctx = { permanentInbox: INBOX, ownAddresses: [REFUND, OWN], now: NOW };
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
    const v = verifyOneTimeOrder(req, good, ctx);
    expect(v.depositAddress).toBe(ONE_TIME);
    expect(v.depositAddress).not.toBe(INBOX);
    expect(v.payoutAddress).toBe(OTHER);
    expect(v.amount).toBe(4000);
  });
  it("refuses an order whose deposit address is the permanent inbox", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: INBOX, sendTo: INBOX }, ctx),
    ).toThrow(/permanent inbox/);
  });
  it("refuses when the payout address came back different", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, payoutAddress: SAVED }, ctx)).toThrow(
      /payout address/,
    );
  });
  it("refuses a different amount", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, amountExpected: 400 }, ctx)).toThrow(
      /amount/,
    );
  });
  it("refuses a segwit or script-hash deposit address", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: "txc1qexample", sendTo: "" }, ctx),
    ).toThrow(/legacy/);
    const p2sh = txcAddr(0x32, 2);
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: p2sh, sendTo: p2sh }, ctx),
    ).toThrow(/legacy/);
  });
  it("refuses an order with less than one hour left", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, expiresAt: "2026-11-11T18:59:00Z" }, ctx),
    ).toThrow(/expired/);
    expect(verifyOneTimeOrder(req, { ...good, expiresAt: "2026-11-11T19:01:00Z" }, ctx).id).toBe(good.id);
  });
  it("refuses a deposit address this wallet owns", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, depositAddress: OWN, sendTo: OWN }, ctx),
    ).toThrow(/belongs to this wallet/);
  });
  it("refuses when TSD Swap names a different account deposit address than the account read", () => {
    expect(() =>
      verifyOneTimeOrder(req, { ...good, accountTxcDepositAddress: txcAddr(0x42, 9) }, ctx),
    ).toThrow(/different account deposit address/);
  });
  it("compares amounts exactly as decimals, not floats", () => {
    const r = { ...req, amount: "4000.12345678" };
    expect(verifyOneTimeOrder(r, { ...good, amountExpected: 4000.12345678 }, ctx).amount).toBe(4000.12345678);
    expect(() => verifyOneTimeOrder(r, { ...good, amountExpected: 4000.12345679 }, ctx)).toThrow(/amount/);
    expect(() => verifyOneTimeOrder({ ...req, amount: "0.3" }, { ...good, amountExpected: 0.1 + 0.2 }, ctx)).toThrow(/amount/);
  });
  it("refuses a non-Ethereum payout network", () => {
    expect(() => verifyOneTimeOrder(req, { ...good, chain: "base" }, ctx)).toThrow(
      /Ethereum/,
    );
  });
  it("stops paying an order one hour before it expires", () => {
    expect(oneTimeOrderStillOpen("2026-11-11T19:00:01Z", NOW)).toBe(true);
    expect(oneTimeOrderStillOpen("2026-11-11T19:00:00Z", NOW)).toBe(false);
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

describe("exact TSD amounts", () => {
  it("reads strings and JSON numbers to 8 decimal places", () => {
    expect(tsdUnits("4000")).toBe(400_000_000_000n);
    expect(tsdUnits(4000.5)).toBe(400_050_000_000n);
    expect(tsdUnits("0.00000001")).toBe(1n);
  });
  it("refuses more than 8 decimals, negatives and exponent forms", () => {
    expect(tsdUnits("1.000000001")).toBeNull();
    expect(tsdUnits(-1)).toBeNull();
    expect(tsdUnits(1e-9)).toBeNull();
  });
});

describe("re-check right before signing", () => {
  const locked = {
    orderId: good.id,
    depositAddress: ONE_TIME,
    payoutAddress: OTHER,
    amount: 4000,
    refundAddress: REFUND,
  };
  it("passes while the order still waits for this exact deposit", () => {
    expect(() => recheckOneTimeOrder(locked, good, NOW)).not.toThrow();
  });
  it("stops once the order is no longer awaiting a deposit", () => {
    expect(() => recheckOneTimeOrder(locked, { ...good, status: "expired" }, NOW)).toThrow(/no longer waiting/);
  });
  it("stops with less than an hour left", () => {
    expect(() =>
      recheckOneTimeOrder(locked, { ...good, expiresAt: "2026-11-11T18:30:00Z" }, NOW),
    ).toThrow(/less than an hour/);
  });
  it("stops when payout, deposit or amount changed", () => {
    expect(() => recheckOneTimeOrder(locked, { ...good, payoutAddress: SAVED }, NOW)).toThrow(/payout/);
    expect(() => recheckOneTimeOrder(locked, { ...good, depositAddress: INBOX }, NOW)).toThrow(/deposit/);
    expect(() => recheckOneTimeOrder(locked, { ...good, amountExpected: 3999 }, NOW)).toThrow(/amount/);
  });
  it("saved-address cash-out stops if the saved address changed since review", () => {
    const saved = { depositAddress: INBOX, payoutAddress: SAVED, amount: 10 };
    expect(() => recheckSavedInbox(saved, { depositAddress: INBOX, payoutAddress: SAVED })).not.toThrow();
    expect(() => recheckSavedInbox(saved, { depositAddress: INBOX, payoutAddress: OTHER })).toThrow(/saved cash-out address/);
    expect(() => recheckSavedInbox(saved, { depositAddress: ONE_TIME, payoutAddress: SAVED })).toThrow(/deposit address/);
  });
});

describe("refund address is the address the TSD leaves from", () => {
  const perAddr = {
    [REFUND]: { 39: "500000000000" }, // 5,000 TSD
    [OWN]: { 39: "900000000000" }, // 9,000 TSD
  };
  it("picks the biggest holder that covers the amount, same as the send", () => {
    expect(pickOmniSender([REFUND, OWN], perAddr, 39, 400_000_000_000n)).toBe(OWN);
  });
  it("is never an address that can't cover the whole amount", () => {
    expect(pickOmniSender([REFUND, OWN], perAddr, 39, 950_000_000_000n)).toBeNull();
  });
});
