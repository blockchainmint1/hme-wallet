/**
 * The project's .env is shipped with the source (the dev preview reads only
 * .env), so it may hold publishable values only. Any new name, or a value that
 * looks like a secret key, fails here before it can reach an export or repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED = new Set([
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
]);

function parse(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const name = (i < 0 ? l : l.slice(0, i)).replace(/^export\s+/, "").trim();
      const value = i < 0 ? "" : l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      return [name, value];
    });
}

function looksSecret(value: string): boolean {
  if (/^sb_secret_/.test(value)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { role?: string };
      if (claims.role && claims.role !== "anon") return true;
    } catch {
      /* not a JWT */
    }
  }
  return false;
}

const ENV = resolve(process.cwd(), ".env");

describe(".env holds publishable values only", () => {
  it("rejects names outside the allowlist and secret-looking values", () => {
    expect(parse("FOO=1").every(([n]) => ALLOWED.has(n))).toBe(false);
    expect(looksSecret("sb_secret_abc")).toBe(true);
    const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    expect(looksSecret(serviceJwt)).toBe(true);
    expect(looksSecret("sb_publishable_abc")).toBe(false);
  });

  it.skipIf(!existsSync(ENV))("the project's .env passes", () => {
    const entries = parse(readFileSync(ENV, "utf8"));
    expect(entries.map(([n]) => n).filter((n) => !ALLOWED.has(n))).toEqual([]);
    expect(entries.filter(([, v]) => looksSecret(v)).map(([n]) => n)).toEqual([]);
  });
});
