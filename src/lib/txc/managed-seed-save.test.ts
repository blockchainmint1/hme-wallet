import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ password: vi.fn(), envelope: vi.fn(), save: vi.fn(), add: vi.fn() }));
vi.mock("./session-cache", () => ({ getSessionPassword: mocks.password }));
vi.mock("./storage", () => ({ loadEnvelope: mocks.envelope, saveWallet: mocks.save, saveWalletToNewProfile: mocks.add }));
import { managedSeedPassword, saveManagedSeedWallet } from "./managed-seed-save";
const wallet = { mnemonic: "test-only draft", passphrase: "", kind: "bip44" as const, label: "New wallet" };
beforeEach(() => { vi.resetAllMocks(); mocks.password.mockReturnValue("shared-password"); mocks.envelope.mockReturnValue(null); });
describe("managed seed saves", () => {
  it("an add refuses missing password without any wallet write", async () => {
    mocks.password.mockReturnValue(null);
    await expect(saveManagedSeedWallet(wallet, true, true, "new-password")).rejects.toThrow("session has locked");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("refuses a locked add even when password is present", async () => {
    await expect(saveManagedSeedWallet(wallet, true, false, "")).rejects.toThrow("session has locked");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("rechecks expiration between import start and save", async () => {
    expect(managedSeedPassword(true, true, "")).toBe("shared-password");
    mocks.password.mockReturnValue(null);
    await expect(saveManagedSeedWallet(wallet, true, true, "")).rejects.toThrow("session has locked");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("an unlocked add uses only a new profile and the current shared password", async () => {
    mocks.envelope.mockReturnValue({ ciphertext: "original" });
    expect(await saveManagedSeedWallet(wallet, true, true, "different-password")).toBe("shared-password");
    expect(mocks.add).toHaveBeenCalledWith(wallet, "shared-password"); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("initial setup cannot replace an existing envelope", async () => {
    mocks.envelope.mockReturnValue({ ciphertext: "original" });
    await expect(saveManagedSeedWallet(wallet, false, false, "new-password")).rejects.toThrow("already exists");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("initial setup without an existing wallet still works", async () => {
    expect(await saveManagedSeedWallet(wallet, false, false, "initial-password")).toBe("initial-password");
    expect(mocks.save).toHaveBeenCalledWith(wallet, "initial-password"); expect(mocks.add).not.toHaveBeenCalled();
  });
});