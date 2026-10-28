import { describe, expect, it } from "vitest";
import {
  THOR_CATALOG,
  THOR_EVM_ROUTERS,
  assertQuoteFresh,
  parseAssetAmount,
  toThorUnits,
  validateSwapMemo,
  validateThorDestination,
} from "./catalog";

describe("parseAssetAmount", () => {
  it("parses 8-decimal UTXO amounts exactly", () => {
    expect(parseAssetAmount("1.5", 8)).toBe(150_000_000n);
    expect(parseAssetAmount("0.00000001", 8)).toBe(1n);
  });
  it("caps precision at THORChain's 1e8 for 18-decimal assets", () => {
    expect(parseAssetAmount("2.25", 18)).toBe(2_250_000_000_000_000_000n);
    expect(() => parseAssetAmount("0.000000001", 18)).toThrow(/decimal/);
  });
  it("caps USDC at 6 decimals", () => {
    expect(parseAssetAmount("1000.123456", 6)).toBe(1_000_123_456n);
    expect(() => parseAssetAmount("1.0000001", 6)).toThrow(/decimal/);
  });
  it("rejects zero, negatives and junk", () => {
    expect(() => parseAssetAmount("0", 8)).toThrow(/greater than zero/);
    expect(() => parseAssetAmount("-1", 8)).toThrow(/positive/);
    expect(() => parseAssetAmount("abc", 8)).toThrow(/positive/);
    expect(() => parseAssetAmount("1e3", 8)).toThrow(/positive/);
  });
});

describe("toThorUnits", () => {
  it("is identity for 8-decimal assets", () => {
    expect(toThorUnits(150_000_000n, 8)).toBe("150000000");
  });
  it("scales 6-decimal tokens up", () => {
    expect(toThorUnits(1_000_123_456n, 6)).toBe("100012345600");
  });
  it("scales 18-decimal assets down exactly", () => {
    expect(toThorUnits(2_250_000_000_000_000_000n, 18)).toBe("225000000");
  });
  it("refuses sub-THOR precision", () => {
    expect(() => toThorUnits(1n, 18)).toThrow(/precise/);
  });
});

describe("validateThorDestination", () => {
  it("accepts a Bitcoin mainnet address for BTC", () => {
    expect(() => validateThorDestination(THOR_CATALOG.btc, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).not.toThrow();
  });
  it("rejects an EVM address for BTC", () => {
    expect(() => validateThorDestination(THOR_CATALOG.btc, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toThrow();
  });
  it("rejects a Bitcoin address for USDC", () => {
    expect(() => validateThorDestination(THOR_CATALOG["usdc-eth"], "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toThrow();
  });
  it("accepts an EVM address for EVM assets", () => {
    expect(() => validateThorDestination(THOR_CATALOG["usdc-base"], "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).not.toThrow();
  });
  it("rejects whitespace-padded addresses", () => {
    expect(() => validateThorDestination(THOR_CATALOG.eth, " 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toThrow();
  });
});

describe("validateSwapMemo", () => {
  const btc = THOR_CATALOG.btc;
  const dest = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  const memo = `=:BTC.BTC:${dest}:1219301/1/0`;

  it("accepts a memo bound to the destination with a protective minimum", () => {
    expect(validateSwapMemo(memo, btc, dest, "1231618", 100)).toBe("1219301");
  });
  it("rejects a changed payout address", () => {
    expect(() => validateSwapMemo(memo, btc, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "1231618", 100)).toThrow(/destination/);
  });
  it("rejects a changed asset", () => {
    expect(() => validateSwapMemo(`=:ETH.ETH:${dest}:1219301/1/0`, btc, dest, "1231618", 100)).toThrow(/destination|asset/);
  });
  it("rejects affiliate fields", () => {
    expect(() => validateSwapMemo(`${memo}:affiliate:10`, btc, dest, "1231618", 100)).toThrow();
  });
  it("rejects a minimum below the tolerance floor", () => {
    // 100 bps of 1231618 = floor 1229299
    expect(() => validateSwapMemo(`=:BTC.BTC:${dest}:1000000/1/0`, btc, dest, "1231618", 100)).toThrow(/protect/);
  });
  it("rejects a minimum above the expected payout", () => {
    expect(() => validateSwapMemo(`=:BTC.BTC:${dest}:9999999/1/0`, btc, dest, "1231618", 100)).toThrow(/protect/);
  });
  it("rejects non-standard streaming formats", () => {
    expect(() => validateSwapMemo(`=:BTC.BTC:${dest}:1219301/5/3`, btc, dest, "1231618", 100)).toThrow(/streaming/);
  });
  it("is case-insensitive on the asset only", () => {
    expect(validateSwapMemo(`SWAP:btc.btc:${dest}:1219301/1/0`, btc, dest, "1231618", 100)).toBe("1219301");
  });
  it("accepts THORChain's short asset form for tokens", () => {
    const usdc = THOR_CATALOG["usdc-base"];
    const evmDest = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
    expect(validateSwapMemo(`=:BASE.USDC:${evmDest}:8021335707/1/0`, usdc, evmDest, "8102359300", 100)).toBe("8021335707");
    expect(validateSwapMemo(`=:BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913:${evmDest}:8021335707/1/0`, usdc, evmDest, "8102359300", 100)).toBe("8021335707");
  });
  it("rejects a short-form asset from a different chain", () => {
    const usdc = THOR_CATALOG["usdc-base"];
    const evmDest = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
    expect(() => validateSwapMemo(`=:ETH.USDC:${evmDest}:8021335707/1/0`, usdc, evmDest, "8102359300", 100)).toThrow(/destination|asset/);
  });
});

describe("router pins", () => {
  it("pins the reviewed routers for all three EVM chains", () => {
    expect(THOR_EVM_ROUTERS.eth).toBe("0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146");
    expect(THOR_EVM_ROUTERS.base).toBe("0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4");
    expect(THOR_EVM_ROUTERS.bsc.toLowerCase()).toBe("0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b");
  });
});

describe("assertQuoteFresh", () => {
  const now = 1_700_000_000_000;
  it("accepts a fresh quote", () => {
    expect(() => assertQuoteFresh({ expiry: now / 1000 + 600, quotedAt: now - 5_000 }, now)).not.toThrow();
  });
  it("rejects an expiring quote", () => {
    expect(() => assertQuoteFresh({ expiry: now / 1000 + 30, quotedAt: now - 5_000 }, now)).toThrow(/expiring/);
  });
  it("rejects a stale quote", () => {
    expect(() => assertQuoteFresh({ expiry: now / 1000 + 600, quotedAt: now - 300_000 }, now)).toThrow(/stale/);
  });
});
