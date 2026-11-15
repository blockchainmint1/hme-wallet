import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import {
  MINT_SOURCES, TSD_BRIDGE_CONTRACT_PIN, TSD_BRIDGE_LATE_DEPOSIT_POLICY, assertMintTransferRequest,
  availableMintSources, mintContractsConfirmed, buildMintTransfer, confirmLockedMintOrder, decimalUnits, estimateTsdOut,
  mintAmountInLimits, mintGasCovered, mintSource, parseMintAmount, recheckMintOrder, verifyMintOrder,
  type MintOrderResponse, type TsdBridgeTerms,
} from "./mint";
import {
  findReusableMintOrder, isPaidMintRecord, lockedFromRecord, reviewedRecord, staleReviewedOrders, type MintRecord,
} from "./mint-history";
import { USDC_BY_CHAIN, USDT_BY_CHAIN, PYUSD_BY_CHAIN } from "@/lib/chains/erc20";
import { EVM_CHAINS } from "@/lib/chains/evm";
import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

function txcAddr(fill: number): string {
  const payload = new Uint8Array(21);
  payload[0] = 0x42;
  payload.fill(fill, 1);
  const out = new Uint8Array(25);
  out.set(payload);
  out.set(sha256(sha256(payload)).slice(0, 4), 21);
  return base58.encode(out);
}

const NOW = Date.parse("2026-11-15T12:00:00Z");
const HOUR = 60 * 60_000;
const RECIPIENT = txcAddr(7);
const OWN_EVM = "0x1111111111111111111111111111111111111111";
const DEPOSIT = "0x2222222222222222222222222222222222222222";
const usdc = mintSource("usdc-eth")!;

const terms: TsdBridgeTerms = {
  live: true, minAmount: 10, maxAmount: 100000, mintFeeBps: 0, redeemFeeBps: 0,
  depositTokens: ["USDC", "USDT", "PYUSD", "DAI"], chains: ["ethereum", "base"],
};

function reply(over: Partial<MintOrderResponse> = {}): MintOrderResponse {
  return {
    id: "6b8a7c2e-1f4d-4a5b-9c3e-2d1f0e9a8b7c", status: "awaiting_deposit", direction: "mint", asset: "TSD",
    depositAddress: DEPOSIT, sendTo: DEPOSIT, address: DEPOSIT, depositToken: "USDC", recipient: RECIPIENT,
    chain: "ethereum", amountExpected: 250.5, mintFeeBps: 0, feeBps: 0,
    expiresAt: new Date(NOW + 24 * HOUR).toISOString(), ...over,
  };
}
const req = { source: usdc, amount: "250.5", recipient: RECIPIENT };
const ctx = { ownEvmAddresses: [OWN_EVM], now: NOW };

/** The rules with a confirmed pin, for tests of the other conditions. */
const CONFIRMED = { writtenConfirmation: "test: TSD Bridge confirmed in writing" };
const availableMintSourcesC = (t: Parameters<typeof availableMintSources>[0]) => availableMintSources(t, CONFIRMED);

describe("buy-TSD sources", () => {
  it("only offer contracts both TSD Bridge and this wallet use", () => {
    const wallet = [USDC_BY_CHAIN.eth, USDT_BY_CHAIN.eth, PYUSD_BY_CHAIN.eth!, USDC_BY_CHAIN.base, USDT_BY_CHAIN.base];
    expect(MINT_SOURCES.map((s) => s.contract)).toEqual(wallet.map((t) => t.address));
    for (const s of MINT_SOURCES) expect(s.chainId).toBe(EVM_CHAINS[s.chain].viemChain.id);
  });
  it("are hidden while TSD Bridge is paused and filtered by its accepted tokens", () => {
    expect(availableMintSourcesC({ ...terms, live: false })).toEqual([]);
    expect(availableMintSourcesC({ ...terms, depositTokens: ["USDC"], chains: ["base"] }).map((s) => s.id)).toEqual(["usdc-base"]);
  });
});

describe("amounts", () => {
  it("parse exactly with token decimals and refuse extra places", () => {
    expect(parseMintAmount("250.5", usdc)).toBe(250_500_000n);
    expect(parseMintAmount("0.0000001", usdc)).toBeNull();
    expect(parseMintAmount("1e3", usdc)).toBeNull();
    expect(parseMintAmount("0", usdc)).toBeNull();
  });
  it("respect TSD Bridge's 10–100,000 limits", () => {
    expect(mintAmountInLimits(9_999_999n, usdc, terms)).toBe(false);
    expect(mintAmountInLimits(10_000_000n, usdc, terms)).toBe(true);
    expect(mintAmountInLimits(100_000_000_001n, usdc, terms)).toBe(false);
  });
  it("estimate 1:1 TSD after the mint fee", () => {
    expect(estimateTsdOut(250_500_000n, usdc, 0)).toBe(25_050_000_000n);
    expect(estimateTsdOut(100_000_000n, usdc, 50)).toBe(9_950_000_000n);
  });
});

describe("verifyMintOrder", () => {
  it("accepts the order we asked for", () => {
    const v = verifyMintOrder(req, reply(), ctx);
    expect(v.depositAddress).toBe(DEPOSIT);
    expect(v.units).toBe("250500000");
  });
  const bad: [string, Partial<MintOrderResponse>][] = [
    ["not waiting", { status: "expired" }],
    ["redeem order", { direction: "redeem" }],
    ["other asset", { asset: "CAN" }],
    ["bad deposit", { depositAddress: "T123", sendTo: undefined, address: undefined }],
    ["zero deposit", { depositAddress: "0x0000000000000000000000000000000000000000", sendTo: undefined, address: undefined }],
    ["own wallet deposit", { depositAddress: OWN_EVM, sendTo: OWN_EVM, address: OWN_EVM }],
    ["token contract deposit", { depositAddress: usdc.contract, sendTo: usdc.contract, address: usdc.contract }],
    ["aliases disagree", { sendTo: "0x3333333333333333333333333333333333333333" }],
    ["chain changed", { chain: "base" }],
    ["token changed", { depositToken: "USDT" }],
    ["recipient changed", { recipient: txcAddr(8) }],
    ["recipient missing", { recipient: undefined }],
    ["amount drift", { amountExpected: 250.500001 }],
    ["fee missing", { mintFeeBps: undefined, feeBps: undefined }],
    // On mint orders `feeBps` describes cash-outs (TSD Bridge, 2026-11-15); only mintFeeBps counts.
    ["only the cash-out fee field", { mintFeeBps: undefined, feeBps: 0 }],
    ["two hours or less left", { expiresAt: new Date(NOW + 2 * HOUR).toISOString() }],
  ];
  for (const [name, over] of bad) {
    it(`refuses: ${name}`, () => expect(() => verifyMintOrder(req, reply(over), ctx)).toThrow(/Nothing was sent/));
  }
});

describe("recheckMintOrder", () => {
  const locked = verifyMintOrder(req, reply(), ctx);
  it("passes while the order is unchanged and open", () => {
    expect(() => recheckMintOrder(locked, reply(), NOW + HOUR)).not.toThrow();
  });
  it("refuses once two hours or less are left (TSD Bridge: never pay in the last hour)", () => {
    expect(() => recheckMintOrder(locked, reply(), NOW + 22 * HOUR - 1)).not.toThrow();
    expect(() => recheckMintOrder(locked, reply(), NOW + 22 * HOUR)).toThrow(/less than two hours/);
  });
  it("refuses a changed deposit, amount, status or order", () => {
    expect(() => recheckMintOrder(locked, reply({ depositAddress: "0x3333333333333333333333333333333333333333" }), NOW)).toThrow(/deposit address/);
    expect(() => recheckMintOrder(locked, reply({ amountExpected: 250 }), NOW)).toThrow(/amount/);
    expect(() => recheckMintOrder(locked, reply({ status: "deposit_detected" }), NOW)).toThrow(/no longer waiting/);
    expect(() => recheckMintOrder(locked, reply({ id: "other-order" }), NOW)).toThrow(/different order/);
  });
});

describe("signed transfer", () => {
  const locked = verifyMintOrder(req, reply(), ctx);
  const tx = buildMintTransfer(locked);
  it("is exactly transfer(deposit, amount) on the token contract", () => {
    expect(tx.to).toBe(usdc.contract);
    expect(tx.value).toBe(0n);
    const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([DEPOSIT, 250_500_000n]);
  });
  it("guard accepts the reviewed bytes and refuses anything else", () => {
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 1 })).not.toThrow();
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 8453 })).toThrow(/wrong network/);
    expect(() => assertMintTransferRequest(locked, { ...tx })).toThrow(/wrong network/);
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 1, to: USDT_BY_CHAIN.eth.address })).toThrow(/different contract/);
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 1, value: 1n })).toThrow(/coin value/);
    const other = buildMintTransfer({ ...locked, units: "250500001" });
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 1, data: other.data })).toThrow(/different address or amount/);
    expect(() => assertMintTransferRequest(locked, { ...tx, chainId: 1, data: "0x095ea7b3" })).toThrow(/plain transfer/);
  });
});

describe("decimalUnits", () => {
  it("never uses float maths", () => {
    expect(decimalUnits(0.1 + 0.2, 6)).toBeNull();
    expect(decimalUnits("100000.000001", 6)).toBe(100_000_000_001n);
  });
});

describe("token contract pinning", () => {
  it("pins exactly the five contracts in TSD Bridge's deposit-watcher list", () => {
    expect(MINT_SOURCES.map((s) => [s.bridgeChain, s.symbol, s.contract])).toEqual([
      ["ethereum", "USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
      ["ethereum", "USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7"],
      ["ethereum", "PYUSD", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8"],
      ["base", "USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
      ["base", "USDT", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"],
    ]);
    expect(MINT_SOURCES.some((s) => s.bridgeChain === "base" && s.symbol === "PYUSD")).toBe(false);
  });
  it("offers no stablecoin at all until TSD Bridge confirms the contracts in writing", () => {
    const unconfirmed = { writtenConfirmation: null };
    expect(mintContractsConfirmed(unconfirmed)).toBe(false);
    expect(availableMintSources(terms, unconfirmed)).toEqual([]);
    expect(availableMintSources({ ...terms, tokenContracts: published }, unconfirmed)).toEqual([]);
    expect(availableMintSources(terms, { writtenConfirmation: "  " })).toEqual([]);
    expect(availableMintSources(terms, CONFIRMED).length).toBe(MINT_SOURCES.length);
  });
  it("is switched on by TSD Bridge's written confirmation of 15 Nov 2026", () => {
    expect(TSD_BRIDGE_CONTRACT_PIN.writtenConfirmation).toMatch(/2026-11-15/);
    expect(mintContractsConfirmed()).toBe(true);
    expect(availableMintSources(terms).map((s) => s.id)).toEqual(MINT_SOURCES.map((s) => s.id));
  });
  it("shows TSD Bridge's own late/wrong-amount sentence, word for word, and no refund promise", () => {
    expect(TSD_BRIDGE_LATE_DEPOSIT_POLICY).toBe(
      "TSD Swap creates TSD for the amount that actually arrives, even if it is more or less than the order. A payment sent after the order expires is not processed automatically; contact TSD Swap support and it will be reviewed by hand.",
    );
    expect(TSD_BRIDGE_LATE_DEPOSIT_POLICY).not.toMatch(/returned|refund/i);
  });
  const published = {
    ethereum: { USDC: usdc.contract.toLowerCase(), USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", PYUSD: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8" },
    base: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
  };
  it("offers a token whose published contract matches the pin (any letter case)", () => {
    expect(availableMintSourcesC({ ...terms, tokenContracts: published }).map((s) => s.id)).toEqual(MINT_SOURCES.map((s) => s.id));
  });
  it("hides a token whose published contract differs or is missing", () => {
    const other = { ...published, base: { USDC: published.base.USDC, USDT: "0x4444444444444444444444444444444444444444" } };
    expect(availableMintSourcesC({ ...terms, tokenContracts: other }).map((s) => s.id)).not.toContain("usdt-base");
    const missing = { ethereum: published.ethereum };
    expect(availableMintSourcesC({ ...terms, tokenContracts: missing }).some((s) => s.chain === "base")).toBe(false);
  });
  it("refuses an order that echoes a different token contract", () => {
    expect(() => verifyMintOrder(req, reply({ depositTokenContract: "0x4444444444444444444444444444444444444444" }), ctx)).toThrow(/different token contract/);
    expect(verifyMintOrder(req, reply({ depositTokenContract: usdc.contract.toLowerCase() }), ctx).tokenContract).toBe(usdc.contract);
  });
  it("re-check refuses changed echoes of recipient, token or contract", () => {
    const locked = verifyMintOrder(req, reply(), ctx);
    expect(() => recheckMintOrder(locked, reply({ recipient: RECIPIENT, depositTokenContract: usdc.contract }), NOW)).not.toThrow();
    expect(() => recheckMintOrder(locked, reply({ recipient: txcAddr(9) }), NOW)).toThrow(/recipient/);
    expect(() => recheckMintOrder(locked, reply({ depositToken: "USDT" }), NOW)).toThrow(/stablecoin/);
    expect(() => recheckMintOrder(locked, reply({ depositTokenContract: USDT_BY_CHAIN.eth.address }), NOW)).toThrow(/contract/);
  });
});

describe("confirmLockedMintOrder (device check)", () => {
  const locked = verifyMintOrder(req, reply(), ctx);
  const want = { sourceId: usdc.id, amount: "250.5", recipient: RECIPIENT };
  const lctx = { ownEvmAddresses: [OWN_EVM], priorOrders: [] as { orderId: string; depositAddress: string }[], now: NOW };
  it("accepts the order we asked for, also when it is already in local history", () => {
    expect(() => confirmLockedMintOrder(locked, want, lctx)).not.toThrow();
    expect(() => confirmLockedMintOrder(locked, want, { ...lctx, priorOrders: [{ orderId: locked.id, depositAddress: DEPOSIT }] })).not.toThrow();
  });
  it("refuses a deposit address an earlier order of this wallet used", () => {
    const prior = [{ orderId: "older-order", depositAddress: DEPOSIT.toUpperCase().replace("0X", "0x") }];
    expect(() => confirmLockedMintOrder(locked, want, { ...lctx, priorOrders: prior })).toThrow(/earlier order/);
  });
  it("refuses a different amount, recipient, contract or too little time", () => {
    expect(() => confirmLockedMintOrder(locked, { ...want, amount: "250.6" }, lctx)).toThrow(/amount/);
    expect(() => confirmLockedMintOrder(locked, { ...want, recipient: txcAddr(9) }, lctx)).toThrow(/recipient/);
    expect(() => confirmLockedMintOrder({ ...locked, tokenContract: USDT_BY_CHAIN.eth.address }, want, lctx)).toThrow(/contract/);
    expect(() => confirmLockedMintOrder(locked, want, { ...lctx, now: NOW + 22 * HOUR })).toThrow(/two hours/);
  });
});

describe("network fee check", () => {
  it("needs the 100k-gas transfer plus 25% headroom", () => {
    const fee = 10_000_000_000n; // 10 gwei
    expect(mintGasCovered(1_250_000_000_000_000n, fee)).toBe(true);
    expect(mintGasCovered(1_249_999_999_999_999n, fee)).toBe(false);
    expect(mintGasCovered(0n, fee)).toBe(false);
  });
});

describe("local mint history", () => {
  const locked = verifyMintOrder(req, reply(), ctx);
  const rec = reviewedRecord(locked, "fp1", true, NOW);
  const want = { sourceId: usdc.id, units: "250500000", recipient: RECIPIENT, keyFp: "fp1" };
  it("keeps the wallet's own copy of what was agreed", () => {
    expect(rec).toMatchObject({ chain: "ethereum", tokenContract: usdc.contract, units: "250500000", recipient: RECIPIENT, depositAddress: DEPOSIT, state: "reviewed" });
    expect(lockedFromRecord(rec)).toEqual(locked);
  });
  it("reuses an identical unpaid order with more than two hours left", () => {
    expect(findReusableMintOrder([rec], want, NOW + 21 * HOUR)?.orderId).toBe(locked.id);
    expect(findReusableMintOrder([rec], want, NOW + 22 * HOUR)).toBeNull();
  });
  it("never reuses a different amount, recipient, key, or an abandoned or paid order", () => {
    expect(findReusableMintOrder([rec], { ...want, units: "250000000" }, NOW)).toBeNull();
    expect(findReusableMintOrder([rec], { ...want, recipient: txcAddr(9) }, NOW)).toBeNull();
    expect(findReusableMintOrder([rec], { ...want, keyFp: "fp2" }, NOW)).toBeNull();
    expect(findReusableMintOrder([{ ...rec, state: "abandoned" }], want, NOW)).toBeNull();
    expect(findReusableMintOrder([{ ...rec, state: "sent", txHash: "0xabc" }], want, NOW)).toBeNull();
  });
  it("tracks only paid orders; older records without a state were paid", () => {
    const legacy: MintRecord = { orderId: "old", txHash: "0xabc", sourceId: "usdc-eth", amount: "10", recipient: RECIPIENT, depositAddress: DEPOSIT, keyFp: "fp1", createdAt: 1 };
    expect(isPaidMintRecord(legacy)).toBe(true);
    expect(isPaidMintRecord(rec)).toBe(false);
    expect(isPaidMintRecord({ ...rec, state: "abandoned" })).toBe(false);
  });
  it("abandons other unpaid orders for the same key when a new one is used", () => {
    const other = { ...rec, orderId: "other" };
    expect(staleReviewedOrders([rec, other, { ...rec, orderId: "k2", keyFp: "fp2" }], "fp1", locked.id).map((r) => r.orderId)).toEqual(["other"]);
  });
});
