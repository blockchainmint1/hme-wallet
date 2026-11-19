import { describe, expect, it } from "vitest";
import { mnemonicToSeedSync } from "@scure/bip39";
import { extraPocketAddress, extraExplorerUrl } from "./extra-addresses";
import { EXTRA_CHAINS, type ExtraChain } from "@/lib/xpub-link/delegate-keys";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed = mnemonicToSeedSync(M);
const addr = (chain: ExtraChain, account = 1106) => extraPocketAddress({ chain, account, seed, mnemonic: M, passphrase: "" });

describe("Seeds extra-coin pocket addresses match Seeds' own vectors", () => {
  it("pocket 1106 (Seeds pockets.test.ts / new-chains.test.ts)", () => {
    expect(addr("DOGE")).toBe("DGd9T3ziwKMXvB4Q5ea9zARewepMc8ER8i");
    expect(addr("BCH")).toBe("bitcoincash:qrjldu6tua6hu2cafctlymwnp5s4htehc5wq4ejyak");
    expect(addr("ZEC")).toBe("t1JmSHJ4tmAcXn16tDzT5pasbhMVYm7Aq2v");
    expect(addr("XRP")).toBe("rJ2grn6pFak4hFP8a7QRiqPQDccxWQYY3x");
    expect(addr("TRX")).toBe("TGeDLmuvGeJFV6Vc9ggnwX96mHR19avogD");
    expect(addr("SOL")).toBe("DXTivYcF78Vznitg6f8JGXouZwsm3xioik1LGWj2H1jV");
    expect(addr("XMR")).toBe("4A4meFan68GQTKM2GJemCwBkfbVP2UsH2ZLPxWKquxhF93ruBpNL3PjSQzkKWFX5ELS8P4MKc4DVqb5sDFuswXJFCRuGsea");
  });
  it("account 0 (Seeds new-chains.test.ts)", () => {
    expect(addr("DASH", 0)).toBe("XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5");
    expect(addr("ATOM", 0)).toBe("cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4");
    expect(addr("RUNE", 0)).toBe("thor1gm00vwsfcp48enm4uv9e5dhm37jtd0ye27wrx0");
  });
  it("ADA, DASH, ATOM, RUNE at 1106 (computed by Seeds' own encoder from its fixtures)", () => {
    expect(addr("ADA")).toBe("addr1q8r6rzvltgh2xq32knz39gn6pv4td7hvsey7g26w9pl2lqzw930gs3rpl924spt83xkr6v5xnhpzjg744v7l252azxksxm68ze");
    expect(addr("DASH")).toBe("Xp6ThXaCd19dsRMhGtmbBotUHpSzvquubJ");
    expect(addr("ATOM")).toBe("cosmos1wqmetx3wwm7tqwj990kf8xjpg8gwp9gcsly57y");
    expect(addr("RUNE")).toBe("thor176rxh2dcfpfjfxmrdatl5057e3satvr8dzj5sw");
  });
  it("Monero gets no explorer link (an address can't show its balance)", () => {
    expect(extraExplorerUrl("XMR", addr("XMR"))).toBeNull();
    for (const c of EXTRA_CHAINS.filter((c) => c !== "XMR")) expect(extraExplorerUrl(c, addr(c))).toMatch(/^https:\/\//);
  });
});

import { EXTRA_ADDRESS_RE } from "./extra-balances.server";
describe("balance lookups accept only real-looking addresses", () => {
  it("every derived 1106 address passes its coin's shape check", () => {
    for (const c of EXTRA_CHAINS) expect(EXTRA_ADDRESS_RE[c].test(addr(c))).toBe(true);
  });
  it("a URL or another coin's address is refused", () => {
    expect(EXTRA_ADDRESS_RE.XRP.test("https://evil.example/x")).toBe(false);
    expect(EXTRA_ADDRESS_RE.ATOM.test(addr("RUNE"))).toBe(false);
  });
});
