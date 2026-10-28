import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi, getAddress, zeroAddress } from "viem";
import { THOR_CATALOG, THOR_EVM_ROUTERS, thorRouterAbi, type ThorCatalogQuote } from "./catalog";
import { makeThorGuard, planUtxoThorSwap, thorApprovalRequest, thorDepositRequest } from "./execute";

const BTC_DEST = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const INBOUND = getAddress("0x718f6c9df785bc4e32a0db0f4e4b6a9b0e8a0e8a12");

function quoteFixture(over: Partial<ThorCatalogQuote> = {}): ThorCatalogQuote {
  const now = Date.now();
  return {
    provider: "thorchain",
    from: "usdc-eth",
    to: "btc",
    rawIn: "1000000000",
    amountIn: "100000000000",
    destination: BTC_DEST,
    inbound: INBOUND,
    router: THOR_EVM_ROUTERS.eth,
    memo: `=:BTC.BTC:${BTC_DEST}:1219301/1/0`,
    expiry: Math.floor(now / 1000) + 600,
    expectedOut: "1231618",
    minimumOut: "1219301",
    feeOut: "12317",
    seconds: 30,
    toleranceBps: 100,
    quotedAt: now,
    ...over,
  };
}

describe("thorDepositRequest", () => {
  it("builds a zero-value ERC-20 deposit to the pinned router", () => {
    const q = quoteFixture();
    const req = thorDepositRequest(q);
    expect(req.to).toBe(THOR_EVM_ROUTERS.eth);
    expect(req.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: thorRouterAbi, data: req.data });
    expect(decoded.functionName).toBe("depositWithExpiry");
    const [vault, asset, amount, memo, expiry] = decoded.args as [string, string, bigint, string, bigint];
    expect(vault.toLowerCase()).toBe(INBOUND.toLowerCase());
    expect(asset.toLowerCase()).toBe(THOR_CATALOG["usdc-eth"].contract!.toLowerCase());
    expect(amount).toBe(1_000_000_000n);
    expect(memo).toBe(q.memo);
    expect(expiry).toBe(BigInt(q.expiry));
  });

  it("builds a native deposit carrying the exact value", () => {
    const q = quoteFixture({ from: "eth", rawIn: "500000000000000000", amountIn: "50000000" });
    const req = thorDepositRequest(q);
    expect(req.value).toBe(500_000_000_000_000_000n);
    const decoded = decodeFunctionData({ abi: thorRouterAbi, data: req.data });
    const [, asset, amount] = decoded.args as [string, string, bigint, string, bigint];
    expect(asset).toBe(zeroAddress);
    expect(amount).toBe(500_000_000_000_000_000n);
  });

  it("refuses a stale quote", () => {
    const q = quoteFixture({ quotedAt: Date.now() - 300_000 });
    expect(() => thorDepositRequest(q)).toThrow(/stale/);
  });

  it("refuses a UTXO route", () => {
    expect(() => thorDepositRequest(quoteFixture({ from: "btc", router: null }))).toThrow(/EVM/);
  });
});

describe("thorApprovalRequest", () => {
  it("approves the exact quoted amount to the pinned router", () => {
    const q = quoteFixture();
    const req = thorApprovalRequest(q);
    expect(req.to).toBe(THOR_CATALOG["usdc-eth"].contract);
    expect(req.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: req.data });
    const [spender, amount] = decoded.args as [string, bigint];
    expect(spender).toBe(THOR_EVM_ROUTERS.eth);
    expect(amount).toBe(1_000_000_000n);
  });

  it("builds a zero reset approval", () => {
    const req = thorApprovalRequest(quoteFixture(), true);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: req.data });
    expect((decoded.args as [string, bigint])[1]).toBe(0n);
  });

  it("refuses native routes", () => {
    expect(() => thorApprovalRequest(quoteFixture({ from: "eth" }))).toThrow(/ERC-20/);
  });
});

describe("makeThorGuard", () => {
  it("accepts a request identical to the rebuilt expectation", () => {
    const req = thorDepositRequest(quoteFixture());
    const guard = makeThorGuard(req);
    expect(() => guard({ to: req.to, data: req.data, value: req.value })).not.toThrow();
  });
  it("rejects a changed target", () => {
    const req = thorDepositRequest(quoteFixture());
    expect(() => makeThorGuard(req)({ to: INBOUND, data: req.data, value: req.value })).toThrow(/target/);
  });
  it("rejects changed calldata", () => {
    const req = thorDepositRequest(quoteFixture());
    const tampered = `${req.data.slice(0, -4)}ffff` as typeof req.data;
    expect(() => makeThorGuard(req)({ to: req.to, data: tampered, value: req.value })).toThrow(/instructions/);
  });
  it("rejects a changed value", () => {
    const req = thorDepositRequest(quoteFixture({ from: "eth", rawIn: "500000000000000000" }));
    expect(() => makeThorGuard(req)({ to: req.to, data: req.data, value: 1n })).toThrow(/value/);
  });
});

describe("planUtxoThorSwap", () => {
  const utxos = [
    { txid: "a".repeat(64), vout: 0, value: 100_000 },
    { txid: "b".repeat(64), vout: 1, value: 50_000 },
  ];
  it("picks the smallest sufficient set, largest first", () => {
    const plan = planUtxoThorSwap("btc", utxos, 80_000, 10);
    expect(plan).not.toBeNull();
    expect(plan!.inputs).toHaveLength(1);
    expect(plan!.inputs[0]!.value).toBe(100_000);
    expect(plan!.feeSats).toBeGreaterThan(0);
  });
  it("adds inputs until amount plus fee is covered", () => {
    const plan = planUtxoThorSwap("btc", utxos, 99_000, 10);
    expect(plan!.inputs).toHaveLength(2);
  });
  it("returns null when funds are insufficient", () => {
    expect(planUtxoThorSwap("btc", utxos, 200_000, 10)).toBeNull();
  });
  it("accounts for the OP_RETURN memo size", () => {
    const plan = planUtxoThorSwap("doge", utxos, 80_000, 1000);
    // 10 overhead + 148 in + 68 out + 90 memo = 316 vB → 316,000 sats at 1000 sat/vB
    expect(plan!.feeSats).toBe(316_000);
    expect(plan).toBeNull();
  });
});
