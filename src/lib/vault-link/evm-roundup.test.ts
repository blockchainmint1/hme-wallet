import { describe, expect, it } from "vitest";
import { mnemonicToSeedSync } from "@scure/bip39";
import { keccak256, stringToBytes, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rootFromSeed } from "@/lib/txc/wallet";
import { evmAddressFromAccountXpub, vaultEvmAccount } from "./evm-accounts";
import { mergeRefreshedPairing, parsePairing, vaultCan, type VaultPairing } from "./pairing";
import {
  buildDisperseIntent, buildSweepBatchRequest, disperseCalldata, planRoundup, planTopUp, sweepBatchIntents,
  verifySweepBatchReply, verifyVaultDisperse, DISPERSE_ADDRESS, type Fees, type ScannedAddress,
} from "./evm-roundup";
import { intentTransaction } from "./evm-send";
import { maxMintAmount } from "@/components/desktop/TsdBridgeSwap";

const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const root = rootFromSeed(mnemonicToSeedSync(WORDS));
const accountXpub = root.derivePath("m/44'/60'/0'").neutered().toBase58();
const key = (i: number) => privateKeyToAccount(`0x${Buffer.from(root.derivePath(`m/44'/60'/0'/0/${i}`).privateKey!).toString("hex")}`);
const ADDR0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const pairing: VaultPairing = {
  v: 1, fp: "73c5da0a", chains: {}, pairedAt: 1,
  evm: { address: ADDR0, path: "m/44'/60'/0'/0/0", xpub: accountXpub }, caps: ["native-disperse", "sweep-batch"],
};
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const USDT = getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7");
const PYUSD = getAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8");
const GWEI = 1_000_000_000n;
const fees: Fees = { maxFeePerGas: 1n * GWEI, maxPriorityFeePerGas: GWEI / 10n };
const ETH = 10n ** 18n;

function addr(i: number, native: bigint, tokens: Record<string, bigint> = {}, nonce = 0): ScannedAddress {
  const a = vaultEvmAccount(pairing, i);
  return { index: i, path: a.path, address: a.address, native, nonce, tokens: { [USDC]: 0n, [USDT]: 0n, [PYUSD]: 0n, ...tokens } };
}
async function signItem(i: ReturnType<typeof sweepBatchIntents>[number], index: number, overrides = {}) {
  return key(index).signTransaction({
    ...intentTransaction(i), chainId: i.chainId, nonce: i.nonce, gas: BigInt(i.gas), type: "eip1559",
    maxFeePerGas: BigInt(i.maxFeePerGas!), maxPriorityFeePerGas: BigInt(i.maxPriorityFeePerGas!), ...overrides,
  });
}
const b64 = (hex: Hex) => Buffer.from(hex.slice(2), "hex").toString("base64");

describe("Vault Ethereum addresses from the account key", () => {
  it("matches the private-key derivation for #0–#3 and the standard test vector", () => {
    expect(evmAddressFromAccountXpub(accountXpub, 0)).toBe(ADDR0);
    for (const i of [1, 2, 3]) expect(evmAddressFromAccountXpub(accountXpub, i)).toBe(key(i).address);
  });
  it("refuses an index past HME Vault's 999 limit", () => {
    expect(() => vaultEvmAccount(pairing, 1000)).toThrow();
  });
});

describe("Pairing with the Ethereum account key", () => {
  const raw = { hmvault: 1, fp: "73c5da0a", evm: { address: ADDR0, path: "m/44'/60'/0'/0/0", xpub: accountXpub }, caps: ["sweep-batch", "native-disperse", "x"] };
  it("keeps the key and the two batch capabilities", () => {
    const p = parsePairing(JSON.stringify(raw));
    expect(p.evm?.xpub).toBe(accountXpub);
    expect(vaultCan(p, "sweep-batch") && vaultCan(p, "native-disperse")).toBe(true);
    expect(p.caps).toEqual(["sweep-batch", "native-disperse"]);
  });
  it("refuses an account key that doesn't reproduce address #0", () => {
    const other = rootFromSeed(new Uint8Array(32).fill(9)).derivePath("m/44'/60'/0'").neutered().toBase58();
    expect(() => parsePairing(JSON.stringify({ ...raw, evm: { ...raw.evm, xpub: other } }))).toThrow(/doesn't match/);
  });
  it("re-scanning the same Vault only adds the key; another Vault is refused", () => {
    const old: VaultPairing = { v: 1, fp: "73c5da0a", chains: {}, pairedAt: 5, evm: { address: ADDR0, path: "m/44'/60'/0'/0/0" } };
    const merged = mergeRefreshedPairing(old, parsePairing(JSON.stringify(raw)));
    expect(merged.evm?.xpub).toBe(accountXpub);
    expect(merged.pairedAt).toBe(5);
    expect(() => mergeRefreshedPairing(old, parsePairing(JSON.stringify({ ...raw, fp: "00000000" })))).toThrow(/different Vault/);
    expect(() => mergeRefreshedPairing({ ...old, evm: { address: key(1).address, path: "m/44'/60'/0'/0/0" } }, parsePairing(JSON.stringify(raw)))).toThrow(/different Vault/);
  });
});

describe("Round-up plan", () => {
  const tokenGas = () => 65_000n;
  it("sends every token then the leftover ETH to #0, and flags holders without fee money", () => {
    const plan = planRoundup({
      chain: "eth", destination: ADDR0, fees, tokenGas,
      addresses: [
        addr(0, ETH, { [USDC]: 5n }),
        addr(1, 0n, { [USDC]: 1_000_000_000n }),               // 1,000 USDC, no ETH
        addr(2, ETH / 100n, { [USDT]: 500_000_000n }, 3),       // 500 USDT + 0.01 ETH, nonce 3
        addr(3, ETH / 1000n),                                   // ETH only
      ],
    });
    expect(plan.needsGas).toEqual([expect.objectContaining({ index: 1, needed: 65_000n * GWEI })]);
    const items = plan.batches.flat();
    expect(items.map((i) => [i.index, i.kind, i.nonce])).toEqual([[2, "erc20-transfer", 3], [2, "native-transfer", 4], [3, "native-transfer", 0]]);
    const native2 = items[1]!;
    expect(native2.kind === "native-transfer" && native2.value).toBe(ETH / 100n - 65_000n * GWEI - 21_000n * GWEI);
    expect(items.some((i) => i.index === 0)).toBe(false);
  });
  it("never splits an address across batches and keeps each batch at 25 or fewer", () => {
    const many = Array.from({ length: 12 }, (_, k) => addr(k + 1, ETH, { [USDC]: 1n, [USDT]: 1n }));
    const plan = planRoundup({ chain: "eth", destination: ADDR0, fees, tokenGas, addresses: many });
    expect(plan.batches.map((b) => b.length)).toEqual([24, 12]);
    for (const b of plan.batches) expect(new Set(b.map((i) => i.index)).size * 3).toBe(b.length);
  });
  it("splits when a batch's fees would pass 5x Vault's 0.02 ETH ceiling", () => {
    const high: Fees = { maxFeePerGas: 300n * GWEI, maxPriorityFeePerGas: GWEI };
    const many = Array.from({ length: 10 }, (_, k) => addr(k + 1, ETH, { [USDC]: 1n }));
    const plan = planRoundup({ chain: "eth", destination: ADDR0, fees: high, tokenGas, addresses: many });
    for (const b of plan.batches) expect(b.reduce((s, i) => s + i.gas * high.maxFeePerGas, 0n)).toBeLessThanOrEqual(100_000_000_000_000_000n);
    expect(plan.batches.length).toBeGreaterThan(1);
  });
});

describe("Batch request and Vault reply", () => {
  const plan = planRoundup({ chain: "eth", destination: ADDR0, fees, tokenGas: () => 65_000n,
    addresses: [addr(1, ETH, { [USDC]: 2_000_000n }), addr(2, ETH, { [PYUSD]: 800_000_000n }, 4)] });
  const request = buildSweepBatchRequest(pairing, "eth", ADDR0, plan.batches[0]!, fees);
  const intents = sweepBatchIntents(request);
  async function reply(mutate?: (signed: Hex[]) => Hex[], hash = keccak256(stringToBytes(request))) {
    let signed = await Promise.all(intents.map((i) => signItem(i, Number((i as { path: string }).path.split("/").pop()))));
    if (mutate) signed = mutate(signed);
    return JSON.stringify({ format: "hm-evm-signed-batch", v: 1, intentHash: hash, signed: signed.map(b64) });
  }
  it("builds Vault's exact sweep-batch shape", () => {
    const r = JSON.parse(request);
    expect(Object.keys(r)).toEqual(["format", "v", "kind", "fp", "chainId", "destination", "items"]);
    expect(r.kind).toBe("sweep-batch");
    expect(r.items[0]).not.toHaveProperty("fp");
    expect(r.items.every((i: { to: string }) => i.to === ADDR0)).toBe(true);
  });
  it("accepts the genuine signed batch", async () => {
    await expect(verifySweepBatchReply(await reply(), request)).resolves.toHaveLength(4);
  });
  it("refuses a reply for a different request", async () => {
    await expect(verifySweepBatchReply(await reply(undefined, keccak256(stringToBytes(request + " "))), request)).rejects.toThrow(/different request/);
  });
  it("refuses reordered or altered transactions", async () => {
    await expect(verifySweepBatchReply(await reply((s) => [s[1]!, s[0]!, s[2]!, s[3]!]), request)).rejects.toThrow();
    const bad = await signItem({ ...intents[0]!, amount: "1" } as never, 1);
    await expect(verifySweepBatchReply(await reply((s) => [bad, s[1]!, s[2]!, s[3]!]), request)).rejects.toThrow();
  });
  it("refuses a sender that isn't this Vault's address at that path", () => {
    const item = { ...plan.batches[0]![0]!, from: key(5).address as Address };
    expect(() => buildSweepBatchRequest(pairing, "eth", ADDR0, [item], fees)).toThrow(/doesn't belong/);
  });
});

describe("Fee top-up through Disperse", () => {
  const addresses = [addr(0, ETH / 2n), addr(1, 0n, { [USDC]: 1n }), addr(2, ETH, {}, 9), addr(3, 0n, { [USDT]: 1n })];
  const needs = [
    { index: 1, address: addresses[1]!.address, path: addresses[1]!.path, native: 0n, needed: 65_000n * GWEI },
    { index: 3, address: addresses[3]!.address, path: addresses[3]!.path, native: 0n, needed: 65_000n * GWEI },
  ];
  it("pays 1.5x each shortfall from the address with the most ETH", () => {
    const t = planTopUp({ chain: "eth", addresses, needs, fees });
    expect(t.funder.index).toBe(2);
    expect(t.values).toEqual([97_500n * GWEI, 97_500n * GWEI]);
    expect(t.total).toBe(195_000n * GWEI);
  });
  it("refuses when no single address can pay for the others", () => {
    expect(() => planTopUp({ chain: "eth", addresses: [addr(0, 1n), ...addresses.slice(1, 2)], needs: needs.slice(0, 1), fees })).toThrow(/Not enough/);
  });
  it("accepts only the exact signed Disperse call", async () => {
    const t = planTopUp({ chain: "eth", addresses, needs, fees, gas: 100_000n });
    const text = buildDisperseIntent(pairing, "eth", t, fees);
    const tx = { chainId: 1, nonce: 9, gas: 100_000n, type: "eip1559" as const, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      to: DISPERSE_ADDRESS, value: t.total, data: disperseCalldata(t.recipients, t.values) };
    await expect(verifyVaultDisperse(await key(2).signTransaction(tx), text)).resolves.toBeUndefined();
    await expect(verifyVaultDisperse(await key(2).signTransaction({ ...tx, value: t.total + 1n }), text)).rejects.toThrow();
    await expect(verifyVaultDisperse(await key(2).signTransaction({ ...tx, data: disperseCalldata([t.recipients[0]!], [t.total]) }), text)).rejects.toThrow();
  });
});

describe("Buy TSD amount", () => {
  it("uses the whole balance, capped at TSD Bridge's per-order maximum", () => {
    expect(maxMintAmount(14_005_930_000n, 6, 50_000)).toBe("14005.93");
    expect(maxMintAmount(60_000_000_000n, 6, 50_000)).toBe("50000");
  });
});
