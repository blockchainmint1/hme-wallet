import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import {
  MINT_SOURCES, assertMintTransferRequest, availableMintSources, buildMintTransfer, decimalUnits,
  estimateTsdOut, mintAmountInLimits, mintSource, parseMintAmount, recheckMintOrder, verifyMintOrder,
  type MintOrderResponse, type TsdBridgeTerms,
} from "./mint";
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

describe("buy-TSD sources", () => {
  it("only offer contracts both TSD Bridge and this wallet use", () => {
    const wallet = [USDC_BY_CHAIN.eth, USDT_BY_CHAIN.eth, PYUSD_BY_CHAIN.eth!, USDC_BY_CHAIN.base, USDT_BY_CHAIN.base];
    expect(MINT_SOURCES.map((s) => s.contract)).toEqual(wallet.map((t) => t.address));
    for (const s of MINT_SOURCES) expect(s.chainId).toBe(EVM_CHAINS[s.chain].viemChain.id);
  });
  it("are hidden while TSD Bridge is paused and filtered by its accepted tokens", () => {
    expect(availableMintSources({ ...terms, live: false })).toEqual([]);
    expect(availableMintSources({ ...terms, depositTokens: ["USDC"], chains: ["base"] }).map((s) => s.id)).toEqual(["usdc-base"]);
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
    ["under an hour left", { expiresAt: new Date(NOW + HOUR - 1).toISOString() }],
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
  it("refuses once less than an hour is left", () => {
    expect(() => recheckMintOrder(locked, reply(), NOW + 23 * HOUR + 1)).toThrow(/less than an hour/);
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
    expect(() => assertMintTransferRequest(locked, { ...tx, to: USDT_BY_CHAIN.eth.address })).toThrow(/different contract/);
    expect(() => assertMintTransferRequest(locked, { ...tx, value: 1n })).toThrow(/coin value/);
    const other = buildMintTransfer({ ...locked, units: "250500001" });
    expect(() => assertMintTransferRequest(locked, { ...tx, data: other.data })).toThrow(/different address or amount/);
    expect(() => assertMintTransferRequest(locked, { ...tx, data: "0x095ea7b3" })).toThrow(/plain transfer/);
  });
});

describe("decimalUnits", () => {
  it("never uses float maths", () => {
    expect(decimalUnits(0.1 + 0.2, 6)).toBeNull();
    expect(decimalUnits("100000.000001", 6)).toBe(100_000_000_001n);
  });
});
