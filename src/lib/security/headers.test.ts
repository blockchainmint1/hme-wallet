import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_META, SECURITY_HEADERS } from "./headers";

describe("local camera policy", () => {
  it("permits only same-origin/blob camera media in both shells", () => {
    for (const policy of [CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_META]) {
      expect(policy.split("; ").find((d) => d.startsWith("media-src "))).toBe("media-src 'self' blob:");
    }
  });
  it("retains same-origin camera permission and excludes general eval", () => {
    expect(SECURITY_HEADERS["Permissions-Policy"]).toBe("camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });
});