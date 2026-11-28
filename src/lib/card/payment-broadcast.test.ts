import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payments, Transaction } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { rootFromSeed } from "@/lib/txc/wallet";

const state = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>,
  key: "",
  failClaim: false,
  claimCode: "" as string,
  reject: false,
  unspent: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let patch: Record<string, unknown> | null = null;
      const filters: [string, unknown][] = [];
      const result = () => {
        if (table === "nfc_cards") return { data: { status: "active" } };
        if (table === "nfc_card_keys") return { data: { enc_key: state.key } };
        if (patch && state.failClaim && "txid" in patch && !("status" in patch))
          return {
            data: null,
            error: Object.assign(
              new Error("claim refused"),
              state.claimCode ? { code: state.claimCode } : {},
            ),
          };
        if (patch && filters.every(([key, value]) => state.payment[key] === value))
          Object.assign(state.payment, patch);
        return { data: { ...state.payment }, error: null };
      };
      const builder = {
        select: (_fields: string) => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        is: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        update: (value: Record<string, unknown>) => {
          patch = value;
          return builder;
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  },
}));
import { encryptKey, executePayment, p2pkhFromPriv } from "./card.server";

const root = rootFromSeed(new Uint8Array(32).fill(31));
const privateKey = root.privateKey;
if (!privateKey) throw new Error("Expected synthetic test key");
const from = p2pkhFromPriv(privateKey);
const prev = new Transaction();
prev.addInput(new Uint8Array(32).fill(21), 0);
prev.addOutput(
  payments.p2pkh({ address: from, network: TXC_NETWORK }).output ?? new Uint8Array(),
  100_000n,
);
let signedHex = "";
beforeEach(async () => {
  vi.stubEnv("CARD_KEY_ENC", "synthetic-card-encryption-for-this-test-only");
  state.key = await encryptKey(Buffer.from(privateKey).toString("hex"));
  state.payment = {
    id: "test-payment",
    status: "pending",
    txid: null,
    card_id: "test-card",
    pay_to: from,
    amount_units: 100000000,
  };
  state.failClaim = false;
  state.claimCode = "";
  state.reject = false;
  state.unspent = false;
  signedHex = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function network(found = false) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/utxo"))
      return Response.json([{ txid: prev.getId(), vout: 0, value: 100000 }]);
    if (url.endsWith(`/tx/${prev.getId()}/hex`)) return new Response(prev.toHex());
    if (url.includes("/fees/recommended")) return Response.json({ halfHourFee: 1, minimumFee: 1 });
    if (init?.method === "POST") {
      signedHex = String(init.body);
      expect(state.payment["txid"]).toBe(Transaction.fromHex(signedHex).getId());
      return state.reject
        ? new Response("min relay fee not met", { status: 400 })
        : new Response("Unavailable", { status: 503 });
    }
    if (url.endsWith("/outspends") && state.unspent) return Response.json([{ spent: false }]);
    return found && signedHex
      ? new Response(signedHex)
      : new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("card uncertain-payment reservation", () => {
  it("stores the local txid before broadcast and leaves uncertainty pending, never failed", async () => {
    const fetcher = network();
    const first = await executePayment("test-payment");
    expect(first.status).toBe("sending");
    expect(state.payment["status"]).toBe("pending");
    expect(state.payment["txid"]).toBe(first.txid);
    const again = await executePayment("test-payment");
    expect(again.status).toBe("sending");
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
  it("a later exact readback resolves pending without another payment", async () => {
    network();
    await executePayment("test-payment");
    const fetcher = network(true);
    const result = await executePayment("test-payment");
    expect(result.status).toBe("paid");
    expect(state.payment["status"]).toBe("paid");
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
  it("does not submit when saving/claiming the attempt fails and does not release the reservation", async () => {
    state.failClaim = true;
    const fetcher = network();
    expect((await executePayment("test-payment")).status).toBe("sending");
    expect(state.payment["status"]).toBe("pending");
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
  it("leaves already-paid records byte-for-byte unchanged", async () => {
    state.payment["status"] = "paid";
    state.payment["txid"] = "a".repeat(64);
    const before = JSON.stringify(state.payment);
    const fetcher = network();
    await executePayment("test-payment");
    expect(JSON.stringify(state.payment)).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("a definite node rejection fails the payment and releases the invoice and limit", async () => {
    state.reject = true;
    network();
    const r = await executePayment("test-payment");
    expect(r.status).toBe("failed");
    expect(state.payment["status"]).toBe("failed");
    expect(String(state.payment["reason"])).toContain("min relay fee not met");
  });
  it("a stuck pending row is released only when the tx is absent and its coins are unspent", async () => {
    network();
    await executePayment("test-payment");
    expect(state.payment["status"]).toBe("pending");
    expect(state.payment["attempt_inputs"]).toEqual([`${prev.getId()}:0`]);
    state.unspent = true;
    const fetcher = network();
    const r = await executePayment("test-payment");
    expect(r.status).toBe("failed");
    expect(state.payment["status"]).toBe("failed");
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
  it("a definite claim error returns failed, not sending", async () => {
    state.failClaim = true;
    state.claimCode = "23505";
    const fetcher = network();
    expect((await executePayment("test-payment")).status).toBe("failed");
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
});
