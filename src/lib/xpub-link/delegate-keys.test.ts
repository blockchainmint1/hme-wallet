/**
 * Reference values come from an independent library (Python bip_utils 2.12),
 * and the DOGE/BCH/ZEC/XRP/TRX/SOL receive addresses match the test table
 * Seeds published in docs/hme-wallet-extra-pockets.md.
 */
import { describe, expect, it } from "vitest";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { payments } from "bitcoinjs-lib";
import { DOGE_NETWORK } from "@/lib/doge/network";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { deriveExtraKey, EXTRA_CHAINS, extraAccountOf, extraAccountPath, type ExtraChain } from "./delegate-keys";

const bip32 = BIP32Factory(ecc);
const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const REF: Record<ExtraChain, { path: string; pub: string; priv: string; addr?: string }> = {
  DOGE: { path: "m/44'/3'/1106'", pub: "xpub6Bxse8AT19uys6z4Sc41PZcxvVX32aDbKGKKLEFJa2nY95dR6nTN2b5boyXDh9TfJxk1d7DtRaKLUTWWzMHVaKMoNVKNVJEyLRGSzs9zpaa", priv: "xprv9xyXEcdZAnMgecubLaX12RgENTgYd7Vjx3PiXqqh1hFZGHJGZF97Unm7xivR6NofbgVgPwXdx3eNmqd1mAeHLrTJGkheA3FF25vJKDVrTtn", addr: "DGd9T3ziwKMXvB4Q5ea9zARewepMc8ER8i" },
  BCH: { path: "m/44'/145'/1106'", pub: "xpub6ByHsPNSQXUM9emiMQCYUTzdW7SGQW5fiUZgAxqvJmrF37pPeUQMQHmzQmqsGu9Xv8U9XfrMH5XwTWnvjea6vhjzvKjXNs3pKzuSX6SwuLa", priv: "xprv9xywTsqYa9v3wAhFFNfY7L3tx5bn13MpMFe5NaSJkSKGAKVF6w66rVTWZUKcykEpx4R4P7NwhuFF6YBes1NGRXxwA5TXVU4m1Bfg6LP9KJg", addr: "bitcoincash:qrjldu6tua6hu2cafctlymwnp5s4htehc5wq4ejyak" },
  DASH: { path: "m/44'/5'/1106'", pub: "xpub6CYEjsU6zPMtSzi4qWgdBWmtGXhKt3zCpXYUntAWUhqKridudrsJCKWHqzsfgFmeUcW8WrA794f2Qp5rHJQpUNdmULbipvB4h6G9ZYUBtX8", priv: "xprv9yYtLMwDA1obEWdbjV9cpNq9iVrqUbGMTJcszVktvNJLyvJm6KZ3eXBozipD7rfZSdHhjKUTmdhFsMmmhtdtU5Xhq7su6QHRD5UjMKSrGcp", addr: "Xp6ThXaCd19dsRMhGtmbBotUHpSzvquubJ" },
  TRX: { path: "m/44'/195'/1106'", pub: "xpub6D1AabNHCuqVKkEYWSLPPSGa9MmB1yKXM4oRkR6r84b4Q3r1uW2Y3HA5gUNhmv3zcbvtgzcJL6u2uPQnLvgmwM6Cjs6E5kgTXB3nQgzGWk5", priv: "xprv9z1pB5qPNYHC7GA5QQoP2JKqbKvgcWbfyqspx2hEZj45XFWsMxiHVUqbqEFHsq1hiyLU59QqePYLR4Qu2ftfP7rdQaBXgzbrZMfrDMYoz9i", addr: "TGeDLmuvGeJFV6Vc9ggnwX96mHR19avogD" },
  ZEC: { path: "m/44'/133'/1106'", pub: "xpub6CLX6bXDznzdoVCvZocJ7Kz42ZF7VjmaXn7JyDmxLKZoYyxJVesX5QWnU8vdkFsC1JmzasUyJrusaY1tc9Bvg2tdFUGeGGtpLQ9QNX1wjN6", priv: "xprv9yMAh5zLARSLb18TTn5HkC3KUXQd6H3jAZBiAqNLmz2pgBd9x7ZGXcCJcqodEMnLjuAHxzPvNV9tkEHXqf93AD92VnrPgVukDKLGfiXiLAx", addr: "t1JmSHJ4tmAcXn16tDzT5pasbhMVYm7Aq2v" },
  XRP: { path: "m/44'/144'/1106'", pub: "xpub6CFKyZTfzj4TaAz2iXz53LkoFWjJY8Zh9KqrUxzu85c3HvZ7VRifaFCt1aGVFyp8M5J2MWZaA9yg6rm2Qi3C1ytUucbBqGfSYWLRLr9rW9s", priv: "xprv9yFya3vnAMWAMguZcWT4gCp4hUtp8fqqn6vFgabHZk54R8DxwtQR2StQAKi3UZoc9L1XeUMpNQokHVdbtH1jhS58j2n1tKfcHf8uPV6kCsj", addr: "rJ2grn6pFak4hFP8a7QRiqPQDccxWQYY3x" },
  ATOM: { path: "m/44'/118'/1106'", pub: "xpub6DGzViq8bmhBxaVfiupQe5DB1Yc9rr5NmjzqqtK4PoAPZQvqCo4XjUaXnrnWzLvEMxdaEst16D9VmA2fyaiMqmj7HFaPrJKuB5HdVTRvXdQ", priv: "xprv9zHe6DJEmQ8tk6RCctHQGwGSTWmfTPMXQX5F3VuSqTdQgcbgfFkHBgG3wbGnV3k98W87gQ11y477hVruTt6UfXKH9dydgreLi3i5ukniFJi", addr: "cosmos1wqmetx3wwm7tqwj990kf8xjpg8gwp9gcsly57y" },
  RUNE: { path: "m/44'/931'/1106'", pub: "xpub6CNbXkRDJeMg8BAp4HD8ZUd6RE3jpBbwMtovvKEQqbDvNzUutoECUP2Q1favP9peqwYn9z7uDgAzmdkexgqfpqNnHPbr5jDArd4KCNYMZCY", priv: "xprv9yPF8EtKUGoNuh6LxFg8CLgMsCDFQit5zftL7vpoHFgwWC9mMFuwvahvAQTvCubrMgURL9EQSW1teUpXfQKsgkkwXJ1kmAr2LxPRRGSrP1o", addr: "thor176rxh2dcfpfjfxmrdatl5057e3satvr8dzj5sw" },
  SOL: { path: "m/44'/501'/1106'/0'", pub: "DXTivYcF78Vznitg6f8JGXouZwsm3xioik1LGWj2H1jV", priv: "23e8f7620c4c073e1df02d77f6d7f4d1be7c00667d413f8cc113b69e2a70dcd4" },
  ADA: { path: "m/1852'/1815'/1106'", pub: "44c508747d1f92f49b06019d1f92fbaff0f1a1b08eb8815d77e50fb790f09c0a2e995b349397df051d6674f12c7732907d995ac8baf74ac0ad837aa26ec1a598", priv: "302f52a2aa7654cf7f25e40c862a49949f9cc36a196629436fe3fd686d0e6f5336bc9b30df6ebc2a6e0f21796be17b50d59ec7d6988c1ba7531b3522eabd807e2e995b349397df051d6674f12c7732907d995ac8baf74ac0ad837aa26ec1a598" },
};

describe("trading-link keys for coins the wallet doesn't show", () => {
  it("matches the independent reference for every extra coin at branch 1106", async () => {
    const seed = await seedFromMnemonic(WORDS, "");
    for (const chain of EXTRA_CHAINS) {
      const k = deriveExtraKey({ chain, account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: true });
      expect(k.path, chain).toBe(REF[chain].path);
      expect(k.pub, chain).toBe(REF[chain].pub);
      expect(k.priv, chain).toBe(REF[chain].priv);
    }
  });

  it("gives Seeds' published Dogecoin and Solana receive addresses", async () => {
    const seed = await seedFromMnemonic(WORDS, "");
    const doge = deriveExtraKey({ chain: "DOGE", account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: false });
    const child = bip32.fromBase58(doge.pub).derive(0).derive(0);
    expect(payments.p2pkh({ pubkey: child.publicKey, network: DOGE_NETWORK }).address).toBe("DGd9T3ziwKMXvB4Q5ea9zARewepMc8ER8i");
    const sol = deriveExtraKey({ chain: "SOL", account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: false });
    expect(sol.pub).toBe("DXTivYcF78Vznitg6f8JGXouZwsm3xioik1LGWj2H1jV");
  });

  it("uses standard xpub/xprv version bytes, not coin-specific ones", async () => {
    const seed = await seedFromMnemonic(WORDS, "");
    for (const chain of ["DOGE", "BCH", "DASH", "TRX", "ZEC", "XRP", "ATOM", "RUNE"] as const) {
      const k = deriveExtraKey({ chain, account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: true });
      expect(k.pub.startsWith("xpub"), chain).toBe(true);
      expect(k.priv!.startsWith("xprv"), chain).toBe(true);
    }
  });

  it("leaves the private half out unless asked", async () => {
    const seed = await seedFromMnemonic(WORDS, "");
    for (const chain of EXTRA_CHAINS) {
      expect(deriveExtraKey({ chain, account: 1106, seed, mnemonic: WORDS, passphrase: "", withPrivate: false }).priv).toBeUndefined();
    }
  });

  it("never names the savings account and only parses exact paths", () => {
    expect(extraAccountPath("SOL", 1106)).toBe("m/44'/501'/1106'/0'");
    expect(extraAccountPath("ADA", 1106)).toBe("m/1852'/1815'/1106'");
    expect(extraAccountOf("DOGE", "m/44'/3'/1106'")).toBe(1106);
    expect(extraAccountOf("DOGE", "m/44'/3'/1106'/0/0")).toBeNull();
    expect(extraAccountOf("DOGE", "m/44'/145'/1106'")).toBeNull();
    expect(extraAccountOf("SOL", "m/44'/501'/1106'")).toBeNull();
    expect(extraAccountOf("BTC" as ExtraChain, "m/84'/0'/1106'")).toBeNull();
  });
});
