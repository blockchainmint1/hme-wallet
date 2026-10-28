import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { assertThorBtcExecution, THOR_USDC, thorBtcApproval, thorBtcDeposit, thorBtcMemoMinimum, thorRouterAbi, usdcRaw, validateThorBtcIntent, validateThorBtcQuote, type ThorBtcQuote } from "./usdc-btc";
const destination = "bc1qup236qj2mr87ml9388ydm33tuhtdckk33j68qx";
const now = 1793174400000;
const quote = (): ThorBtcQuote => ({ intent: { network: "eth", amount: "1000.123456", destination }, provider: "thorchain", inbound: "0x718f6c9df785bc4e323086de024ca822efbe8ab9", router: THOR_USDC.eth.router, memo: `=:b:${destination}:990000/1/0`, expiry: now / 1000 + 600, expectedSats: "1000000", minimumSats: "990000", feeSats: "1000", seconds: 30, quotedAt: now });
describe("Direct THORChain USDC to Bitcoin", () => {
  it("converts USDC's six decimals exactly", () => { expect(usdcRaw("1000.123456")).toBe(1000123456n); expect(usdcRaw("0.000001")).toBe(1n); });
  it.each(["0", "-1", "1e3", "1.1234567", "NaN", " 1", "01"])("refuses invalid amount %s", amount => { expect(() => usdcRaw(amount)).toThrow(); });
  it("accepts a Bitcoin mainnet destination", () => { expect(() => validateThorBtcIntent(quote().intent)).not.toThrow(); });
  it.each(["0x718f6c9df785bc4e323086de024ca822efbe8ab9", "bitcoin:" + destination, "tb1qup236qj2mr87ml9388ydm33tuhtdckk33j68qx", destination + " "])("refuses wrong address %s", address => { expect(() => validateThorBtcIntent({ ...quote().intent, destination: address })).toThrow(); });
  it("binds actual deposit ABI to USDC raw units, vault, memo and expiry", () => {
    const q = quote(); const tx = thorBtcDeposit(q, now); const decoded = decodeFunctionData({ abi: thorRouterAbi, data: tx.data });
    expect(tx.to).toBe(THOR_USDC.eth.router); expect(tx.value).toBe(0n);
    expect(decoded.functionName).toBe("depositWithExpiry"); expect(decoded.args).toEqual([q.inbound, THOR_USDC.eth.token, 1000123456n, q.memo, BigInt(q.expiry)]);
  });
  it("binds Base deposit to Base USDC and router", () => {
    const q = quote(); const base = { ...q, intent: { ...q.intent, network: "base" as const }, router: THOR_USDC.base.router };
    const tx = thorBtcDeposit(base, now); const decoded = decodeFunctionData({ abi: thorRouterAbi, data: tx.data });
    expect(tx.to).toBe(THOR_USDC.base.router); expect(decoded.args?.[1]).toBe(THOR_USDC.base.token);
  });
  it("approval candidate is exact amount, never unlimited", () => {
    const q = quote(); const tx = thorBtcApproval(q, false, now); const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(tx.to).toBe(THOR_USDC.eth.token); expect(decoded.args).toEqual([THOR_USDC.eth.router, 1000123456n]);
    expect(decodeFunctionData({ abi: erc20Abi, data: thorBtcApproval(q, true, now).data }).args).toEqual([THOR_USDC.eth.router, 0n]);
  });
  it("enforces a 1% after-fee minimum", () => { expect(thorBtcMemoMinimum(quote().memo, destination, "1000000", 1)).toBe("990000"); expect(() => thorBtcMemoMinimum(`=:b:${destination}:989999/1/0`, destination, "1000000", 1)).toThrow(); });
  it.each([`=:b:${destination}:990000/1/0:affiliate:25`, `=:ETH.ETH:${destination}:990000`, `=:b:${destination}:0`, `=:b:${destination}:990000/2/0`, `=:b:${destination}:990000/1/2`, `=:b:${destination}:1000001`, `=:b:${destination}:99e4`])("rejects altered or opaque memo %s", memo => { expect(() => thorBtcMemoMinimum(memo, destination, "1000000", 1)).toThrow(); });
  it("rejects redirected destination", () => { expect(() => thorBtcMemoMinimum(quote().memo, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "1000000", 1)).toThrow(); });
  it("rejects a changed router", () => { expect(() => validateThorBtcQuote({ ...quote(), router: THOR_USDC.base.router }, now)).toThrow(); });
  it("rejects expiring quotes", () => { expect(() => validateThorBtcQuote({ ...quote(), expiry: now / 1000 + 60 }, now)).toThrow(); });
  it("rejects stale observations", () => { expect(() => validateThorBtcQuote(quote(), now + 60_001)).toThrow(); });
  it("rejects displayed minimum mismatch", () => { expect(() => validateThorBtcQuote({ ...quote(), minimumSats: "995000" }, now)).toThrow(); });
  it("execution remains blocked independently of LI.FI or UI settings", () => { expect(() => assertThorBtcExecution()).toThrow("independent review"); });
});