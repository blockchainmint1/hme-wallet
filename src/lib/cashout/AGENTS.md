# Cash-out

- TSD cash-out key is profile-scoped (src/lib/cashout/api-key.ts): link claims write to the wallet captured before any await, records keep only an 8-hex fingerprint, the legacy device-wide key migrates once (marker; a reappearing unprefixed key is the default wallet's), and cash-out orders re-check wallet+key fingerprint before signing. Why: an account token must never cross wallets.
