/**
 * The optional BIP39 passphrase ("25th word") turns the same 12/24 words into a
 * completely different wallet. Password managers can silently drop a saved
 * password into it, so the wallet must make a filled passphrase visible and
 * confirmed before using it. Pure helpers, tested.
 */

/** Plain-language note about what's in the passphrase field, or null when empty. */
export function passphraseWarning(passphrase: string): string | null {
  if (passphrase.length === 0) return null;
  const n = passphrase.length;
  const parts = [
    `The extra passphrase field has ${n} character${n === 1 ? "" : "s"} in it. ` +
      "With a passphrase, these same words open a different wallet with different addresses. " +
      "Only keep it if you set this passphrase when the wallet was first made — a password manager may have filled it in.",
  ];
  if (passphrase.trim() !== passphrase) parts.push("It starts or ends with a space, and spaces count.");
  return parts.join(" ");
}

/** A filled passphrase may be used only after the member confirmed that exact value. */
export function passphraseNeedsConfirm(passphrase: string, confirmed: string | null): boolean {
  return passphrase.length > 0 && confirmed !== passphrase;
}
