/**
 * Fetches the trusted-site registry published by the Honest.Money Ecosystem
 * site. The response is signed with the wallet's dedicated site API key:
 *   x-hme-timestamp: unix seconds
 *   x-hme-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 * Unsigned or badly signed lists are rejected, so a hijacked response can't
 * mark a phishing site as trusted. Spec: docs/ecosystem-trusted-sites.md
 */
import { createHmac, timingSafeEqual } from "crypto";
import { ecosystemCredential } from "./ecosystem-credential.server";

export interface EcosystemSite {
  host: string;
  label: string;
  /** HME grants trading/spending access only to sites marked delegate: true. */
  delegate: boolean;
  /** Link modes HME allows this site ("approve" = xpubs only, "access" = spending key). */
  delegate_modes: ("approve" | "access")[];
  /** Trading branches (hardened accounts) HME reserved for this site. */
  delegate_branches: number[];
}

const DEFAULT_URL = "https://honest.money/api/public/v1/trusted-sites";
let cache: { at: number; sites: EcosystemSite[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * honest.money usually answers in under a second but occasionally stalls past
 * the timeout. Try twice (8s each) on timeouts, network errors and 5xx; any
 * other answer is final. The response is still signature-checked by the caller.
 */
async function fetchRegistry(url: string, secret: string, site: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${secret}`, "X-HME-Site": site },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return res;
      if (res.status < 500) throw Object.assign(new Error(`registry ${res.status}`), { final: true });
      last = new Error(`registry ${res.status}`);
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("registry unavailable");
}

export async function loadEcosystemSites(): Promise<EcosystemSite[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sites;
  // HME_ECOSYSTEM now contains the newly issued wallet-only site key.
  const { apiKey: secret, site } = ecosystemCredential();
  const res = await fetchRegistry(process.env["ECOSYSTEM_SITES_URL"] || DEFAULT_URL, secret, site);
  const { readBoundedText } = await import("./security/json-proxy.server");
  const body = await readBoundedText(res, 128 * 1024);
  const ts = res.headers.get("x-hme-timestamp") ?? "";
  const sig = res.headers.get("x-hme-signature") ?? "";
  if (!/^\d{10,13}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig)) throw new Error("registry signature malformed");
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("registry signature invalid");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error("registry signature stale");
  const parsed = JSON.parse(body) as {
    sites?: { host?: unknown; label?: unknown; active?: unknown; delegate?: unknown; delegate_modes?: unknown; delegate_branches?: unknown }[];
  };
  const sites = (parsed.sites ?? [])
    .filter((s) => typeof s.host === "string" && s.active !== false)
    .map((s) => ({
      host: String(s.host).toLowerCase(),
      label: typeof s.label === "string" ? s.label : "",
      // Missing or anything but literal true means no spending authority.
      delegate: s.delegate === true,
      delegate_modes: (Array.isArray(s.delegate_modes) ? s.delegate_modes : [])
        .filter((m): m is "approve" | "access" => m === "approve" || m === "access")
        .slice(0, 2),
      // Range/reserved checks happen in the client policy (web-login-hosts).
      delegate_branches: (Array.isArray(s.delegate_branches) ? s.delegate_branches : [])
        .filter((b): b is number => typeof b === "number" && Number.isInteger(b))
        .slice(0, 50),
    }))
    .slice(0, 500);
  cache = { at: Date.now(), sites };
  return sites;
}
