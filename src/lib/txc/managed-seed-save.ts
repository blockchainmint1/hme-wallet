import { getSessionPassword } from "./session-cache";
import { loadEnvelope, saveWallet, saveWalletToNewProfile, type UnlockedWallet } from "./storage";

/** Add intent is immutable; missing/expired credentials must never select replacement. */
export function managedSeedPassword(add: boolean, unlocked: boolean, initialPassword: string): string {
  if (add) {
    const password = getSessionPassword();
    if (!unlocked || !password) throw new Error("Your session has locked. Go back, unlock your wallet, and try again.");
    return password;
  }
  if (loadEnvelope()) throw new Error("A wallet already exists. Use Add wallet to keep it and add another.");
  return initialPassword;
}

export async function saveManagedSeedWallet(wallet: UnlockedWallet, add: boolean, unlocked: boolean, initialPassword: string): Promise<string> {
  // Read again at the save boundary, never from form-mount state.
  const password = managedSeedPassword(add, unlocked, initialPassword);
  if (add) await saveWalletToNewProfile(wallet, password);
  else await saveWallet(wallet, password);
  return password;
}