/**
 * End-to-end relay coverage: every protocol body the wallet POSTs through
 * /api/nectar/link is built by the real client code (fetch stubbed only to
 * capture it) and then validated by the real relay policy, so a client change
 * the relay would refuse fails here instead of in a member's browser.
 *
 * The trading-link shape itself (with and without Seeds' extra coins) is
 * covered the same way in src/lib/xpub-link/delegate-extra.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";

vi.mock("@/lib/ecosystem-sites.functions", () => ({ getEcosystemSites: async () => ({ sites: [] }) }));

const { validateRelayPost } = await import("./relay-policy");
const { signInToNectar } = await import("@/lib/nectar/auth");
const { classifyLoginHost } = await import("@/lib/web-login-hosts");
const { submitLink } = await import("@/lib/nectar/link");
const { submitRequested } = await import("@/lib/xpub-link/requested");
const { revokeDelegate } = await import("@/lib/xpub-link/delegate");
const { approveTrade, declineTrade } = await import("@/lib/seeds/trades");
const { pocketAddresses } = await import("@/lib/seeds/pocket");
const { seedFromMnemonic } = await import("@/lib/txc/wallet");
const { TXC_NETWORK } = await import("@/lib/txc/network");

const WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** Stub fetch, record every POST body, and answer 200 like a partner site. */
function capturePosts() {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, link_id: "link-1", linked_to: "Site" }), { status: 200 });
  });
  return sent;
}

/** The relay validates against the ?url= target the wallet asked the proxy to POST to. */
function targetOf(url: string): URL {
  return new URL(new URL(url, "http://localhost").searchParams.get("url")!);
}

afterEach(() => vi.unstubAllGlobals());

describe("every wallet protocol body passes the real relay policy", () => {
  it("website sign-in (hm-login)", async () => {
    const sent = capturePosts();
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const nonce = "abcdefghijklmnopqrst";
    const origin = "shop.example.com";
    const message = [
      `${origin} wants you to sign in with your TXC wallet.`,
      "",
      `Nonce: ${nonce}`,
      "Issued At: 2026-11-18T20:00:00Z",
      "By signing, you authorize a sign-in session for Shop.",
      "This signature does not authorize any payment.",
    ].join("\n");
    const host = classifyLoginHost(origin);
    await signInToNectar({
      request: {
        challengeId: id,
        nonce,
        callbackUrl: `https://${origin}/api/login?id=${id}`,
        origin,
        expiresAt: Date.now() + 60_000,
        chain: "txc",
        message,
        tier: host.tier,
        siteName: host.name,
      },
      mnemonic: WORDS,
    });
    expect(sent).toHaveLength(1);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();
  });

  it("NectarPay watch-only xpub bundle (hm-link-xpubs)", async () => {
    const sent = capturePosts();
    const callback = "https://app.nectar-pay.com/api/link/callback";
    await submitLink({
      manifest: {
        v: 1,
        type: "hm-link-xpubs",
        challenge_id: "ch-123",
        from: "app.nectar-pay.com",
        callback_url: callback,
        manifest_url: "https://app.nectar-pay.com/api/link/manifest/ch-123",
        chains: ["TXC", "BTC"],
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      mnemonic: WORDS,
    });
    expect(sent).toHaveLength(1);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();
  });

  it("requested-paths link (Bonfire dialect)", async () => {
    const sent = capturePosts();
    await submitRequested({
      manifest: {
        kind: "requested",
        host: "bonfire.example.com",
        appName: "Bonfire",
        token: "abcdefgh123",
        challenge: "challenge-12345",
        keys: [{ chain: "TXC", path: "m/44'/696969'/1'" }],
        template:
          "Honest Money - Link wallet\n\nDomain: {domain}\nChallenge: {challenge}\nPath: {path}\nXpub: {xpub}\n\nI authorize sharing this watch-only key.",
        submitUrl: "https://bonfire.example.com/api/link/submit",
        manifestUrl: "https://bonfire.example.com/api/link/manifest/abc",
      },
      mnemonic: WORDS,
    });
    expect(sent).toHaveLength(1);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();
  });

  it("revoke a trading link", async () => {
    const sent = capturePosts();
    await revokeDelegate({
      record: {
        linkId: "link-1",
        host: "seeds.honest.money",
        appName: "Seeds",
        mode: "access",
        account: 1106,
        chains: ["TXC"],
        revokeUrl: "https://seeds.honest.money/api/public/hme-link/revoke",
        origin: "https://seeds.honest.money",
        identity: "",
        linkedAt: "2026-11-18T00:00:00Z",
      },
      mnemonic: WORDS,
    });
    expect(sent).toHaveLength(1);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();
  });

  it("trade decisions: decline without a PSBT, approve with a signed one", async () => {
    const seed = await seedFromMnemonic(WORDS);
    const pocket = pocketAddresses(seed, "TXC", 1106);
    seed.fill(0);
    const mine = pocket[0]!;
    const merchant = pocket[5]!;
    // A fake confirmed payment to the pocket, then a trade spending it.
    const funding = new Transaction();
    funding.version = 1;
    funding.addInput(new Uint8Array(32).fill(1), 0);
    funding.addOutput(payments.p2pkh({ pubkey: mine.node.publicKey, network: TXC_NETWORK }).output!, BigInt(100_000));
    const psbt = new Psbt({ network: TXC_NETWORK });
    psbt.addInput({ hash: funding.getId(), index: 0, nonWitnessUtxo: funding.toBuffer() });
    psbt.addOutput({ address: merchant.address, value: BigInt(90_000) });
    const link = {
      linkId: "link-1",
      host: "seeds.honest.money",
      appName: "Seeds",
      mode: "approve" as const,
      account: 1106,
      chains: ["TXC" as const],
      revokeUrl: "https://seeds.honest.money/api/public/hme-link/revoke",
      origin: "https://seeds.honest.money",
      identity: "",
      linkedAt: "2026-11-18T00:00:00Z",
    };
    const respondPath = "/api/public/hme-link/trades/respond";

    let sent = capturePosts();
    await declineTrade({ link, tradeId: "trade-1", mnemonic: WORDS });
    expect(sent[0]!.body["signed_psbt"]).toBeUndefined();
    expect(targetOf(sent[0]!.url).pathname).toBe(respondPath);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();

    sent = capturePosts();
    await approveTrade({
      link,
      view: {
        proposal: { id: "trade-2", chain: "TXC", psbt: psbt.toBase64() },
        chain: "TXC",
        youPay: 10_000n,
        youGet: 0n,
        fee: null,
        outputs: [],
        ourInputs: 1,
      },
      mnemonic: WORDS,
    });
    expect(String(sent[0]!.body["signed_psbt"])).toMatch(/^cHNidP/);
    expect(() => validateRelayPost(sent[0]!.body, targetOf(sent[0]!.url))).not.toThrow();
  });
});
