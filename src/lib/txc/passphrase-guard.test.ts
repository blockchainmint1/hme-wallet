import { describe, expect, it } from "vitest";
import { passphraseNeedsConfirm, passphraseWarning } from "./passphrase-guard";

describe("extra passphrase safeguards", () => {
  it("an empty passphrase needs no warning or confirmation", () => {
    expect(passphraseWarning("")).toBeNull();
    expect(passphraseNeedsConfirm("", null)).toBe(false);
  });
  it("any filled passphrase must be confirmed before import", () => {
    expect(passphraseNeedsConfirm("hunter2", null)).toBe(true);
    expect(passphraseNeedsConfirm("hunter2", "hunter2")).toBe(false);
  });
  it("changing the passphrase after confirming needs a new confirmation", () => {
    expect(passphraseNeedsConfirm("hunter22", "hunter2")).toBe(true);
  });
  it("warns with the character count and about spaces", () => {
    expect(passphraseWarning("abc")).toMatch(/3 characters/);
    expect(passphraseWarning(" abc")).toMatch(/space/);
    expect(passphraseWarning("abc")).not.toMatch(/space/);
  });
});
