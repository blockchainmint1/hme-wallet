import { describe, expect, it } from "vitest";
import { pickInitialEvmAsset } from "./evm-initial-asset";
const real = {
  symbol: "USDC",
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  decimals: 6,
} as never;
describe("pickInitialEvmAsset", () => {
  it("unmatched contract selects nothing and never falls back to the symbol", () => {
    expect(
      pickInitialEvmAsset(
        [real],
        { asset: "USDC", contract: "0x9FC65df3997073B8551Ffd617154B5102fACbb88" },
        "ETH",
        () => real,
      ),
    ).toBeNull();
  });
  it("matching contract selects that exact token", () => {
    expect(
      pickInitialEvmAsset(
        [real],
        { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
        "ETH",
        () => null,
      ),
    ).toEqual({ kind: "erc20", token: real });
  });
});
