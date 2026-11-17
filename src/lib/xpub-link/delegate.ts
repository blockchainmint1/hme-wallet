/**
 * `hm-link-delegate` — a site (Seeds Exchange) asks to trade from the user's
 * Trading pocket. The user picks one of two modes:
 *
 * - "access":  the wallet hands over the pocket's account-level xprv per
 *   chain, sealed to the site's X25519 key on this device. Instant trades.
 * - "approve": the wallet hands over xpubs only. The site proposes each trade
 *   as an unsigned transaction and the user approves it in the wallet.
 *
 * Hard rules (never configurable by the site):
 * - Site must be marked delegate: true on a fresh, signed honest.money list
 *   (no "continue anyway"), and only the modes HME allows it are offered.
 * - Requested paths must all be one branch honest.money reserved for that
 *   site, on the known coin types. A site may also list coins the wallet
 *   doesn't support itself (`request_optional`, see ./delegate-keys.ts): their
 *   keys go only into "access" links, at the same branch, and the wallet never
 *   shows, sends or sweeps them. If this wallet already retired that branch
 *   (or another site owns it here), the next reserved branch is used; the
 *   real `account`/`paths` go back in the submission. See ./branches.ts.
 * - submit_url / revoke_url share the manifest origin.
 * - The signed identity message is rebuilt locally from a fixed shape.
 */
import { x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url, base64urlnopad } from "@scure/base";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { signMessageWithSeed } from "@/lib/txc/message-sign";
import { scopedKey } from "@/lib/profiles";
import { isEcosystemSite, loginSiteName, setEcosystemSites, spendingGrant } from "@/lib/web-login-hosts";
import { getEcosystemSites } from "@/lib/ecosystem-sites.functions";
import { accountPath, chainRoot, legacyPocketAccount, POCKET_CHAINS, type PocketChain } from "@/lib/seeds/pocket";
import { chooseDelegateBranch, claimBranch, loadBranchBook, type BranchBook } from "./branches";
import { deriveExtraKey, extraAccountOf, isExtraChain, type ExtraChain } from "./delegate-keys";

const PROXY = "/api/nectar/link";

export type DelegateMode = "access" | "approve";

export interface DelegateManifest {
  host: string;
  appName: string;
  purpose?: string;
  token: string;
  challenge: string;
  chains: PocketChain[];
  /** Coins the wallet doesn't support itself; keys shared in "access" links only. */
  extraChains: ExtraChain[];
  /** Branch the site asked for (one of its honest.money reservations). */
  requestedAccount: number;
  /** Branch this wallet will actually use for the site. */
  account: number;
  /** Link modes honest.money allows this site. */
  modes: DelegateMode[];
  recipientPub: Uint8Array;
  submitUrl: string;
  revokeUrl: string;
  manifestUrl: string;
}

export function isDelegateDialect(raw: Record<string, unknown>): boolean {
  return raw["type"] === "hm-link-delegate";
}

/** Parse `m/<purpose>'/<coin>'/<account>'` for `chain`; null unless it is exactly that chain's account path. */
function requestedAccountOf(chain: PocketChain, path: unknown): number | null {
  const m = /^m\/\d+'\/\d+'\/(\d{1,10})'$/.exec(String(path));
  if (!m) return null;
  const n = Number(m[1]);
  return accountPath(chain, n) === path ? n : null;
}

export function validateDelegate(
  raw: Record<string, unknown>,
  manifestUrl: string,
  book: BranchBook = currentBranchBook(),
): DelegateManifest {
  const fail = (m: string): never => {
    throw new Error(m);
  };
  if (!isDelegateDialect(raw)) fail("That code isn't a trading link.");
  const u = new URL(manifestUrl);
  const host = u.hostname;
  const siteName = loginSiteName(host) === host ? host : `${loginSiteName(host)} (${host})`;
  const grant = spendingGrant(host);
  if (!grant)
    fail(
      isEcosystemSite(host)
        ? `honest.money hasn't approved ${siteName} for trading access, so no trading branch is reserved for it.`
        : `${host} isn't on the honest.money trusted list, so it can't be given trading access.`,
    );
  const sameOrigin = (s: unknown) => {
    try {
      return typeof s === "string" && new URL(s).origin === u.origin;
    } catch {
      return false;
    }
  };
  if (!sameOrigin(raw["submit_url"]) || !sameOrigin(raw["revoke_url"])) fail("Link sends keys to a different server.");
  const token = raw["challenge_id"];
  const challenge = raw["challenge"];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) fail("Link is malformed.");
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(challenge)) fail("Link is malformed.");
  const exp = Date.parse(String(raw["expires_at"] ?? ""));
  if (!Number.isFinite(exp) || exp <= Date.now()) fail("This link has expired.");
  let recipientPub: Uint8Array = new Uint8Array();
  try {
    recipientPub = base64urlnopad.decode(String(raw["recipient_pubkey"] ?? "").trim().replace(/=+$/, ""));
  } catch {
    fail("Link is missing its encryption key.");
  }
  if (recipientPub.length !== 32) fail("Link is missing its encryption key.");

  const req = Array.isArray(raw["request"]) ? (raw["request"] as Record<string, unknown>[]) : [];
  const opt = Array.isArray(raw["request_optional"]) ? (raw["request_optional"] as Record<string, unknown>[]) : [];
  if (req.length === 0) fail("Link doesn't ask for any chain.");
  if (req.length + opt.length > 40) fail("Link is malformed.");
  const chains: PocketChain[] = [];
  const extraChains: ExtraChain[] = [];
  let requiredExtra = false;
  let requested: number | null = null;
  const entries = [...req.map((r) => ({ r, optional: false })), ...opt.map((r) => ({ r, optional: true }))];
  for (const { r, optional } of entries) {
    const chain = String(r?.["chain"] ?? "").toUpperCase();
    const core = (POCKET_CHAINS as string[]).includes(chain);
    const extra = isExtraChain(chain);
    if (!core && !extra) {
      // A coin this wallet can't make a key for: skip it if optional, refuse if required.
      if (optional) continue;
      fail(`Unsupported chain: ${chain}`);
    }
    // One whole hardened account, on that chain's own coin type.
    const n = core ? requestedAccountOf(chain as PocketChain, r["path"]) : extraAccountOf(chain as ExtraChain, r["path"]);
    if (n === null) fail(`Refused key request: ${chain} ${String(r["path"])} isn't a trading branch path.`);
    if (requested !== null && n !== requested) fail("Link asks for different branches on different chains.");
    requested = n;
    if (core) {
      if (!chains.includes(chain as PocketChain)) chains.push(chain as PocketChain);
    } else {
      if (!optional) requiredExtra = true;
      if (!extraChains.includes(chain as ExtraChain)) extraChains.push(chain as ExtraChain);
    }
  }
  const choice = chooseDelegateBranch({ host, siteName, requested: requested!, reserved: grant!.branches, book });
  if (!choice.ok) fail(`Refused key request: ${choice.reason}`);
  const account = (choice as { account: number }).account;
  const app = (raw["app"] ?? {}) as Record<string, unknown>;
  return {
    host,
    appName: typeof app["name"] === "string" ? (app["name"] as string).slice(0, 40) : typeof raw["app_name"] === "string" ? (raw["app_name"] as string).slice(0, 40) : loginSiteName(host),
    purpose: typeof raw["purpose"] === "string" ? (raw["purpose"] as string).slice(0, 300) : undefined,
    token: token as string,
    challenge: challenge as string,
    chains,
    extraChains,
    requestedAccount: requested!,
    account,
    // The wallet can't approve trades on coins it doesn't support, so a link
    // that requires one, or has no supported coin, is offered "access" only.
    modes: grant!.modes.filter((m) => m !== "approve" || (!requiredExtra && chains.length > 0)),
    recipientPub,
    submitUrl: raw["submit_url"] as string,
    revokeUrl: raw["revoke_url"] as string,
    manifestUrl,
  };
}

/**
 * Seal bytes to an X25519 public key.
 * Format: base64url( ephemeralPub(32) || nonce(12) || AES-256-GCM ciphertext+tag )
 * key = HKDF-SHA256(ikm = X25519(eph, recipient), salt = ephPub || recipientPub,
 *                   info = "hm-link-delegate v1"), 32 bytes.
 */
export function sealTo(recipientPub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientPub);
  const salt = new Uint8Array(64);
  salt.set(ephPub, 0);
  salt.set(recipientPub, 32);
  const key = hkdf(sha256, shared, salt, new TextEncoder().encode("hm-link-delegate v1"), 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(32 + 12 + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, 32);
  out.set(ct, 44);
  key.fill(0);
  shared.fill(0);
  eph.fill(0);
  return out;
}

function hexOf(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function buildDelegateMessage(args: {
  host: string;
  challenge: string;
  paths: string[];
  mode: DelegateMode;
  payloadSha256: string;
}): string {
  const last =
    args.mode === "access"
      ? "I authorize this site to spend from these branches until I revoke."
      : "I authorize this site to propose trades from these branches. Each trade needs my approval.";
  return [
    "Honest Money - Link wallet (delegate)",
    "",
    `Domain: ${args.host}`,
    `Challenge: ${args.challenge}`,
    `Mode: ${args.mode}`,
    `Paths: ${args.paths.join(",")}`,
    `Payload-SHA256: ${args.payloadSha256}`,
    "",
    last,
  ].join("\n");
}

export interface DelegateLinkRecord {
  linkId: string;
  host: string;
  appName: string;
  mode: DelegateMode;
  account: number;
  chains: PocketChain[];
  /** Extra coins whose trading keys went to the site (access links only). */
  extraChains?: ExtraChain[];
  revokeUrl: string;
  /** Where pending-trade proposals are read from (approve mode). */
  origin: string;
  identity: string;
  linkedAt: string;
}

export async function submitDelegate(args: {
  manifest: DelegateManifest;
  mode: DelegateMode;
  mnemonic: string;
  passphrase?: string;
}): Promise<DelegateLinkRecord> {
  const { manifest, mode, mnemonic, passphrase = "" } = args;
  const registry = await getEcosystemSites();
  setEcosystemSites(registry.sites, true);
  const grant = spendingGrant(manifest.host);
  if (!grant) throw new Error("This site is no longer on the verified spending list.");
  if (!grant.modes.includes(mode)) throw new Error("honest.money no longer allows this kind of link for this site.");
  if (!manifest.modes.includes(mode)) throw new Error("This link can't be used that way.");
  // Re-check the branch against the fresh list and this wallet's own record.
  const book = currentBranchBook();
  const choice = chooseDelegateBranch({
    host: manifest.host,
    siteName: manifest.appName,
    requested: manifest.requestedAccount,
    reserved: grant.branches,
    book,
  });
  if (!choice.ok) throw new Error(choice.reason);
  if (choice.account !== manifest.account) throw new Error("The trading branch for this site changed. Open the link again.");
  const account = choice.account;
  // Record ownership before anything about this branch leaves the device.
  claimBranch(book, manifest.host, account);
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const xpubs: Record<string, string> = {};
  const xprvs: Record<string, string> = {};
  const paths: string[] = [];
  for (const c of manifest.chains) {
    const path = accountPath(c, account);
    const node = chainRoot(seed, c).derivePath(path);
    paths.push(path);
    xpubs[c] = node.neutered().toBase58();
    if (mode === "access") xprvs[c] = node.toBase58();
  }
  // Extra coins are spend-only: their keys go to the site in access links, never approve.
  const extraChains = mode === "access" ? manifest.extraChains : [];
  try {
    for (const c of extraChains) {
      const k = deriveExtraKey({ chain: c, account, seed, mnemonic, passphrase, withPrivate: true });
      paths.push(k.path);
      xpubs[c] = k.pub;
      xprvs[c] = k.priv!;
    }
  } finally {
    seed.fill(0);
  }

  let payload: string | undefined;
  let payloadSha = "none";
  if (mode === "access") {
    const sealed = sealTo(manifest.recipientPub, new TextEncoder().encode(JSON.stringify(xprvs)));
    for (const k of Object.keys(xprvs)) xprvs[k] = "";
    payload = base64url.encode(sealed);
    payloadSha = hexOf(sha256(sealed));
  }

  const message = buildDelegateMessage({
    host: manifest.host,
    challenge: manifest.challenge,
    paths,
    mode,
    payloadSha256: payloadSha,
  });
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });

  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifest.submitUrl)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      token: manifest.token,
      mode,
      account,
      paths,
      identity_address: signed.address,
      signature: signed.signature,
      message,
      ...(payload ? { payload } : {}),
      xpubs,
      app_name: "honest.money wallet",
      // Seeds reads the app name from a nested app.name; keep both fields.
      app: { name: "honest.money wallet" },
    }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error((body?.["error"] as string) ?? (body?.["message"] as string) ?? `Link failed (${res.status})`);
  const linkId = String(body?.["link_id"] ?? manifest.token);
  const record: DelegateLinkRecord = {
    linkId,
    host: manifest.host,
    appName: (body?.["linked_to"] as string) ?? manifest.appName,
    mode,
    account,
    chains: manifest.chains,
    ...(extraChains.length ? { extraChains: [...extraChains] } : {}),
    revokeUrl: manifest.revokeUrl,
    origin: new URL(manifest.manifestUrl).origin,
    identity: signed.address,
    linkedAt: new Date().toISOString(),
  };
  saveDelegateLink(record);
  return record;
}

export async function revokeDelegate(args: {
  record: DelegateLinkRecord;
  mnemonic: string;
  passphrase?: string;
}): Promise<void> {
  const { record, mnemonic, passphrase = "" } = args;
  const message = [
    "Honest Money - Revoke link",
    "",
    `Domain: ${record.host}`,
    `Link: ${record.linkId}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(record.revokeUrl)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ link_id: record.linkId, identity_address: signed.address, signature: signed.signature, message }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error((body?.["error"] as string) ?? `Revoke failed (${res.status})`);
  }
}

/* ------------------------------ local records ---------------------------- */

/** This wallet's branch book, folding in the legacy counter and existing links. */
export function currentBranchBook(): BranchBook {
  return loadBranchBook(legacyPocketAccount(), listDelegateLinks());
}

const STORE = "hme:delegate-links";
export const DELEGATE_LINKS_EVENT = "hme:delegate-links-changed";

export function listDelegateLinks(): DelegateLinkRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(scopedKey(STORE)) ?? "[]") as DelegateLinkRecord[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list: DelegateLinkRecord[]) {
  window.localStorage.setItem(scopedKey(STORE), JSON.stringify(list));
  window.dispatchEvent(new Event(DELEGATE_LINKS_EVENT));
}

export function saveDelegateLink(r: DelegateLinkRecord) {
  write([...listDelegateLinks().filter((l) => l.linkId !== r.linkId), r]);
}

export function removeDelegateLink(linkId: string) {
  write(listDelegateLinks().filter((l) => l.linkId !== linkId));
}

export async function fetchDelegateManifest(manifestUrl: string): Promise<DelegateManifest> {
  const registry = await getEcosystemSites();
  setEcosystemSites(registry.sites, true);
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifestUrl)}`, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new Error((body?.["error"] as string) ?? "Could not read the link");
  return validateDelegate(body, manifestUrl);
}

/** Peek a manifest's type so the Ecosystem links box can route it. */
export async function peekManifestType(manifestUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifestUrl)}`, { headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return typeof body?.["type"] === "string" ? (body["type"] as string) : null;
  } catch {
    return null;
  }
}
