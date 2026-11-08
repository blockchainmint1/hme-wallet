import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { webBuildVerdict } from "./app-release";

describe("stale-tab detection", () => {
  it("flags a tab whose build differs from the server's", () => {
    expect(webBuildVerdict({ local: "1794054415610", server: "1794100000000", reloadedFor: null })).toBe("update");
  });

  it("treats a matching build as current", () => {
    expect(webBuildVerdict({ local: "1794054415610", server: "1794054415610", reloadedFor: null })).toBe("current");
  });

  it("stops asking after one reload for the same server build", () => {
    expect(
      webBuildVerdict({ local: "1794054415610", server: "1794100000000", reloadedFor: "1794100000000" }),
    ).toBe("current");
  });

  it("asks again when a newer server build appears after that reload", () => {
    expect(
      webBuildVerdict({ local: "1794054415610", server: "1794200000000", reloadedFor: "1794100000000" }),
    ).toBe("update");
  });

  it("says unknown when the server can't be reached", () => {
    expect(webBuildVerdict({ local: "1794054415610", server: null, reloadedFor: null })).toBe("unknown");
  });
});
