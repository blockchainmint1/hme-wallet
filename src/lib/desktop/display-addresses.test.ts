import { expect, it } from "vitest";
import { rootFromSeed } from "@/lib/txc/wallet";
import { deriveTronAccount, deriveTronAddress } from "@/lib/tron/address";
import { deriveSolanaAccount, deriveSolanaAddress } from "@/lib/solana/network";

it("Tron address-only display matches the existing payment account", () => {
  const root = rootFromSeed(new Uint8Array(32).fill(5));
  const address = deriveTronAddress(root);
  expect(typeof address).toBe("string");
  expect(address).toBe(deriveTronAccount(root).address);
});

it("Solana address-only display matches the existing payment account", () => {
  const seed = new Uint8Array(32).fill(5);
  const address = deriveSolanaAddress(seed);
  expect(typeof address).toBe("string");
  expect(address).toBe(deriveSolanaAccount(seed).address);
});